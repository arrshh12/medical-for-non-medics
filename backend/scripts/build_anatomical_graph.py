#!/usr/bin/env python3
"""
Seeds the physiological and anatomical dependency graph edges:
- ARTERIAL_SUPPLY (e.g., LAD artery -> anterior septum & LV apex)
- FLOWS_INTO (sequential chamber & valve blood flow)
- OCLUDES_VIEW_OF (superficial skeletal and muscular structures)
- PART_OF (hierarchical containment)
"""

import json
from pathlib import Path

# Dependency Edges
GRAPH_EDGES = [
    # 1. ARTERIAL SUPPLY
    {
        "source_fma_id": "FMA_3734",
        "target_fma_id": "FMA_7101",
        "relationship_type": "ARTERIAL_SUPPLY",
        "clinical_note": "Aorta gives rise to Left Main and Left Anterior Descending coronary artery."
    },
    {
        "source_fma_id": "FMA_7101",
        "target_fma_id": "FMA_9462",
        "relationship_type": "ARTERIAL_SUPPLY",
        "clinical_note": "LAD septal perforators supply anterior 2/3 of interventricular septum."
    },
    {
        "source_fma_id": "FMA_7101",
        "target_fma_id": "FMA_7163",
        "relationship_type": "ARTERIAL_SUPPLY",
        "clinical_note": "LAD wraps around the cardiac apex, providing critical apical perfusion."
    },
    {
        "source_fma_id": "FMA_7101",
        "target_fma_id": "FMA_7099",
        "relationship_type": "ARTERIAL_SUPPLY",
        "clinical_note": "LAD diagonal branches supply the anterior left ventricular free wall."
    },
    {
        "source_fma_id": "FMA_7100",
        "target_fma_id": "FMA_7096",
        "relationship_type": "ARTERIAL_SUPPLY",
        "clinical_note": "Right Coronary Artery supplies the right atrium and SA nodal artery."
    },
    {
        "source_fma_id": "FMA_7100",
        "target_fma_id": "FMA_7098",
        "relationship_type": "ARTERIAL_SUPPLY",
        "clinical_note": "RCA acute marginal branches supply the right ventricular anterior/inferior wall."
    },
    {
        "source_fma_id": "FMA_7105",
        "target_fma_id": "FMA_7097",
        "relationship_type": "ARTERIAL_SUPPLY",
        "clinical_note": "Left Circumflex supplies the lateral left atrium."
    },
    {
        "source_fma_id": "FMA_7105",
        "target_fma_id": "FMA_7099",
        "relationship_type": "ARTERIAL_SUPPLY",
        "clinical_note": "LCX obtuse marginal branches supply the lateral and posterior left ventricle."
    },

    # 2. SEQUENTIAL BLOOD FLOW (CARDIAC CYCLE)
    {
        "source_fma_id": "FMA_4720",
        "target_fma_id": "FMA_7096",
        "relationship_type": "FLOWS_INTO",
        "clinical_note": "Superior Vena Cava returns upper systemic venous blood into Right Atrium."
    },
    {
        "source_fma_id": "FMA_4721",
        "target_fma_id": "FMA_7096",
        "relationship_type": "FLOWS_INTO",
        "clinical_note": "Inferior Vena Cava returns lower systemic venous blood into Right Atrium."
    },
    {
        "source_fma_id": "FMA_7096",
        "target_fma_id": "FMA_7234",
        "relationship_type": "FLOWS_INTO",
        "clinical_note": "Blood passes through the Tricuspid Valve during ventricular diastole."
    },
    {
        "source_fma_id": "FMA_7234",
        "target_fma_id": "FMA_7098",
        "relationship_type": "FLOWS_INTO",
        "clinical_note": "Tricuspid valve directs deoxygenated flow into Right Ventricle."
    },
    {
        "source_fma_id": "FMA_7098",
        "target_fma_id": "FMA_7237",
        "relationship_type": "FLOWS_INTO",
        "clinical_note": "Right ventricle contracts in systole, opening the Pulmonary Valve."
    },
    {
        "source_fma_id": "FMA_7237",
        "target_fma_id": "FMA_8614",
        "relationship_type": "FLOWS_INTO",
        "clinical_note": "Pulmonary valve ejects blood into the Pulmonary Trunk."
    },
    {
        "source_fma_id": "FMA_8614",
        "target_fma_id": "FMA_7309",
        "relationship_type": "FLOWS_INTO",
        "clinical_note": "Right pulmonary artery conducts flow to Right Lung microcirculation."
    },
    {
        "source_fma_id": "FMA_8614",
        "target_fma_id": "FMA_7310",
        "relationship_type": "FLOWS_INTO",
        "clinical_note": "Left pulmonary artery conducts flow to Left Lung microcirculation."
    },
    {
        "source_fma_id": "FMA_7309",
        "target_fma_id": "FMA_7097",
        "relationship_type": "FLOWS_INTO",
        "clinical_note": "Right pulmonary veins return oxygenated blood to Left Atrium."
    },
    {
        "source_fma_id": "FMA_7310",
        "target_fma_id": "FMA_7097",
        "relationship_type": "FLOWS_INTO",
        "clinical_note": "Left pulmonary veins return oxygenated blood to Left Atrium."
    },
    {
        "source_fma_id": "FMA_7097",
        "target_fma_id": "FMA_7236",
        "relationship_type": "FLOWS_INTO",
        "clinical_note": "Oxygenated blood passes across the Mitral Valve during left ventricular filling."
    },
    {
        "source_fma_id": "FMA_7236",
        "target_fma_id": "FMA_7099",
        "relationship_type": "FLOWS_INTO",
        "clinical_note": "Mitral valve fills the Left Ventricle."
    },
    {
        "source_fma_id": "FMA_7099",
        "target_fma_id": "FMA_7238",
        "relationship_type": "FLOWS_INTO",
        "clinical_note": "Left ventricular high-pressure systolic contraction forces open the Aortic Valve."
    },
    {
        "source_fma_id": "FMA_7238",
        "target_fma_id": "FMA_3734",
        "relationship_type": "FLOWS_INTO",
        "clinical_note": "Aortic valve ejects blood into the Ascending Aorta."
    },
    {
        "source_fma_id": "FMA_3734",
        "target_fma_id": "FMA_3735",
        "relationship_type": "FLOWS_INTO",
        "clinical_note": "Ascending aorta distributes cardiac output into the Aortic Arch."
    },

    # 3. OCCLUSION RELATIONSHIPS (FOR RAYCAST X-RAY FADING)
    {
        "source_fma_id": "FMA_7485",
        "target_fma_id": "FMA_7088",
        "relationship_type": "OCLUDES_VIEW_OF",
        "clinical_note": "Sternum directly occludes anterior line of sight to heart."
    },
    {
        "source_fma_id": "FMA_7480",
        "target_fma_id": "FMA_7088",
        "relationship_type": "OCLUDES_VIEW_OF",
        "clinical_note": "Ribcage and costal cartilages enclose and occlude thoracic viscera."
    },
    {
        "source_fma_id": "FMA_7480",
        "target_fma_id": "FMA_7309",
        "relationship_type": "OCLUDES_VIEW_OF",
        "clinical_note": "Ribcage encloses right lung."
    },
    {
        "source_fma_id": "FMA_7480",
        "target_fma_id": "FMA_7310",
        "relationship_type": "OCLUDES_VIEW_OF",
        "clinical_note": "Ribcage encloses left lung."
    },

    # 4. PART_OF HIERARCHY
    {
        "source_fma_id": "FMA_7096",
        "target_fma_id": "FMA_7088",
        "relationship_type": "PART_OF",
        "clinical_note": "Right atrium is a component chamber of the heart."
    },
    {
        "source_fma_id": "FMA_7098",
        "target_fma_id": "FMA_7088",
        "relationship_type": "PART_OF",
        "clinical_note": "Right ventricle is a component chamber of the heart."
    },
    {
        "source_fma_id": "FMA_7097",
        "target_fma_id": "FMA_7088",
        "relationship_type": "PART_OF",
        "clinical_note": "Left atrium is a component chamber of the heart."
    },
    {
        "source_fma_id": "FMA_7099",
        "target_fma_id": "FMA_7088",
        "relationship_type": "PART_OF",
        "clinical_note": "Left ventricle is a component chamber of the heart."
    },
    {
        "source_fma_id": "FMA_9462",
        "target_fma_id": "FMA_7088",
        "relationship_type": "PART_OF",
        "clinical_note": "Interventricular septum divides the cardiac ventricles."
    },
    {
        "source_fma_id": "FMA_7163",
        "target_fma_id": "FMA_7099",
        "relationship_type": "PART_OF",
        "clinical_note": "Cardiac apex is part of the left ventricle."
    }
]


def main():
    seed_dir = Path(__file__).resolve().parent.parent / "app" / "db" / "seed_data"
    seed_dir.mkdir(parents=True, exist_ok=True)

    # 1. Save graph edges
    graph_file = seed_dir / "graph_edges.json"
    with open(graph_file, "w", encoding="utf-8") as f:
        json.dump(GRAPH_EDGES, f, indent=2)

    # 2. Sync structures from manifest
    manifest_file = Path(__file__).resolve().parent.parent.parent / "frontend" / "public" / "models" / "manifest.json"
    if manifest_file.exists():
        with open(manifest_file, "r", encoding="utf-8") as f:
            manifest_data = json.load(f)
        struct_file = seed_dir / "structures.json"
        with open(struct_file, "w", encoding="utf-8") as f:
            json.dump(manifest_data.get("structures", {}), f, indent=2)

    print(f"[build_anatomical_graph] Successfully generated {graph_file} with {len(GRAPH_EDGES)} physiological edges.")


if __name__ == "__main__":
    main()
