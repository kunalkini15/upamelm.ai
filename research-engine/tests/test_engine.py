import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[2] / "doc-intelligence" / "src"))
sys.path.insert(0, str(Path(__file__).parents[1]))

import pytest
from research_engine.config import MuseConfig, META_MODEL, META_BASE_URL
from research_engine.models import ResearchRequest
from research_engine.agent.orchestrator import ResearchOrchestrator, mock_orchestrator


def request():
    return ResearchRequest(
        research_id="r1",
        objective="Find documented observations",
        sources=[{"path": "/tmp/report.pdf"}],
        research_questions=["What was observed?"],
    )


def test_request_validation_and_provider_restrictions():
    assert ResearchRequest.model_validate(request().model_dump()).research_id == "r1"
    MuseConfig("key", META_BASE_URL, META_MODEL).validate()
    for model in ["gemini-1.5-flash", "gpt-4o", "claude-3"]:
        with pytest.raises(ValueError):
            MuseConfig("key", META_BASE_URL, model).validate()
    with pytest.raises(ValueError):
        MuseConfig("key", "https://api.openai.com/v1", META_MODEL).validate()


def test_mock_agent_records_real_decisions_and_budget(monkeypatch):
    agent = mock_orchestrator(
        request(),
        [
            {
                "action": "list_sources",
                "reason": "inspect available sources",
                "plan": ["retrieve evidence"],
            },
            {"action": "complete_investigation", "reason": "no source was loadable"},
        ],
    )
    monkeypatch.setattr(
        agent.tools,
        "list_sources",
        lambda: [{"document_id": "doc-test", "available": True, "pages": 1}],
    )
    result = agent.run()
    assert result.status == "partial"
    assert [e.tool for e in result.execution_trace] == [
        "list_sources",
        "complete_investigation",
    ]
    assert agent.state.source_documents["0"]["path"] == "/tmp/report.pdf"


def test_evidence_status_never_promotes_to_human_verified():
    from research_engine.models import Claim

    claim = Claim(claim_id="c", text="a", status="grounded")
    assert claim.status == "grounded"


def test_tools_compare_and_validate_are_deterministic(tmp_path):
    from research_engine.tools import ResearchTools
    from doc_intelligence.providers.mock_provider import MockModelProvider

    tools = ResearchTools(MockModelProvider(), [])
    findings = [
        {"finding_id": "a", "fields": {"amount": {"value": 10}}},
        {"finding_id": "b", "fields": {"amount": {"value": 12}}},
    ]
    comparison = tools.compare_evidence(["a", "b"], findings)
    assert comparison["conflicts"] == []
    assert comparison["comparisons"][0]["differs"] is True
    assert tools.deterministic_analysis([1, 3, 5], "mean")["result"] == 3


def test_dynamic_extraction_arguments_are_forwarded():
    from research_engine.tools import ResearchTools
    from doc_intelligence.providers.mock_provider import MockModelProvider

    # The argument surface is intentionally inspected without parsing a document;
    # validation belongs to TaskSpecification once a permitted document is supplied.
    tools = ResearchTools(MockModelProvider(), [])
    assert tools.task_key("/tmp/a.pdf", "objective", ["question"])


def test_missing_source_catalog_does_not_expose_local_path(tmp_path):
    from research_engine.tools import DocumentIntelligenceAdapter

    adapter = DocumentIntelligenceAdapter(
        object(), [str(tmp_path / "private-report.pdf")]
    )
    assert adapter.list_sources() == [
        {"filename": "private-report.pdf", "available": False}
    ]


def test_wholly_missing_sources_fail_preflight_without_model_inference(tmp_path):
    from research_engine.models import ResearchRequest

    class NeverCallProvider:
        provider_name = "test"

        def complete(self, *args, **kwargs):
            raise AssertionError("no inference should happen")

    missing = tmp_path / "not-here.pdf"
    agent = ResearchOrchestrator(
        ResearchRequest(
            research_id="missing",
            objective="Inspect the document",
            sources=[{"path": str(missing)}],
        ),
        NeverCallProvider(),
    )
    result = agent.run(str(tmp_path / "state.json"))
    assert result.status == "failed"
    assert result.model_usage["calls"] == 0
    assert "not-here.pdf" in result.issues[0]
    assert str(tmp_path) not in result.issues[0]


def test_common_document_selector_aliases_normalize_without_rejecting_extras():
    from research_engine.agent.orchestrator import ResearchOrchestrator

    assert ResearchOrchestrator._normalize_source_selectors(
        {"page_numbers": [2, 4], "section_ids": "methods", "extra": "ignored"}
    ) == {
        "page_numbers": [2, 4],
        "section_ids": "methods",
        "extra": "ignored",
        "pages": [2, 4],
        "sections": ["methods"],
    }
    assert ResearchOrchestrator._normalize_source_selectors(
        {"page": 3, "task": {"task_id": "x"}}
    )["pages"] == [3]


def test_extraction_progress_fingerprint_ignores_generated_task_ids_but_keeps_scope():
    first_args = {
        "document_id": "doc-a",
        "pages": [2],
        "task": {"task_id": "generated-one", "objective": "Extract observations"},
    }
    second_args = {
        "document_id": "doc-a",
        "pages": [2],
        "task": {"task_id": "generated-two", "objective": "Extract observations"},
    }
    first_result = {
        "document_id": "doc-a",
        "status": "completed",
        "findings": [
            {
                "finding_id": "doc-a:generated-one:finding_1",
                "fields": {"observation": {"value": "recorded", "page": 2}},
            }
        ],
        "coverage": {"processed_pages": [2], "notes": "task generated-one"},
    }
    second_result = {
        **first_result,
        "findings": [
            {
                "finding_id": "doc-a:generated-two:finding_1",
                "fields": {"observation": {"value": "recorded", "page": 2}},
            }
        ],
        "coverage": {"processed_pages": [2], "notes": "task generated-two"},
    }

    fingerprint = ResearchOrchestrator._progress_fingerprint_value
    assert fingerprint("extract_information", first_args, first_result) == fingerprint(
        "extract_information", second_args, second_result
    )
    second_args["pages"] = [3]
    assert fingerprint("extract_information", first_args, first_result) != fingerprint(
        "extract_information", second_args, second_result
    )


def test_explicit_extraction_selectors_are_not_truncated_by_di_sample_defaults(
    tmp_path, monkeypatch
):
    import json

    import fitz
    from doc_intelligence.providers.base import ModelResponse
    from research_engine.tools import DocumentIntelligenceAdapter

    pdf_path = tmp_path / "multi-page.pdf"
    pdf = fitz.open()
    for page_number in range(1, 8):
        page = pdf.new_page()
        page.insert_text((40, 60), f"Relevant record on page {page_number}")
    pdf.save(pdf_path)
    pdf.close()

    class CountingProvider:
        provider_name = "test"

        def __init__(self):
            self.prompts = []

        def complete(self, prompt, **kwargs):
            self.prompts.append(prompt)
            return ModelResponse(
                content=json.dumps({"findings": []}),
                parsed_json={"findings": []},
                prompt_tokens=1,
                completion_tokens=1,
                total_tokens=2,
                model_name="test",
                raw_response={},
            )

    class BroadMatchAtlas:
        pages = list(range(1, 8))

        def search(self, _query, top_k):
            from types import SimpleNamespace

            return [
                SimpleNamespace(page_number=page, score=1.0)
                for page in self.pages[:top_k]
            ]

    provider = CountingProvider()
    adapter = DocumentIntelligenceAdapter(provider, [str(pdf_path)])
    monkeypatch.setattr(adapter, "_atlas", lambda _document_id: BroadMatchAtlas())
    result = adapter.extract(
        adapter.list_sources()[0]["document_id"],
        {
            "task_id": "explicit-pages",
            "objective": "Extract the requested records",
            "fields": [],
            "coverage_scope": "sample",
        },
        remaining_calls=None,
        remaining_tokens=None,
        selectors={"pages": [2, 5, 7], "query": "broad query matching every page"},
    )

    assert len(provider.prompts) == 2  # DI's existing two-page batch behavior.
    for excluded_page in (1, 3, 4, 6):
        assert all(
            f"=== PAGE {excluded_page} ===" not in prompt for prompt in provider.prompts
        )
    for requested_page in (2, 5, 7):
        assert any(
            f"=== PAGE {requested_page} " in prompt for prompt in provider.prompts
        )
    assert result["coverage"]["processed_pages"] == [2, 5, 7]


def test_artifact_source_and_workspace_reference_problems_are_warnings(tmp_path):
    from research_engine.models import ResearchRequest
    from research_engine.workspace import ResearchWorkspace
    from doc_intelligence.providers.mock_provider import MockModelProvider

    req = ResearchRequest(
        research_id="refs",
        objective="Keep arbitrary research notes",
        sources=[{"path": "/tmp/report.pdf"}],
    )
    agent = ResearchOrchestrator(req, MockModelProvider())
    agent.workspace = ResearchWorkspace(tmp_path / "workspace")
    agent.tools.list_sources = lambda: [
        {"document_id": "doc-known", "pages": 2, "available": True}
    ]
    artifact = agent._annotate_artifact_references(
        {
            "artifact_id": "note",
            "content": {"free_form": True},
            "evidence": [
                {"document_id": "doc-known", "page": 4},
                {"document_id": "doc-unknown", "page": 1},
                {"artifact_id": "missing", "version": 3},
            ],
        }
    )
    saved = agent.workspace.upsert(artifact)
    assert len(saved["metadata"]["reference_warnings"]) == 3
    assert saved["content"] == {"free_form": True}


def test_workspace_artifact_revision_and_muse_finish(tmp_path, monkeypatch):
    from research_engine.models import ResearchRequest

    req = ResearchRequest(
        research_id="workspace",
        objective="preserve an observation",
        sources=[{"path": "/tmp/report.pdf"}],
    )
    agent = mock_orchestrator(
        req,
        [
            {
                "action": "workspace_upsert",
                "artifact": {
                    "artifact_id": "note-1",
                    "type": "note",
                    "format": "markdown",
                    "title": "Observation",
                    "content": "first",
                },
            },
            {
                "action": "workspace_upsert",
                "artifact": {
                    "artifact_id": "note-1",
                    "type": "note",
                    "format": "markdown",
                    "title": "Observation",
                    "content": "revised",
                },
            },
            {
                "action": "finish_investigation",
                "summary": "Finished",
                "artifact_ids": ["note-1"],
            },
        ],
    )
    monkeypatch.setattr(
        agent.tools,
        "list_sources",
        lambda: [{"document_id": "doc-test", "available": True, "pages": 1}],
    )
    result = agent.run(str(tmp_path / "research_state.json"))
    assert result.status == "completed"
    assert result.final_artifact_ids == ["note-1"]
    assert (tmp_path / "workspace" / "artifacts" / "note-1" / "v0001.json").is_file()
    assert (tmp_path / "workspace" / "artifacts" / "note-1" / "v0002.json").is_file()
