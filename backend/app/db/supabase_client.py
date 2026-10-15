import logging
from typing import Optional
from backend.app.config import settings

logger = logging.getLogger(__name__)

_supabase_client = None


def get_supabase_client():
    """
    Returns an initialized Supabase client if SUPABASE_URL and SUPABASE_KEY are provided.
    Returns None if running in local zero-config fallback mode.
    """
    global _supabase_client
    if _supabase_client is not None:
        return _supabase_client

    if settings.SUPABASE_URL and settings.SUPABASE_KEY:
        try:
            from supabase import create_client, Client
            _supabase_client = create_client(settings.SUPABASE_URL, settings.SUPABASE_KEY)
            logger.info("[Supabase] Successfully connected to remote pgvector instance.")
            return _supabase_client
        except Exception as exc:
            logger.warning(f"[Supabase] Could not connect to Supabase: {exc}. Falling back to local store.")
            return None
    else:
        logger.info("[Supabase] SUPABASE_URL not configured. Operating in zero-config local vector/graph store mode.")
        return None
