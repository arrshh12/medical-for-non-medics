#!/usr/bin/env python3
"""
Downloads the official NIH / HuBMAP Human Reference Atlas (Visible Human Project)
whole-body 3D GLB asset into `frontend/public/models/human_anatomy.glb`,
parses its glTF 2.0 binary scene graph, and generates synchronized
`frontend/public/models/manifest.json` and `backend/app/db/seed_data/structures.json`.
"""

import json
import struct
import sys
import time
import urllib.request
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
GLB_DEST = ROOT_DIR / "frontend" / "public" / "models" / "human_anatomy.glb"
FRONTEND_MANIFEST = ROOT_DIR / "frontend" / "public" / "models" / "manifest.json"
BACKEND_STRUCTURES = ROOT_DIR / "backend" / "app" / "db" / "seed_data" / "structures.json"

# Official NIH / HuBMAP Visible Human United Whole-Body GLB (~201 MB)
NIH_WHOLE_BODY_GLB_URL = (
    "https://cdn.humanatlas.io/digital-objects/ref-organ/united-female/v1.5/assets/3d-vh-f-united.glb"
)

CANONICAL_ANATOMY_MAP = [
    {
        "fma_id": "FMA_7088",
        "canonical_name": "Heart",
        "common_name": "Heart",
        "mesh_node_name": "Heart",
        "glb_aliases": ["Heart", "VH_F_Heart", "heart", "Myocardium", "Left_Ventricle", "Right_Ventricle", "Atrium"],
        "organ_system": "cardiovascular",
        "spatial_zone_code": "ZONE_05_HEART_MEDIASTINUM",
        "cranio_caudal_rank": 5,
        "caudo_cranial_rank": 8,
        "occluding_fma_ids": ["FMA_7485", "FMA_7480", "FMA_7195"],
        "supplies_fma_ids": ["FMA_3734", "FMA_3939", "FMA_50801"],
        "centroid": [0.0, 0.0, 0.0],
        "bbox_min": [-0.85, -0.9, -0.65],
        "bbox_max": [0.75, 0.7, 0.65],
        "bounding_radius": 1.25,
        "description_summary": (
            "Four-chambered muscular pump in the middle mediastinum that propels oxygenated blood "
            "from the left ventricle into the systemic arterial circulation via the aorta at ~5 L/min."
        ),
        "canonical_physiology_summary": (
            "Four-chambered muscular pump in the middle mediastinum that propels oxygenated blood "
            "from the left ventricle into the systemic arterial circulation via the aorta at ~5 L/min."
        ),
    },
    {
        "fma_id": "FMA_3734",
        "canonical_name": "Aorta & Aortic Arch",
        "common_name": "Aorta & Aortic Arch",
        "mesh_node_name": "Aorta",
        "glb_aliases": ["Aorta", "VH_F_Aorta", "Aortic_Arch", "Ascending_Aorta", "Thoracic_Aorta"],
        "organ_system": "cardiovascular",
        "spatial_zone_code": "ZONE_05_HEART_MEDIASTINUM",
        "cranio_caudal_rank": 5,
        "caudo_cranial_rank": 8,
        "occluding_fma_ids": ["FMA_7485", "FMA_7480"],
        "supplies_fma_ids": ["FMA_3939", "FMA_50801", "FMA_7197", "FMA_7203"],
        "centroid": [0.0, 0.35, -0.05],
        "bbox_min": [-0.25, 0.0, -0.2],
        "bbox_max": [0.25, 0.7, 0.15],
        "bounding_radius": 0.8,
        "description_summary": (
            "The largest elastic artery in the body; originates at the left ventricle via the aortic valve, "
            "arches superiorly to give off the brachiocephalic, left common carotid, and left subclavian arteries."
        ),
        "canonical_physiology_summary": (
            "The largest elastic artery in the body; originates at the left ventricle via the aortic valve, "
            "arches superiorly to give off the brachiocephalic, left common carotid, and left subclavian arteries "
            "that supply oxygenated blood to the head, neck, and brain."
        ),
    },
    {
        "fma_id": "FMA_3939",
        "canonical_name": "Common & Internal Carotid Arteries",
        "common_name": "Carotid Arteries",
        "mesh_node_name": "Carotid",
        "glb_aliases": ["Carotid", "Common_Carotid", "Internal_Carotid", "VH_F_Carotid", "Blood_Vasculature", "Neck_Artery"],
        "organ_system": "cardiovascular",
        "spatial_zone_code": "ZONE_03_NECK_CERVICAL",
        "cranio_caudal_rank": 3,
        "caudo_cranial_rank": 10,
        "occluding_fma_ids": ["FMA_24138"],
        "supplies_fma_ids": ["FMA_50801"],
        "centroid": [0.0, 0.85, 0.05],
        "bbox_min": [-0.2, 0.65, -0.1],
        "bbox_max": [0.2, 1.05, 0.15],
        "bounding_radius": 0.5,
        "description_summary": (
            "Paired cervical arteries ascending through the neck inside the carotid sheath to deliver "
            "oxygenated blood directly from the aortic arch into the Circle of Willis and cerebral hemispheres."
        ),
        "canonical_physiology_summary": (
            "Paired cervical arteries ascending through the neck inside the carotid sheath to deliver "
            "oxygenated blood directly from the aortic arch into the Circle of Willis and cerebral hemispheres."
        ),
    },
    {
        "fma_id": "FMA_50801",
        "canonical_name": "Brain",
        "common_name": "Brain",
        "mesh_node_name": "Brain",
        "glb_aliases": ["Brain", "VH_F_Brain", "Cerebrum", "Cerebral_Cortex", "Encephalon"],
        "organ_system": "nervous",
        "spatial_zone_code": "ZONE_01_CRANIUM_BRAIN",
        "cranio_caudal_rank": 1,
        "caudo_cranial_rank": 12,
        "occluding_fma_ids": ["FMA_46565"],
        "supplies_fma_ids": [],
        "centroid": [0.0, 1.45, 0.0],
        "bbox_min": [-0.35, 1.25, -0.4],
        "bbox_max": [0.35, 1.65, 0.4],
        "bounding_radius": 0.6,
        "description_summary": (
            "Central command organ of the nervous system housed within the cranial vault; consumes ~20% "
            "of total body oxygen and requires continuous arterial perfusion."
        ),
        "canonical_physiology_summary": (
            "Central command organ of the nervous system housed within the cranial vault; consumes ~20% "
            "of total body oxygen and requires continuous arterial perfusion via the internal carotid and "
            "vertebral arteries."
        ),
    },
    {
        "fma_id": "FMA_46565",
        "canonical_name": "Skull & Cranium",
        "common_name": "Skull & Cranium",
        "mesh_node_name": "Skull",
        "glb_aliases": ["Skull", "Cranium", "VH_F_Skull", "Head_Bone", "Calvaria"],
        "organ_system": "skeletal",
        "spatial_zone_code": "ZONE_01_CRANIUM_BRAIN",
        "cranio_caudal_rank": 1,
        "caudo_cranial_rank": 12,
        "occluding_fma_ids": [],
        "supplies_fma_ids": [],
        "centroid": [0.0, 1.45, 0.0],
        "bbox_min": [-0.4, 1.2, -0.45],
        "bbox_max": [0.4, 1.7, 0.45],
        "bounding_radius": 0.7,
        "description_summary": (
            "Bony endoskeletal vault composed of cranial and facial bones that encases and protects the "
            "brain, meninges, and special sense organs."
        ),
        "canonical_physiology_summary": (
            "Bony endoskeletal vault composed of cranial and facial bones that encases and protects the "
            "brain, meninges, and special sense organs."
        ),
    },
    {
        "fma_id": "FMA_7485",
        "canonical_name": "Sternum",
        "common_name": "Sternum",
        "mesh_node_name": "Sternum",
        "glb_aliases": ["Sternum", "VH_F_Sternum", "Breastbone", "Manubrium"],
        "organ_system": "skeletal",
        "spatial_zone_code": "ZONE_04_THORACIC_WALL_LUNGS",
        "cranio_caudal_rank": 4,
        "caudo_cranial_rank": 9,
        "occluding_fma_ids": [],
        "supplies_fma_ids": [],
        "centroid": [0.0, 0.25, 0.45],
        "bbox_min": [-0.15, 0.05, 0.4],
        "bbox_max": [0.15, 0.55, 0.5],
        "bounding_radius": 0.45,
        "description_summary": (
            "Flat T-shaped bone in the anterior midline of the thorax that shields the heart and great vessels."
        ),
        "canonical_physiology_summary": (
            "Flat T-shaped bone in the anterior midline of the thorax (manubrium, body, and xiphoid process) "
            "that articulates with the clavicles and costal cartilages of ribs 1-7 to shield the heart and great vessels."
        ),
    },
    {
        "fma_id": "FMA_7480",
        "canonical_name": "Rib Cage & Thoracic Skeleton",
        "common_name": "Rib Cage",
        "mesh_node_name": "Rib_Cage",
        "glb_aliases": ["Rib_Cage", "Ribs", "VH_F_Rib_Cage", "Thoracic_Cage", "Skeleton", "Pelvis", "Spinal_Cord", "Clavicle"],
        "organ_system": "skeletal",
        "spatial_zone_code": "ZONE_04_THORACIC_WALL_LUNGS",
        "cranio_caudal_rank": 4,
        "caudo_cranial_rank": 9,
        "occluding_fma_ids": [],
        "supplies_fma_ids": [],
        "centroid": [0.0, 0.15, 0.0],
        "bbox_min": [-0.65, -0.4, -0.35],
        "bbox_max": [0.65, 0.65, 0.45],
        "bounding_radius": 1.1,
        "description_summary": (
            "Twelve pairs of curved ribs articulating posteriorly with the thoracic vertebrae and anteriorly "
            "with the sternum to protect thoracic viscera and assist respiratory mechanics."
        ),
        "canonical_physiology_summary": (
            "Twelve pairs of curved ribs articulating posteriorly with the thoracic vertebrae and anteriorly "
            "with the sternum to protect thoracic viscera and assist respiratory mechanics."
        ),
    },
    {
        "fma_id": "FMA_7195",
        "canonical_name": "Lungs (Right & Left)",
        "common_name": "Lungs",
        "mesh_node_name": "Lungs",
        "glb_aliases": ["Lung", "Lungs", "VH_F_Lung", "Right_Lung", "Left_Lung", "Respiratory_System", "Pulmonary"],
        "organ_system": "respiratory",
        "spatial_zone_code": "ZONE_04_THORACIC_WALL_LUNGS",
        "cranio_caudal_rank": 4,
        "caudo_cranial_rank": 9,
        "occluding_fma_ids": ["FMA_7480", "FMA_7485"],
        "supplies_fma_ids": ["FMA_7088"],
        "centroid": [0.0, 0.15, 0.0],
        "bbox_min": [-0.6, -0.3, -0.3],
        "bbox_max": [0.6, 0.6, 0.3],
        "bounding_radius": 0.95,
        "description_summary": (
            "Paired spongy respiratory organs in the pleural cavities responsible for alveolar gas exchange."
        ),
        "canonical_physiology_summary": (
            "Paired spongy respiratory organs in the pleural cavities responsible for alveolar gas exchange: "
            "oxygenating venous blood from the right ventricle and expelling carbon dioxide."
        ),
    },
    {
        "fma_id": "FMA_7197",
        "canonical_name": "Liver",
        "common_name": "Liver",
        "mesh_node_name": "Liver",
        "glb_aliases": ["Liver", "VH_F_Liver", "Hepatic"],
        "organ_system": "digestive",
        "spatial_zone_code": "ZONE_07_ABDOMEN_UPPER_GI",
        "cranio_caudal_rank": 7,
        "caudo_cranial_rank": 6,
        "occluding_fma_ids": ["FMA_7480"],
        "supplies_fma_ids": [],
        "centroid": [0.2, -0.25, 0.1],
        "bbox_min": [-0.1, -0.5, -0.2],
        "bbox_max": [0.55, 0.0, 0.3],
        "bounding_radius": 0.7,
        "description_summary": (
            "Largest internal organ and metabolic gland located in the right upper quadrant beneath the diaphragm."
        ),
        "canonical_physiology_summary": (
            "Largest internal organ and metabolic gland located in the right upper quadrant beneath the diaphragm; "
            "filters portal venous blood, synthesizes plasma proteins, detoxifies metabolites, and secretes bile."
        ),
    },
    {
        "fma_id": "FMA_7203",
        "canonical_name": "Kidneys (Right & Left)",
        "common_name": "Kidneys",
        "mesh_node_name": "Kidneys",
        "glb_aliases": ["Kidney", "Kidneys", "VH_F_Kidney_Left", "VH_F_Kidney_Right", "Renal"],
        "organ_system": "urinary",
        "spatial_zone_code": "ZONE_08_ABDOMEN_RETROPERITONEAL_LOWER_GI",
        "cranio_caudal_rank": 8,
        "caudo_cranial_rank": 5,
        "occluding_fma_ids": ["FMA_7197"],
        "supplies_fma_ids": [],
        "centroid": [0.0, -0.45, -0.15],
        "bbox_min": [-0.35, -0.65, -0.25],
        "bbox_max": [0.35, -0.25, -0.05],
        "bounding_radius": 0.5,
        "description_summary": (
            "Bean-shaped retroperitoneal organs that filter plasma to regulate fluid, electrolyte, and acid-base balance."
        ),
        "canonical_physiology_summary": (
            "Bean-shaped retroperitoneal organs that filter ~180 liters of plasma daily through millions of "
            "nephrons to regulate fluid, electrolyte, and acid-base balance and blood pressure."
        ),
    },
]


def parse_glb_node_names(glb_path: Path) -> list[str]:
    """Reads the JSON chunk (Chunk 0) of a binary GLB file and returns all node names."""
    with open(glb_path, "rb") as f:
        magic, version, length = struct.unpack("<4sII", f.read(12))
        if magic != b"glTF":
            raise ValueError(f"Invalid GLB header in {glb_path}")
        chunk_length, chunk_type = struct.unpack("<II", f.read(8))
        json_bytes = f.read(chunk_length)
        gltf_json = json.loads(json_bytes.decode("utf-8"))
        nodes = gltf_json.get("nodes", [])
        return [n.get("name", f"Node_{idx}") for idx, n in enumerate(nodes) if n.get("name")]


def download_glb_file(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp_dest = dest.with_suffix(".tmp")
    print(f"[fetch_glb] Downloading NIH Whole-Body 3D GLB from:\n  {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "HoloMed3D/2.0"})

    with urllib.request.urlopen(req) as resp:
        total_size = int(resp.headers.get("Content-Length", 0))
        downloaded = 0
        chunk_size = 1024 * 512  # 512 KB
        start_time = time.time()
        last_log = start_time

        with open(tmp_dest, "wb") as out_file:
            while True:
                chunk = resp.read(chunk_size)
                if not chunk:
                    break
                out_file.write(chunk)
                downloaded += len(chunk)
                now = time.time()
                if now - last_log >= 2.0 or downloaded == total_size:
                    elapsed = max(0.1, now - start_time)
                    speed_mb = (downloaded / (1024 * 1024)) / elapsed
                    percent = (downloaded / total_size * 100) if total_size else 0
                    print(
                        f"  -> {downloaded / (1024 * 1024):.1f} MB / {total_size / (1024 * 1024):.1f} MB "
                        f"({percent:.1f}%) at {speed_mb:.2f} MB/s",
                        flush=True,
                    )
                    last_log = now

    tmp_dest.replace(dest)
    print(f"[fetch_glb] Download complete! Saved to {dest} ({dest.stat().st_size / (1024*1024):.1f} MB)")


def main() -> None:
    GLB_DEST.parent.mkdir(parents=True, exist_ok=True)

    if not GLB_DEST.exists() or GLB_DEST.stat().st_size < 1_000_000:
        download_glb_file(NIH_WHOLE_BODY_GLB_URL, GLB_DEST)
    else:
        print(f"[fetch_glb] Model already exists at {GLB_DEST} ({GLB_DEST.stat().st_size / (1024*1024):.1f} MB)")

    discovered_nodes = parse_glb_node_names(GLB_DEST)
    print(f"[fetch_glb] Discovered {len(discovered_nodes)} named 3D nodes inside human_anatomy.glb")

    # Merge with existing structures if already present
    existing_structures = {}
    if BACKEND_STRUCTURES.exists():
        try:
            loaded = json.loads(BACKEND_STRUCTURES.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                existing_structures = loaded
            elif isinstance(loaded, list):
                existing_structures = {item["fma_id"]: item for item in loaded if "fma_id" in item}
        except Exception:
            pass

    for item in CANONICAL_ANATOMY_MAP:
        existing_structures[item["fma_id"]] = {**existing_structures.get(item["fma_id"], {}), **item}

    # Sync frontend manifest
    FRONTEND_MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    manifest_data = {
        "version": "2.0.0",
        "glb_file": "/models/human_anatomy.glb",
        "glb_url": "/models/human_anatomy.glb",
        "total_structures": len(existing_structures),
        "discovered_glb_nodes": discovered_nodes,
        "structures": list(existing_structures.values()),
    }
    FRONTEND_MANIFEST.write_text(json.dumps(manifest_data, indent=2), encoding="utf-8")
    print(f"[fetch_glb] Updated {FRONTEND_MANIFEST} ({len(existing_structures)} structures)")

    # Sync backend structures: preserve dict mapping by fma_id for local_store.py
    BACKEND_STRUCTURES.parent.mkdir(parents=True, exist_ok=True)
    BACKEND_STRUCTURES.write_text(json.dumps(existing_structures, indent=2), encoding="utf-8")
    print(f"[fetch_glb] Updated {BACKEND_STRUCTURES} ({len(existing_structures)} structures)")


if __name__ == "__main__":
    main()
