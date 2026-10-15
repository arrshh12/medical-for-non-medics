from fastapi import APIRouter, HTTPException
from backend.app.schemas.llm_schemas import (
    FetchModelsRequest,
    FetchModelsResponse,
    TestConnectionRequest,
    TestConnectionResponse
)
from backend.app.services.openai_compat_gateway import (
    normalize_base_url,
    fetch_available_models,
    test_model_connection
)

router = APIRouter(prefix="/api/v1/llm", tags=["LLM Provider"])


@router.post("/models", response_model=FetchModelsResponse)
async def list_models(req: FetchModelsRequest):
    """
    Auto-fetches all models from any OpenAI-compatible base URL.
    """
    try:
        normalized_url = normalize_base_url(req.base_url)
        models = await fetch_available_models(req.base_url, req.api_key)
        return FetchModelsResponse(
            normalized_base_url=normalized_url,
            models=models
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid base URL or request: {str(exc)}"
        )


@router.post("/test-connection", response_model=TestConnectionResponse)
async def test_connection(req: TestConnectionRequest):
    """
    Pings the specified model at base_url to verify credentials and streaming readiness.
    """
    res = await test_model_connection(req.base_url, req.api_key, req.model_id)
    return TestConnectionResponse(**res)
