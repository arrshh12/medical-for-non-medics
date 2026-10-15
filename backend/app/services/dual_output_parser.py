"""
Streaming Dual-Output Parser for HoloMed 3D.
Processes token streams from OpenAI-compatible providers, interleaving real-time
narrative text deltas and validated 3D WebGL scene commands (<scene_cmd>...</scene_cmd>).
Enforces Rule 4 citation grounding (stripping/verifying [source_id] tags) and
resilient JSON recovery with Pydantic v2 validation.
"""

import json
import logging
import re
from typing import Any, AsyncIterator, Dict, List, Optional, Set, Union

from backend.app.schemas.chat_schemas import CitationItem
from backend.app.schemas.scene_command_schemas import SceneCommandSchema

logger = logging.getLogger(__name__)

# State constants
STATE_TEXT = "TEXT"
STATE_COMMAND = "COMMAND"

# Regex for tag boundaries
RE_OPEN_TAG = re.compile(r'<\s*scene_cmd\s*>', re.IGNORECASE)
RE_CLOSE_TAG = re.compile(r'<\s*/\s*scene_cmd\s*>', re.IGNORECASE)

# Regex to detect bracketed citation patterns: [NBK459269], [PMID12345], [source_id]
# Capture group 1: citation tag content, Capture group 2: following character (e.g. '(' for markdown links)
RE_CITATION = re.compile(r'\[([A-Za-z0-9_\-\s:]+)\](\(?)')


def repair_json_payload(raw_text: str) -> str:
    """
    Cleans and repairs common LLM JSON syntax artifacts:
    - Strips markdown code block wrappers (```json ... ```)
    - Removes illegal trailing commas before closing braces/brackets
    - Normalizes unescaped whitespace/newlines
    """
    cleaned = raw_text.strip()

    # Strip markdown code fences
    cleaned = re.sub(r'^\s*```(?:json)?\s*', '', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'\s*```\s*$', '', cleaned)
    cleaned = cleaned.strip()

    # Remove trailing commas: e.g. {"a": 1, } or [1, 2, ]
    cleaned = re.sub(r',\s*([}\]])', r'\1', cleaned)

    return cleaned


def is_potential_tag_prefix(text: str, is_closing: bool = False) -> bool:
    """
    Checks if the given string could be the starting prefix of a <scene_cmd> or </scene_cmd> tag.
    Used to hold back potential tag boundary characters during streaming.
    """
    if not text or not text.startswith('<'):
        return False

    norm = text.lower().replace(' ', '')
    target = "</scene_cmd>" if is_closing else "<scene_cmd>"

    # Check if target starts with normalized prefix
    return target.startswith(norm)


class DualOutputParser:
    """
    State machine parser consuming token deltas from an AsyncOpenAI completion stream.
    Multiplexes output into typed Server-Sent Events (SSE):
    - 'scene_command': Validated 3D scene action (SceneCommandSchema)
    - 'text_delta': Natural language explanation for user chat UI
    - 'citation': Literature citation card metadata
    """

    def __init__(
        self,
        retrieved_chunks: Optional[List[Union[Dict[str, Any], CitationItem]]] = None
    ):
        self.mode: str = STATE_TEXT
        self.text_buffer: str = ""
        self.command_buffer: str = ""

        # Map of verified source IDs for Rule 4 citation gating
        self.verified_sources: Dict[str, CitationItem] = {}
        self.emitted_citations: Set[str] = set()

        if retrieved_chunks:
            self._register_verified_sources(retrieved_chunks)

    def _register_verified_sources(
        self,
        chunks: List[Union[Dict[str, Any], CitationItem]]
    ) -> None:
        """
        Indexes verified literature sources by normalized ID keys.
        """
        for chunk in chunks:
            if isinstance(chunk, CitationItem):
                item = chunk
            elif isinstance(chunk, dict):
                try:
                    item = CitationItem(
                        source_id=chunk.get("source_id", "Unknown"),
                        source_type=chunk.get("source_type", "StatPearls"),
                        title=chunk.get("title", ""),
                        section=chunk.get("section", chunk.get("section_heading", "")),
                        excerpt=chunk.get("excerpt", chunk.get("content", ""))[:400],
                        citation_url=chunk.get("citation_url", "https://www.ncbi.nlm.nih.gov/")
                    )
                except Exception as exc:
                    logger.warning(f"[DualOutputParser] Failed to construct CitationItem: {exc}")
                    continue
            else:
                continue

            sid = item.source_id.strip()
            self.verified_sources[sid.upper()] = item
            self.verified_sources[sid.lower()] = item
            self.verified_sources[sid] = item

            # Strip common prefixes (e.g. 'NBK' or 'PMID') for numeric match
            num_match = re.search(r'\d+', sid)
            if num_match:
                self.verified_sources[num_match.group(0)] = item

    def _parse_scene_command(self, raw_json: str) -> Optional[Dict[str, Any]]:
        """
        Parses, repairs, and validates a JSON string against SceneCommandSchema.
        Emits a structured 'scene_command' event dictionary or logs non-fatal error.
        """
        repaired = repair_json_payload(raw_json)
        if not repaired:
            return None

        data: Optional[Dict[str, Any]] = None

        # Pass 1: Direct JSON parsing
        try:
            data = json.loads(repaired)
        except Exception:
            pass

        # Pass 2: Fallback regex repair for single quotes or missing outer braces
        if data is None:
            try:
                # Replace single quotes with double quotes for valid JSON
                repaired_quotes = re.sub(r"'([^'\\]*(?:\\.[^'\\]*)*)'", r'"\1"', repaired)
                data = json.loads(repaired_quotes)
            except Exception:
                pass

        # Pass 3: Extract first outer brace pair
        if data is None:
            first_brace = repaired.find('{')
            last_brace = repaired.rfind('}')
            if first_brace != -1 and last_brace > first_brace:
                try:
                    trimmed = repaired[first_brace:last_brace + 1]
                    trimmed = re.sub(r',\s*([}\]])', r'\1', trimmed)
                    data = json.loads(trimmed)
                except Exception:
                    pass

        if data is None or not isinstance(data, dict):
            logger.warning(f"[DualOutputParser] Failed to parse scene command JSON: {raw_json[:150]}")
            return None

        # Action normalization (e.g. 'focus_structure' -> 'FOCUS_STRUCTURE')
        if "action" in data and isinstance(data["action"], str):
            data["action"] = data["action"].strip().upper()

        # Validate with Pydantic v2
        try:
            command = SceneCommandSchema.model_validate(data)
            return {
                "event": "scene_command",
                "data": command.model_dump()
            }
        except Exception as err:
            logger.warning(f"[DualOutputParser] SceneCommandSchema validation failed: {err} | Raw: {data}")
            return None

    def _process_text_and_verify_citations(
        self,
        text: str
    ) -> Tuple[str, List[Dict[str, Any]]]:
        """
        Scans narrative text for [source_id] citations.
        - Verified citations: preserved in text, and 'citation' SSE events are generated.
        - Hallucinated citations (not present in verified_sources): stripped from text (Rule 4).
        - Markdown links like [Heart](url): preserved unchanged.
        """
        if not text:
            return "", []

        citation_events: List[Dict[str, Any]] = []

        def replace_citation(match: re.Match) -> str:
            tag_content = match.group(1).strip()
            following_char = match.group(2)

            # If followed by '(', this is a markdown link: preserve completely
            if following_char == "(":
                return match.group(0)

            # Clean and normalize candidate citation ID
            clean_tag = tag_content.upper()
            clean_tag = re.sub(r'^(STATPEARLS|PUBMED|PMID|NBK)[\s:]+', '', clean_tag)
            clean_tag = clean_tag.replace(" ", "")

            # Look up against verified sources
            matched_item = (
                self.verified_sources.get(tag_content) or
                self.verified_sources.get(tag_content.upper()) or
                self.verified_sources.get(clean_tag)
            )

            # Numeric fallback (e.g. matching '459269' against 'NBK459269')
            if not matched_item:
                num_match = re.search(r'\d+', tag_content)
                if num_match:
                    matched_item = self.verified_sources.get(num_match.group(0))

            if matched_item:
                # Verified: emit citation event once
                source_key = matched_item.source_id.upper()
                if source_key not in self.emitted_citations:
                    self.emitted_citations.add(source_key)
                    citation_events.append({
                        "event": "citation",
                        "data": matched_item.model_dump()
                    })
                return f"[{tag_content}]"
            else:
                # If it looks like a citation tag (NBK..., PMID..., or author/year), strip it (Rule 4)
                looks_like_citation = bool(re.match(r'^(NBK|PMID|\d+|[A-Z][a-z]+20\d\d)', tag_content, re.IGNORECASE))
                if looks_like_citation:
                    logger.info(f"[DualOutputParser] Stripped hallucinated citation: [{tag_content}]")
                    return ""
                # Otherwise, keep generic bracketed text
                return f"[{tag_content}]"

        sanitized_text = RE_CITATION.sub(replace_citation, text)
        return sanitized_text, citation_events

    def feed(self, chunk: str) -> List[Dict[str, Any]]:
        """
        Consumes an incoming string chunk of any size and updates the state machine.
        Returns a list of typed event dictionaries ready for SSE streaming.
        """
        events: List[Dict[str, Any]] = []
        if not chunk:
            return events

        while chunk:
            if self.mode == STATE_TEXT:
                self.text_buffer += chunk
                chunk = ""

                # Look for opening <scene_cmd> tag
                open_match = RE_OPEN_TAG.search(self.text_buffer)
                if open_match:
                    # Everything prior to <scene_cmd> is narrative text
                    pre_text = self.text_buffer[:open_match.start()]
                    if pre_text:
                        clean_text, cit_events = self._process_text_and_verify_citations(pre_text)
                        for ce in cit_events:
                            events.append(ce)
                        if clean_text:
                            events.append({
                                "event": "text_delta",
                                "data": {"delta": clean_text}
                            })

                    # Switch to command mode
                    remaining = self.text_buffer[open_match.end():]
                    self.text_buffer = ""
                    self.command_buffer = remaining
                    self.mode = STATE_COMMAND
                    continue
                else:
                    # Check if buffer ends with a potential opening tag prefix (e.g. '<scen')
                    last_lt = self.text_buffer.rfind('<')
                    if last_lt != -1 and (len(self.text_buffer) - last_lt) <= 15:
                        candidate = self.text_buffer[last_lt:]
                        if is_potential_tag_prefix(candidate, is_closing=False):
                            # Hold back candidate tag prefix
                            to_emit = self.text_buffer[:last_lt]
                            if to_emit:
                                clean_text, cit_events = self._process_text_and_verify_citations(to_emit)
                                for ce in cit_events:
                                    events.append(ce)
                                if clean_text:
                                    events.append({
                                        "event": "text_delta",
                                        "data": {"delta": clean_text}
                                    })
                            self.text_buffer = candidate
                            break

                    # Check for unclosed citation bracket at end of buffer (e.g. '[NBK')
                    last_bracket = self.text_buffer.rfind('[')
                    if last_bracket != -1 and ']' not in self.text_buffer[last_bracket:]:
                        if (len(self.text_buffer) - last_bracket) <= 30:
                            to_emit = self.text_buffer[:last_bracket]
                            if to_emit:
                                clean_text, cit_events = self._process_text_and_verify_citations(to_emit)
                                for ce in cit_events:
                                    events.append(ce)
                                if clean_text:
                                    events.append({
                                        "event": "text_delta",
                                        "data": {"delta": clean_text}
                                    })
                            self.text_buffer = self.text_buffer[last_bracket:]
                            break

                    # Emit all accumulated text
                    if self.text_buffer:
                        clean_text, cit_events = self._process_text_and_verify_citations(self.text_buffer)
                        for ce in cit_events:
                            events.append(ce)
                        if clean_text:
                            events.append({
                                "event": "text_delta",
                                "data": {"delta": clean_text}
                            })
                        self.text_buffer = ""
                    break

            elif self.mode == STATE_COMMAND:
                self.command_buffer += chunk
                chunk = ""

                # Look for closing </scene_cmd> tag
                close_match = RE_CLOSE_TAG.search(self.command_buffer)
                if close_match:
                    raw_cmd = self.command_buffer[:close_match.start()]
                    remaining = self.command_buffer[close_match.end():]
                    self.command_buffer = ""
                    self.mode = STATE_TEXT
                    self.text_buffer = remaining

                    # Parse and emit scene command
                    cmd_event = self._parse_scene_command(raw_cmd)
                    if cmd_event:
                        events.append(cmd_event)

                    # Continue loop to process remaining text
                    continue
                else:
                    # Closing tag not yet reached, continue buffering
                    break

        return events

    def flush(self) -> List[Dict[str, Any]]:
        """
        Flushes remaining buffered tokens at stream completion.
        Ensures trailing commands or narrative text are not dropped.
        """
        events: List[Dict[str, Any]] = []

        if self.mode == STATE_COMMAND and self.command_buffer.strip():
            cmd_event = self._parse_scene_command(self.command_buffer)
            if cmd_event:
                events.append(cmd_event)
            self.command_buffer = ""
            self.mode = STATE_TEXT

        if self.text_buffer:
            clean_text, cit_events = self._process_text_and_verify_citations(self.text_buffer)
            for ce in cit_events:
                events.append(ce)
            if clean_text:
                events.append({
                    "event": "text_delta",
                    "data": {"delta": clean_text}
                })
            self.text_buffer = ""

        return events

    async def parse_stream(
        self,
        token_stream: AsyncIterator[Any]
    ) -> AsyncIterator[Dict[str, Any]]:
        """
        Async generator consuming token chunks from an OpenAI-compatible stream.
        Yields typed SSE event dictionaries.
        Supports both string tokens and AsyncOpenAI ChatCompletionChunk objects.
        """
        async for chunk in token_stream:
            # Extract text token depending on chunk type
            token = ""
            if isinstance(chunk, str):
                token = chunk
            elif hasattr(chunk, "choices") and chunk.choices:
                delta = chunk.choices[0].delta
                token = getattr(delta, "content", None) or ""
            elif isinstance(chunk, dict):
                token = chunk.get("delta", {}).get("content", "")

            if not token:
                continue

            events = self.feed(token)
            for event in events:
                yield event

        # Emit remaining buffered content
        for event in self.flush():
            yield event

    @staticmethod
    def to_sse(event_payload: Dict[str, Any]) -> str:
        """
        Helper method to format an event dictionary as a standard SSE wire frame.
        Example:
            event: text_delta
            data: {"delta": "Hello"}
        """
        event_type = event_payload.get("event", "message")
        data = event_payload.get("data", {})
        return f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
