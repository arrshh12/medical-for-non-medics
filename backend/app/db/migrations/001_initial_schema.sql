-- HoloMed 3D Initial Schema Migration: PostgreSQL + pgvector
-- Enables real-time hybrid retrieval of vetted medical literature and anatomical dependency graphs

CREATE EXTENSION IF NOT EXISTS vector;

-- 1. 3D Anatomical Structures Registry
CREATE TABLE IF NOT EXISTS anatomical_structures (
    fma_id TEXT PRIMARY KEY,                      -- e.g. 'FMA_7088' (Heart)
    mesh_node_name TEXT NOT NULL UNIQUE,          -- Exact mesh node identifier
    common_name TEXT NOT NULL,                    -- e.g. 'Heart'
    latin_name TEXT,                              -- e.g. 'Cor'
    organ_system TEXT NOT NULL,                   -- e.g. 'cardiovascular', 'respiratory', 'skeletal'
    bbox_min FLOAT8[3] NOT NULL,                  -- [xmin, ymin, zmin]
    bbox_max FLOAT8[3] NOT NULL,                  -- [xmax, ymax, zmax]
    centroid FLOAT8[3] NOT NULL,                  -- [cx, cy, cz]
    bounding_radius FLOAT8 NOT NULL,              -- r for camera distance math
    description_summary TEXT,
    name_embedding vector(1536)                   -- Vector representation for fuzzy structure matching
);

-- 2. Anatomical & Physiological Dependency Graph (For Pathology Cascades)
CREATE TABLE IF NOT EXISTS anatomical_graph_edges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_fma_id TEXT NOT NULL REFERENCES anatomical_structures(fma_id) ON DELETE CASCADE,
    target_fma_id TEXT NOT NULL REFERENCES anatomical_structures(fma_id) ON DELETE CASCADE,
    relationship_type TEXT NOT NULL CHECK (
        relationship_type IN (
            'ARTERIAL_SUPPLY',       -- Source artery supplies target tissue/organ
            'VENOUS_DRAINAGE',       -- Source structure drains into target vein
            'INNERVATES',            -- Source nerve innervates target muscle/organ
            'FLOWS_INTO',            -- Sequential chamber/lumen flow (e.g., RA -> RV)
            'OCLUDES_VIEW_OF',       -- Source superficial structure blocks anterior view of target
            'PART_OF'                -- Hierarchical containment
        )
    ),
    clinical_note TEXT,
    UNIQUE(source_fma_id, target_fma_id, relationship_type)
);

-- 3. Vetted Medical Literature Corpus (StatPearls & PubMed Open Access)
CREATE TABLE IF NOT EXISTS medical_literature_chunks (
    chunk_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type TEXT NOT NULL CHECK (source_type IN ('StatPearls', 'PubMed_OA')),
    source_id TEXT NOT NULL,                      -- PMID or StatPearls NBK ID (e.g. 'NBK459269')
    title TEXT NOT NULL,
    section_heading TEXT NOT NULL,                -- e.g. 'Pathophysiology', 'Anatomy'
    content TEXT NOT NULL,                        -- Vetted literature excerpt (300-500 tokens)
    associated_fma_ids TEXT[] DEFAULT '{}',       -- Pre-linked FMA IDs
    citation_url TEXT NOT NULL,
    embedding vector(1536) NOT NULL
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_lit_embedding ON medical_literature_chunks
USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_struct_embedding ON anatomical_structures
USING ivfflat (name_embedding vector_cosine_ops) WITH (lists = 50);

CREATE INDEX IF NOT EXISTS idx_graph_source ON anatomical_graph_edges(source_fma_id);
CREATE INDEX IF NOT EXISTS idx_graph_target ON anatomical_graph_edges(target_fma_id);
