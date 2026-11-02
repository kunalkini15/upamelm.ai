from __future__ import annotations

import json
from pathlib import Path

from research_engine_v2.artifacts import ArtifactStore
from research_engine_v2.models import Request
from research_engine_v2.muse import tool_definitions
from research_engine_v2.planner import Planner
from research_engine_v2.workflow import PlanningStage, ResearchWorkflow
from research_engine_v2.tools import bounded_selectors, resolve_pages
from research_engine_v2.cli import extractor_dir_for
from research_engine_v2.models import PlanningState
from research_engine_v2.prompts import SYSTEM_INSTRUCTIONS, planning_input
from research_engine_v2.atlas import _candidate_windows, inspect_atlas
from research_engine_v2.ui_contract import assemble, empty_package, structured_schema, validate
from research_engine_v2.muse import MuseResponse
from research_engine_v2.models import CallUsage


def test_ui_scientific_package_is_generic_and_reference_valid():
    package = empty_package({"id": "r1", "title": "Evidence report", "source_refs": ["src1"]})
    package["sources"] = [{"id": "src1", "document_id": "doc1", "page": 1}]
    package["study_areas"] = [{"id": "area1", "type": "district", "name": "Area", "source_refs": ["src1"]}]
    package["observations"] = [{"id": "obs1", "type": "rainfall", "study_area_id": "area1", "value": 4, "unit": "mm", "source_refs": ["src1"]}]
    result = validate(package)
    assert result["valid"] is True


def test_ui_assembly_preserves_scientific_fragments_and_datasets():
    first = {"features": [{"id": "f1", "type": "well", "name": "A", "source_refs": []}]}
    second = {"observations": [{"id": "o1", "type": "depth", "feature_id": "f1", "value": 4, "unit": "m", "source_refs": []}]}
    package = assemble([first, second], {"id": "r1", "title": "Report", "source_refs": []}, [{"id": "ds1", "type": "table", "rows": []}])
    assert len(package["features"]) == 1
    assert len(package["observations"]) == 1
    assert package["extensions"]["datasets"][0]["id"] == "ds1"


def test_ui_structured_schema_has_fixed_root_and_strict_objects():
    schema = structured_schema()
    assert schema["additionalProperties"] is False
    assert set(schema["required"]) == set(schema["properties"])
    assert "observations" in schema["properties"]
    assert schema["properties"]["observations"]["items"]["additionalProperties"] is False


def test_ui_v1_package_has_scientific_sections():
    package = empty_package({"id": "r1", "title": "Report", "source_refs": []})
    assert package["schema_version"] == "1.0"
    assert set(package) == {"schema_version", "report", "study_areas", "features", "observations", "intervals", "sources", "extensions"}
    assert validate(package)["valid"] is True


def test_navigation_index_accepts_compact_lat_lon_coordinates():
    from research_engine_v2.evidence_pack import _build_navigation_indexes

    entities, spatial = _build_navigation_indexes([{"records": [{"record_id": "r1", "site": "A", "lat": 23.2, "lon": 72.5}]}])
    assert entities and spatial[0]["geometry"]["coordinates"] == [72.5, 23.2]


def test_ui_dataset_rows_are_host_preserved_without_model_reemission():
    from research_engine_v2.synthesizer import Synthesizer

    synthesizer = Synthesizer.__new__(Synthesizer)
    evidence = {"groups": [{"target_id": "t1", "chunks": [{"chunk_id": "c1", "records": {"items": [{"record_id": "row-1", "source_table": {"table_id": "t1", "headers": ["value"]}, "columns": {"value": 4}, "_evidence_id": "ev1"}]}}]}]}
    datasets = synthesizer._build_inline_datasets(evidence)
    assert datasets[0]["rows"][0]["values"]["value"] == 4


def test_responses_structured_output_is_read_without_tool_call():
    response = MuseResponse("call_1", {"output": [{"type": "message", "content": [{"type": "output_text", "text": '{"ok":true}'}]}]}, CallUsage(), [])
    assert response.json_content == {"ok": True}


class Section:
    def __init__(self, section_id: str, start_page: int, end_page: int):
        self.section_id = section_id
        self.start_page = start_page
        self.end_page = end_page


class Atlas:
    total_pages = 5

    def __init__(self):
        self.sections = [Section("s1", 2, 3)]

    def get_section(self, identifier):
        return next((x for x in self.sections if x.section_id == identifier), None)

    def search(self, query, top_k=20):
        return [type("Hit", (), {"page_number": 4})()]


def test_request_accepts_additive_context_and_limits():
    request = Request.model_validate(
        {
            "research_id": "r1",
            "objective": "Understand the source",
            "sources": [{"path": "/tmp/source.pdf", "extra_source_metadata": "kept"}],
            "context": {"desired_outcomes": ["analysis"]},
            "limits": {},
            "future_field": {"preserved": True},
        }
    )
    assert request.context["desired_outcomes"] == ["analysis"]
    assert request.model_extra["future_field"] == {"preserved": True}


def test_artifact_versions_are_manifested_and_incremental(tmp_path: Path):
    store = ArtifactStore(tmp_path)
    first, version1 = store.version("research_plan", {"revision": 1})
    second, version2 = store.version("research_plan", {"revision": 2})
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert first.exists() and second.exists()
    assert (version1, version2) == (1, 2)
    assert [x["version"] for x in manifest["artifacts"]["research_plan"]["versions"]] == [1, 2]


def test_selector_resolution_is_bounded_and_atlas_driven():
    atlas = Atlas()
    assert bounded_selectors({"selectors": {"sections": ["s1"]}})
    assert resolve_pages(atlas, {"sections": ["s1"]}) == [2, 3]
    assert resolve_pages(atlas, {"query": "target"}) == [4]
    assert not bounded_selectors({"selectors": {}})


def test_tool_registry_contains_only_generic_planning_tools():
    names = {tool["name"] for tool in tool_definitions()}
    assert names == {
        "inspect_atlas",
        "search_atlas",
        "request_reconnaissance",
        "read_planning_artifact",
        "search_planning_memory",
        "read_tool_observation",
        "revise_plan",
        "complete_planning",
    }
    revise = next(tool for tool in tool_definitions() if tool["name"] == "revise_plan")
    assert "strict" not in revise
    assert revise["parameters"]["additionalProperties"] is True


def test_planner_prompt_prioritizes_sufficient_coverage_without_minimum_page_bias():
    assert "distinct information" in SYSTEM_INSTRUCTIONS
    assert "entire section solely because its title is relevant" in SYSTEM_INSTRUCTIONS
    assert "smallest evidence-bearing page set" not in SYSTEM_INSTRUCTIONS
    assert "whole-document extraction" not in SYSTEM_INSTRUCTIONS


def test_planning_input_preserves_request_requirements():
    payload = json.loads(planning_input(
        {"objective": "Map the source", "domain_context": "domain", "instructions": ["retain provenance"], "desired_outcomes": ["analysis"], "context": {"mode": "test"}},
        [{"document_id": "doc-1", "total_pages": 3}],
        {"phase": "atlas_discovery"},
    ))
    assert payload["mission"]["objective"] == "Map the source"
    assert payload["mission"]["desired_outcomes"] == ["analysis"]
    assert payload["sources"][0]["document_id"] == "doc-1"


def test_planner_contract_is_domain_independent():
    for objective, domain in (("Characterize soil horizons", "soil science"), ("Compare crop yields", "agriculture")):
        payload = json.loads(planning_input(
            {"objective": objective, "domain_context": domain, "instructions": [], "desired_outcomes": ["analysis"], "context": {}},
            [{"document_id": "doc-1", "total_pages": 2}],
            {"phase": "atlas_discovery"},
        ))
        assert payload["mission"]["objective"] == objective
        assert payload["mission"]["domain_context"] == domain


def test_extractor_is_not_an_autonomous_tool_registry():
    from research_engine_v2.models import ExtractionPlan, ExtractorConfig
    assert ExtractorConfig().soft_chunk_pages == 5
    assert "page_targets" in ExtractionPlan.model_fields


def test_compact_state_omits_full_observation_payloads(tmp_path: Path):
    planner = Planner.__new__(Planner)
    planner.state = type("State", (), {
        "model_dump": lambda self, mode="json": {"observations": [{"tool": "request_reconnaissance", "result": {"large": "x" * 10000}}]},
        "observations": [{"tool": "request_reconnaissance", "result": {"large": "x" * 10000}}],
    })()
    compact = planner._compact_state()
    assert "result" not in compact["observations"][0]
    assert compact["observations"][0]["result_summary"]["keys"] == ["large"]


def test_compact_atlas_unwraps_source_overview():
    planner = Planner.__new__(Planner)
    planner.overviews = [{
        "document_id": "doc-1",
        "source_type": "local_document",
        "overview": {
            "document_id": "doc-1", "filename": "source.pdf", "total_pages": 10,
            "toc_source": "original_toc", "toc_pages": [1],
            "sections": [{"section_id": "s1", "title": "Evidence", "start_page": 2, "end_page": 4}],
            "candidate_windows": [{"pages": [2, 4], "keyphrases": ["evidence"]}],
            "content_counts": {"tables": 2},
        },
    }]
    compact = planner._compact_atlas_overviews()
    assert compact[0]["total_pages"] == 10
    assert compact[0]["sections"][0]["section_id"] == "s1"
    assert compact[0]["candidate_windows"][0]["pages"] == [2, 4]


def test_section_inspection_includes_bounded_page_signals():
    metadata = type("Meta", (), {
        "has_tables": True, "table_captions": ["Table 1"], "table_headers": ["id | value"],
        "has_figures": False, "figure_captions": [],
    })()
    page = type("Page", (), {
        "page_number": 2, "printed_page_number": "1", "keyphrases": ["target"],
        "char_count": 100, "structural_metadata": metadata,
    })()
    section = type("Section", (), {
        "section_id": "s1", "title": "Evidence", "start_page": 2, "end_page": 2,
        "level": 1, "model_dump": lambda self, mode="json": {"section_id": "s1", "title": "Evidence"},
    })()
    atlas = type("Atlas", (), {
        "document_id": "doc-1", "filename": "source.pdf", "total_pages": 2,
        "sections": [section], "pages": [page],
        "get_section": lambda self, identifier: section if identifier == "s1" else None,
    })()
    result = inspect_atlas(atlas, "s1")
    assert result["pages"][0]["page_number"] == 2
    assert result["pages"][0]["table_headers"] == ["id | value"]


def test_repeated_successful_discovery_is_reported_as_already_observed():
    planner = Planner.__new__(Planner)
    planner.state = PlanningState(research_id="r1", atlas_observed=True)
    planner.state.discovery_signatures = []
    planner.atlases = {"doc-1": Atlas()}
    planner._remember_atlas("inspect_atlas", {"document_id": "doc-1"}, {"document_id": "doc-1", "total_pages": 5, "sections": []})
    call = {"name": "inspect_atlas", "arguments": json.dumps({"document_id": "doc-1"})}
    result = planner._execute(call)
    assert result["status"] == "already_observed"


def test_planner_does_not_expose_plan_completion_before_atlas(tmp_path: Path):
    request = Request(
        research_id="r1",
        objective="Understand the source",
        sources=[{"path": "/tmp/source.pdf"}],
    )
    planner = Planner.__new__(Planner)
    planner.request = request
    planner.state = type("State", (), {"atlas_observed": False, "plan_revision": 0})()
    names = {tool["name"] for tool in planner._available_tools()}
    assert names == {"inspect_atlas", "search_atlas"}


def test_planner_retains_semantic_atlas_memory_and_allows_additional_discovery():
    planner = Planner.__new__(Planner)
    planner.state = PlanningState(research_id="r1", atlas_observed=True, discovery_actions=6)
    planner.state.atlas_digest = {"documents": {}}
    planner._remember_atlas(
        "search_atlas",
        {"document_id": "doc-1", "query": "aquifer"},
        {"document_id": "doc-1", "results": [{"page_number": 12, "matched_sections": ["Hydrogeology"], "preview_snippet": "aquifer evidence"}]},
    )
    assert planner.state.atlas_digest["documents"]["doc-1"]["search_hits"][0]["page_number"] == 12
    names = {tool["name"] for tool in planner._available_tools()}
    assert "inspect_atlas" in names and "search_atlas" in names
    assert "revise_plan" in names
    assert "read_tool_observation" in names


def test_planner_exposes_only_completion_after_valid_plan():
    planner = Planner.__new__(Planner)
    planner.state = PlanningState(research_id="r1", atlas_observed=True, plan_revision=1)
    assert {tool["name"] for tool in planner._available_tools()} == {"complete_planning"}


def test_planner_accepts_unique_atlas_page_targets():
    planner = Planner.__new__(Planner)
    planner.atlases = {"doc-1": Atlas()}
    targets = [{
        "document_id": "doc-1", "pages": [2, 3], "reason": "Relevant section",
        "expected_information": "Evidence for the objective", "covered_outcomes": ["analysis"], "status": "required",
    }]
    assert planner._validate_page_targets(targets) is None
    assert "duplicate" in planner._validate_page_targets(targets + [targets[0]])
    conditional = [dict(targets[0], status="conditional")]
    assert planner._validate_page_targets(conditional) is None


def test_planner_tolerates_noncritical_target_annotations():
    planner = Planner.__new__(Planner)
    planner.atlases = {"doc-1": Atlas()}
    targets, warnings = planner._normalize_page_targets([{
        "document_id": "doc-1", "pages": [2], "reason": "Relevant",
        "expected_information": "Evidence", "status": "required",
        "future_annotation": {"confidence": "high"},
    }])
    assert planner._validate_page_targets(targets) is None
    assert "future_annotation" in warnings[0]


def test_outcome_annotations_are_advisory_not_blocking():
    planner = Planner.__new__(Planner)
    planner.request = Request(
        research_id="r1", objective="Understand the source",
        desired_outcomes=["analysis", "visualization"], sources=[{"path": "/tmp/source.pdf"}],
    )
    assert "omit requested outcomes" in planner._outcome_coverage_warning([{
        "covered_outcomes": ["analysis"],
    }])
    assert planner._outcome_coverage_warning([]).startswith("No optional")


def test_planner_stops_repeated_identical_errors():
    planner = Planner.__new__(Planner)
    planner.last_no_progress_signature = None
    planner.repeated_no_progress = 0
    planner.no_progress_threshold = 5
    observation = {"status": "retryable_error", "message": "invalid page target"}
    assert all(planner._register_progress(observation, "revise_plan") for _ in range(4))
    assert planner._register_progress(observation, "revise_plan") is False


def test_atlas_candidate_windows_are_section_aware():
    class Page:
        def __init__(self, number, section, chars=100):
            self.page_number = number
            self.char_count = chars
            self.keyphrases = [f"term-{number}"]
            self.structural_metadata = type("Meta", (), {"has_tables": False, "table_captions": [], "figure_captions": []})()
    atlas = type("Atlas", (), {
        "sections": [type("Section", (), {"section_id": "s1", "title": "One", "start_page": 1, "end_page": 2})(), type("Section", (), {"section_id": "s2", "title": "Two", "start_page": 3, "end_page": 4})()],
        "pages": [Page(1, "s1"), Page(2, "s1"), Page(3, "s2"), Page(4, "s2")],
    })()
    windows = _candidate_windows(atlas)
    assert windows and windows[0]["pages"] == [1, 2] and windows[-1]["pages"] == [3, 4]


def test_workflow_exposes_planning_as_a_stage_without_execution():
    assert hasattr(ResearchWorkflow, "run_planning")
    assert hasattr(PlanningStage, "run")
    assert hasattr(ResearchWorkflow, "run_extraction")


def test_workflow_continues_through_limited_successes():
    workflow = ResearchWorkflow.__new__(ResearchWorkflow)
    workflow.run_planning = lambda: type("Result", (), {"status": "completed_with_limitations"})()
    workflow.run_extraction = lambda: type("Result", (), {"status": "completed_with_limitations"})()
    workflow.run_synthesis = lambda: {"status": "completed", "stage": "synthesis"}

    assert workflow.run_all() == {"status": "completed", "stage": "synthesis"}


def test_planner_and_extractor_use_sibling_stage_roots(tmp_path: Path):
    planner_dir = tmp_path / "planner"
    assert extractor_dir_for(planner_dir) == tmp_path / "extractor"


def test_extractor_prompt_propagates_complete_research_mission():
    from research_engine_v2.extractor import Extractor

    extractor = Extractor.__new__(Extractor)
    extractor.plan = type("Plan", (), {"objective": "Answer the objective", "instructions": ["Preserve provenance"]})()
    extractor.request_snapshot = {
        "domain_context": "Use the supplied domain context",
        "instructions": ["Keep all measurements"],
        "desired_outcomes": ["structured evidence", "analysis"],
    }
    extractor.source_paths = {}
    prompt = json.loads(extractor._prompt({
        "document_id": "doc-1", "target": {"reason": "group reason"},
        "chunk_id": "chunk-1", "target_id": "target-1", "pages": [1],
        "continuation_group_id": None,
    }, [{"pdf_page_number": 1, "text": "source"}], 350))
    assert prompt["objective"] == "Answer the objective"
    assert prompt["domain_context"] == "Use the supplied domain context"
    assert prompt["request_instructions"] == ["Keep all measurements"]
    assert prompt["desired_outcomes"] == ["structured evidence", "analysis"]
    assert prompt["target"]["reason"] == "group reason"


def test_extractor_prompt_is_generic_and_schema_is_native():
    from research_engine_v2.extractor import EXTRACTION_INSTRUCTIONS, EXTRACTION_RESPONSE_FORMAT

    assert "domain-independent" in EXTRACTION_INSTRUCTIONS
    assert "aquifer" not in EXTRACTION_INSTRUCTIONS.lower()
    assert "json_schema" == EXTRACTION_RESPONSE_FORMAT["type"]
    assert EXTRACTION_RESPONSE_FORMAT["schema"]["required"] == ["digest", "facts", "records", "uncertainties", "limitations"]


def test_page_payload_preserves_lossless_table_cell_text():
    from research_engine_v2.extractor import Extractor
    from doc_intelligence.models.document import Page, ContentBlock, TableData, TableCell

    page = Page(
        page_number=1,
        text="Heading\nValue 10 m",
        blocks=[ContentBlock(block_id="b1", page_number=1, text="Heading")],
        tables=[TableData(table_id="t1", page_number=1, headers=["Value"], rows=[["10 m"]], cells=[TableCell(text="10 m", row_index=0, col_index=0)])],
    )
    payload = Extractor._page_payload(page)
    assert payload["text"] == page.text
    assert "text" not in payload["blocks"][0]
    assert payload["tables"][0]["rows"] == [["10 m"]]
    assert "cells" not in payload["tables"][0]
    lossless = Extractor._page_payload(page, compact=False)
    assert lossless["tables"][0]["cells"][0]["text"] == "10 m"


def test_source_rows_are_preserved_as_atomic_records():
    from research_engine_v2.extractor import Extractor

    pages = [{"pdf_page_number": 4, "tables": [{"table_id": "p4_t1", "headers": ["Name", "Value"], "rows": [["A", "10"], ["B", "20"]]}]}]
    records = Extractor._source_records(pages, "doc_test")
    assert [record["record_id"] for record in records] == ["doc_test_p4_p4_t1_r0001", "doc_test_p4_p4_t1_r0002"]
    assert records[0]["columns"] == {"Name": "A", "Value": "10"}
    assert records[1]["evidence"][0]["row_number"] == 2


def test_source_rows_normalize_reported_coordinate_pairs_without_fabrication():
    from research_engine_v2.extractor import Extractor

    pages = [{"pdf_page_number": 4, "tables": [{"table_id": "p4_t1", "headers": ["Latitude", "Longitude"], "rows": [["23°04'N", "72°38'E"]]}]}]
    record = Extractor._source_records(pages, "doc_test")[0]
    assert record["spatial_status"] == "located"
    assert record["geometry"]["coordinates"] == [72 + 38 / 60, 23 + 4 / 60]


def test_evidence_pack_selects_latest_artifact_version(tmp_path):
    from research_engine_v2.evidence_pack import build_evidence_pack

    root = tmp_path / "extractor"
    (root / "artifacts" / "evidence_chunk_1").mkdir(parents=True)
    for version, value in (("v0001", "old"), ("v0002", "new")):
        (root / "artifacts" / "evidence_chunk_1" / f"{version}.json").write_text(json.dumps({"chunk": {"chunk_id": "chunk_1"}, "extraction": {"digest": value}}), encoding="utf-8")
    pack = build_evidence_pack(root)
    assert len(pack["chunk_index"]) == 1
    assert pack["chunk_index"][0]["digest"] == "new"


def test_evidence_pack_contains_synthesis_evidence_without_raw_pages(tmp_path):
    from research_engine_v2.evidence_pack import build_evidence_pack

    root = tmp_path / "extractor"
    artifact_dir = root / "artifacts" / "evidence_chunk_1"
    artifact_dir.mkdir(parents=True)
    artifact = {
        "chunk": {"chunk_id": "chunk_1", "target_id": "target_1", "document_id": "doc_1", "pages": [3]},
        "source_pages": [{"pdf_page_number": 3, "text": "raw source"}],
        "extraction": {
            "digest": "summary",
            "facts": [{"fact_id": "f1", "observation": "value", "evidence": [{"pdf_page_number": 3}]}],
            "records": [{"record_id": "doc_1_p3_t1_r0001", "record_type": "source_table_row", "evidence": [{"pdf_page_number": 3}]}],
            "relationships": [{"from": "f1", "to": "doc_1_p3_t1_r0001"}],
            "visual_evidence": [{"visual_id": "v1", "pdf_page_number": 3}],
            "limitations": [],
        },
    }
    (artifact_dir / "v0001.json").write_text(json.dumps(artifact), encoding="utf-8")
    pack = build_evidence_pack(root)
    chunk = pack["chunk_index"][0]
    assert chunk["facts"][0]["fact_id"] == "f1"
    assert chunk["records"][0]["record_type"] == "source_table_row"
    assert chunk["relationships"]
    assert chunk["visual_evidence"][0]["visual_id"] == "v1"
    assert "source_pages" not in chunk


def test_row_range_filter_preserves_original_row_numbers():
    from research_engine_v2.extractor import Extractor

    pages = [{"pdf_page_number": 4, "tables": [{"table_id": "p4_t1", "headers": ["Name"], "rows": [["A"], ["B"], ["C"], ["D"]]}]}]
    filtered = Extractor._filter_row_ranges(pages, [{"pdf_page_number": 4, "table_id": "p4_t1", "row_start": 3, "row_end": 4}])
    records = Extractor._source_records(filtered, "doc_test")
    assert [record["record_id"] for record in records] == ["doc_test_p4_p4_t1_r0003", "doc_test_p4_p4_t1_r0004"]
    assert [record["columns"]["Name"] for record in records] == ["C", "D"]


def test_extractor_group_cache_identity_includes_chunks_and_configuration(tmp_path: Path):
    from research_engine_v2.extractor import Extractor, EXTRACTION_PROMPT_VERSION
    from research_engine_v2.models import ExtractorConfig

    extractor = Extractor.__new__(Extractor)
    extractor.output_dir = tmp_path
    extractor.config = ExtractorConfig()
    extractor.transport = type("Transport", (), {"model": "muse-spark-1.3-contributor"})()
    fingerprint = extractor._config_fingerprint()
    assert fingerprint
    assert EXTRACTION_PROMPT_VERSION == "extractor-evidence-v5-source-row-ledger"


def test_extractor_normalizes_provenance_aliases_without_rejecting_extra_fields():
    from research_engine_v2.extractor import Extractor

    extractor = Extractor.__new__(Extractor)
    payload, issues = extractor._ground({"facts": [{"fact_id": "f1", "source_evidence": {"page": "2", "source": "quoted"}, "extra": "kept"}], "records": [], "relationships": []}, {"pages": [2]})
    fact = payload["facts"][0]
    assert fact["evidence"][0]["pdf_page_number"] == 2
    assert fact["evidence"][0]["source_text"] == "quoted"
    assert fact["extra"] == "kept"
    assert not issues


def test_extractor_parses_generic_page_provenance_strings():
    from research_engine_v2.extractor import Extractor

    ref = Extractor._canonical_ref({"source_text": "doc_abc pdf p20 printed 14 Table-8"}, {"pages": [20]})
    assert ref["document_id"] == "doc_abc"
    assert ref["pdf_page_number"] == 20
    assert ref["printed_page_number"] == "14"


def test_single_chunk_group_is_promoted_without_model_call():
    from research_engine_v2.extractor import Extractor
    from research_engine_v2.models import PageTarget

    extractor = Extractor.__new__(Extractor)
    target = PageTarget(target_id="t1", document_id="d1", pages=[1])
    result = extractor._consolidate_group(target, [{"status": "success", "artifact_id": "a1", "version": 1, "path": "x", "digest": "summary", "facts": [{"x": 1}], "chunk": {"chunk_id": "c1", "pages": [1]}, "limitations": []}])
    assert result["promoted_chunk"] is True
    assert result["artifact_id"] == "a1"


def test_synthesis_projection_preserves_evidence_and_removes_orchestration_metadata():
    from research_engine_v2.synthesis_support import SynthesisEvidenceProjector

    pack = {
        "research_id": "r1",
        "objective": "Compare evidence",
        "chunk_index": [{
            "chunk_id": "c1", "target_id": "t1", "document_id": "d1", "pages": [2],
            "artifact_id": "internal-artifact", "artifact_path": "artifacts/x.json", "digest": "internal summary",
            "facts": [
                {"statement": "A", "observation_type": "direct_observation", "evidence": [{"pdf_page_number": 2}]},
                {"statement": "B", "observation_type": "direct_observation", "evidence": [{"pdf_page_number": 2}]},
            ],
            "records": [{"record_id": "r1", "value": 10, "observation_type": "direct_observation"}],
            "relationships": [{"from": "A", "to": "B"}],
            "uncertainties": ["uncertain"], "limitations": ["limited"],
        }],
        "group_analyses": [{"target_id": "t1", "artifact_path": "internal/group.json", "analysis": {"analysis": "combined"}}],
        "coverage": {"chunk_artifacts": 1},
    }
    projection, audit = SynthesisEvidenceProjector().project(pack)
    chunk = projection["groups"][0]["chunks"][0]
    assert audit["counts_match"] is True
    assert audit["lossless_evidence_counts"] == {"facts": 2, "records": 1, "relationships": 1, "measurements": 0, "uncertainties": 1, "limitations": 1}
    assert chunk["facts"]["defaults"] == {"observation_type": "direct_observation"}
    assert [item["statement"] for item in chunk["facts"]["items"]] == ["A", "B"]
    assert chunk["facts"]["items"][0]["evidence"][0]["pdf_page_number"] == 2
    assert "artifact_id" not in chunk and "artifact_path" not in chunk and "digest" not in chunk


def test_evidence_assembler_reads_inline_v6_chunk_index(tmp_path: Path):
    from research_engine_v2.synthesis_support import EvidenceAssembler

    pack = {
        "research_id": "r1", "objective": "Understand evidence",
        "planner_targets": [{"target_id": "t1"}],
        "chunk_index": [{
            "chunk_id": "c1", "target_id": "t1", "document_id": "d1", "pages": [1],
            "artifact_id": "a1", "facts": [{"statement": "observed", "evidence": [{"pdf_page_number": 1}]}],
            "records": [], "relationships": [], "uncertainties": [], "limitations": [],
        }],
        "group_analyses": [{"target_id": "t1", "artifact_id": "g1", "analysis": {"analysis": "summary"}}],
    }
    (tmp_path / "evidence_pack.json").write_text(json.dumps(pack), encoding="utf-8")
    effective, index, coverage = EvidenceAssembler(tmp_path).build()
    assert len(effective["chunks"]) == 1
    assert index["item_count"] == 1
    assert coverage["missing_target_ids"] == []
