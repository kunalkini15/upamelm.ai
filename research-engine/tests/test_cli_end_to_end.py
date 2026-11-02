import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[2] / "doc-intelligence" / "src"))
sys.path.insert(0, str(Path(__file__).parents[1]))

from doc_intelligence.parsers.pymupdf_parser import PyMuPDFParser
from doc_intelligence.providers.base import ModelResponse
from research_engine import cli
from research_engine.agent.orchestrator import ResearchOrchestrator
from research_engine.models import ResearchRequest


def _tool_call(call_id, name, arguments):
    return {
        "id": call_id,
        "type": "function",
        "function": {"name": name, "arguments": json.dumps(arguments)},
    }


class OfflineMuse:
    """Native-protocol fixture; nested DI completions are also fully mocked."""

    provider_name = "offline-muse-contributor-fixture"
    supports_native_tool_calls = True

    def __init__(self, turns):
        self.turns = list(turns)
        self.requests = []
        self.extraction_prompts = []

    def complete_agent(self, messages, tools):
        self.requests.append((json.loads(json.dumps(messages)), tools))
        response = self.turns.pop(0)
        return {
            "message": response,
            "finish_reason": "tool_calls",
            "model": "muse-spark-1.3-contributor",
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
            "duration_seconds": 0.01,
        }

    def complete(
        self,
        prompt,
        system_instruction=None,
        json_mode=False,
        temperature=0.0,
        reasoning_effort=None,
    ):
        self.extraction_prompts.append(prompt)
        if "Site A groundwater level was 6 metres in 2020." in prompt:
            row = {
                "entity_id": "site-a",
                "values": {"water_level": 6, "year": 2020},
                "units": {"water_level": "metres"},
                "page_number": 1,
                "source_text": "Site A groundwater level was 6 metres in 2020.",
            }
        elif "Site B groundwater level was 8 metres in 2020." in prompt:
            row = {
                "entity_id": "site-b",
                "values": {"water_level": 8, "year": 2020},
                "units": {"water_level": "metres"},
                "page_number": 1,
                "source_text": "Site B groundwater level was 8 metres in 2020.",
            }
        else:
            row = None
        payload = {"findings": [row] if row else []}
        return ModelResponse(
            content=json.dumps(payload),
            parsed_json=payload,
            prompt_tokens=30,
            completion_tokens=15,
            total_tokens=45,
            model_name="muse-spark-1.3-contributor",
            raw_response=payload,
        )


def _pdf(path, text):
    import fitz

    document = fitz.open()
    page = document.new_page()
    page.insert_text((45, 60), "Groundwater Observation", fontsize=16)
    page.insert_text((45, 100), text, fontsize=11)
    document.save(path)
    document.close()


def test_normal_cli_runs_autonomous_two_document_research_offline(
    tmp_path, monkeypatch
):
    source_a = tmp_path / "site-a.pdf"
    source_b = tmp_path / "site-b.pdf"
    _pdf(source_a, "Site A groundwater level was 6 metres in 2020.")
    _pdf(source_b, "Site B groundwater level was 8 metres in 2020.")
    parser = PyMuPDFParser()
    document_a = parser.parse(source_a)
    document_b = parser.parse(source_b)
    artifact_a = ResearchOrchestrator._evidence_artifact_id(
        "site-a-observation", document_a.metadata.document_id
    )
    artifact_b = ResearchOrchestrator._evidence_artifact_id(
        "site-b-observation", document_b.metadata.document_id
    )

    turns = [
        {
            "role": "assistant",
            "tool_calls": [
                _tool_call(
                    "inspect-a",
                    "inspect_source",
                    {"document_id": document_a.metadata.document_id},
                ),
                _tool_call(
                    "inspect-b",
                    "inspect_source",
                    {"document_id": document_b.metadata.document_id},
                ),
            ],
        },
        {
            "role": "assistant",
            "tool_calls": [
                _tool_call(
                    "search-a",
                    "search_source",
                    {
                        "document_id": document_a.metadata.document_id,
                        "query": "groundwater level site A",
                    },
                ),
                _tool_call(
                    "search-b",
                    "search_source",
                    {
                        "document_id": document_b.metadata.document_id,
                        "query": "groundwater level site B",
                    },
                ),
            ],
        },
        {
            "role": "assistant",
            "tool_calls": [
                _tool_call(
                    "extract-a",
                    "extract_information",
                    {
                        "document_id": document_a.metadata.document_id,
                        "pages": [1],
                        "task": {
                            "task_id": "site-a-observation",
                            "objective": "Record the groundwater level and year",
                            "fields": ["water_level", "year"],
                            "coverage_scope": "all",
                        },
                    },
                )
            ],
        },
        {
            "role": "assistant",
            "tool_calls": [
                _tool_call(
                    "extract-b",
                    "extract_information",
                    {
                        "document_id": document_b.metadata.document_id,
                        "pages": [1],
                        "task": {
                            "task_id": "site-b-observation",
                            "objective": "Record the groundwater level and year",
                            "fields": ["water_level", "year"],
                            "coverage_scope": "all",
                        },
                    },
                )
            ],
        },
        {
            "role": "assistant",
            "tool_calls": [
                _tool_call(
                    "search-memory",
                    "search_workspace",
                    {"query": "groundwater level", "limit": 10},
                )
            ],
        },
        {
            "role": "assistant",
            "tool_calls": [
                _tool_call(
                    "read-old",
                    "read_workspace",
                    {"artifact_id": artifact_a, "record_key": "findings", "limit": 10},
                )
            ],
        },
        {
            "role": "assistant",
            "tool_calls": [
                _tool_call(
                    "compare",
                    "compare_findings",
                    {
                        "artifact_ids": [artifact_a, artifact_b],
                        "comparison_dimensions": ["document_id", "year"],
                    },
                )
            ],
        },
        {
            "role": "assistant",
            "tool_calls": [
                _tool_call(
                    "calculate",
                    "calculate",
                    {
                        "artifact_ids": [artifact_a, artifact_b],
                        "field": "water_level",
                        "operation": "difference",
                    },
                )
            ],
        },
        {
            "role": "assistant",
            "tool_calls": [
                _tool_call(
                    "write-v1",
                    "write_artifact",
                    {
                        "artifact_id": "cross_site_analysis",
                        "type": "analysis",
                        "format": "json",
                        "title": "Cross-site analysis",
                        "content": {"draft": True},
                        "evidence": [
                            {"artifact_id": artifact_a},
                            {"artifact_id": artifact_b},
                        ],
                    },
                )
            ],
        },
        {
            "role": "assistant",
            "tool_calls": [
                _tool_call(
                    "write-v2",
                    "write_artifact",
                    {
                        "artifact_id": "cross_site_analysis",
                        "title": "Final cross-site analysis",
                        "metadata": {"reviewed": True},
                    },
                )
            ],
        },
        {
            "role": "assistant",
            "tool_calls": [
                _tool_call(
                    "finish",
                    "finish_investigation",
                    {
                        "summary": "The two reported groundwater levels differ by 2 metres.",
                        "artifact_ids": ["cross_site_analysis"],
                        "limitations": [
                            "Synthetic fixture; not a scientific conclusion about a real aquifer."
                        ],
                    },
                )
            ],
        },
    ]
    provider = OfflineMuse(turns)
    monkeypatch.setattr(ResearchOrchestrator, "_provider", lambda self: provider)
    request_path = tmp_path / "request.json"
    request_path.write_text(
        ResearchRequest(
            research_id="offline-e2e",
            objective="Compare groundwater observations across the provided documents and calculate their difference.",
            sources=[{"path": str(source_a)}, {"path": str(source_b)}],
            desired_outcomes=["Evidence-backed comparison"],
        ).model_dump_json(),
        encoding="utf-8",
    )
    output = tmp_path / "output"

    cli.main(["run", "--request", str(request_path), "--output", str(output)])

    run_dir = Path(json.loads((output / "latest_run.json").read_text())["path"])
    result = json.loads((run_dir / "research_result.json").read_text())
    state = json.loads((run_dir / "research_state.json").read_text())
    assert result["status"] == "completed_with_limitations"
    assert result["final_artifact_ids"] == ["cross_site_analysis"]
    assert result["model_usage"]["nested_calls"] == 2
    assert result["model_usage"]["calls"] == len(turns) + 2
    assert len(result["model_usage"]["request_details"]) == len(turns) + 2
    nested_usage = [
        item
        for item in result["model_usage"]["request_details"]
        if item.get("phase") == "document_intelligence"
    ]
    assert len(nested_usage) == 2
    assert all(item["usage"]["total_tokens"] == 45 for item in nested_usage)
    assert result["model_usage"]["models"] == ["muse-spark-1.3-contributor"]
    assert [
        event["tool"]
        for event in result["execution_trace"]
        if event["tool"]
        in {
            "inspect_source",
            "search_source",
            "extract_information",
            "compare_findings",
            "calculate",
        }
    ]
    assert len(provider.extraction_prompts) == 2
    assert any(
        "Site A groundwater level" in prompt for prompt in provider.extraction_prompts
    )
    assert any(
        "Site B groundwater level" in prompt for prompt in provider.extraction_prompts
    )
    tool_results = {
        message["tool_call_id"]: json.loads(message["content"])
        for message in state["conversation"]
        if message.get("role") == "tool"
    }
    assert tool_results["search-a"]["result"][0]["page"] == 1
    assert tool_results["search-b"]["result"][0]["page"] == 1
    extraction_preview = tool_results["extract-a"]["result"]["finding_preview"][0]
    assert extraction_preview["entity_id"] == "site-a"
    assert extraction_preview["fields"]["water_level"]["value"] == 6
    assert (
        extraction_preview["fields"]["water_level"]["evidence"]["pdf_page_number"] == 1
    )
    comparison = tool_results["compare"]["result"]["comparisons"]
    water_levels = next(item for item in comparison if item["field"] == "water_level")
    assert water_levels["differs"] is True
    assert len(water_levels["values"]) == 2
    assert tool_results["calculate"]["result"]["result"] == 2.0
    assert tool_results["read-old"]["result"]["records"]

    workspace = run_dir / "workspace"
    manifest = json.loads((workspace / "manifest.json").read_text())
    assert artifact_a in manifest["artifacts"] and artifact_b in manifest["artifacts"]
    assert manifest["artifacts"]["cross_site_analysis"]["latest_version"] == 2
    evidence_a = json.loads(
        (workspace / "artifacts" / artifact_a / "v0001.json").read_text()
    )
    evidence_b = json.loads(
        (workspace / "artifacts" / artifact_b / "v0001.json").read_text()
    )
    finding_a = evidence_a["content"]["findings"][0]
    finding_b = evidence_b["content"]["findings"][0]
    assert finding_a["finding_id"] != finding_b["finding_id"]
    assert finding_a["fields"]["water_level"]["evidence"]["pdf_page_number"] == 1
    assert finding_b["fields"]["water_level"]["evidence"]["pdf_page_number"] == 1
    assert finding_a["finding_id"].startswith(
        f"{document_a.metadata.document_id}:site-a-observation:"
    )
    assert finding_b["finding_id"].startswith(
        f"{document_b.metadata.document_id}:site-b-observation:"
    )
    finding_a_claim = next(
        item
        for item in result["key_findings"]
        if item["claim_id"] == finding_a["finding_id"]
    )
    assert len(finding_a_claim["evidence"]) == 1
    stored_analysis = json.loads(
        (workspace / "artifacts" / "cross_site_analysis" / "v0002.json").read_text()
    )
    assert stored_analysis["content"] == {"draft": True}
    assert stored_analysis["metadata"]["reviewed"] is True
    assert all(
        event["tool"] not in {"synthesize_findings", "revise_plan"}
        for event in result["execution_trace"]
    )
