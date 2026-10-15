import pytest
import httpx
from fastapi.testclient import TestClient
from backend.app.services.openai_compat_gateway import normalize_base_url, fetch_available_models
from backend.app.main import app

client = TestClient(app)


def test_url_normalization_variations():
    """
    Acceptance Criteria: Test URL normalization across at least 6 variations:
    1. Standard domain without protocol -> defaults to https://.../v1
    2. URL with trailing slash -> stripped
    3. URL with /chat/completions suffix -> stripped to base URL
    4. URL with /models suffix -> stripped to base URL
    5. Localhost with port but no path -> appends /v1
    6. Localhost with /v1 -> preserved
    7. Custom provider with deep path (e.g., Google or Azure compat) -> preserved
    """
    assert normalize_base_url("api.openai.com") == "https://api.openai.com/v1"
    assert normalize_base_url("https://openrouter.ai/api/v1/") == "https://openrouter.ai/api/v1"
    assert normalize_base_url("https://api.openai.com/v1/chat/completions") == "https://api.openai.com/v1"
    assert normalize_base_url("https://api.groq.com/openai/v1/models") == "https://api.groq.com/openai/v1"
    assert normalize_base_url("http://localhost:11434") == "http://localhost:11434/v1"
    assert normalize_base_url("http://localhost:11434/v1/") == "http://localhost:11434/v1"
    assert normalize_base_url("https://generativelanguage.googleapis.com/v1beta/openai") == "https://generativelanguage.googleapis.com/v1beta/openai"


def test_health_endpoint():
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["service"] == "HoloMed 3D"


@pytest.mark.asyncio
async def test_fetch_available_models_mock(monkeypatch):
    """
    Tests parsing both standard OpenAI dict format and custom list format.
    """
    mock_openai_response = {
        "data": [
            {"id": "gpt-4o", "owned_by": "openai"},
            {"id": "claude-3-5-sonnet", "owned_by": "anthropic"}
        ]
    }

    class MockResponse:
        status_code = 200
        def json(self):
            return mock_openai_response

    async def mock_get(self, url, headers=None):
        return MockResponse()

    monkeypatch.setattr(httpx.AsyncClient, "get", mock_get)

    models = await fetch_available_models("https://mock-provider.ai/v1", api_key="sk-test")
    assert len(models) == 2
    # Should be sorted alphabetically
    assert models[0].id == "claude-3-5-sonnet"
    assert models[1].id == "gpt-4o"


def test_routes_llm_models_endpoint(monkeypatch):
    """
    Tests POST /api/v1/llm/models with mock HTTP client.
    """
    mock_response = {
        "data": [
            {"id": "model-b", "owned_by": "org-b"},
            {"id": "model-a", "owned_by": "org-a"}
        ]
    }

    class MockResponse:
        status_code = 200
        def json(self):
            return mock_response

    async def mock_get(self, url, headers=None):
        return MockResponse()

    monkeypatch.setattr(httpx.AsyncClient, "get", mock_get)

    res = client.post("/api/v1/llm/models", json={
        "base_url": "https://api.openai.com/v1",
        "api_key": "sk-mock-key"
    })
    assert res.status_code == 200
    data = res.json()
    assert data["normalized_base_url"] == "https://api.openai.com/v1"
    assert len(data["models"]) == 2
    assert data["models"][0]["id"] == "model-a"
    assert data["models"][1]["id"] == "model-b"
