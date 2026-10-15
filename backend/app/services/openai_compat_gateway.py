import os
import re
import time
from typing import AsyncGenerator, Dict, List, Optional, Tuple
from urllib.parse import urlparse, urlunparse

import httpx
from openai import AsyncOpenAI
from fastapi import HTTPException

from backend.app.schemas.llm_schemas import ModelInfo
from backend.app.config import settings


# Client cache: (normalized_base_url, api_key) -> AsyncOpenAI
_client_cache: Dict[Tuple[str, str], AsyncOpenAI] = {}


def normalize_base_url(url: str | None) -> str:
    """
    Normalizes any OpenAI-compatible base URL.
    - Strips leading/trailing whitespace and trailing slashes.
    - Normalizes known OpenRouter and Google Gemini OpenAI-compatible endpoints.
    - Strips accidental `/chat/completions` or `/models` suffixes.
    - Appends `/v1` if there is no path component.
    """
    raw = (url or os.getenv("DEFAULT_LLM_BASE_URL") or settings.DEFAULT_OPENAI_BASE_URL or "https://openrouter.ai/api/v1").strip()
    if not (raw.startswith("http://") or raw.startswith("https://")):
        raw = "https://" + raw

    raw = raw.rstrip("/")

    # Known domain shortcuts
    if "openrouter.ai" in raw and not raw.endswith("/api/v1"):
        return "https://openrouter.ai/api/v1"
    if "generativelanguage.googleapis.com" in raw and not raw.endswith("/openai"):
        return "https://generativelanguage.googleapis.com/v1beta/openai"

    parsed = urlparse(raw)
    scheme = parsed.scheme
    netloc = parsed.netloc
    path = parsed.path.rstrip("/")

    # Strip accidental endpoint suffixes
    suffixes_to_strip = [
        "/chat/completions",
        "/models",
        "/completions",
        "/embeddings"
    ]
    for suffix in suffixes_to_strip:
        if path.endswith(suffix):
            path = path[:-len(suffix)].rstrip("/")

    # If no path is left or path is empty, append /v1
    if not path or path == "":
        path = "/v1"

    normalized = urlunparse((scheme, netloc, path, "", "", ""))
    return normalized.rstrip("/")


def resolve_api_key(request_api_key: Optional[str], normalized_url: str) -> str:
    """
    Resolves the API key from the request payload, environment variables,
    or settings so OpenRouter / Gemini / OpenAI never fail with 401 Missing Authentication header.
    """
    candidates = [
        request_api_key,
        os.getenv("DEFAULT_LLM_API_KEY"),
        os.getenv("OPENROUTER_API_KEY"),
        os.getenv("GEMINI_API_KEY"),
        os.getenv("OPENAI_API_KEY"),
        settings.DEFAULT_OPENAI_API_KEY,
    ]
    for key in candidates:
        if key and isinstance(key, str):
            clean = key.strip()
            if clean and clean not in ("null", "undefined", "YOUR_API_KEY", "local-no-key"):
                return clean

    # Local Ollama / LM Studio endpoints do not require an API key
    if "localhost" in normalized_url or "127.0.0.1" in normalized_url:
        return "ollama-local"

    return ""


async def fetch_available_models(base_url: str, api_key: Optional[str] = None) -> List[ModelInfo]:
    """
    Fetches available models from GET {normalized_base_url}/models with strict 10.0s timeout.
    Supports standard OpenAI {"data": [...]}, Anthropic/Ollama {"models": [...]}, or flat lists.
    """
    normalized_url = normalize_base_url(base_url)
    clean_key = resolve_api_key(api_key, normalized_url)
    models_endpoint = f"{normalized_url}/models"

    headers: Dict[str, str] = {
        "Accept": "application/json",
        "User-Agent": "HoloMed3D/2.0",
        "HTTP-Referer": "http://localhost:5173",
        "X-Title": "HoloMed 3D Interactive Anatomy Tutor",
    }
    if clean_key:
        headers["Authorization"] = f"Bearer {clean_key}"

    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            response = await client.get(models_endpoint, headers=headers)

        if response.status_code in (401, 403):
            raise HTTPException(
                status_code=response.status_code,
                detail=f"Authentication failed for {normalized_url}. Please check your API key."
            )
        elif response.status_code >= 400:
            raise HTTPException(
                status_code=response.status_code,
                detail=f"Failed to fetch models from {models_endpoint} (HTTP {response.status_code}): {response.text[:200]}"
            )

        data = response.json()
        raw_models = []

        if isinstance(data, dict):
            if "data" in data and isinstance(data["data"], list):
                raw_models = data["data"]
            elif "models" in data and isinstance(data["models"], list):
                raw_models = data["models"]
            elif "items" in data and isinstance(data["items"], list):
                raw_models = data["items"]
        elif isinstance(data, list):
            raw_models = data

        model_list: List[ModelInfo] = []
        for item in raw_models:
            if isinstance(item, str):
                model_list.append(ModelInfo(id=item, owned_by=None))
            elif isinstance(item, dict) and "id" in item:
                model_list.append(ModelInfo(
                    id=str(item["id"]),
                    owned_by=item.get("owned_by") or item.get("owner"),
                    created=item.get("created")
                ))
            elif isinstance(item, dict) and "name" in item:
                model_list.append(ModelInfo(
                    id=str(item["name"]),
                    owned_by=item.get("owned_by") or item.get("owner"),
                    created=item.get("created")
                ))

        model_list.sort(key=lambda m: m.id.lower())
        return model_list

    except httpx.TimeoutException:
        raise HTTPException(
            status_code=504,
            detail=f"Connection timed out after 10.0s when querying {models_endpoint}."
        )
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Could not connect to provider at {models_endpoint}: {str(exc)}"
        )


def get_async_openai_client(base_url: str, api_key: Optional[str] = None) -> AsyncOpenAI:
    """
    Returns a cached AsyncOpenAI client configured for the normalized base URL and resolved auth header.
    """
    normalized_url = normalize_base_url(base_url)
    clean_key = resolve_api_key(api_key, normalized_url) or "local-no-key"
    cache_key = (normalized_url, clean_key)

    if cache_key not in _client_cache:
        headers = {
            "Authorization": f"Bearer {clean_key}",
            "HTTP-Referer": "http://localhost:5173",
            "X-Title": "HoloMed 3D Interactive Anatomy Tutor",
        }
        _client_cache[cache_key] = AsyncOpenAI(
            base_url=normalized_url,
            api_key=clean_key,
            default_headers=headers,
            timeout=httpx.Timeout(45.0, connect=10.0)
        )
    return _client_cache[cache_key]


async def test_model_connection(base_url: str, api_key: Optional[str], model_id: str) -> dict:
    """
    Tests an OpenAI-compatible endpoint with a minimal completion to verify connectivity and latency.
    """
    normalized_url = normalize_base_url(base_url)
    client = get_async_openai_client(normalized_url, api_key)

    start_time = time.perf_counter()
    try:
        response = await client.chat.completions.create(
            model=model_id,
            messages=[
                {"role": "user", "content": "Ping: say OK in one word."}
            ],
            max_tokens=5,
            temperature=0.0
        )
        latency_ms = round((time.perf_counter() - start_time) * 1000, 1)
        content = ""
        if response.choices and len(response.choices) > 0 and response.choices[0].message:
            content = response.choices[0].message.content or ""

        return {
            "success": True,
            "message": f"Successfully connected to {model_id} ({latency_ms}ms)",
            "latency_ms": latency_ms,
            "sample_output": content.strip()
        }
    except Exception as exc:
        latency_ms = round((time.perf_counter() - start_time) * 1000, 1)
        return {
            "success": False,
            "message": f"Connection test failed for {model_id}: {str(exc)}",
            "latency_ms": latency_ms,
            "sample_output": None
        }


async def stream_openai_compatible_chat(
    messages: list[dict[str, str]],
    model: str,
    base_url: Optional[str] = None,
    api_key: Optional[str] = None,
    temperature: float = 0.25,
) -> AsyncGenerator[str, None]:
    """
    Direct asynchronous generator streaming completions with user-friendly fallback if key is missing.
    """
    normalized_url = normalize_base_url(base_url)
    clean_key = resolve_api_key(api_key, normalized_url)

    if not clean_key and not ("localhost" in normalized_url or "127.0.0.1" in normalized_url):
        yield (
            "**API Key Required:** Please click the **Provider Settings (⚙️)** button in the top-right "
            "navbar, paste your API key (OpenRouter, Google Gemini, or OpenAI), and click **Save**."
        )
        return

    client = get_async_openai_client(normalized_url, clean_key)

    stream = await client.chat.completions.create(
        model=model or os.getenv("DEFAULT_LLM_MODEL", "google/gemini-2.5-flash"),
        messages=messages,  # type: ignore[arg-type]
        temperature=temperature,
        stream=True,
    )

    async for chunk in stream:
        if chunk.choices and chunk.choices[0].delta and chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content
