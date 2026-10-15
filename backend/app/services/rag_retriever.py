"""
Hybrid Medical Literature & Anatomical Graph RAG Retriever for HoloMed 3D.
Implements Rule 4 grounding verification (0.72 cosine threshold gate),
FMA structural entity extraction, and multi-hop physiological graph traversal.
Supports Supabase pgvector with seamless in-memory local fallback.
"""

import logging
import re
from typing import Any, Dict, List, Optional, Set, Tuple, Union
from pydantic import BaseModel, Field

from backend.app.schemas.chat_schemas import CitationItem, ActiveMode
from backend.app.db.local_store import local_store
from backend.app.db.supabase_client import get_supabase_client

logger = logging.getLogger(__name__)

GROUNDING_THRESHOLD = 0.72

# Anatomical aliases, acronyms, and clinical keyword mappings to canonical FMA IDs
SYNONYM_MAP: Dict[str, Union[str, List[str]]] = {
    "lad": "FMA_7101",
    "left anterior descending": "FMA_7101",
    "left anterior descending artery": "FMA_7101",
    "rca": "FMA_7100",
    "right coronary artery": "FMA_7100",
    "lcx": "FMA_7105",
    "left circumflex": "FMA_7105",
    "left circumflex artery": "FMA_7105",
    "circumflex": "FMA_7105",
    "heart": "FMA_7088",
    "cardiac": "FMA_7088",
    "cor": "FMA_7088",
    "myocardium": "FMA_7088",
    "heart attack": ["FMA_7088", "FMA_7101"],
    "myocardial infarction": ["FMA_7088", "FMA_7101"],
    "ami": ["FMA_7088", "FMA_7101"],
    "infarct": ["FMA_7088", "FMA_7101"],
    "infarction": ["FMA_7088", "FMA_7101"],
    "ischemia": ["FMA_7088", "FMA_7101"],
    "right atrium": "FMA_7096",
    "ra": "FMA_7096",
    "right ventricle": "FMA_7098",
    "rv": "FMA_7098",
    "left atrium": "FMA_7097",
    "la": "FMA_7097",
    "left ventricle": "FMA_7099",
    "lv": "FMA_7099",
    "aorta": "FMA_3734",
    "ascending aorta": "FMA_3734",
    "aortic arch": "FMA_3735",
    "interventricular septum": "FMA_9462",
    "septum": "FMA_9462",
    "cardiac apex": "FMA_7163",
    "apex": "FMA_7163",
    "tricuspid valve": "FMA_7234",
    "tricuspid": "FMA_7234",
    "mitral valve": "FMA_7236",
    "mitral": "FMA_7236",
    "bicuspid valve": "FMA_7236",
    "pulmonary valve": "FMA_7237",
    "pulmonic valve": "FMA_7237",
    "aortic valve": "FMA_7238",
    "pulmonary trunk": "FMA_8614",
    "pulmonary artery": "FMA_8614",
    "lung": ["FMA_7309", "FMA_7310"],
    "lungs": ["FMA_7309", "FMA_7310"],
    "right lung": "FMA_7309",
    "left lung": "FMA_7310",
    "svc": "FMA_4720",
    "superior vena cava": "FMA_4720",
    "ivc": "FMA_4721",
    "inferior vena cava": "FMA_4721",
    "pericardium": "FMA_9869",
    "sternum": "FMA_7485",
    "ribs": "FMA_7486",
    "rib cage": "FMA_7486",
}


class RetrievalContext(BaseModel):
    """
    Structured retrieval package supplied to prompt builder and SSE stream controller.
    Supports both attribute and dict-like key access.
    """
    retrieved_chunks: List[Dict[str, Any]] = Field(default_factory=list, description="Raw chunks with scores")
    citation_items: List[CitationItem] = Field(default_factory=list, description="Typed CitationItem models")
    grounding_status: str = Field(..., description="'verified' or 'unverified'")
    max_similarity: float = Field(default=0.0, description="Highest cosine similarity score among retrieved chunks")
    relevant_structures: List[Dict[str, Any]] = Field(default_factory=list, description="Anatomical structures metadata")
    graph_edges: List[Dict[str, Any]] = Field(default_factory=list, description="Physiological dependency graph edges")
    valid_fma_ids_prompt_list: str = Field(default="", description="Formatted Markdown string for prompt whitelist")
    valid_fma_mappings: Dict[str, str] = Field(default_factory=dict, description="Dictionary mapping fma_id -> common_name")

    def __getitem__(self, item: str) -> Any:
        return getattr(self, item)

    def get(self, item: str, default: Any = None) -> Any:
        return getattr(self, item, default)


class RAGRetriever:
    """
    Algorithmic RAG retrieval engine with hybrid Supabase pgvector and in-memory fallback.
    """

    def __init__(self):
        self.grounding_threshold: float = GROUNDING_THRESHOLD

    def detect_mentioned_fma_ids(
        self,
        query: str,
        current_focused_ids: Optional[List[str]] = None
    ) -> Set[str]:
        """
        Extracts canonical FMA IDs directly mentioned in the query text,
        via regex, clinical synonym matching, or structure name matching.
        """
        detected: Set[str] = set()

        if current_focused_ids:
            for fid in current_focused_ids:
                if fid:
                    detected.add(fid.strip())

        # 1. Direct FMA ID Regex (e.g., FMA_7101, FMA-7101, fma7101)
        direct_matches = re.findall(r'\bFMA[_-]?(\d+)\b', query, re.IGNORECASE)
        for num in direct_matches:
            detected.add(f"FMA_{num}")

        query_lower = query.lower()

        # 2. Match Clinical Synonyms and Acronyms (boundary sensitive for short acronyms)
        for syn, target in SYNONYM_MAP.items():
            pattern = rf'\b{re.escape(syn)}\b'
            if re.search(pattern, query_lower):
                if isinstance(target, list):
                    detected.update(target)
                else:
                    detected.add(target)

        # 3. Match against loaded structures in local store (common_name and latin_name)
        for fma_id, struct in local_store.structures.items():
            c_name = struct.get("common_name", "").lower()
            l_name = struct.get("latin_name", "").lower()

            if c_name and len(c_name) > 2:
                pattern = rf'\b{re.escape(c_name)}\b'
                if re.search(pattern, query_lower):
                    detected.add(fma_id)

            if l_name and len(l_name) > 2:
                pattern = rf'\b{re.escape(l_name)}\b'
                if re.search(pattern, query_lower):
                    detected.add(fma_id)

        return detected

    def _search_supabase_literature(
        self,
        query: str,
        top_k: int = 4
    ) -> Optional[List[Tuple[Dict[str, Any], float]]]:
        """
        Attempts to query remote Supabase pgvector if connection and embeddings are available.
        Returns None to trigger fallback if unconfigured or on failure.
        """
        client = get_supabase_client()
        if client is None:
            return None

        try:
            # Check if pgvector RPC function 'match_literature' exists
            # We use local deterministic embedding as fallback query vector
            from backend.app.db.local_store import generate_deterministic_embedding
            query_vec = generate_deterministic_embedding(query).tolist()

            response = client.rpc(
                "match_literature",
                {
                    "query_embedding": query_vec,
                    "match_threshold": 0.40,
                    "match_count": top_k
                }
            ).execute()

            if response.data and isinstance(response.data, list):
                results: List[Tuple[Dict[str, Any], float]] = []
                for row in response.data:
                    score = float(row.get("similarity", 0.0))
                    results.append((row, score))
                return results
        except Exception as exc:
            logger.debug(f"[RAGRetriever] Supabase RPC query failed ({exc}), falling back to local store.")

        return None

    def expand_medical_query(self, query: str) -> str:
        """
        Expands common layperson and clinical terms into standard medical corpus terminology
        to bridge vocabulary gaps in bag-of-words / vector embedding matching.
        """
        expanded = [query]
        q_lower = query.lower()

        clinical_expansions = [
            ("heart attack", "acute myocardial infarction ami coronary thrombosis plaque rupture"),
            ("myocardial infarction", "acute coronary syndrome ami ischemia coagulative necrosis"),
            ("blocked artery", "coronary artery occlusion atherosclerosis stenosis"),
            ("blood clot", "thrombus thrombosis platelet aggregation"),
            ("lad", "left anterior descending coronary artery occlusion"),
            ("rca", "right coronary artery"),
            ("lcx", "left circumflex artery"),
            ("blood flow", "hemodynamics cardiac cycle valve mechanics systemic venous return"),
            ("cardiac cycle", "sequential hemodynamics diastole systole ventricular"),
            ("valve", "atrioventricular semilunar tricuspid mitral aortic pulmonary valve mechanics"),
            ("septum", "interventricular septum septal perforators"),
            ("apex", "cardiac apex apical perfusion"),
            ("lungs", "pulmonary alveolar capillary gas exchange"),
            ("aorta", "ascending aorta aortic arch systemic outflow"),
        ]

        for trigger, addition in clinical_expansions:
            if trigger in q_lower:
                expanded.append(addition)

        return " ".join(expanded)

    def search_literature(
        self,
        query: str,
        mode: ActiveMode = "anatomy",
        top_k: int = 4
    ) -> Tuple[List[Dict[str, Any]], float, str]:
        """
        Performs hybrid retrieval against medical literature chunks.
        Returns (ranked_chunks, max_similarity, grounding_status).
        Enforces Rule 4 threshold gate: max_similarity >= 0.72 for 'verified'.
        """
        search_query = self.expand_medical_query(query)
        raw_results = self._search_supabase_literature(search_query, top_k=top_k)

        if raw_results is None:
            # Query local in-memory store
            raw_results = local_store.search_literature(search_query, top_k=top_k, min_threshold=0.0)

        if not raw_results:
            return [], 0.0, "unverified"

        max_similarity = float(raw_results[0][1]) if raw_results else 0.0
        grounding_status = "verified" if max_similarity >= self.grounding_threshold else "unverified"

        # Format chunks and attach similarity score
        retrieved_chunks: List[Dict[str, Any]] = []
        for chunk_data, score in raw_results:
            formatted_chunk = dict(chunk_data)
            formatted_chunk["similarity"] = round(float(score), 4)

            # Ensure standard fields align with CitationItem schema
            if "section_heading" in formatted_chunk and "section" not in formatted_chunk:
                formatted_chunk["section"] = formatted_chunk["section_heading"]
            if "content" in formatted_chunk and "excerpt" not in formatted_chunk:
                formatted_chunk["excerpt"] = formatted_chunk["content"]

            retrieved_chunks.append(formatted_chunk)

        return retrieved_chunks, max_similarity, grounding_status

    def traverse_anatomical_graph(
        self,
        seed_fma_ids: Set[str],
        max_hops: int = 2
    ) -> Tuple[List[Dict[str, Any]], Set[str]]:
        """
        Traverses 1-to-2 hops in anatomical_graph_edges.
        Collects connected edges and all newly discovered target/source structures.
        Supports ARTERIAL_SUPPLY, FLOWS_INTO, OCLUDES_VIEW_OF, PART_OF, etc.
        """
        if not seed_fma_ids:
            return [], set()

        edges = local_store.get_graph_neighborhood(list(seed_fma_ids), max_hops=max_hops)
        all_structure_ids = set(seed_fma_ids)

        for edge in edges:
            src = edge.get("source_fma_id")
            tgt = edge.get("target_fma_id")
            if src:
                all_structure_ids.add(src)
            if tgt:
                all_structure_ids.add(tgt)

        return edges, all_structure_ids

    def retrieve(
        self,
        query: str,
        mode: ActiveMode = "anatomy",
        top_k: int = 4,
        current_focused_ids: Optional[List[str]] = None,
        focused_ids: Optional[List[str]] = None
    ) -> RetrievalContext:
        """
        Synchronous / core retrieval pipeline:
        1. Query literature corpus with cosine similarity scoring.
        2. Evaluate Rule 4 grounding threshold gate (>= 0.72).
        3. Detect mentioned anatomical structures + literature-associated structures.
        4. Traverse multi-hop dependency graph for downstream targets (e.g. LAD -> Septum, Apex).
        5. Build validated FMA whitelist for prompt injection.
        """
        current_focused_ids = current_focused_ids or focused_ids
        # Step 1 & 2: Literature Search & Similarity Gate
        retrieved_chunks, max_similarity, grounding_status = self.search_literature(
            query=query,
            mode=mode,
            top_k=top_k
        )

        # Convert to CitationItem models
        citation_items: List[CitationItem] = []
        for chunk in retrieved_chunks:
            try:
                item = CitationItem(
                    source_id=chunk.get("source_id", "Unknown"),
                    source_type=chunk.get("source_type", "StatPearls"),
                    title=chunk.get("title", "Medical Literature"),
                    section=chunk.get("section", chunk.get("section_heading", "General")),
                    excerpt=chunk.get("excerpt", chunk.get("content", ""))[:400],
                    citation_url=chunk.get("citation_url", "https://www.ncbi.nlm.nih.gov/")
                )
                citation_items.append(item)
            except Exception as e:
                logger.warning(f"[RAGRetriever] Error building CitationItem: {e}")

        # Step 3: Entity detection
        seed_fma_ids = self.detect_mentioned_fma_ids(query, current_focused_ids=current_focused_ids)

        # Add pre-linked structures from retrieved literature chunks
        for chunk in retrieved_chunks:
            assoc = chunk.get("associated_fma_ids", [])
            for fid in assoc:
                if fid:
                    seed_fma_ids.add(fid)

        # In pathology mode, if heart or coronary occlusion is mentioned, ensure LAD is anchored
        if mode == "pathology":
            pathology_triggers = {"heart attack", "infarction", "ami", "ischemia", "occlusion", "atherosclerosis"}
            if any(t in query.lower() for t in pathology_triggers) and not seed_fma_ids:
                seed_fma_ids.add("FMA_7088")
                seed_fma_ids.add("FMA_7101")

        # Step 4: Multi-hop graph traversal (1-to-2 hops)
        # This bundles downstream ischemic targets like FMA_9462 (Septum) and FMA_7163 (Apex)
        graph_edges, all_discovered_ids = self.traverse_anatomical_graph(seed_fma_ids, max_hops=2)

        # If no structures were identified at all, default to core cardiovascular organs
        if not all_discovered_ids:
            all_discovered_ids.update(["FMA_7088", "FMA_7101", "FMA_3734"])

        # Fetch metadata for all discovered structures
        relevant_structures: List[Dict[str, Any]] = []
        valid_fma_mappings: Dict[str, str] = {}

        for fma_id in sorted(all_discovered_ids):
            struct = local_store.get_structure(fma_id)
            if struct:
                relevant_structures.append(struct)
                valid_fma_mappings[fma_id] = struct.get("common_name", fma_id)
            else:
                valid_fma_mappings[fma_id] = fma_id

        # Format FMA whitelist for prompt injection
        whitelist_lines = [f"- `{fid}`: {name}" for fid, name in sorted(valid_fma_mappings.items())]
        valid_fma_ids_prompt_list = "\n".join(whitelist_lines)

        logger.info(
            f"[RAGRetriever] Query: '{query[:40]}...' | Mode: {mode} | "
            f"Grounding: {grounding_status} (max_sim={max_similarity:.3f}) | "
            f"Structures: {len(relevant_structures)} | Edges: {len(graph_edges)}"
        )

        return RetrievalContext(
            retrieved_chunks=retrieved_chunks,
            citation_items=citation_items,
            grounding_status=grounding_status,
            max_similarity=max_similarity,
            relevant_structures=relevant_structures,
            graph_edges=graph_edges,
            valid_fma_ids_prompt_list=valid_fma_ids_prompt_list,
            valid_fma_mappings=valid_fma_mappings
        )

    async def retrieve_async(
        self,
        query: str,
        mode: ActiveMode = "anatomy",
        top_k: int = 4,
        current_focused_ids: Optional[List[str]] = None,
        focused_ids: Optional[List[str]] = None
    ) -> RetrievalContext:
        """
        Async wrapper for retrieve() to be used in FastAPI async routes.
        """
        import asyncio
        return await asyncio.to_thread(
            self.retrieve,
            query=query,
            mode=mode,
            top_k=top_k,
            current_focused_ids=current_focused_ids or focused_ids
        )


# Global singleton instance
rag_retriever = RAGRetriever()
