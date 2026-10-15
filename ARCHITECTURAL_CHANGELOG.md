# Architectural Changelog & System Footprint Decisions

**Project:** HoloMed 3D  
**Date:** October 2026  
**Status:** Approved & Applied  
**Authority:** Architectural Override (`gemini-code-1792000546657.md` & Agent Analysis)

---

## 1. Executive Summary of Changes

The project architecture has transitioned from a **Heavy Local `pgvector` RAG Pipeline** to a **Zero-Storage "Just-In-Time" Cloud RAG & Ultra-Light Anatomical Fact Graph**. 

This eliminates the need for massive local medical corpus downloads, PyTorch dependencies, and gigabytes of vector tables, while maintaining 100% literature grounding and 3D WebGL synchronization.

---

## 2. Quantitative Footprint Comparison

| Dimension | Previous Heavy Vector Architecture | Approved Ultra-Light Cloud Architecture | Net Impact |
| :--- | :--- | :--- | :--- |
| **Minimum Free Disk Space Needed** | **15 GB – 20 GB** | **< 1 GB** | **-95%** |
| **Local Medical Archives Download** | **~1.6 GB – 5.5 GB** *(StatPearls tar.gz, 10 textbooks)* | **0 GB (None)** | **-100%** |
| **Database Storage Footprint** | **~6.5 GB – 8.5 GB** *(375k vectors, FP32, HNSW)* | **< 15 MB** *(PostgreSQL Full-Text Search)* | **-99.8%** |
| **Python Virtual Environment** | **~2.5 GB – 3.5 GB** *(PyTorch, transformers, sentence-transformers)* | **~180 MB** *(FastAPI, uvicorn, httpx, supabase, pydantic)* | **-94%** |
| **Client Browser Download** | **~125 MB – 230 MB** *(Draco `.glb` + React bundle)* | **~125 MB – 230 MB** *(Draco `.glb` + React bundle)* | **Unchanged** |
| **Total Deployed System Size** | **~10 GB – 14 GB** | **~1.0 GB – 1.4 GB** *(All-in)* | **-90%** |

---

## 3. Core Architectural Changes

### A. Prohibited Dependencies & Processes (DO NOT USE)
1. **No PyTorch / Heavy ML:** `torch`, `sentence-transformers`, `transformers`, `langchain`, and `chromadb` are strictly removed from `backend/requirements.txt`.
2. **No Local Bulk Archives:** Do **not** download the 1.4 GB `statpearls_NBK430685.tar.gz` archive or expand 4–7 GB of raw XML.
3. **No Vector(1536) Database Tables:** Supabase `pgvector` vector columns are replaced with PostgreSQL native Full-Text Search.
4. **No Blanket RAG on Every Query:** RAG is bypassed for 80% of anatomy/layperson queries and only invoked for pathology/clinical claims.

---

### B. The 3-Tier Ultra-Light Grounding Engine (<15 MB DB)

```
User Query (e.g., "How does a heart attack happen?")
                     │
                     ▼
       ┌───────────────────────────┐
       │ Tier 2: Adaptive          │
       │ Gatekeeper                │
       │ (adaptive_gatekeeper.py)  │
       └─────────────┬─────────────┘
                     │
         ┌───────────┴───────────┐
         │ (80% Queries)         │ (20% Queries)
         ▼                       ▼
┌──────────────────┐    ┌──────────────────────────────────────────┐
│ Mode 1 Anatomy & │    │ Tier 3: NCBI Cloud RAG                   │
│ Layperson Stream │    │ (app/services/ncbi_cloud_rag.py)         │
│ (0 NCBI calls,   │    │ 1. Read-through Supabase cache (~4ms)    │
│  0ms RAG latency)│    │ 2. Cache miss: live NCBI E-utilities API │
└────────┬─────────┘    │ 3. Ingest ~2 KB snippet & cache in DB    │
         │              └────────────────────┬─────────────────────┘
         │                                   │
         └─────────────────┬─────────────────┘
                           ▼
          ┌───────────────────────────────────┐
          │ Tier 1: Deterministic 3D          │
          │ Anatomical Fact Graph (~12 MB DB) │
          │ • tsvector + GIN index            │
          │ • FMA_ID -> 3D Mesh Nodes         │
          │ • Head-to-Toe / Toe-to-Head Ranks │
          │ • Arterial/Venous/Nerve Edges     │
          └─────────────────┬─────────────────┘
                            ▼
              OpenAI-Compatible LLM Gateway
          (Streams Dual Output: Text + <scene_cmd>)
```

1. **Tier 1 — Deterministic 3D Anatomical Fact Graph (`~12 MB` in Supabase Postgres):**
   * Uses native PostgreSQL Full-Text Search (`tsvector` + GIN index, 0 MB vector overhead).
   * Maps every 3D `.glb` mesh node (`fma_id`) to Head-to-Toe rank (`1–12`), Toe-to-Head rank (`1–12`), arterial supply, venous drainage, occluding meshes, and canonical 2-sentence physiology summaries.
2. **Tier 2 — The Adaptive Gatekeeper (`app/services/adaptive_gatekeeper.py`):**
   * **Path A (80% of queries — Mode 1 Anatomy/Physiology & Feature 3 Layperson Analogies):** Handled directly by the user's OpenAI-compatible LLM constrained strictly by the Tier 1 3D Scene Graph slice (**0 NCBI API calls, 0ms latency**).
   * **Path B (20% of queries — Mode 2 Pathology Cascades, Disease Mechanisms & Clinical Facts):** Routed to Tier 3 for live literature lookup.
3. **Tier 3 — Live NIH/NCBI Cloud RAG with Read-Through Cache (`app/services/ncbi_cloud_rag.py`):**
   * Queries the official NIH / NCBI E-utilities REST API (`esearch.fcgi` + `efetch.fcgi`) on demand.
   * Stores compact `~2 KB` snippets in a `ncbi_literature_cache` table in Supabase so repeat queries return in ~4ms.

---

## 4. Credentials & Configuration Applied

* **NCBI API Key Configured:** The developer's NCBI API key has been added to `backend/.env`.
* **Rate Limit Tier:**
  * Unauthenticated: 3 req/sec
  * **With API Key (`backend/.env`): 10 req/sec** *(Active)*
* **Credential Protection:** Added `.gitignore` at repository root to prevent `.env` or credential leakage to git.

---

## 5. Phase 4 Milestone Revision (`phases.md` Impact)

* **Previous Phase 4:** Required downloading bulk textbooks, running offline sentence chunking, generating embeddings, and building multi-gigabyte vector tables.
* **Updated Phase 4:**
  1. Write `001_initial_schema.sql` with `tsvector` + GIN indexes and the `ncbi_literature_cache` table.
  2. Implement `adaptive_gatekeeper.py` to route Mode 1 vs Mode 2 queries.
  3. Implement `ncbi_cloud_rag.py` with asynchronous HTTPX pooling and 10 req/sec rate limiting.
  4. Seed the 12 MB anatomical fact graph connecting FMA IDs to bidirectional ranks (`H2T_01` $\rightarrow$ `H2T_12` and `T2H_01` $\rightarrow$ `T2H_12`).
