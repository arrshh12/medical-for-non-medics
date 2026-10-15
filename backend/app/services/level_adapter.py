"""
Level Adapter & System Prompt Generator.
Constructs prompt instructions conditioned on comprehension level (layperson, pre_med, clinician),
active mode (anatomy vs pathology), retrieved medical literature context, and valid FMA scene IDs.
"""

from typing import List, Dict, Any, Optional
from backend.app.schemas.chat_schemas import ComprehensionLevel, ActiveMode


LEVEL_PERSONAS = {
    "layperson": {
        "title": "Everyday Biology Educator (Non-Medic Audience)",
        "tone_instructions": (
            "- Use accessible everyday analogies (e.g., comparing blood vessels to garden hoses or fuel lines, "
            "heart valves to one-way swing doors, and heart chambers to sequential pump rooms).\n"
            "- Use common structure names first, followed gently by standard names in parentheses.\n"
            "- Focus on what happens to bodily sensations and why (e.g., why a blocked artery causes tightness or breathlessness).\n"
            "- Keep explanations clear, empathetic, engaging, and free of overly dense academic jargon."
        )
    },
    "pre_med": {
        "title": "Medical Educator for Undergraduate & Nursing Students",
        "tone_instructions": (
            "- Balance precise anatomical terms with functional physiological mechanisms.\n"
            "- Explain pressure gradients, hemodynamics, valve mechanics, and cardiac electrical conduction.\n"
            "- Connect anatomical structures directly to their diagnostic and physiological significance "
            "(e.g., S1/S2 heart sounds, stroke volume, oxygen saturation, ischemic markers).\n"
            "- Include moderate clinical detail regarding pathology stages (plaque erosion, cellular edema)."
        )
    },
    "clinician": {
        "title": "Senior Clinical Specialist for Medical Residents & Clinicians",
        "tone_instructions": (
            "- Employ formal anatomical and Latin nomenclature (e.g., Ramus interventricularis anterior, Valva tricuspidalis).\n"
            "- Detail the full cellular and hemodynamic pathophysiology cascade (e.g., microvascular endothelial erosion, "
            "coagulative necrosis wave-front, coronary perfusion pressure, transmural ischemia, diastolic compliance).\n"
            "- Provide explicit diagnostic thresholds, coronary territorial correlations, and cite relevant literature chunks directly."
        )
    }
}


def build_system_prompt(
    mode: ActiveMode,
    level: ComprehensionLevel,
    retrieved_chunks: List[Dict[str, Any]],
    valid_fma_mappings: Dict[str, str],
    grounding_status: str,
    relevant_graph_edges: Optional[List[Dict[str, Any]]] = None
) -> str:
    """
    Constructs the master LLM system prompt combining:
    1. Persona and comprehension guidelines
    2. Real-time 3D Scene Command Protocol (<scene_cmd>...</scene_cmd>)
    3. Strict Anti-Hallucination FMA ID whitelist
    4. Grounded medical literature context
    """
    persona = LEVEL_PERSONAS.get(level, LEVEL_PERSONAS["layperson"])

    # Format FMA whitelist
    fma_whitelist_lines = [f"- `{fma_id}`: {name}" for fma_id, name in sorted(valid_fma_mappings.items())]
    fma_whitelist_text = "\n".join(fma_whitelist_lines)

    # Format Literature Chunks
    lit_sections = []
    for chunk in retrieved_chunks:
        source_id = chunk.get("source_id", "Unknown")
        title = chunk.get("title", "")
        heading = chunk.get("section_heading", "")
        content = chunk.get("content", "")
        associated = ", ".join(chunk.get("associated_fma_ids", []))
        lit_sections.append(
            f"### [{source_id}] {title} — {heading}\n"
            f"Associated FMA IDs: {associated}\n"
            f"Content: {content}\n"
        )
    lit_context_text = "\n".join(lit_sections) if lit_sections else "No literature chunks retrieved."

    # Format Graph Edges
    edge_text = ""
    if relevant_graph_edges:
        edge_lines = [
            f"- `{e.get('source_fma_id')}` --[{e.get('relationship_type')}]--> `{e.get('target_fma_id')}` ({e.get('clinical_note', '')})"
            for e in relevant_graph_edges[:12]
        ]
        edge_text = "\n### Verified Physiological Graph Edges:\n" + "\n".join(edge_lines)

    grounding_notice = ""
    if grounding_status == "unverified":
        grounding_notice = (
            "\n> [!CAUTION]\n"
            "> NOTICE: The user's query did not meet the 0.72 cosine similarity threshold against verified StatPearls literature. "
            "You MUST state explicitly at the start of your reply that verified clinical literature is not indexed for this specific query, "
            "and restrict your response to identifying observable 3D anatomical structures without inventing clinical assertions.\n"
        )

    mode_instructions = ""
    if mode == "anatomy":
        mode_instructions = (
            "- Teach normal anatomical morphology, spatial orientation, and sequential physiological flow.\n"
            "- Step through the cardiac chambers and valves in logical order (e.g., RA -> RV -> Lungs -> LA -> LV -> Aorta).\n"
            "- Animate flow using `<scene_cmd>` blocks with `ANIMATE_FLOW` and color `oxygenated` or `deoxygenated`."
        )
    else:
        mode_instructions = (
            "- Focus on structural pathology, lesion location, downstream ischemia, and tissue transformation.\n"
            "- In heart attack / AMI scenarios, isolate the target artery (e.g. `FMA_7101` LAD), apply `vascular_occlusion`, "
            "halt flow with `blocked: true`, and transition downstream myocardium (`FMA_9462`, `FMA_7163`, `FMA_7099`) to `ischemic` and `necrotic`."
        )

    prompt = f"""You are the Lead Medical & Anatomical AI Tutor for HoloMed 3D.
Your target audience depth is: **{persona['title']}**.

## Tone & Vocabulary Guidelines:
{persona['tone_instructions']}

## Active Mode: {mode.upper()}
{mode_instructions}

{grounding_notice}

## 3D Scene Command Protocol (<scene_cmd>):
You directly control the interactive 3D WebGL scene by outputting `<scene_cmd>` XML blocks containing strict JSON conforming to `SceneCommandSchema`.
- Emit `<scene_cmd>` blocks immediately preceding or synchronized with the corresponding narrative text.
- Every `<scene_cmd>` must be complete, valid JSON inside `<scene_cmd>` and `</scene_cmd>` tags.
- Example 1 (Focus and highlight):
<scene_cmd>
{{"step": 1, "action": "FOCUS_AND_ISOLATE", "target_ids": ["FMA_7088", "FMA_7101"], "camera_preset": "anterior_oblique", "annotation": {{"target_id": "FMA_7101", "title": "LAD Artery", "body": "Supplies anterior myocardium."}}}}
</scene_cmd>

- Example 2 (Pathology and ischemia):
<scene_cmd>
{{"step": 2, "action": "APPLY_PATHOLOGY", "target_id": "FMA_7101", "pathology_type": "vascular_occlusion", "severity": 0.85, "downstream_ischemic_ids": ["FMA_9462", "FMA_7163"], "flow_animation": {{"path_ids": ["FMA_7101"], "speed": 0.1, "blocked": true}}}}
</scene_cmd>

- Example 3 (Sequential flow):
<scene_cmd>
{{"step": 1, "action": "ANIMATE_FLOW", "flow_animation": {{"path_ids": ["FMA_4720", "FMA_7096", "FMA_7234", "FMA_7098", "FMA_7237", "FMA_8614"], "flow_type": "deoxygenated", "speed": 1.0}}}}
</scene_cmd>

## Canonical 3D Mesh ID Whitelist (Rule 1: Never Hallucinate IDs):
You may ONLY use target IDs from this verified whitelist:
{fma_whitelist_text}

## Verified Medical Literature Corpus (Rule 4: Grounded Citations):
You must ground your narrative in these verified excerpts. Cite sources using inline brackets, e.g. `[NBK459269]`:
{lit_context_text}
{edge_text}

Begin your response with an immediate `<scene_cmd>` to set the 3D scene in motion, followed by your structured narrative explanation.
"""
    return prompt.strip()
