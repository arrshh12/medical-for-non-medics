import os
from typing import List
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    PROJECT_NAME: str = "HoloMed 3D"
    ENVIRONMENT: str = "development"
    PORT: int = 8000
    HOST: str = "0.0.0.0"

    # Supabase (optional, falls back to local SQLite + numpy vector/graph store if empty)
    SUPABASE_URL: str = ""
    SUPABASE_KEY: str = ""

    # Default LLM Provider Settings
    DEFAULT_OPENAI_BASE_URL: str = "https://api.openai.com/v1"
    DEFAULT_OPENAI_API_KEY: str = ""
    DEFAULT_MODEL_ID: str = "gpt-4o"

    # CORS
    CORS_ORIGINS: List[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "*"
    ]

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )


settings = Settings()
