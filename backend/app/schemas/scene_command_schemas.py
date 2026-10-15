from typing import List, Optional, Literal
from pydantic import BaseModel, Field


ActionType = Literal[
    "FOCUS_STRUCTURE",
    "ISOLATE_STRUCTURES",
    "FOCUS_AND_ISOLATE",
    "HIGHLIGHT_STRUCTURES",
    "APPLY_PATHOLOGY",
    "ANIMATE_FLOW",
    "PLACE_ANNOTATION",
    "RESET_SCENE"
]

CameraPreset = Literal[
    "anterior",
    "posterior",
    "left_lateral",
    "right_lateral",
    "superior",
    "inferior",
    "anterior_oblique",
    "superior_oblique"
]

PathologyType = Literal[
    "ischemic",
    "necrotic",
    "inflamed",
    "vascular_occlusion"
]

FlowType = Literal[
    "oxygenated",
    "deoxygenated",
    "lymphatic",
    "neural"
]


class FlowAnimationSchema(BaseModel):
    path_ids: List[str] = Field(..., description="Ordered list of anatomical FMA IDs along flow path")
    speed: float = Field(default=1.0, description="Relative speed multiplier")
    flow_type: FlowType = Field(default="oxygenated", description="Type/color of biological flow")
    blocked: bool = Field(default=False, description="Whether flow is obstructed or turbulent at lesion")


class AnnotationSchema(BaseModel):
    target_id: str = Field(..., description="Target FMA ID mesh to anchor callout pin")
    title: str = Field(..., description="Short heading for the annotation")
    body: str = Field(..., description="Concise explanation text")


class SceneCommandSchema(BaseModel):
    step: int = Field(default=1, description="Step index in multi-step narrative")
    action: ActionType = Field(..., description="3D action verb to execute")
    target_id: Optional[str] = Field(default=None, description="Primary target FMA ID")
    target_ids: Optional[List[str]] = Field(default=None, description="Multiple target FMA IDs")
    fade_occluders: Optional[bool] = Field(default=None, description="Whether to ghost blocking superficial structures")
    camera_preset: Optional[CameraPreset] = Field(default=None, description="Camera viewing angle preset")
    highlight_color: Optional[str] = Field(default=None, description="Hex color string for highlighting")
    pathology_type: Optional[PathologyType] = Field(default=None, description="Type of tissue pathology to apply")
    severity: Optional[float] = Field(default=None, ge=0.0, le=1.0, description="Pathology severity from 0.0 to 1.0")
    downstream_ischemic_ids: Optional[List[str]] = Field(default=None, description="Downstream organ/vessel meshes affected by ischemia")
    flow_animation: Optional[FlowAnimationSchema] = Field(default=None, description="Physiological particle flow configuration")
    annotation: Optional[AnnotationSchema] = Field(default=None, description="3D callout annotation pin")
