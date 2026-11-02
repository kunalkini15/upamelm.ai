import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[2] / "doc-intelligence" / "src"))
sys.path.insert(0, str(Path(__file__).parents[1]))

import pytest

from research_engine.agent.muse_protocol import (
    MuseChatTransport,
    MuseProtocolError,
    TOOLS,
)
from research_engine.agent.orchestrator import ResearchOrchestrator
from research_engine.models import ResearchRequest, ResearchState
from research_engine.storage import save_state
from research_engine.workspace import ResearchWorkspace


class FakeProvider:
    provider_name = "fake-contributor"

    def __init__(self, turns):
        self.turns = list(turns)
        self.requests = []

    def complete_agent(self, messages, tools):
        self.requests.append((json.loads(json.dumps(messages)), tools))
        item = self.turns.pop(0)
        return {
            "message": item,
            "finish_reason": "tool_calls",
            "model": "muse-spark-1.3-contributor",
            "usage": {"prompt_tokens": 11, "completion_tokens": 7, "total_tokens": 18},
            "duration_seconds": 0.01,
        }

    def complete(self, *args, **kwargs):
        raise AssertionError("DI should not be invoked by this workspace-only scenario")


def call(call_id, name, args):
    return {
        "id": call_id,
        "type": "function",
        "function": {"name": name, "arguments": json.dumps(args)},
    }


def request(path):
    return ResearchRequest(
        research_id="native-test",
        objective="Preserve a useful observation",
        sources=[{"path": str(path)}],
    )


def available_catalog(agent):
    agent.tools.list_sources = lambda: [
        {"document_id": "doc-test", "available": True, "pages": 1}
    ]


def test_native_tool_calls_replay_and_finish_validate_artifacts(tmp_path, monkeypatch):
    provider = FakeProvider(
        [
            {
                "role": "assistant",
                "content": "I will save the observation.",
                "tool_calls": [
                    call(
                        "tc-1",
                        "write_artifact",
                        {
                            "artifact_id": "note-1",
                            "format": "markdown",
                            "content": "Evidence note",
                        },
                    )
                ],
            },
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    call(
                        "tc-2",
                        "finish_investigation",
                        {"summary": "Done", "artifact_ids": ["note-1"]},
                    )
                ],
            },
        ]
    )
    agent = ResearchOrchestrator(request(tmp_path / "report.pdf"), provider)
    available_catalog(agent)
    result = agent.run(str(tmp_path / "research_state.json"))
    assert result.status == "completed"
    assert result.final_artifact_ids == ["note-1"]
    assert len(provider.requests) == 2
    replay = provider.requests[1][0]
    assistant = next(m for m in replay if m.get("role") == "assistant")
    tool_results = [m for m in replay if m.get("role") == "tool"]
    assert assistant["tool_calls"][0]["id"] == "tc-1"
    assert tool_results[0]["tool_call_id"] == "tc-1"
    assert provider.requests[0][1] == TOOLS
    assert all(m.get("role") != "developer" or m["content"] for m in replay)


def test_native_schema_error_is_returned_for_model_correction(tmp_path):
    provider = FakeProvider(
        [
            {
                "role": "assistant",
                "tool_calls": [
                    call(
                        "bad-1",
                        "write_artifact",
                        {"artifact_id": "../escape", "content": "x"},
                    )
                ],
            },
            {
                "role": "assistant",
                "tool_calls": [
                    call(
                        "good-1",
                        "write_artifact",
                        {"artifact_id": "note", "content": "x"},
                    )
                ],
            },
            {
                "role": "assistant",
                "tool_calls": [
                    call("finish-1", "finish_investigation", {"artifact_ids": ["note"]})
                ],
            },
        ]
    )
    agent = ResearchOrchestrator(request(tmp_path / "report.pdf"), provider)
    available_catalog(agent)
    result = agent.run(str(tmp_path / "state.json"))
    assert result.status == "completed"
    transcript = provider.requests[1][0]
    error = next(m for m in transcript if m.get("tool_call_id") == "bad-1")
    assert json.loads(error["content"])["status"] == "error"
    assert error["tool_call_id"] == "bad-1"


def test_inventory_only_turns_trigger_recovery_instead_of_counting_as_progress(
    tmp_path,
):
    provider = FakeProvider(
        [
            {"role": "assistant", "tool_calls": [call("source-1", "list_sources", {})]},
            {
                "role": "assistant",
                "tool_calls": [call("workspace-1", "list_workspace", {})],
            },
            {"role": "assistant", "tool_calls": [call("source-2", "list_sources", {})]},
            {
                "role": "assistant",
                "tool_calls": [
                    call(
                        "finish",
                        "finish_investigation",
                        {
                            "summary": "No useful evidence found",
                            "limitations": ["No document inspection was performed"],
                        },
                    )
                ],
            },
        ]
    )
    agent = ResearchOrchestrator(request(tmp_path / "report.pdf"), provider)
    available_catalog(agent)
    result = agent.run(str(tmp_path / "state.json"))
    assert result.status == "completed_with_limitations"
    recovery = provider.requests[3][0][-1]
    assert recovery["role"] == "user"
    assert (
        "last three tool-call turns did not produce new research state"
        in recovery["content"]
    )


def test_repeated_inspection_results_ignore_per_call_harness_ids(tmp_path):
    provider = FakeProvider(
        [
            {
                "role": "assistant",
                "tool_calls": [
                    call(f"inspect-{i}", "inspect_source", {"document_id": "doc-test"})
                ],
            }
            for i in range(7)
        ]
    )
    agent = ResearchOrchestrator(request(tmp_path / "report.pdf"), provider)
    available_catalog(agent)
    observation = {"document_id": "doc-test", "atlas": {"sections": []}}
    agent.tools.inspect_source = lambda document_id, section_id=None: observation
    result = agent.run(str(tmp_path / "state.json"))
    assert result.status == "stalled"
    recovery = provider.requests[4][0][-1]
    assert (
        recovery["role"] == "user"
        and "last three tool-call turns" in recovery["content"]
    )
    assert len(agent.state.tool_outcomes) == 1
    assert not agent.state.finish_requested
    initial = provider.requests[0][0][1]["content"]
    assert "no artifacts means there is nothing to list" in initial


def test_configured_repeated_tool_error_ceiling_is_respected(tmp_path):
    provider = FakeProvider(
        [
            {
                "role": "assistant",
                "tool_calls": [
                    call(
                        "bad-1",
                        "write_artifact",
                        {"artifact_id": "../escape", "content": "x"},
                    )
                ],
            },
        ]
    )
    req = request(tmp_path / "report.pdf")
    req.budget.max_retries_per_issue = 0
    agent = ResearchOrchestrator(req, provider)
    available_catalog(agent)
    result = agent.run(str(tmp_path / "state.json"))
    assert result.status == "partial"
    error = next(
        m for m in agent.state.conversation if m.get("tool_call_id") == "bad-1"
    )
    assert json.loads(error["content"])["retryable"] is False


def test_pending_tool_call_is_resumed_before_new_model_turn(tmp_path):
    provider = FakeProvider(
        [
            {
                "role": "assistant",
                "tool_calls": [
                    call("finish", "finish_investigation", {"summary": "resumed"})
                ],
            },
        ]
    )
    req = request(tmp_path / "report.pdf")
    state = ResearchState(
        research_id=req.research_id,
        objective=req.objective,
        request_snapshot=req.model_dump(),
        run_id="resume-run",
        conversation=[
            {"role": "developer", "content": "system"},
            {"role": "user", "content": "mission"},
            {
                "role": "assistant",
                "tool_calls": [
                    call(
                        "write",
                        "write_artifact",
                        {"artifact_id": "note", "content": "x"},
                    )
                ],
            },
        ],
        pending_tool_calls=[
            call("write", "write_artifact", {"artifact_id": "note", "content": "x"})
        ],
    )
    state_path = tmp_path / "state.json"
    save_state(state, state_path)
    workspace = ResearchWorkspace(tmp_path / "workspace")
    workspace.upsert(
        {
            "artifact_id": "note",
            "content": "x",
            "metadata": {"_harness_tool_call_id": "resume-run:write"},
        }
    )
    agent = ResearchOrchestrator(req, provider, state)
    available_catalog(agent)
    result = agent.run(str(state_path))
    assert result.status == "completed"
    # Exactly one inference call was used, for finish after the pending write.
    assert len(provider.requests) == 1
    replay = provider.requests[0][0]
    assert any(m.get("tool_call_id") == "write" for m in replay)
    assert ResearchWorkspace(tmp_path / "workspace").get("note")["version"] == 1


def test_workspace_confinement_corruption_and_patch_revision(tmp_path):
    workspace = ResearchWorkspace(tmp_path / "workspace")
    first = workspace.upsert(
        {"artifact_id": "note", "content": {"a": 1}, "metadata": {"source": "test"}}
    )
    second = workspace.upsert({"artifact_id": "note", "title": "Revised"})
    assert first["version"] == 1 and second["version"] == 2
    assert second["content"] == {"a": 1} and second["metadata"] == {"source": "test"}
    with pytest.raises(ValueError):
        workspace.upsert({"artifact_id": "../escape"})
    workspace.manifest_path.write_text("not-json", encoding="utf-8")
    with pytest.raises(ValueError, match="corrupt"):
        workspace.list()


def test_sse_reassembles_split_tool_arguments_and_rejects_incomplete_stream():
    chunks = [
        "data: "
        + json.dumps(
            {
                "model": "muse-spark-1.3-contributor",
                "choices": [
                    {
                        "delta": {
                            "reasoning_state": "part-1",
                            "tool_calls": [
                                {
                                    "index": 0,
                                    "id": "tc",
                                    "type": "function",
                                    "function": {
                                        "name": "search_",
                                        "arguments": '{"query":',
                                    },
                                }
                            ],
                        },
                        "finish_reason": None,
                    }
                ],
            }
        ),
        "data: "
        + json.dumps(
            {
                "choices": [
                    {
                        "delta": {
                            "reasoning_state": "part-2",
                            "tool_calls": [
                                {
                                    "index": 0,
                                    "function": {
                                        "name": "source",
                                        "arguments": '"water"}',
                                    },
                                }
                            ],
                        },
                        "finish_reason": "tool_calls",
                    }
                ]
            }
        ),
        "data: [DONE]",
    ]
    response = type("Response", (), {"iter_lines": lambda self: iter(chunks)})()
    data = MuseChatTransport._consume_stream(response)
    tool_call = data["choices"][0]["message"]["tool_calls"][0]
    assert tool_call["function"]["name"] == "search_source"
    assert json.loads(tool_call["function"]["arguments"]) == {"query": "water"}
    assert data["choices"][0]["message"]["reasoning_state"] == "part-1part-2"
    incomplete = type(
        "Response", (), {"iter_lines": lambda self: iter(["data: [DONE]"])}
    )()
    with pytest.raises(MuseProtocolError):
        MuseChatTransport._consume_stream(incomplete)
    malformed = type(
        "Response",
        (),
        {"iter_lines": lambda self: iter(['data: {"choices":', "data: [DONE]"])},
    )()
    with pytest.raises(MuseProtocolError) as captured:
        MuseChatTransport._consume_stream(malformed)
    assert captured.value.raw_chunks == ['{"choices":']
    assert captured.value.stream_chunks_received == 1


def test_native_request_contains_replayable_messages_and_tool_definitions(monkeypatch):
    captured = {}

    class Response:
        def raise_for_status(self):
            pass

        def json(self):
            return {
                "model": "muse-spark-1.3-contributor",
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "tool_calls": [call("tc", "list_sources", {})],
                        },
                        "finish_reason": "tool_calls",
                    }
                ],
                "usage": {"prompt_tokens": 3},
            }

    class Client:
        def __init__(self, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def post(self, url, headers, json):
            captured.update(url=url, headers=headers, payload=json)
            return Response()

    monkeypatch.setattr("research_engine.agent.muse_protocol.httpx.Client", Client)
    transport = MuseChatTransport("key", stream=False)
    transport.set_max_output_tokens(23)
    result = transport.complete_agent(
        [
            {"role": "developer", "content": "system"},
            {"role": "user", "content": "mission"},
        ],
        TOOLS,
    )
    assert captured["url"].endswith("/chat/completions")
    assert captured["payload"]["model"] == "muse-spark-1.3-contributor"
    assert captured["payload"]["messages"][0]["role"] == "developer"
    assert captured["payload"]["tools"] == TOOLS
    assert captured["payload"]["max_completion_tokens"] == 23
    assert result["message"]["tool_calls"][0]["id"] == "tc"


def test_transport_retries_transient_http_status_but_not_client_errors(monkeypatch):
    import httpx

    attempts = []

    class Client:
        def __init__(self, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def post(self, url, headers, json):
            attempts.append(url)
            if len(attempts) == 1:
                return httpx.Response(429, request=httpx.Request("POST", url))
            return type(
                "Success",
                (),
                {
                    "raise_for_status": lambda self: None,
                    "json": lambda self: {
                        "model": "muse-spark-1.3-contributor",
                        "choices": [
                            {
                                "message": {"role": "assistant", "content": "ok"},
                                "finish_reason": "stop",
                            }
                        ],
                        "usage": {},
                    },
                },
            )()

    monkeypatch.setattr("research_engine.agent.muse_protocol.httpx.Client", Client)
    result = MuseChatTransport("key", stream=False).complete_agent(
        [{"role": "user", "content": "probe"}], None
    )
    assert len(attempts) == 2 and result["transport_attempts"] == 2

    attempts.clear()

    class BadRequestClient(Client):
        def post(self, url, headers, json):
            attempts.append(url)
            return httpx.Response(400, request=httpx.Request("POST", url))

    monkeypatch.setattr(
        "research_engine.agent.muse_protocol.httpx.Client", BadRequestClient
    )
    with pytest.raises(httpx.HTTPStatusError):
        MuseChatTransport("key", stream=False).complete_agent(
            [{"role": "user", "content": "probe"}], None
        )
    assert len(attempts) == 1


def test_standard_cli_creates_distinct_run_folders(tmp_path, monkeypatch):
    from research_engine import cli
    from research_engine.tools import ResearchTools

    request_path = tmp_path / "request.json"
    request_path.write_text(
        request(tmp_path / "missing.pdf").model_dump_json(), encoding="utf-8"
    )
    monkeypatch.setattr(
        ResearchTools,
        "list_sources",
        lambda self: [{"document_id": "doc-test", "available": True, "pages": 1}],
    )

    def provider_factory(self):
        return FakeProvider(
            [
                {
                    "role": "assistant",
                    "tool_calls": [
                        call("finish", "finish_investigation", {"summary": "done"})
                    ],
                }
            ]
        )

    monkeypatch.setattr(ResearchOrchestrator, "_provider", provider_factory)
    output = tmp_path / "runs-root"
    cli.main(["run", "--request", str(request_path), "--output", str(output)])
    first = json.loads((output / "latest_run.json").read_text())
    assert Path(first["path"]).joinpath("research_result.json").is_file()
    cli.main(["run", "--request", str(request_path), "--output", str(output)])
    second = json.loads((output / "latest_run.json").read_text())
    assert first["run_id"] != second["run_id"]
    assert Path(first["path"]).joinpath("research_state.json").is_file()
    assert Path(second["path"]).joinpath("research_state.json").is_file()


def test_atlas_page_scope_keeps_original_physical_page_ids(tmp_path):
    from research_engine.tools import DocumentIntelligenceAdapter
    from doc_intelligence.models.document import DocumentMetadata, Page, ParsedDocument
    from doc_intelligence.models.index import DocumentIndex, PageSummary
    from doc_intelligence.models.task import TaskSpecification
    from doc_intelligence.atlas.models import AtlasPage, AtlasSection, DocumentAtlas

    doc = ParsedDocument(
        metadata=DocumentMetadata(
            document_id="doc-test",
            filename="r.pdf",
            file_path="/tmp/r.pdf",
            file_size_bytes=1,
            file_hash_sha256="abc",
            page_count=3,
        ),
        pages=[Page(page_number=i, text=f"page {i}") for i in (1, 2, 3)],
        parser_name="fixture",
    )
    index = DocumentIndex(
        document_id="doc-test",
        total_pages=3,
        page_summaries=[
            PageSummary(page_number=i, char_count=1, word_count=1) for i in (1, 2, 3)
        ],
    )
    atlas = DocumentAtlas(
        document_id="doc-test",
        filename="r.pdf",
        total_pages=3,
        pages=[
            AtlasPage(page_number=i, preview_snippet=f"page {i}") for i in (1, 2, 3)
        ],
        sections=[
            AtlasSection(section_id="s1", title="Aquifer", start_page=2, end_page=3)
        ],
    )
    adapter = DocumentIntelligenceAdapter(object(), [])
    adapter.docs["doc-test"] = doc
    adapter.indexes["doc-test"] = index
    adapter.atlases["doc-test"] = atlas
    task = TaskSpecification(task_id="task", objective="water levels")
    scoped_doc, scoped_index = adapter._select_extraction_scope(
        doc, index, {"pages": [3]}, task
    )
    assert [page.page_number for page in scoped_doc.pages] == [3]
    assert scoped_doc.metadata.page_count == 3
    assert scoped_index.vocabulary["water"] == [3]
    task = TaskSpecification(
        task_id="all", objective="water levels", coverage_scope="all"
    )
    all_doc, _ = adapter._select_extraction_scope(doc, index, {}, task)
    assert [page.page_number for page in all_doc.pages] == [1, 2, 3]


def test_conversation_compaction_archives_history_and_keeps_recent_complete_turns(
    tmp_path, monkeypatch
):
    monkeypatch.setenv("RESEARCH_ENGINE_CONTEXT_COMPACTION_CHARS", "1")
    provider = FakeProvider(
        [
            {
                "role": "assistant",
                "content": "Remember the earlier searches and artifact evidence references.",
            }
        ]
    )
    req = request(tmp_path / "report.pdf")
    agent = ResearchOrchestrator(req, provider)
    agent.workspace = ResearchWorkspace(tmp_path / "workspace")
    messages = [
        {"role": "developer", "content": "system"},
        {"role": "user", "content": "mission"},
    ]
    for i in range(5):
        messages.extend(
            [
                {
                    "role": "assistant",
                    "tool_calls": [call(f"t{i}", "read_evidence", {"page": i + 1})],
                },
                {
                    "role": "tool",
                    "tool_call_id": f"t{i}",
                    "content": json.dumps({"page": i + 1, "text": "observed"}),
                },
            ]
        )
    agent.state.conversation = messages
    agent._maybe_compact_conversation()
    assert agent.state.compaction_count == 1
    archives = [
        entry
        for entry in agent.workspace.list()
        if entry["type"] == "conversation_archive"
    ]
    assert len(archives) == 1
    assert (
        len(agent.workspace.get(archives[0]["artifact_id"])["content"]["messages"]) > 0
    )
    retained = agent.state.conversation
    for assistant in [m for m in retained if m.get("role") == "assistant"]:
        for tool_call in assistant.get("tool_calls", []):
            assert any(
                m.get("tool_call_id") == tool_call["id"]
                for m in retained
                if m.get("role") == "tool"
            )
