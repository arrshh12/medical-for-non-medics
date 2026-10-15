import json
import logging
from typing import AsyncGenerator
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from backend.app.config import settings
from backend.app.schemas.chat_schemas import ChatStreamRequest
from backend.app.services.openai_compat_gateway import (
    normalize_base_url,
    get_async_openai_client
)
from backend.app.services.level_adapter import build_system_prompt

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/chat", tags=["AI Tutor Chat & Streaming"])


@router.post("/stream")
async def chat_stream(req: ChatStreamRequest):
    """
    Synchronized Dual-Output SSE streaming endpoint.
    Retrieves literature & graph context, compiles prompt, and multiplexes
    scene commands and markdown text over Server-Sent Events.
    """
    # 1. Resolve Provider Settings
    base_url = req.base_url or settings.DEFAULT_OPENAI_BASE_URL
    api_key = req.api_key or settings.DEFAULT_OPENAI_API_KEY
    model_id = req.model_id or settings.DEFAULT_MODEL_ID

    try:
        normalized_url = normalize_base_url(base_url)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid base URL: {str(e)}")

    # 2. Dynamic import of RAG Retriever and Dual Output Parser
    try:
        from backend.app.services.rag_retriever import rag_retriever
        from backend.app.services.dual_output_parser import DualOutputParser
    except ImportError as e:
        raise HTTPException(status_code=500, detail=f"RAG services initialization error: {str(e)}")

    # 3. Mandatory Retrieval Before Generation (Rule 4)
    rag_context = await rag_retriever.retrieve_async(
        query=req.message,
        mode=req.mode,
        focused_ids=req.current_focused_ids
    )

    # 4. Construct Grounded System Prompt
    system_prompt = build_system_prompt(
        mode=req.mode,
        level=req.comprehension_level,
        retrieved_chunks=rag_context["retrieved_chunks"],
        valid_fma_mappings=rag_context["valid_fma_mappings"],
        grounding_status=rag_context["grounding_status"],
        relevant_graph_edges=rag_context.get("graph_edges", [])
    )

    # 5. Generator for Server-Sent Events
    async def sse_event_stream() -> AsyncGenerator[str, None]:
        # A. Emit grounding status frame
        yield f"event: grounding_status\ndata: {json.dumps({'status': rag_context['grounding_status'], 'max_similarity': rag_context['max_similarity']})}\n\n"

        # B. Emit citation frames for verified retrieved chunks
        for chunk in rag_context["retrieved_chunks"]:
            cite_data = {
                "source_id": chunk.get("source_id", ""),
                "source_type": chunk.get("source_type", "StatPearls"),
                "title": chunk.get("title", ""),
                "section": chunk.get("section_heading", ""),
                "excerpt": chunk.get("content", "")[:250] + "...",
                "citation_url": chunk.get("citation_url", "")
            }
            yield f"event: citation\ndata: {json.dumps(cite_data)}\n\n"

        # C. Stream completions from dynamic OpenAI-compatible provider
        try:
            client = get_async_openai_client(normalized_url, api_key)
            parser = DualOutputParser(retrieved_chunks=rag_context["retrieved_chunks"])

            stream = await client.chat.completions.create(
                model=model_id,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": req.message}
                ],
                temperature=0.2,
                stream=True
            )

            async for sse_frame in parser.parse_stream(stream):
                yield DualOutputParser.to_sse(sse_frame)

            yield f"event: done\ndata: {json.dumps({'status': 'complete'})}\n\n"

        except Exception as exc:
            logger.error(f"[chat_stream] Streaming failure with {model_id}: {exc}")
            err_payload = {"message": f"LLM stream error from {model_id}: {str(exc)}"}
            yield f"event: error\ndata: {json.dumps(err_payload)}\n\n"

    return StreamingResponse(
        sse_event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )
