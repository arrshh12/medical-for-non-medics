from typing import List, Optional, Literal
from pydantic import BaseModel, Field


ComprehensionLevel = Literal["layperson", "pre_med", "clinician"]
ActiveMode = Literal["anatomy", "pathology"]


class CitationItem(BaseModel):
    source_id: str = Field(..., description="PMID or StatPearls NBK ID")
    source_type: str = Field(default="StatPearls", description="StatPearls or PubMed_OA")
    title: str = Field(..., description="Article / book title")
    section: str = Field(..., description="Section heading")
    excerpt: str = Field(..., description="Verified literature excerpt")
    citation_url: str = Field(..., description="Link to NCBI / PubMed")


class ChatStreamRequest(BaseModel):
    message: str = Field(..., description="User question or follow-up prompt")
    mode: ActiveMode = Field(default="anatomy", description="Active operating mode")
    comprehension_level: ComprehensionLevel = Field(default="layperson", description="Target depth and vocabulary level")
    base_url: Optional[str] = Field(default=None, description="Client-provided OpenAI-compatible base URL")
    api_key: Optional[str] = Field(default=None, description="Client-provided API key")
    model_id: Optional[str] = Field(default=None, description="Model ID to invoke")
    current_focused_ids: Optional[List[str]] = Field(default=None, description="Currently focused or selected FMA IDs in 3D viewport")


class SSEEventPayload(BaseModel):
    event: Literal["scene_command", "text_delta", "citation", "grounding_status", "done", "error"]
    data: dict
