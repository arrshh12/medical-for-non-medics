import pytest
import json
from unittest.mock import AsyncMock, patch, MagicMock
from fastapi.testclient import TestClient
from backend.app.main import app

client = TestClient(app)


def test_anatomy_structures_endpoint():
    res = client.get("/api/v1/anatomy/structures")
    assert res.status_code == 200
    data = res.json()
    assert data["count"] >= 20
    assert any(s["fma_id"] == "FMA_7088" for s in data["structures"])


def test_anatomy_single_structure():
    res = client.get("/api/v1/anatomy/structures/FMA_7101")
    assert res.status_code == 200
    data = res.json()
    assert data["fma_id"] == "FMA_7101"
    assert "Left Anterior Descending" in data["common_name"]


def test_anatomy_graph_endpoint():
    res = client.get("/api/v1/anatomy/graph")
    assert res.status_code == 200
    data = res.json()
    assert data["edge_count"] >= 20
    assert any(e["relationship_type"] == "ARTERIAL_SUPPLY" for e in data["edges"])


def test_anatomy_downstream_graph():
    res = client.get("/api/v1/anatomy/graph/downstream/FMA_7101?max_hops=2")
    assert res.status_code == 200
    data = res.json()
    assert data["fma_id"] == "FMA_7101"
    target_ids = [e["target_fma_id"] for e in data["edges"]]
    assert "FMA_9462" in target_ids or "FMA_7163" in target_ids


@pytest.mark.asyncio
async def test_chat_stream_endpoint(monkeypatch):
    """
    Tests POST /api/v1/chat/stream emitting SSE events:
    grounding_status, citation, scene_command, text_delta, done.
    """
    class MockChoice:
        def __init__(self, text):
            self.delta = MagicMock(content=text)

    class MockChunk:
        def __init__(self, text):
            self.choices = [MockChoice(text)]

    async def mock_stream_generator():
        chunks = [
            "<scene_cmd>\n",
            '{"step": 1, "action": "FOCUS_STRUCTURE", "target_id": "FMA_7101"}\n',
            "</scene_cmd>\n",
            "The Left Anterior Descending artery supplies the anterior septum [NBK459269]."
        ]
        for c in chunks:
            yield MockChunk(c)

    mock_client = MagicMock()
    mock_completions = MagicMock()
    mock_completions.create = AsyncMock(return_value=mock_stream_generator())
    mock_client.chat = MagicMock(completions=mock_completions)

    from backend.app.api import routes_chat
    monkeypatch.setattr(routes_chat, "get_async_openai_client", lambda base_url, api_key: mock_client)

    payload = {
        "message": "How does a heart attack happen in the LAD artery?",
        "mode": "pathology",
        "comprehension_level": "pre_med",
        "base_url": "https://api.openai.com/v1",
        "api_key": "sk-mock-key",
        "model_id": "gpt-4o"
    }

    response = client.post("/api/v1/chat/stream", json=payload)
    assert response.status_code == 200
    assert "text/event-stream" in response.headers["content-type"]

    body = response.text
    assert "event: grounding_status" in body
    assert "event: citation" in body
    assert "event: scene_command" in body
    assert "event: text_delta" in body
    assert "event: done" in body
