"""
Zero-Storage Just-In-Time NIH / NCBI Cloud RAG Service.
Queries live NCBI E-utilities (esearch.fcgi + efetch.fcgi) with rate limiting (aiolimiter),
secure XML parsing (defusedxml), and local/Supabase read-through caching.
"""

import json
import logging
import re
from typing import Dict, Any, List, Optional, Tuple
import httpx
from aiolimiter import AsyncLimiter
import defusedxml.ElementTree as ET

from backend.app.config import settings
from backend.app.db.local_store import local_store
from backend.app.db.supabase_client import get_supabase_client

logger = logging.getLogger(__name__)

EUTILS_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"


class NCBICloudRAG:
    def __init__(self):
        # Configure rate limiter: 10 req/s with API key, 3 req/s without
        self.api_key = settings.NCBI_API_KEY.strip() if settings.NCBI_API_KEY else ""
        if self.api_key:
            self.limiter = AsyncLimiter(10, 1)
            logger.info("[NCBICloudRAG] Initialized with NCBI_API_KEY (Rate limit: 10 req/sec)")
        else:
            self.limiter = AsyncLimiter(3, 1)
            logger.info("[NCBICloudRAG] Running without NCBI_API_KEY (Rate limit: 3 req/sec)")

        # In-memory query read-through cache: normalized_query -> List[chunk_dict]
        self.cache: Dict[str, List[Dict[str, Any]]] = {}

    def _get_common_params(self) -> Dict[str, str]:
        params = {
            "tool": settings.NCBI_TOOL,
            "email": settings.NCBI_EMAIL,
        }
        if self.api_key:
            params["api_key"] = self.api_key
        return params

    def _normalize_key(self, query: str) -> str:
        return re.sub(r'\s+', ' ', query.lower().strip())

    async def _check_cache(self, query: str) -> Optional[List[Dict[str, Any]]]:
        key = self._normalize_key(query)
        if key in self.cache:
            logger.info(f"[NCBICloudRAG] In-memory cache hit for: '{key[:40]}'")
            return self.cache[key]

        # Check Supabase ncbi_literature_cache if connected
        client = get_supabase_client()
        if client:
            try:
                res = client.table("ncbi_literature_cache").select("*").eq("query_key", key).execute()
                if res.data and len(res.data) > 0:
                    chunks = res.data[0].get("chunks", [])
                    if chunks:
                        self.cache[key] = chunks
                        logger.info(f"[NCBICloudRAG] Supabase cache hit for: '{key[:40]}'")
                        return chunks
            except Exception as e:
                logger.debug(f"[NCBICloudRAG] Supabase cache read skipped: {e}")

        # Check local_store seed data
        local_results = local_store.search_literature(query, top_k=3, min_threshold=0.70)
        if local_results:
            chunks = [r[0] for r in local_results]
            self.cache[key] = chunks
            return chunks

        return None

    def get_cached(self, query: str) -> Optional[List[Dict[str, Any]]]:
        """Synchronously check in-memory cache and local store."""
        key = self._normalize_key(query)
        if key in self.cache:
            return self.cache[key]
        local_results = local_store.search_literature(query, top_k=3, min_threshold=0.70)
        if local_results:
            chunks = [r[0] for r in local_results]
            self.cache[key] = chunks
            return chunks
        return None

    def cache_result(self, query: str, chunks: List[Dict[str, Any]]):
        """Synchronously cache results in memory and local store."""
        key = self._normalize_key(query)
        self.cache[key] = chunks
        for c in chunks:
            local_store.add_literature_chunk(c)

    async def _save_cache(self, query: str, chunks: List[Dict[str, Any]]):
        key = self._normalize_key(query)
        self.cache[key] = chunks

        # Persist to local_store
        for c in chunks:
            local_store.add_literature_chunk(c)

        # Persist to Supabase if available
        client = get_supabase_client()
        if client:
            try:
                client.table("ncbi_literature_cache").upsert({
                    "query_key": key,
                    "chunks": chunks
                }).execute()
            except Exception as e:
                logger.debug(f"[NCBICloudRAG] Supabase cache write skipped: {e}")

    async def search_and_fetch(self, query: str, top_k: int = 3) -> List[Dict[str, Any]]:
        """
        Executes live NIH/NCBI E-utilities esearch.fcgi + efetch.fcgi with read-through cache.
        """
        # 1. Check read-through cache first (~0-4ms)
        cached = await self._check_cache(query)
        if cached:
            return cached

        # 2. On cache miss, query live NCBI API
        logger.info(f"[NCBICloudRAG] Cache miss. Querying live NCBI E-utilities for: '{query[:40]}'")
        try:
            chunks = await self._fetch_live_ncbi(query, top_k=top_k)
            if chunks:
                await self._save_cache(query, chunks)
                return chunks
        except Exception as exc:
            logger.warning(f"[NCBICloudRAG] Live query error: {exc}. Falling back to local store.")

        # 3. Fallback to local store
        fallback_results = local_store.search_literature(query, top_k=top_k, min_threshold=0.0)
        return [r[0] for r in fallback_results]

    async def _fetch_live_ncbi(self, query: str, top_k: int = 3) -> List[Dict[str, Any]]:
        """
        Internal implementation calling esearch and efetch.
        """
        # Search PubMed/StatPearls
        search_params = self._get_common_params()
        search_params.update({
            "db": "pubmed",
            "term": f"{query} AND (StatPearls[book] OR review[pt])",
            "retmode": "json",
            "retmax": str(top_k),
            "sort": "relevance"
        })

        async with self.limiter:
            async with httpx.AsyncClient(timeout=8.0) as client:
                search_res = await client.get(f"{EUTILS_BASE}/esearch.fcgi", params=search_params)

        if search_res.status_code != 200:
            logger.warning(f"[NCBICloudRAG] esearch returned HTTP {search_res.status_code}")
            return []

        search_data = search_res.json()
        id_list = search_data.get("esearchresult", {}).get("idlist", [])

        if not id_list:
            # Fallback search without book filter
            search_params["term"] = query
            async with self.limiter:
                async with httpx.AsyncClient(timeout=8.0) as client:
                    search_res = await client.get(f"{EUTILS_BASE}/esearch.fcgi", params=search_params)
            if search_res.status_code == 200:
                id_list = search_res.json().get("esearchresult", {}).get("idlist", [])

        if not id_list:
            return []

        # Fetch XML details via efetch.fcgi
        fetch_params = self._get_common_params()
        fetch_params.update({
            "db": "pubmed",
            "id": ",".join(id_list),
            "retmode": "xml"
        })

        async with self.limiter:
            async with httpx.AsyncClient(timeout=10.0) as client:
                fetch_res = await client.get(f"{EUTILS_BASE}/efetch.fcgi", params=fetch_params)

        if fetch_res.status_code != 200:
            return []

        # Parse XML with defusedxml
        return self._parse_pubmed_xml(fetch_res.content)

    def _parse_pubmed_xml(self, xml_bytes: bytes) -> List[Dict[str, Any]]:
        """
        Parses NCBI PubmedArticleSet XML securely with defusedxml.
        """
        chunks: List[Dict[str, Any]] = []
        try:
            root = ET.fromstring(xml_bytes)
        except Exception as e:
            logger.error(f"[NCBICloudRAG] XML parse error: {e}")
            return []

        for article in root.findall(".//PubmedArticle"):
            pmid_elem = article.find(".//PMID")
            pmid = pmid_elem.text.strip() if pmid_elem is not None and pmid_elem.text else "PMID_Unknown"

            title_elem = article.find(".//ArticleTitle")
            title = title_elem.text.strip() if title_elem is not None and title_elem.text else "Clinical Review"

            abstract_texts = []
            for abstract_text in article.findall(".//AbstractText"):
                label = abstract_text.get("Label", "")
                text = "".join(abstract_text.itertext()).strip()
                if text:
                    if label:
                        abstract_texts.append(f"{label}: {text}")
                    else:
                        abstract_texts.append(text)

            content = " ".join(abstract_texts).strip()
            if not content:
                content = f"Peer-reviewed medical reference covering {title}."

            chunks.append({
                "source_type": "PubMed_OA",
                "source_id": f"PMID{pmid}",
                "title": title,
                "section_heading": "Abstract & Pathophysiology",
                "content": content[:900],
                "citation_url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
                "associated_fma_ids": []
            })

        return chunks


ncbi_cloud_rag = NCBICloudRAG()
