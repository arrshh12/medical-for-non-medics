from typing import List, Optional
from pydantic import BaseModel, Field


class FetchModelsRequest(BaseModel):
    base_url: str = Field(..., description="OpenAI-compatible base URL")
    api_key: Optional[str] = Field(default=None, description="Optional or required API key for the endpoint")


class ModelInfo(BaseModel):
    id: str = Field(..., description="Model ID")
    owned_by: Optional[str] = Field(default=None, description="Owner/organization of the model")
    created: Optional[int] = Field(default=None, description="Creation timestamp if available")


class FetchModelsResponse(BaseModel):
    normalized_base_url: str = Field(..., description="Normalized API base URL")
    models: List[ModelInfo] = Field(default_factory=list, description="Available models returned by endpoint")


class TestConnectionRequest(BaseModel):
    base_url: str = Field(..., description="OpenAI-compatible base URL")
    api_key: Optional[str] = Field(default=None, description="API key")
    model_id: str = Field(..., description="Model identifier to test")


class TestConnectionResponse(BaseModel):
    success: bool
    message: str
    latency_ms: float
    sample_output: Optional[str] = None
