from fastapi import APIRouter, HTTPException
from backend.app.db.local_store import local_store

router = APIRouter(prefix="/api/v1/anatomy", tags=["Anatomy & Graph"])


@router.get("/structures")
async def list_structures():
    """
    Returns all registered anatomical structures with bounds and metadata.
    """
    return {
        "count": len(local_store.structures),
        "structures": list(local_store.structures.values())
    }


@router.get("/structures/{fma_id}")
async def get_structure_by_id(fma_id: str):
    """
    Retrieves a single anatomical structure by FMA ID.
    """
    struct = local_store.get_structure(fma_id)
    if not struct:
        raise HTTPException(status_code=404, detail=f"Structure {fma_id} not found")
    return struct


@router.get("/graph")
async def get_anatomical_graph():
    """
    Returns all physiological dependency edges.
    """
    return {
        "edge_count": len(local_store.graph_edges),
        "edges": local_store.graph_edges
    }


@router.get("/graph/downstream/{fma_id}")
async def get_downstream_neighborhood(fma_id: str, max_hops: int = 2):
    """
    Traverses graph edges 1-to-2 hops starting from fma_id.
    """
    edges = local_store.get_graph_neighborhood([fma_id], max_hops=max_hops)
    return {
        "fma_id": fma_id,
        "max_hops": max_hops,
        "edges": edges
    }
