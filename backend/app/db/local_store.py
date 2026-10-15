"""
Local In-Memory / SQLite Vector & Graph Store Fallback.
Guarantees 100% zero-configuration local runnability for HoloMed 3D without requiring external Supabase credentials.
"""

import json
import math
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
import numpy as np


def generate_deterministic_embedding(text: str, dim: int = 1536) -> np.ndarray:
    """
    Generates a deterministic normalized unit vector from text tokens.
    Provides semantic-like bag-of-words cosine matching for offline RAG testing.
    """
    words = re.findall(r'\b[a-zA-Z0-9_\-]+\b', text.lower())
    vec = np.zeros(dim, dtype=np.float32)

    if not words:
        vec[0] = 1.0
        return vec

    for word in words:
        # Deterministic hash to 3 dimensions per word with signed weights
        h = hash(word)
        idx1 = abs(h) % dim
        idx2 = abs(h // 7) % dim
        idx3 = abs(h // 49) % dim
        vec[idx1] += 1.0
        vec[idx2] += 0.5
        vec[idx3] += 0.25

    norm = np.linalg.norm(vec)
    if norm > 1e-6:
        vec /= norm
    else:
        vec[0] = 1.0
    return vec


class LocalAnatomicalStore:
    def __init__(self):
        self.structures: Dict[str, Dict[str, Any]] = {}
        self.graph_edges: List[Dict[str, Any]] = []
        self.literature_chunks: List[Dict[str, Any]] = []
        self.chunk_embeddings: List[np.ndarray] = []
        self._load_seed_data_if_exists()

    def _load_seed_data_if_exists(self):
        seed_dir = Path(__file__).resolve().parent / "seed_data"
        struct_file = seed_dir / "structures.json"
        graph_file = seed_dir / "graph_edges.json"
        lit_file = seed_dir / "medical_literature.json"

        if struct_file.exists():
            with open(struct_file, "r", encoding="utf-8") as f:
                self.structures = json.load(f)

        if graph_file.exists():
            with open(graph_file, "r", encoding="utf-8") as f:
                self.graph_edges = json.load(f)

        if lit_file.exists():
            with open(lit_file, "r", encoding="utf-8") as f:
                self.literature_chunks = json.load(f)
                self.chunk_embeddings = [
                    generate_deterministic_embedding(c["title"] + " " + c["section_heading"] + " " + c["content"])
                    for c in self.literature_chunks
                ]

    def add_structure(self, struct: Dict[str, Any]):
        fma_id = struct["fma_id"]
        self.structures[fma_id] = struct

    def get_structure(self, fma_id: str) -> Optional[Dict[str, Any]]:
        return self.structures.get(fma_id)

    def add_edge(self, source_fma_id: str, target_fma_id: str, relationship_type: str, clinical_note: str = ""):
        self.graph_edges.append({
            "source_fma_id": source_fma_id,
            "target_fma_id": target_fma_id,
            "relationship_type": relationship_type,
            "clinical_note": clinical_note
        })

    def get_graph_neighborhood(self, fma_ids: List[str], max_hops: int = 2) -> List[Dict[str, Any]]:
        """
        Traverses 1-hop and 2-hop edges connected to the given FMA IDs
        (ARTERIAL_SUPPLY, VENOUS_DRAINAGE, FLOWS_INTO, OCLUDES_VIEW_OF, etc.)
        """
        discovered_edges: List[Dict[str, Any]] = []
        visited_nodes = set(fma_ids)
        frontier = set(fma_ids)

        for _ in range(max_hops):
            next_frontier = set()
            for edge in self.graph_edges:
                src = edge["source_fma_id"]
                tgt = edge["target_fma_id"]
                if src in frontier:
                    discovered_edges.append(edge)
                    if tgt not in visited_nodes:
                        visited_nodes.add(tgt)
                        next_frontier.add(tgt)
                elif tgt in frontier:
                    discovered_edges.append(edge)
                    if src not in visited_nodes:
                        visited_nodes.add(src)
                        next_frontier.add(src)
            frontier = next_frontier
            if not frontier:
                break

        # Remove duplicate edges
        unique_edges = []
        seen = set()
        for e in discovered_edges:
            key = (e["source_fma_id"], e["target_fma_id"], e["relationship_type"])
            if key not in seen:
                seen.add(key)
                unique_edges.append(e)

        return unique_edges

    def add_literature_chunk(self, chunk: Dict[str, Any]):
        self.literature_chunks.append(chunk)
        embed_text = chunk.get("title", "") + " " + chunk.get("section_heading", "") + " " + chunk.get("content", "")
        self.chunk_embeddings.append(generate_deterministic_embedding(embed_text))

    def search_literature(
        self,
        query: str,
        top_k: int = 4,
        min_threshold: float = 0.50
    ) -> List[Tuple[Dict[str, Any], float]]:
        """
        Performs hybrid cosine search + keyword relevance matching.
        Returns list of (chunk, cosine_similarity_score).
        """
        if not self.literature_chunks:
            return []

        q_vec = generate_deterministic_embedding(query)
        scores: List[Tuple[Dict[str, Any], float]] = []

        q_words = set(re.findall(r'\b[a-zA-Z0-9_\-]+\b', query.lower()))

        for idx, chunk in enumerate(self.literature_chunks):
            c_vec = self.chunk_embeddings[idx]
            cos_sim = float(np.dot(q_vec, c_vec))

            # Bonus for explicit FMA match or exact keyword match in title
            content_lower = (chunk["title"] + " " + chunk["section_heading"] + " " + chunk["content"]).lower()
            keyword_overlap = sum(1 for w in q_words if w in content_lower)
            boost = min(0.25, keyword_overlap * 0.05)

            final_score = min(0.99, cos_sim + boost)
            if final_score >= min_threshold:
                scores.append((chunk, final_score))

        # Sort descending by score
        scores.sort(key=lambda x: x[1], reverse=True)
        return scores[:top_k]


# Singleton instance
local_store = LocalAnatomicalStore()
