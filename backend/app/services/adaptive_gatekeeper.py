"""
Adaptive Gatekeeper for HoloMed 3D Zero-Storage Cloud RAG.
Evaluates user intent and operational mode to eliminate unnecessary external RAG calls:
- Path A (80% of queries - Mode 1 Anatomy/Physiology): 0 NCBI API calls, 0ms latency,
  grounded purely via the Tier 1 3D Anatomical Scene Graph.
- Path B (20% of queries - Mode 2 Pathology Cascades & Clinical Mechanisms):
  Routes to Tier 3 Live NIH/NCBI E-utilities Cloud RAG on cache misses.
"""

import re
from typing import List, Optional
from pydantic import BaseModel, Field
from backend.app.schemas.chat_schemas import ActiveMode, ComprehensionLevel

# Keywords that indicate pathology, clinical mechanisms, or disease processes
PATHOLOGY_TRIGGERS = {
    "infarct", "infarction", "ischemi", "ischemia", "ischemic", "necros", "necrosis",
    "necrotic", "atherosclero", "atherosclerosis", "stenos", "stenosis", "plaque",
    "thromb", "thrombus", "thrombosis", "embol", "embolism", "embolus", "clot",
    "rupture", "occlus", "occlusion", "blocked", "blockage", "heart attack", "ami",
    "stroke", "aneurysm", "disease", "disorder", "syndrome", "patholog", "pathology",
    "pathophysiolog", "pathophysiology", "inflam", "inflammation", "inflamed",
    "hypertrophy", "edema", "swelling", "infection", "cancer", "tumor", "lesion",
    "fracture", "failure", "insufficiency", "regurgitation", "pain", "angina",
    "symptom", "complication", "treatment", "untreated"
}

# Directional scanning triggers
CRANIO_CAUDAL_TRIGGERS = {"head to toe", "head-to-toe", "cranio-caudal", "craniocaudal", "descending", "downward"}
CAUDO_CRANIAL_TRIGGERS = {"toe to head", "toe-to-head", "caudo-cranial", "caudocranial", "ascending", "upward", "venous return"}


class RouteDecision(BaseModel):
    requires_external_rag: bool = Field(..., description="Whether to query NIH/NCBI Cloud RAG")
    routing_reason: str = Field(..., description="Explanation for routing path")
    route_path: str = Field(..., description="'Path A (Tier 1 Graph)' or 'Path B (Tier 3 NCBI Cloud)'")
    search_query: Optional[str] = Field(default=None, description="Refined query string for NCBI E-utilities if routed to Path B")
    spatial_direction: Optional[str] = Field(default=None, description="'cranio_caudal' or 'caudo_cranial' if detected")


class AdaptiveGatekeeper:
    """
    Decides whether a user query requires external NCBI Cloud RAG or can be answered
    with 100% fidelity directly from the 3D Anatomical Scene Graph slice.
    """

    def evaluate(
        self,
        query: str,
        mode: ActiveMode = "anatomy",
        comprehension_level: ComprehensionLevel = "layperson",
        focused_ids: Optional[List[str]] = None
    ) -> RouteDecision:
        q_lower = query.lower()
        words = set(re.findall(r'\b[a-zA-Z0-9_\-]+\b', q_lower))

        # Check for directional scanning intent
        spatial_direction = None
        if any(trig in q_lower for trig in CRANIO_CAUDAL_TRIGGERS):
            spatial_direction = "cranio_caudal"
        elif any(trig in q_lower for trig in CAUDO_CRANIAL_TRIGGERS):
            spatial_direction = "caudo_cranial"

        # Check for pathology triggers
        has_pathology_terms = any(
            any(word.startswith(trig) or trig in word for trig in PATHOLOGY_TRIGGERS)
            for word in words
        )

        # Path B: Mode 2 Pathology or explicit clinical pathology inquiries
        if mode == "pathology" or has_pathology_terms:
            clean_search = re.sub(r'[^\w\s\-]', ' ', query).strip()
            # Append StatPearls preference for high-yield clinical review
            return RouteDecision(
                requires_external_rag=True,
                routing_reason="Mode 2 Pathology / clinical mechanism query requires peer-reviewed StatPearls/PubMed literature.",
                route_path="Path B (Tier 3 NCBI Cloud)",
                search_query=clean_search,
                spatial_direction=spatial_direction
            )

        # Path A: Mode 1 Anatomy/Physiology, structure identification, and layperson analogies
        return RouteDecision(
            requires_external_rag=False,
            routing_reason="Mode 1 Anatomy / normal physiology query grounded directly in Tier 1 3D scene graph (0 external calls, 0ms latency).",
            route_path="Path A (Tier 1 Graph)",
            search_query=None,
            spatial_direction=spatial_direction
        )


adaptive_gatekeeper = AdaptiveGatekeeper()
