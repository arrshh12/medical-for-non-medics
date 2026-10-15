import asyncio
import sys
from pathlib import Path

# Add project root to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from backend.app.schemas.chat_schemas import CitationItem
from backend.app.services.dual_output_parser import DualOutputParser
from backend.app.services.rag_retriever import rag_retriever


def test_rag_retriever():
    print("=== Testing RAGRetriever ===")
    # Test 1: High relevance pathology query
    ctx1 = rag_retriever.retrieve(
        "How does a heart attack happen in the LAD artery?",
        mode="pathology"
    )
    print("Pathology Query Grounding Status:", ctx1.grounding_status)
    print("Pathology Query Max Similarity:", ctx1.max_similarity)
    print("Relevant structures count:", len(ctx1.relevant_structures))
    print("Graph edges count:", len(ctx1.graph_edges))

    assert ctx1.grounding_status == "verified", "Expected verified grounding for heart attack query"
    assert ctx1.max_similarity >= 0.72, "Expected max_similarity >= 0.72"
    assert "FMA_7101" in ctx1.valid_fma_mappings, "LAD artery should be in valid FMA mappings"
    assert "FMA_9462" in ctx1.valid_fma_mappings, "Interventricular septum (downstream) should be in mappings"
    assert "FMA_7163" in ctx1.valid_fma_mappings, "Cardiac apex (downstream) should be in mappings"
    assert len(ctx1.citation_items) > 0, "Expected citation items"
    assert len(ctx1.valid_fma_ids_prompt_list) > 0, "Expected formatted prompt whitelist"

    # Test 2: Unrelated query
    ctx2 = rag_retriever.retrieve(
        "Can you write a poem about the Eiffel tower?",
        mode="anatomy"
    )
    print("Unrelated Query Grounding Status:", ctx2.grounding_status)
    print("Unrelated Query Max Similarity:", ctx2.max_similarity)
    assert ctx2.grounding_status == "unverified", "Expected unverified grounding for unrelated query"
    assert ctx2.max_similarity < 0.72, "Expected max_similarity < 0.72"

    print("RAGRetriever tests PASSED!\n")


def test_dual_output_parser():
    print("=== Testing DualOutputParser ===")
    verified_chunks = [
        CitationItem(
            source_id="NBK459269",
            source_type="StatPearls",
            title="Acute Myocardial Infarction",
            section="Pathophysiology and Coronary Occlusion",
            excerpt="Acute myocardial infarction occurs when ischemia exceeds threshold...",
            citation_url="https://www.ncbi.nlm.nih.gov/books/NBK459269/"
        )
    ]

    parser = DualOutputParser(retrieved_chunks=verified_chunks)

    stream_tokens = [
        "Welcome to HoloMed 3D. ",
        "Here is step one: <scene_",
        "cmd>\n```json\n{\n",
        '  "step": 1,\n',
        '  "action": "FOCUS_AND_ISOLATE",\n',
        '  "target_ids": ["FMA_7088", "FMA_7101",],\n',
        '  "fade_occluders": true,\n',
        '  "camera_preset": "anterior_oblique",\n',
        '  "annotation": {\n',
        '    "target_id": "FMA_7101",\n',
        '    "title": "LAD Artery",\n',
        '    "body": "Main coronary vessel.",\n',
        '  },\n',
        "}\n```\n</scene_",
        "cmd>\nNow, as stated in [NBK",
        "459269], the LAD artery supplies the anterior wall. ",
        "However, [NBK999999] was an unindexed citation. ",
        "You can also inspect [Heart Organ](https://holomed.org) in 3D."
    ]

    all_events = []
    for tok in stream_tokens:
        events = parser.feed(tok)
        all_events.extend(events)

    all_events.extend(parser.flush())

    print(f"Total events emitted: {len(all_events)}")
    for i, ev in enumerate(all_events):
        print(f"[{i}] {ev['event']}: {str(ev['data'])[:90]}...")

    scene_cmds = [e for e in all_events if e["event"] == "scene_command"]
    citations = [e for e in all_events if e["event"] == "citation"]
    text_deltas = [e for e in all_events if e["event"] == "text_delta"]

    assert len(scene_cmds) == 1, f"Expected 1 scene command, got {len(scene_cmds)}"
    cmd_data = scene_cmds[0]["data"]
    assert cmd_data["action"] == "FOCUS_AND_ISOLATE"
    assert cmd_data["target_ids"] == ["FMA_7088", "FMA_7101"]
    assert cmd_data["fade_occluders"] is True
    assert cmd_data["camera_preset"] == "anterior_oblique"

    assert len(citations) == 1, f"Expected 1 citation event, got {len(citations)}"
    assert citations[0]["data"]["source_id"] == "NBK459269"

    combined_text = "".join(e["data"]["delta"] for e in text_deltas)
    print("\n--- Combined Output Text ---")
    print(combined_text)
    print("----------------------------\n")

    assert "[NBK459269]" in combined_text, "Verified citation must be present in narrative"
    assert "[NBK999999]" not in combined_text, "Hallucinated citation MUST be stripped per Rule 4"
    assert "[Heart Organ](https://holomed.org)" in combined_text, "Markdown link must be preserved"

    # Test SSE wire formatting
    sse_line = DualOutputParser.to_sse(scene_cmds[0])
    assert sse_line.startswith("event: scene_command\ndata: {")

    # Test Async parse_stream
    async def run_async():
        p = DualOutputParser(retrieved_chunks=verified_chunks)
        async def mock_stream():
            for t in stream_tokens:
                yield t
        async_events = [ev async for ev in p.parse_stream(mock_stream())]
        assert len(async_events) == len(all_events), "Async parse_stream event count mismatch"

    asyncio.run(run_async())

    print("DualOutputParser tests PASSED!\n")


if __name__ == "__main__":
    test_rag_retriever()
    test_dual_output_parser()
    print("ALL BACKEND SERVICE TESTS COMPLETED SUCCESSFULLY!")
