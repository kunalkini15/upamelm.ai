from __future__ import annotations

import json
from pathlib import Path

import pytest
import pymupdf
import httpx
from PIL import Image

from agentic_subsurface.adapters import AdapterRegistry
from agentic_subsurface.batching import EvidenceBatch, SemanticBatcher
from agentic_subsurface.models import MODEL, Artifact, ContentUnit, ExtractionResult, PipelineConfig, RunRequest, SourceBundle, SourceLocator
from agentic_subsurface.models import DocumentRunRequest, DocumentStudyRunRequest
from agentic_subsurface.loop1 import DocumentLoop1Processor
from agentic_subsurface.loop2 import DocumentLoop2Processor, requests_from_manifest
from agentic_subsurface.normalization import normalize_extraction_result_ids
from agentic_subsurface.pipeline import AgenticSubsurfacePipeline
from agentic_subsurface.provider import BudgetExceeded, IncompleteResponse, MuseClient


def test_token_counter_retries_transient_504_then_succeeds(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    client = MuseClient(tmp_path, PipelineConfig(live=True))
    client.api_key = "test"
    calls = 0

    def post(*args, **kwargs):
        nonlocal calls
        calls += 1
        request = httpx.Request("POST", str(args[0]))
        if calls < 3:
            return httpx.Response(504, request=request)
        return httpx.Response(200, request=request, json={"input_tokens": 1234})

    monkeypatch.setattr("agentic_subsurface.provider.httpx.post", post)
    monkeypatch.setattr("agentic_subsurface.provider.time.sleep", lambda _: None)
    assert client.count_tokens("instructions", "input") == 1234
    assert calls == 3


def test_token_counter_falls_back_after_transient_failures(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    client = MuseClient(tmp_path, PipelineConfig(live=True))
    client.api_key = "test"
    calls = 0

    def post(*args, **kwargs):
        nonlocal calls
        calls += 1
        request = httpx.Request("POST", str(args[0]))
        return httpx.Response(504, request=request)

    monkeypatch.setattr("agentic_subsurface.provider.httpx.post", post)
    monkeypatch.setattr("agentic_subsurface.provider.time.sleep", lambda _: None)
    content = [{"content": [{"type": "input_text", "text": "evidence"}, {"type": "input_image", "image_url": "data:image/png;base64,abc"}]}]
    estimated = client.count_tokens("instructions", content, {"type": "object"})
    assert calls == 4
    assert estimated >= 3_000
    assert "using conservative local estimate" in capsys.readouterr().err


def _normalization_result(batch_id: str = "visual-batch-0001") -> ExtractionResult:
    locator = {"kind": "pdf_page", "artifact_id": "page-1", "unit_id": "page-1", "page": 1}
    return ExtractionResult.model_validate({
        "batch_id": batch_id,
        "summary": "valuable extraction",
        "evidence_items": [{
            "evidence_id": "EV-01", "kind": "measurement", "statement": "Rock begins at 12 m",
            "confidence": "high", "basis": "direct", "evidence": [{"artifact_id": "page-1", "locator": locator}],
        }],
        "entities": [{"entity_id": "ENT-01", "name": "Borehole", "type": "borehole", "evidence_refs": ["EV-01"]}],
        "spatial_features": [{"feature_id": "SF-01", "name": "BH-1", "type": "borehole", "evidence_refs": ["EV-01"]}],
        "vertical_intervals": [{"interval_id": "VI-01", "feature_id": "SF-01", "name": "Rock", "type": "rock", "axis": "depth", "reference": "bgl", "start": 12, "end": 30, "unit": "m", "material": "rock", "fidelity": "quoted", "evidence_refs": ["EV-01"]}],
        "relationships": [{"relationship_id": "REL-01", "type": "located_at", "from_id": "ENT-01", "to_id": "SF-01", "evidence_refs": ["EV-01"]}],
        "visual_interpretations": [{"visual_id": "page-1", "artifact_id": "page-1", "type": "borehole_log", "evidence_refs": ["EV-01"]}],
    })


def test_normalization_namespaces_ids_and_rewrites_references_without_mutating_source() -> None:
    original = _normalization_result()
    normalized, issues, stats = normalize_extraction_result_ids("document:test", original)
    prefix = "document:test:visual-batch-0001"
    assert original.evidence_items[0].evidence_id == "EV-01"
    assert normalized.evidence_items[0].evidence_id == f"{prefix}:evidence:EV-01"
    assert normalized.entities[0]["entity_id"] == f"{prefix}:entity:ENT-01"
    assert normalized.entities[0]["evidence_refs"] == [f"{prefix}:evidence:EV-01"]
    assert normalized.vertical_intervals[0]["feature_id"] == f"{prefix}:feature:SF-01"
    assert normalized.relationships[0]["from_id"] == f"{prefix}:entity:ENT-01"
    assert normalized.relationships[0]["to_id"] == f"{prefix}:feature:SF-01"
    assert normalized.visual_interpretations[0]["artifact_id"] == "page-1"
    assert issues == []
    assert stats["rewritten"]["evidence_items"] == 1


def test_normalization_retains_and_reports_unresolved_reference() -> None:
    result = _normalization_result()
    result.entities[0]["evidence_refs"] = ["EV-MISSING"]
    normalized, issues, _ = normalize_extraction_result_ids("document:test", result)
    assert normalized.entities[0]["evidence_refs"] == ["document:test:visual-batch-0001:unresolved:EV-MISSING"]
    assert any(issue["code"] == "unresolved_generated_reference" for issue in issues)


def test_same_local_ids_in_different_batches_remain_unique() -> None:
    first, _, _ = normalize_extraction_result_ids("document:test", _normalization_result("batch-1"))
    second, _, _ = normalize_extraction_result_ids("document:test", _normalization_result("batch-2"))
    assert first.evidence_items[0].evidence_id != second.evidence_items[0].evidence_id


def test_consolidation_retains_evidence_with_invalid_native_provenance(tmp_path: Path) -> None:
    processor, request, _, _ = _stage3_fixture(tmp_path)
    root = tmp_path / "version"
    bundle = SourceBundle(
        source_id="source", original_path="source.pdf", filename="source.pdf", media_type="application/pdf",
        sha256="x", size_bytes=1, adapter="pdf",
        artifacts=[Artifact(artifact_id="page-1", kind="page_render", path="page.png", sha256="x")],
    )
    result = _normalization_result()
    result.evidence_items[0].evidence[0].artifact_id = "missing-artifact"
    result.evidence_items[0].evidence[0].locator.artifact_id = "missing-artifact"
    package = processor._consolidate(request, root, "document:test", "version:test", bundle, [], [result], [])
    assert len(package["evidence_items"]) == 1
    assert package["coverage"]["evidence_items_retained"] == 1
    assert package["coverage"]["valid_evidence_items"] == 0
    assert package["coverage"]["validation_errors"] == 1
    report = json.loads((root / "identifier_normalization_report.json").read_text(encoding="utf-8"))
    assert report["rewritten"]["evidence_items"] == 1


def test_consolidation_repairs_unit_used_as_artifact_without_changing_evidence(tmp_path: Path) -> None:
    processor, request, _, _ = _stage3_fixture(tmp_path)
    root = tmp_path / "version"
    locator = SourceLocator(kind="pdf_region", artifact_id="table-1", unit_id="table-1:unit", page=3)
    unit = ContentUnit(unit_id="table-1:unit", artifact_id="table-1", kind="pdf_table", sequence=1, text="Depth 30 m", locator=locator)
    bundle = SourceBundle(
        source_id="source", original_path="source.pdf", filename="source.pdf", media_type="application/pdf",
        sha256="x", size_bytes=1, adapter="pdf", units=[unit],
        artifacts=[Artifact(artifact_id="table-1", kind="pdf_table", path="table.json", sha256="x")],
    )
    result = _normalization_result()
    ref = result.evidence_items[0].evidence[0]
    ref.artifact_id = "table-1:unit"
    ref.locator.artifact_id = "table-1"
    ref.locator.unit_id = "table-1:unit}}],"
    package = processor._consolidate(request, root, "document:test", "version:test", bundle, [], [result], [])
    repaired = package["evidence_items"][0]["evidence"][0]
    assert repaired["artifact_id"] == "table-1"
    assert repaired["locator"]["unit_id"] == "table-1:unit"
    assert package["evidence_items"][0]["statement"] == "Rock begins at 12 m"
    assert package["coverage"]["validation_errors"] == 0
    report = json.loads((root / "identifier_normalization_report.json").read_text(encoding="utf-8"))
    assert report["provenance_repairs"] == 2


def test_completed_empty_extraction_stage_is_reusable(tmp_path: Path) -> None:
    root = tmp_path / "version"
    directory = root / "stages" / "visual_extraction"
    directory.mkdir(parents=True)
    (root / "stage_telemetry.json").write_text(json.dumps({
        "stages": {"5": {"runs": [{"status": "completed", "details": {"batches": 0}}]}},
    }), encoding="utf-8")
    assert DocumentLoop1Processor._load_extraction_results(directory, 5) == []


def test_missing_empty_extraction_stage_is_not_treated_as_complete(tmp_path: Path) -> None:
    directory = tmp_path / "version" / "stages" / "visual_extraction"
    directory.mkdir(parents=True)
    with pytest.raises(RuntimeError, match="stage 5 artifacts are missing"):
        DocumentLoop1Processor._load_extraction_results(directory, 5)


def test_model_and_budget_are_hard_limited() -> None:
    with pytest.raises(ValueError): PipelineConfig(model="muse-spark-1.3")
    with pytest.raises(ValueError): PipelineConfig(max_cost_usd=20.01)
    with pytest.raises(ValueError): PipelineConfig(max_workers=33)
    config = PipelineConfig()
    assert config.target_batch_tokens == 128_000
    assert config.max_batch_tokens == config.max_output_tokens == 128_000


def _stage3_fixture(tmp_path: Path) -> tuple[DocumentLoop1Processor, DocumentRunRequest, SourceBundle, EvidenceBatch]:
    config = PipelineConfig(live=True, target_batch_tokens=128_000, max_batch_tokens=128_000, max_output_tokens=128_000)
    processor = DocumentLoop1Processor(tmp_path / "corpus", config)
    source = tmp_path / "source.txt"
    source.write_text("source", encoding="utf-8")
    request = DocumentRunRequest(corpus_id="test", objective="extract", source=source, output_dir=tmp_path / "corpus", config=config)
    units = [ContentUnit(unit_id=f"unit-{index}", artifact_id="artifact", kind="text", sequence=index, text=letter * 300, locator=SourceLocator(kind="file", artifact_id="artifact", unit_id=f"unit-{index}")) for index, letter in enumerate("abcd", 1)]
    bundle = SourceBundle(source_id="source", original_path="source.txt", filename="source.txt", media_type="text/plain", sha256="x", size_bytes=6, adapter="text", units=units)
    batch = EvidenceBatch(batch_id="batch", source_id="source", units=units, estimated_tokens=400)
    return processor, request, bundle, batch


def test_stage3_preflight_count_does_not_shrink_initial_128k_batch(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    processor, request, bundle, batch = _stage3_fixture(tmp_path)
    completed: list[tuple[str, int]] = []
    monkeypatch.setattr(processor.client, "count_tokens", lambda instructions, payload, schema: 140_000)
    def complete(**kwargs):
        completed.append((kwargs["phase"], kwargs["counted_input_tokens"]))
        return {"batch_id": "ignored", "summary": "ok"}
    monkeypatch.setattr(processor.client, "complete", complete)
    results = processor._extract_text_batch(request, tmp_path / "version", bundle, batch, [], False)
    assert len(results) == 1
    assert completed == [("document-text-batch", 140_000)]


def test_stage3_incomplete_128k_response_falls_back_to_smaller_children(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    processor, request, bundle, batch = _stage3_fixture(tmp_path)
    completed: list[str] = []
    monkeypatch.setattr(processor.client, "count_tokens", lambda instructions, payload, schema: 120_000 if payload.count("--- SOURCE UNIT") == 4 else 60_000)
    def complete(**kwargs):
        if kwargs["phase"] == "document-text-batch":
            raise IncompleteResponse("max_output_tokens")
        completed.append(kwargs["phase"])
        return {"batch_id": "ignored", "summary": "ok"}
    monkeypatch.setattr(processor.client, "complete", complete)
    results = processor._extract_text_batch(request, tmp_path / "version", bundle, batch, [], False)
    assert len(results) == 2
    assert completed == ["document-text-batch-a", "document-text-batch-b"]


def test_stage3_emits_live_and_persistent_progress(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    processor, request, bundle, batch = _stage3_fixture(tmp_path)
    root = tmp_path / "version"
    monkeypatch.setattr(processor.client, "count_tokens", lambda instructions, payload, schema: 120_000)
    monkeypatch.setattr(processor.client, "complete", lambda **kwargs: {"batch_id": "ignored", "summary": "ok"})
    results = processor._extract_text(request, root, bundle, [batch], [], False)
    assert len(results) == 1
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "[stage 3] Starting 1 initial evidence batches" in captured.err
    assert "[stage 3] Completed in" in captured.err
    records = [json.loads(line) for line in (root / "stages" / "text" / "progress.jsonl").read_text(encoding="utf-8").splitlines()]
    assert [record["event"] for record in records] == ["stage_started", "batch_started", "batch_counted", "batch_completed", "initial_batch_finished", "stage_completed"]


def test_visual_stages_emit_live_and_persistent_progress(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    processor, request, bundle, _ = _stage3_fixture(tmp_path)
    root = tmp_path / "version"
    image_path = root / "visual.png"
    image_path.parent.mkdir(parents=True)
    Image.new("RGB", (10, 10), "white").save(image_path)
    artifact_id = "visual-1"
    bundle.visual_assets = [{"visual_id": artifact_id, "artifact_id": artifact_id, "kind": "image", "path": "visual.png"}]

    def complete(**kwargs):
        if kwargs["phase"].startswith("visual-classify"):
            return {"classifications": [{"artifact_id": artifact_id, "classification": "map", "meaningful": True, "reason": "test", "duplicate_of": None, "suggested_extraction": "deep_visual"}], "limitations": []}
        return {"batch_id": "ignored", "summary": "ok", "visual_interpretations": [{"artifact_id": artifact_id}]}

    monkeypatch.setattr(processor.client, "complete", complete)
    classifications = processor._classify_visuals(request, root, bundle, [], False)
    results = processor._extract_visuals(request, root, bundle, [], classifications, False)
    assert len(classifications) == len(results) == 1
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "[stage 4] Starting classification of 1 visuals" in captured.err
    assert "[stage 5] Starting extraction of 1 meaningful visuals" in captured.err
    stage4 = [json.loads(line)["event"] for line in (root / "stages" / "visual_classification" / "progress.jsonl").read_text().splitlines()]
    stage5 = [json.loads(line)["event"] for line in (root / "stages" / "visual_extraction" / "progress.jsonl").read_text().splitlines()]
    assert stage4 == ["stage_started", "batch_started", "batch_completed", "progress", "stage_completed"]
    assert stage5 == ["stage_started", "batch_started", "batch_completed", "progress", "stage_completed"]


@pytest.mark.parametrize("error", [IncompleteResponse("length"), IncompleteResponse("content_filter"), json.JSONDecodeError("bad JSON", "x", 0)])
def test_stage3_non_token_errors_do_not_split(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, error: Exception) -> None:
    processor, request, bundle, batch = _stage3_fixture(tmp_path)
    calls = 0
    monkeypatch.setattr(processor.client, "count_tokens", lambda instructions, payload, schema: 120_000)

    def complete(**kwargs):
        nonlocal calls
        calls += 1
        raise error

    monkeypatch.setattr(processor.client, "complete", complete)
    with pytest.raises(type(error)):
        processor._extract_text_batch(request, tmp_path / "version", bundle, batch, [], False)
    assert calls == 1


def test_batcher_starts_with_128k_batches_and_keeps_final_remainder(tmp_path: Path) -> None:
    units = [ContentUnit(unit_id=f"u-{index}", artifact_id="artifact", kind="text", sequence=index, text=str(tokens), locator=SourceLocator(kind="file", artifact_id="artifact", unit_id=f"u-{index}")) for index, tokens in enumerate([63_920, 63_920, 63_920, 63_920, 43_920], 1)]
    bundle = SourceBundle(source_id="source", original_path="source.txt", filename="source.txt", media_type="text/plain", sha256="x", size_bytes=1, adapter="text", units=units)
    batches = SemanticBatcher(token_estimator=lambda text: int(text)).build([bundle])
    assert [batch.estimated_tokens for batch in batches] == [128_000, 128_000, 44_000]


def test_stage3_oversized_single_unit_is_segmented_with_original_locator(tmp_path: Path) -> None:
    processor, _, _, _ = _stage3_fixture(tmp_path)
    locator = SourceLocator(kind="pdf_page", artifact_id="page-1", unit_id="page-1", page=1)
    unit = ContentUnit(unit_id="page-1", artifact_id="page-1", kind="pdf_page", sequence=1, text=("paragraph text. " * 10_000), locator=locator)
    children = processor._split_batch(EvidenceBatch(batch_id="large", source_id="source", units=[unit], estimated_tokens=50_000))
    assert len(children) == 2
    assert "".join(child.units[0].text for child in children) == unit.text
    assert all(child.units[0].locator.unit_id == "page-1" for child in children)
    assert [child.units[0].metadata["segment"] for child in children] == ["a", "b"]


def test_csv_adapter_preserves_rows(tmp_path: Path) -> None:
    source = tmp_path / "boreholes.csv"
    source.write_text("id,lat,lon,depth\nBH-1,12.9,77.5,30\n", encoding="utf-8")
    bundle = AdapterRegistry().materialize(source, tmp_path / "out")
    assert bundle.adapter == "csv"
    assert bundle.structured_assets[0]["row_count"] == 1
    assert bundle.units[0].locator.row == 2
    assert (tmp_path / "out" / bundle.original_path).read_text(encoding="utf-8").startswith("id,lat")


def test_kml_adapter_preserves_geometry(tmp_path: Path) -> None:
    source = tmp_path / "lines.kml"
    source.write_text('''<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>Pipe A</name><LineString><coordinates>77.5,12.9 77.6,13.0</coordinates></LineString></Placemark></Document></kml>''', encoding="utf-8")
    bundle = AdapterRegistry().materialize(source, tmp_path / "out")
    assert bundle.spatial_assets[0]["feature_count"] == 1
    geojson = json.loads((tmp_path / "out" / bundle.spatial_assets[0]["path"]).read_text(encoding="utf-8"))
    assert geojson["features"][0]["geometry"]["type"] == "LineString"


def test_pdf_adapter_preserves_page_render_and_detected_table(tmp_path: Path) -> None:
    source = tmp_path / "table.pdf"
    doc = pymupdf.open()
    page = doc.new_page()
    for x in (50, 150, 250): page.draw_line((x, 50), (x, 130))
    for y in (50, 90, 130): page.draw_line((50, y), (250, y))
    page.insert_text((65, 75), "Name")
    page.insert_text((165, 75), "Depth")
    page.insert_text((65, 115), "BH-1")
    page.insert_text((165, 115), "30 m")
    doc.save(source)
    doc.close()
    bundle = AdapterRegistry().materialize(source, tmp_path / "out")
    assert bundle.units[0].kind == "pdf_page"
    assert any(asset["kind"] == "pdf_table" for asset in bundle.structured_assets)
    assert any(item.kind == "page_render" for item in bundle.artifacts)


def test_batcher_is_lossless(tmp_path: Path) -> None:
    source = tmp_path / "rows.csv"
    source.write_text("id,value\n1," + "a" * 100 + "\n2," + "b" * 100 + "\n", encoding="utf-8")
    bundle = AdapterRegistry().materialize(source, tmp_path / "out")
    batches = SemanticBatcher(target_tokens=50, max_tokens=80).build([bundle])
    assert [u.unit_id for batch in batches for u in batch.units] == [u.unit_id for u in bundle.units]


def test_batcher_never_mixes_documents(tmp_path: Path) -> None:
    first = tmp_path / "one.csv"
    second = tmp_path / "two.csv"
    first.write_text("id,value\n1,a\n", encoding="utf-8")
    second.write_text("id,value\n2,b\n", encoding="utf-8")
    registry = AdapterRegistry()
    bundles = [registry.materialize(first, tmp_path / "out"), registry.materialize(second, tmp_path / "out")]
    batches = SemanticBatcher(target_tokens=10_000).build(bundles)
    assert all(len({unit.unit_id.split(":row:")[0] for unit in batch.units}) == 1 for batch in batches)
    assert len(batches) == 2


def test_budget_guard_uses_contributor_pricing(tmp_path: Path) -> None:
    client = MuseClient(tmp_path, PipelineConfig(max_cost_usd=0.01))
    assert client._estimated_cost(1_000_000, 1_000_000) == pytest.approx(0.30)
    with pytest.raises(BudgetExceeded): client._guard(1_000_000, 1_000_000)


def test_parallel_budget_reservations_cannot_oversubscribe(tmp_path: Path) -> None:
    client = MuseClient(tmp_path, PipelineConfig(max_cost_usd=0.01))
    reservation = client._reserve(0, 40_000)  # reserves $0.008
    with pytest.raises(BudgetExceeded):
        client._reserve(0, 40_000)
    client._release(reservation)
    assert client._reserve(0, 40_000)


def test_offline_pipeline_materializes_complete_shape(tmp_path: Path) -> None:
    source_dir = tmp_path / "sources"
    source_dir.mkdir()
    (source_dir / "points.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": [{"type": "Feature", "id": "p1", "properties": {"name": "BH-1"}, "geometry": {"type": "Point", "coordinates": [77.5, 12.9]}}]}), encoding="utf-8")
    request = RunRequest(run_id="test", objective="Test subsurface evidence", sources=[source_dir / "points.geojson"], output_dir=tmp_path / "run", config=PipelineConfig(live=False))
    result = AgenticSubsurfacePipeline(request).run()
    assert result["status"] == "completed"
    package = json.loads((tmp_path / "run" / "final" / "ui_consolidated_package.json").read_text(encoding="utf-8"))
    assert package["schema_version"] == "1.0"
    assert package["extensions"]["datasets"][0]["feature_count"] == 1
    assert MODEL == "muse-spark-1.3-contributor"


def _completed_loop1_package(corpus: Path) -> None:
    package = {
        "schema_version": "document-evidence.v2", "document_id": "document:test", "version_id": "version:test", "status": "complete",
        "source": {"source_id": "source:test", "filename": "test.csv", "media_type": "text/csv", "sha256": "abc", "adapter": "csv", "original_path": "sources/test.csv"},
        "structured_assets": [{"asset_id": "table:test", "kind": "table", "path": "sources/table.json", "row_count": 1}],
        "spatial_assets": [], "visual_assets": [], "entities": [], "evidence_items": [], "spatial_features": [], "vertical_intervals": [], "relationships": [], "visual_interpretations": [], "limitations": [], "unresolved_items": [],
        "coverage": {"validation_errors": 0},
    }
    target = corpus / "documents" / "document:test" / "versions" / "version:test" / "document_evidence_package.json"
    target.parent.mkdir(parents=True)
    target.write_text(json.dumps(package), encoding="utf-8")
    active = target.parents[2] / "active.json"
    active.write_text(json.dumps({"document_id": "document:test", "version_id": "version:test", "package_path": str(target.relative_to(corpus))}), encoding="utf-8")
    (corpus / "corpus_manifest.json").write_text(json.dumps({"schema_version": "corpus-manifest.v1", "active_documents": [{"document_id": "document:test", "version_id": "version:test", "package_path": str(target.relative_to(corpus)), "source_sha256": "abc"}]}), encoding="utf-8")


def test_loop2_stage_ranges_checkpoint_and_resume(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    corpus = tmp_path / "corpus"
    _completed_loop1_package(corpus)
    output = corpus / "loop2"
    config = PipelineConfig(live=True)
    request = requests_from_manifest(corpus, output, config)[0]
    processor = DocumentLoop2Processor(output, config)
    monkeypatch.setattr(processor.client, "count_tokens", lambda *args, **kwargs: 100)
    def complete(**kwargs):
        phase = kwargs["phase"]
        if "render" in phase:
            return {"title": "Test", "short_title": "Test", "domain": "generic", "summary": "Test", "primary_rendering_mode": "structured_data", "layers": [], "features": [], "observations": [], "intervals": [], "vertical_profiles": [], "structured_resources": [{"id": "resource:test", "name": "Test table", "kind": "table", "source_asset_id": "table:test", "ui_role": "table", "evidence_refs": []}], "evidence_dispositions": [], "unsupported_objects": [], "limitations": []}
        if "narrative" in phase:
                targets = json.loads(kwargs["input_content"])["targets"]
                return {"narratives": [{"target_id": item["target_id"], "headline": "Test", "summary": "Test", "why_it_matters": "Test", "visual_takeaway": "Test", "insights": [], "secondary_context": None, "evidence_refs": [], "limitations": []} for item in targets]}
        return {"schema_version": "report-synthesis.v1", "report_id": "temporary", "executive_overview": {"headline": "Test", "abstract": "Test", "key_finding_ids": [], "key_stat_callout_ids": [], "generation_mode": "model"}, "themes": [], "chapters": [], "findings": [], "stat_callouts": [], "uncertainties": [], "coverage": {"summary": "Test", "source_count": 1, "feature_count": 0, "finding_count": 0, "limitations": []}}
    monkeypatch.setattr(processor.client, "complete", complete)
    first = processor.process(request, start_step=1, end_step=1)
    assert first["status"] == "partial"
    version_root = output / "documents" / first["document_id"] / "versions" / first["study_version_id"]
    assert (version_root / "stages" / "preparation" / "snapshot.json").exists()
    assert (version_root / "stages" / "preparation" / "synthesis_projection.json").exists()
    middle = processor.process(request, start_step=2, end_step=4)
    assert middle["last_completed_stage"] == 4
    final = processor.process(request, start_step=5, end_step=5)
    assert final["status"] == "complete"
    assert (output / "documents" / first["document_id"] / "active.json").exists()
    assert (output / "study_manifest.json").exists()
    telemetry = json.loads((version_root / "stage_telemetry.json").read_text())
    assert set(telemetry["stages"]) == {"1", "2", "3", "4", "5"}
    assert telemetry["schema_version"] == "loop2-stage-telemetry.v2"
    stage_one = telemetry["stages"]["1"]["runs"][-1]
    assert stage_one["status"] == "completed"
    assert stage_one["run_id"].startswith("stage-run-")
    assert stage_one["cost_delta"]["cost_usd"] == 0
    assert stage_one["model_calls"] == []
    assert {item["path"] for item in stage_one["artifacts"]} >= {
        "stages/preparation/snapshot.json",
        "stages/preparation/input_integrity_audit.json",
        "stages/preparation/synthesis_projection.json",
        "stages/preparation/native_asset_registry.json",
        "stages/preparation/projection_audit.json",
    }
    assert all(len(item["sha256"]) == 64 for item in stage_one["artifacts"])
    events = [json.loads(line) for line in (version_root / "run_events.jsonl").read_text().splitlines()]
    assert [(event["event"], event["stage"]) for event in events] == [
        pair for step in range(1, 6) for pair in (("stage_started", step), ("stage_completed", step))
    ]
    assert final["artifacts_root"] == str(version_root / "stages")
    assert final["run_events"] == str(version_root / "run_events.jsonl")
    assert final["cost_ledger"] == str(output / "telemetry" / "cost_ledger.json")


def test_loop2_later_stage_requires_checkpoint(tmp_path: Path) -> None:
    corpus = tmp_path / "corpus"
    _completed_loop1_package(corpus)
    config = PipelineConfig(live=False)
    request = requests_from_manifest(corpus, corpus / "loop2", config)[0]
    with pytest.raises(RuntimeError, match="stage 1 artifact is missing"):
        DocumentLoop2Processor(request.output_dir, config).process(request, start_step=2, end_step=2)


def test_loop2_quarantines_declared_unresolved_evidence_references(tmp_path: Path) -> None:
    corpus = tmp_path / "corpus"
    _completed_loop1_package(corpus)
    package_path = next(corpus.glob("documents/*/versions/*/document_evidence_package.json"))
    package = json.loads(package_path.read_text())
    unresolved = "document:test:batch:unresolved:EV-1"
    package["entities"] = [{"entity_id": "entity:test", "name": "Test", "type": "place", "evidence_refs": [unresolved]}]
    package_path.write_text(json.dumps(package))
    request = requests_from_manifest(corpus, corpus / "loop2", PipelineConfig(live=False))[0]
    processor = DocumentLoop2Processor(request.output_dir, request.config)
    first = processor.process(request, start_step=1, end_step=1)
    version_root = Path(first["version_root"])
    audit = json.loads((version_root / "stages/preparation/input_integrity_audit.json").read_text())
    assert audit["valid"] is True
    assert audit["counts"]["unresolved_evidence_refs"] == 1
    projection = json.loads((version_root / "stages/preparation/synthesis_projection.json").read_text())
    entity = projection["projection"]["entities"][0]
    assert entity["evidence_refs"] == []
    assert entity["unresolved_evidence_refs"] == [unresolved]
    assert projection["audit"]["unresolved_references_quarantined"] == 1


def test_loop2_rejects_undeclared_dangling_evidence_reference(tmp_path: Path) -> None:
    corpus = tmp_path / "corpus"
    _completed_loop1_package(corpus)
    package_path = next(corpus.glob("documents/*/versions/*/document_evidence_package.json"))
    package = json.loads(package_path.read_text())
    package["entities"] = [{"entity_id": "entity:test", "name": "Test", "type": "place", "evidence_refs": ["missing:evidence"]}]
    package_path.write_text(json.dumps(package))
    request = requests_from_manifest(corpus, corpus / "loop2", PipelineConfig(live=False))[0]
    with pytest.raises(ValueError, match="1 invalid evidence references"):
        DocumentLoop2Processor(request.output_dir, request.config).process(request, start_step=1, end_step=1)


def test_loop2_semantic_transport_is_exact_and_stores_each_object_once() -> None:
    projection = {
        "schema_version": "study-evidence-projection.v2", "document_id": "document:test", "loop1_version_id": "version:test",
        "source": {"source_id": "source:test", "filename": "test.pdf"}, "summary": "Study",
        "evidence_items": [
            {"evidence_id": "evidence:one", "statement": "First"},
            {"evidence_id": "evidence:two", "statement": "Second"},
        ],
        "entities": [{"entity_id": "entity:shared", "name": "Shared", "evidence_refs": ["evidence:one", "evidence:two"]}],
        "spatial_features": [], "vertical_intervals": [], "relationships": [], "visual_interpretations": [],
        "limitations": [], "unresolved_items": [],
    }
    assets = [{"asset_class": "structured", "asset_id": "asset:one", "path": "table.json", "resolved_path": "/tmp/table.json"}]
    transport, handle_map, audit = DocumentLoop2Processor._semantic_transport(projection, assets)
    assert audit["round_trip_exact"] is True
    assert handle_map["canonical_to_handle"]["evidence:one"] == "E0001"
    prepared = {"projection": projection, "native_assets": assets, "semantic_transport": transport, "semantic_handle_map": handle_map}
    units = DocumentLoop2Processor._render_evidence_units(prepared)
    entity_units = [unit for unit in units if unit.get("collection") == "entities"]
    assert len(entity_units) == 1
    assert entity_units[0]["object"]["entity_id"] == "N0001"
    assert entity_units[0]["evidence_ids"] == ["E0001", "E0002"]
    assert "entity:shared" not in json.dumps(units)


def test_loop2_transport_units_follow_source_order_and_keep_objects_adjacent() -> None:
    projection = {
        "source": {"filename": "ordered.pdf"}, "summary": "", "limitations": [], "unresolved_items": [],
        "evidence_items": [
            {"evidence_id": "late", "evidence": [{"locator": {"page": 20}}]},
            {"evidence_id": "early", "evidence": [{"locator": {"page": 2}}]},
        ],
        "entities": [{"entity_id": "early-object", "evidence_refs": ["early"]}],
        "spatial_features": [], "vertical_intervals": [], "relationships": [], "visual_interpretations": [],
    }
    transport, _, _ = DocumentLoop2Processor._semantic_transport(projection, [])
    units = DocumentLoop2Processor._ordered_transport_units(transport)
    assert [unit["unit_id"] for unit in units[:3]] == ["E0002", "N0001", "E0001"]
    assert [unit["source_sequence"] for unit in units] == list(range(1, len(units) + 1))


def test_loop2_columnar_reconciliation_transport_is_exact() -> None:
    value = [{"id": "a", "optional": None, "items": [{"x": 1}, {"x": 2}]}, {"id": "b", "different": True}]
    compact = DocumentLoop2Processor._columnarize(value)
    assert DocumentLoop2Processor._decolumnarize(compact) == value
    assert len(json.dumps(compact)) < len(json.dumps(value)) + 100


def test_loop2_local_render_normalization_removes_context_only_output() -> None:
    units = [{"unit_id": "E1", "kind": "evidence", "evidence_ids": ["E1"], "evidence_item": {"evidence_id": "E1"}}, {"unit_id": "F1", "kind": "source_object", "evidence_ids": ["E1"]}]
    plan = {
        "evidence_dispositions": [
            {"evidence_id": "E0", "disposition": "rendered", "target_ids": ["context"]},
            {"evidence_id": "E1", "disposition": "rendered", "target_ids": ["owned"]},
        ],
        "features": [
            {"id": "context", "evidence_refs": ["E0"], "source_object_ids": ["F0"]},
            {"id": "owned", "evidence_refs": ["E1"], "source_object_ids": ["F1"]},
        ],
    }
    normalized, audit = DocumentLoop2Processor._normalize_local_render_plan(plan, units)
    assert [item["evidence_id"] for item in normalized["evidence_dispositions"]] == ["E1"]
    assert [item["id"] for item in normalized["features"]] == ["owned"]
    assert audit["context_dispositions_removed"] == 1


def test_loop2_reconciliation_assembly_cannot_delete_leaf_objects() -> None:
    local = [
        {"features": [{"id": "f1"}], "evidence_dispositions": [{"evidence_id": "e1", "disposition": "rendered", "target_ids": ["f1"]}]},
        {"features": [{"id": "f2"}], "evidence_dispositions": [{"evidence_id": "e2", "disposition": "rendered", "target_ids": ["f2"]}]},
    ]
    semantic = {"title": "Study", "short_title": "Study", "domain": "generic", "summary": "Summary", "primary_rendering_mode": "interactive_spatial", "features": [{"id": "f1"}]}
    assembled, audit = DocumentLoop2Processor._assemble_render_plans(local, semantic)
    assert [item["id"] for item in assembled["features"]] == ["f1", "f2"]
    assert len(assembled["evidence_dispositions"]) == 2
    assert audit["model_reconciliation_allowed_to_delete_leaf_objects"] is False


def test_loop2_integrity_repair_is_grounded_and_retains_unclassified_sources() -> None:
    plan = {
        "features": [{"id": "f1", "coordinate_evidence_refs": ["e1"], "evidence_refs": [], "source_asset_id": "page:1", "source_object_ids": ["sf1"]}],
        "layers": [], "observations": [], "intervals": [], "vertical_profiles": [], "structured_resources": [],
        "evidence_dispositions": [{"evidence_id": "e1", "disposition": "rendered", "target_ids": ["missing-observation"]}],
        "unsupported_objects": [], "limitations": [],
    }
    evidence = {"evidence_id": "e1", "statement": "Measured depth is 10 m", "subject": "BH-1", "unit": "m"}
    prepared = {"evidence_index": {"by_id": {"e1": evidence}}, "native_assets": [], "projection": {"spatial_features": [{"feature_id": "sf1", "evidence_refs": ["e1"]}, {"feature_id": "sf2", "evidence_refs": ["e1"]}], "vertical_intervals": [{"interval_id": "vi1", "evidence_refs": ["e1"]}]}}
    repaired, audit = DocumentLoop2Processor._repair_render_plan_integrity(plan, prepared)
    assert repaired["features"][0]["source_asset_id"] is None
    assert repaired["features"][0]["evidence_refs"] == ["e1"]
    assert repaired["observations"][0]["id"] == "missing-observation"
    assert repaired["observations"][0]["statement"] == evidence["statement"]
    assert {(item["source_kind"], item["source_id"]) for item in repaired["unsupported_objects"]} == {("spatial_feature", "sf2"), ("vertical_interval", "vi1")}
    assert audit["policy"]["evidence_deleted"] is False


def test_loop2_integrity_repair_unsupported_classification_overrides_renderable_links() -> None:
    plan = {
        "features": [{"id": "f1", "source_object_ids": ["sf-bad", "sf-good"], "coordinate_evidence_refs": [], "evidence_refs": [], "source_asset_id": None}],
        "layers": [{"id": "l1", "source_object_ids": ["sf-bad", "sf-good"]}],
        "observations": [],
        "intervals": [{"id": "i1", "source_object_ids": ["vi-bad", "vi-good"]}],
        "vertical_profiles": [],
        "structured_resources": [],
        "evidence_dispositions": [],
        "unsupported_objects": [
            {"source_kind": "spatial_feature", "source_id": "sf-bad", "reason": "invalid coordinates", "evidence_refs": []},
            {"source_kind": "vertical_interval", "source_id": "vi-bad", "reason": "invalid bounds", "evidence_refs": []},
        ],
        "limitations": [],
    }
    prepared = {
        "evidence_index": {"by_id": {}},
        "native_assets": [],
        "projection": {
            "spatial_features": [{"feature_id": "sf-bad"}, {"feature_id": "sf-good"}],
            "vertical_intervals": [{"interval_id": "vi-bad"}, {"interval_id": "vi-good"}],
        },
    }

    repaired, audit = DocumentLoop2Processor._repair_render_plan_integrity(plan, prepared)

    assert repaired["features"][0]["source_object_ids"] == ["sf-good"]
    assert repaired["layers"][0]["source_object_ids"] == ["sf-good"]
    assert repaired["intervals"][0]["source_object_ids"] == ["vi-good"]
    override_repairs = [item for item in audit["repairs"] if item["kind"] == "unsupported_classification_overrode_renderable_link"]
    assert {(item["collection"], tuple(item["source_object_ids"])) for item in override_repairs} == {
        ("features", ("sf-bad",)),
        ("layers", ("sf-bad",)),
        ("intervals", ("vi-bad",)),
    }


def test_loop2_coverage_counts_only_registered_spatial_and_interval_source_ids(tmp_path: Path) -> None:
    request = DocumentStudyRunRequest(study_id="study:test", corpus_root=tmp_path, output_dir=tmp_path / "out", document_id="document:test", loop1_version_id="version:test", package_path=tmp_path / "package.json", expected_source_sha256="abc")
    evidence = {"evidence_id": "e1", "statement": "Grounded"}
    prepared = {"projection": {"source": {"filename": "study.pdf"}, "limitations": [], "spatial_features": [{"feature_id": "sf1"}], "vertical_intervals": [{"interval_id": "vi1"}]}, "evidence_index": {"evidence_ids": ["e1"], "by_id": {"e1": evidence}}, "native_assets": []}
    plan = {"title": "Study", "short_title": "Study", "domain": "generic", "summary": "", "primary_rendering_mode": "interactive_spatial", "layers": [], "features": [{"id": "f1", "name": "F", "type": "point", "geometry_json": None, "latitude": None, "longitude": None, "location_description": None, "source_asset_id": None, "properties": [], "fidelity": "reported", "evidence_refs": ["e1"], "coordinate_evidence_refs": [], "source_object_ids": ["sf1", "entity:not-spatial"]}], "observations": [], "intervals": [{"id": "i1", "name": "I", "type": "interval", "profile_id": None, "feature_id": None, "axis": "depth", "reference": "ground", "start": 0, "end": 1, "thickness": 1, "unit": "m", "material": None, "qualifier": None, "fidelity": "reported", "evidence_refs": ["e1"], "source_object_ids": ["vi1", "entity:not-interval"]}], "vertical_profiles": [], "structured_resources": [], "evidence_dispositions": [{"evidence_id": "e1", "disposition": "rendered", "target_ids": ["f1"], "reason": "grounded"}], "unsupported_objects": [], "limitations": []}
    rendering = DocumentLoop2Processor._materialize_render_plan(request, prepared, plan)
    assert rendering["coverage"]["renderable_features"] == 1
    assert rendering["coverage"]["rendered_intervals"] == 1
    assert rendering["coverage"]["loop1_spatial_features"] == 1
    assert rendering["coverage"]["loop1_vertical_intervals"] == 1


def test_loop2_manifest_requests_remain_document_isolated(tmp_path: Path) -> None:
    corpus = tmp_path / "corpus"
    _completed_loop1_package(corpus)
    config = PipelineConfig(live=False)
    requests = requests_from_manifest(corpus, corpus / "loop2", config)
    assert len(requests) == 1
    assert requests[0].document_id == "document:test"
    result = DocumentLoop2Processor(requests[0].output_dir, config).process(requests[0], start_step=1, end_step=1)
    projection = json.loads((Path(result["stage_telemetry"]).parent / "stages/preparation/synthesis_projection.json").read_text())
    assert projection["projection"]["document_id"] == "document:test"
    assert projection["audit"]["counts"]["evidence_items"] == 0


def test_loop2_rendering_skeleton_supports_native_layer_without_feature_pollution(tmp_path: Path) -> None:
    config = PipelineConfig(live=False)
    request = DocumentStudyRunRequest(study_id="study:test", corpus_root=tmp_path, output_dir=tmp_path / "out", document_id="document:test", loop1_version_id="version:test", package_path=tmp_path / "package.json", expected_source_sha256="abc", config=config)
    prepared = {
        "projection": {"source": {"filename": "network.kml", "source_id": "source:test"}, "summary": "network", "evidence_items": [], "spatial_features": [{"feature_id": "network", "name": "Network", "type": "network", "source_asset_id": "asset:network", "evidence_refs": [], "latitude": None, "longitude": None, "geometry_json": None}], "vertical_intervals": [], "limitations": []},
        "evidence_index": {"by_id": {}, "evidence_ids": []},
        "native_assets": [
            {"asset_class": "spatial", "asset_id": "asset:network", "kind": "vector_features", "path": "features.geojson", "resolved_path": "/tmp/features.geojson", "feature_count": 97827, "geometry_type_counts": {"LineString": 80078}},
            {"asset_class": "visual", "asset_id": "page:1", "kind": "page_render", "path": "page.png"},
        ],
    }
    rendering, _ = DocumentLoop2Processor._deterministic_rendering(request, prepared)
    assert rendering["primary_rendering_mode"] == "native_layer"
    assert len(rendering["layers"]) == 1
    assert rendering["layers"][0]["feature_count"] == 97827
    assert rendering["features"] == []
    assert rendering["structured_resources"] == []
    assert {x["kind"] for x in rendering["narrative_targets"]} == {"study", "layer"}
    assert rendering["coverage"]["dropped_spatial_features"] == 0


def test_loop2_rendering_skeleton_preserves_line_geometry_and_quarantines_invalid() -> None:
    request = DocumentStudyRunRequest(study_id="study:test", corpus_root=Path("."), output_dir=Path("out"), document_id="document:test", loop1_version_id="version:test", package_path=Path("package.json"), expected_source_sha256="abc")
    prepared = {"projection": {"source": {"filename": "study.json", "source_id": "source:test"}, "summary": "", "evidence_items": [], "vertical_intervals": [], "limitations": [], "spatial_features": [
        {"feature_id": "line", "name": "Line", "type": "alignment", "geometry_json": {"type": "LineString", "coordinates": [[77.0, 12.0], [78.0, 13.0]]}, "evidence_refs": ["ev1"]},
        {"feature_id": "bad", "name": "Bad", "type": "point", "latitude": 999, "longitude": 77, "evidence_refs": []},
    ]}, "evidence_index": {"by_id": {}, "evidence_ids": []}, "native_assets": []}
    rendering, _ = DocumentLoop2Processor._deterministic_rendering(request, prepared)
    assert rendering["features"][0]["geometry"]["type"] == "LineString"
    assert rendering["coverage"]["renderable_features"] == 1
    assert rendering["coverage"]["quarantined_spatial_concepts"] == 1
    assert rendering["coverage"]["loop1_spatial_features"] == 2


def test_loop2_rendering_skeleton_accepts_report_only_study() -> None:
    request = DocumentStudyRunRequest(study_id="study:report", corpus_root=Path("."), output_dir=Path("out"), document_id="document:report", loop1_version_id="version:report", package_path=Path("package.json"), expected_source_sha256="abc")
    prepared = {"projection": {"source": {"filename": "policy.txt", "source_id": "source:report"}, "summary": "A descriptive study", "evidence_items": [{"evidence_id": "ev1", "kind": "methodology", "statement": "Method", "value": None}], "spatial_features": [], "vertical_intervals": [], "limitations": []}, "evidence_index": {"by_id": {"ev1": {}}, "evidence_ids": ["ev1"]}, "native_assets": []}
    rendering, _ = DocumentLoop2Processor._deterministic_rendering(request, prepared)
    assert rendering["primary_rendering_mode"] == "report_only"
    assert rendering["capabilities"]["report"] is True
    assert rendering["capabilities"]["map"] is False
    assert rendering["narrative_targets"][0]["kind"] == "study"
    assert rendering["coverage"]["evidence_retained_for_report"] == 1
    assert rendering["coverage"]["discarded_evidence_items"] == 0


def test_loop2_llm_geometry_requires_exact_source_provenance(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = PipelineConfig(live=True)
    request = DocumentStudyRunRequest(study_id="study:test", corpus_root=tmp_path, output_dir=tmp_path / "out", document_id="document:test", loop1_version_id="version:test", package_path=tmp_path / "package.json", expected_source_sha256="abc", config=config)
    evidence = {"evidence_id": "ev1", "kind": "observation", "statement": "P1 is located at 12.0, 77.0", "value": None}
    prepared = {"study_context": {"source_filename": "study.json"}, "projection": {"source": {"filename": "study.json", "source_id": "source:test"}, "summary": "", "evidence_items": [evidence], "entities": [], "relationships": [], "visual_interpretations": [], "vertical_intervals": [], "limitations": [], "unresolved_items": [], "spatial_features": [{"feature_id": "p1", "name": "P1", "type": "point", "latitude": 12.0, "longitude": 77.0, "evidence_refs": ["ev1"]}]}, "evidence_index": {"by_id": {"ev1": evidence}, "evidence_ids": ["ev1"]}, "native_assets": []}
    processor = DocumentLoop2Processor(request.output_dir, config)
    monkeypatch.setattr(processor.client, "count_tokens", lambda *args, **kwargs: 100)
    monkeypatch.setattr(processor.client, "complete", lambda **kwargs: {"title": "Study", "short_title": "Study", "domain": "generic", "summary": "Summary", "primary_rendering_mode": "interactive_spatial", "layers": [{"id": "layer:p1", "name": "Points", "description": "Reported points", "kind": "generated_features", "representation": "point_map", "semantic_category": "monitoring_points", "source_asset_ids": [], "feature_ids": ["p1"], "profile_ids": [], "resource_ids": [], "source_object_ids": ["p1"], "evidence_refs": ["ev1"], "default_visible": True}], "features": [{"id": "p1", "name": "P1", "type": "point", "geometry_json": "{\"type\":\"Point\",\"coordinates\":[77.0,12.0]}", "latitude": 12.0, "longitude": 77.0, "location_description": None, "source_asset_id": None, "properties": [], "fidelity": "reported", "evidence_refs": ["ev1"], "coordinate_evidence_refs": ["ev1"], "source_object_ids": ["p1"]}], "observations": [], "intervals": [], "vertical_profiles": [], "structured_resources": [], "evidence_dispositions": [{"evidence_id": "ev1", "disposition": "rendered", "target_ids": ["p1"], "reason": "Direct point evidence"}], "unsupported_objects": [], "limitations": []})
    result = processor._render(request, prepared, tmp_path / "rendering" / "ui_rendering_package.json", False)
    assert result["features"][0]["geometry"] == {"type": "Point", "coordinates": [77.0, 12.0]}
    assert result["study"]["title"] == "Study"
    assert (tmp_path / "rendering" / "coverage_audit.json").exists()


def test_loop2_llm_can_extract_coordinates_directly_from_cited_evidence(tmp_path: Path) -> None:
    request = DocumentStudyRunRequest(study_id="study:test", corpus_root=tmp_path, output_dir=tmp_path / "out", document_id="document:test", loop1_version_id="version:test", package_path=tmp_path / "package.json", expected_source_sha256="abc")
    evidence = {"evidence_id": "ev1", "kind": "observation", "statement": "Monitoring location: latitude 12.25, longitude 77.75", "value": None}
    prepared = {"projection": {"source": {"filename": "study.txt"}, "summary": "", "evidence_items": [evidence], "spatial_features": [], "vertical_intervals": [], "limitations": []}, "evidence_index": {"by_id": {"ev1": evidence}, "evidence_ids": ["ev1"]}, "native_assets": []}
    plan = {"title": "Study", "short_title": "Study", "domain": "generic", "summary": "Study", "primary_rendering_mode": "interactive_spatial", "layers": [], "features": [{"id": "p1", "name": "P1", "type": "monitoring_point", "geometry_json": None, "latitude": 12.25, "longitude": 77.75, "location_description": None, "source_asset_id": None, "properties": [], "fidelity": "reported", "evidence_refs": ["ev1"], "coordinate_evidence_refs": ["ev1"], "source_object_ids": []}], "observations": [], "intervals": [], "vertical_profiles": [], "structured_resources": [], "evidence_dispositions": [{"evidence_id": "ev1", "disposition": "rendered", "target_ids": ["p1"], "reason": "Explicit coordinates"}], "unsupported_objects": [], "limitations": []}
    rendering = DocumentLoop2Processor._materialize_render_plan(request, prepared, plan)
    assert rendering["features"][0]["geometry"] == {"type": "Point", "coordinates": [77.75, 12.25]}


def test_loop2_llm_plan_fails_when_any_evidence_is_omitted(tmp_path: Path) -> None:
    request = DocumentStudyRunRequest(study_id="study:test", corpus_root=tmp_path, output_dir=tmp_path / "out", document_id="document:test", loop1_version_id="version:test", package_path=tmp_path / "package.json", expected_source_sha256="abc")
    evidence = {"evidence_id": "ev1", "kind": "finding", "statement": "Finding", "value": None}
    prepared = {"projection": {"source": {"filename": "study.txt"}, "summary": "", "evidence_items": [evidence], "spatial_features": [], "vertical_intervals": [], "limitations": []}, "evidence_index": {"by_id": {"ev1": evidence}, "evidence_ids": ["ev1"]}, "native_assets": []}
    plan = {"title": "Study", "short_title": "Study", "domain": "generic", "summary": "Study", "primary_rendering_mode": "report_only", "layers": [], "features": [], "observations": [], "intervals": [], "vertical_profiles": [], "structured_resources": [], "evidence_dispositions": [], "unsupported_objects": [], "limitations": []}
    with pytest.raises(ValueError, match="missing 1 evidence IDs"):
        DocumentLoop2Processor._materialize_render_plan(request, prepared, plan)


def test_loop2_rendering_recursively_splits_oversized_evidence_batches(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = PipelineConfig(live=True, target_batch_tokens=1000, max_batch_tokens=1000)
    request = DocumentStudyRunRequest(study_id="study:test", corpus_root=tmp_path, output_dir=tmp_path / "out", document_id="document:test", loop1_version_id="version:test", package_path=tmp_path / "package.json", expected_source_sha256="abc", config=config)
    processor = DocumentLoop2Processor(request.output_dir, config)
    prepared = {"study_context": {"source_filename": "study.txt"}}
    units = [{"unit_id": f"ev{i}", "kind": "evidence", "evidence_ids": [f"ev{i}"], "evidence_item": {"evidence_id": f"ev{i}"}} for i in range(2)]
    monkeypatch.setattr(processor.client, "count_tokens", lambda instructions, content, schema: 2000 if len(json.loads(content)["evidence_units"]) > 1 else 500)
    def complete(**kwargs):
        ids = json.loads(kwargs["input_content"])["scope"]["evidence_ids"]
        return {"title": "Study", "short_title": "Study", "domain": "generic", "summary": "Study", "primary_rendering_mode": "report_only", "layers": [], "features": [], "observations": [], "intervals": [], "vertical_profiles": [], "structured_resources": [], "evidence_dispositions": [{"evidence_id": value, "disposition": "report_only", "target_ids": [], "reason": "Report evidence"} for value in ids], "unsupported_objects": [], "limitations": []}
    monkeypatch.setattr(processor.client, "complete", complete)
    fragments = processor._render_fragment(request, prepared, tmp_path / "rendering", "batch-0001", units, False)
    assert len(fragments) == 2
    assert len(list((tmp_path / "rendering/fragments/leaf").glob("*.json"))) == 2


def test_loop2_render_reconciliation_prefers_exact_count_and_logs_progress(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = PipelineConfig(live=True, target_batch_tokens=1000, max_batch_tokens=1000, max_workers=2)
    request = DocumentStudyRunRequest(study_id="study:test", corpus_root=tmp_path, output_dir=tmp_path / "out", document_id="document:test", loop1_version_id="version:test", package_path=tmp_path / "package.json", expected_source_sha256="abc", config=config)
    processor = DocumentLoop2Processor(request.output_dir, config)
    prepared = {"study_context": {"source_filename": "study.txt"}}
    plans = [{"plan": index, "padding": "x" * 2000} for index in range(2)]
    monkeypatch.setattr(processor.client, "count_tokens", lambda *args, **kwargs: 900)
    phases = []
    def complete(**kwargs):
        phases.append(kwargs["phase"])
        children = DocumentLoop2Processor._decolumnarize(json.loads(kwargs["input_content"])["child_plans"])
        return {"merged_plan_count": len(children)}
    monkeypatch.setattr(processor.client, "complete", complete)
    result = processor._reconcile_render_plans(request, prepared, tmp_path / "rendering", plans, False)
    assert result == {"merged_plan_count": 2}
    assert len(phases) == 1
    events = [json.loads(line)["event"] for line in (tmp_path / "rendering/progress.jsonl").read_text().splitlines()]
    assert "reconciliation_group_started" in events
    assert "reconciliation_group_completed" in events


def test_loop2_render_reconciliation_attempts_256k_then_uses_128k_groups(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = PipelineConfig(live=True, target_batch_tokens=128_000, max_batch_tokens=128_000, max_workers=4)
    request = DocumentStudyRunRequest(study_id="study:test", corpus_root=tmp_path, output_dir=tmp_path / "out", document_id="document:test", loop1_version_id="version:test", package_path=tmp_path / "package.json", expected_source_sha256="abc", config=config)
    processor = DocumentLoop2Processor(request.output_dir, config)
    prepared = {"study_context": {"source_filename": "study.txt"}}
    plans = [{"plan": index} for index in range(7)]
    def count_tokens(_instructions, content, _schema):
        children = DocumentLoop2Processor._decolumnarize(json.loads(content)["child_plans"])
        return 300_000 if len(children) > 2 else 100_000
    monkeypatch.setattr(processor.client, "count_tokens", count_tokens)
    calls = []
    def complete(**kwargs):
        calls.append(kwargs["counted_input_tokens"])
        children = DocumentLoop2Processor._decolumnarize(json.loads(kwargs["input_content"])["child_plans"])
        return {"merged": len(children)}
    monkeypatch.setattr(processor.client, "complete", complete)
    result = processor._reconcile_render_plans(request, prepared, tmp_path / "rendering", plans, False)
    assert result == {"merged": 2}
    assert calls and all(count <= 256_000 for count in calls)
    event = next(json.loads(line) for line in (tmp_path / "rendering/progress.jsonl").read_text().splitlines() if json.loads(line)["event"] == "reconciliation_level_started")
    assert event["decision"] == "split_to_128k_groups"
    assert event["exact_global_input_tokens"] == 300_000
    assert event["reconciliation_ceiling_tokens"] == 256_000
    assert event["group_target_tokens"] == 140_800


def test_loop2_narratives_batch_targets_and_adaptively_split(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = PipelineConfig(live=True, target_batch_tokens=10_000, max_batch_tokens=10_000, max_workers=3)
    request = DocumentStudyRunRequest(study_id="study:test", corpus_root=tmp_path, output_dir=tmp_path / "out", document_id="document:test", loop1_version_id="version:test", package_path=tmp_path / "package.json", expected_source_sha256="abc", config=config)
    processor = DocumentLoop2Processor(request.output_dir, config)
    evidence = [{"evidence_id": f"ev{i}", "statement": f"Finding {i}"} for i in range(3)]
    prepared = {"study_context": {"source_filename": "study.txt"}, "projection": {"evidence_items": evidence}, "evidence_index": {"by_id": {x["evidence_id"]: x for x in evidence}, "evidence_ids": [x["evidence_id"] for x in evidence]}}
    features = [{"id": f"feature:{i}", "name": f"Feature {i}", "type": "point", "geometry": {"type": "Point", "coordinates": [77.0, 12.0]}} for i in range(3)]
    rendering = {"study": {"id": "study:test"}, "features": features, "layers": [], "vertical_profiles": [], "observations": [], "intervals": [], "narrative_targets": [{"id": f"target:{i}", "kind": "feature", "object_id": f"feature:{i}", "source_refs": [f"ev{i}"]} for i in range(3)]}
    monkeypatch.setattr(processor.client, "count_tokens", lambda instructions, content, schema: 20_000 if len(json.loads(content)["targets"]) > 1 else 500)
    phases = []
    def complete(**kwargs):
        phases.append(kwargs["phase"])
        targets = json.loads(kwargs["input_content"])["targets"]
        return {"narratives": [{"target_id": item["target_id"], "headline": "H", "summary": "S", "why_it_matters": "W", "visual_takeaway": "V", "insights": [], "secondary_context": None, "evidence_refs": [], "limitations": []} for item in targets]}
    monkeypatch.setattr(processor.client, "complete", complete)
    result = processor._narrate(rendering, prepared, tmp_path / "narratives/ui_narrative_package.json", False)
    assert len(result["target_insights"]) == 3
    assert len(phases) == 3
    assert all(item["status"] == "complete" for item in result["target_insights"])


def test_loop2_narratives_return_empty_without_geometry_and_make_no_model_call(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = PipelineConfig(live=True)
    processor = DocumentLoop2Processor(tmp_path / "out", config)
    evidence = {"evidence_id": "e1", "statement": "Report-only finding"}
    prepared = {"study_context": {"source_filename": "report.pdf"}, "projection": {"evidence_items": [evidence]}, "evidence_index": {"by_id": {"e1": evidence}, "evidence_ids": ["e1"]}}
    rendering = {"study": {"id": "study:test"}, "features": [{"id": "f1", "name": "Concept", "type": "concept", "geometry": None}], "layers": [], "vertical_profiles": [], "observations": [], "intervals": [], "narrative_targets": [{"id": "t1", "kind": "feature", "object_id": "f1", "source_refs": ["e1"]}, {"id": "study-target", "kind": "study", "object_id": "study:test", "source_refs": []}]}
    monkeypatch.setattr(processor.client, "complete", lambda **kwargs: (_ for _ in ()).throw(AssertionError("model must not be called")))
    result = processor._narrate(rendering, prepared, tmp_path / "narratives/ui_narrative_package.json", False)
    assert result["target_insights"] == []
    assert result["coverage"]["empty_reason"] == "no_individually_renderable_features"
    assert json.loads((tmp_path / "narratives/eligibility_audit.json").read_text())["model_call_required"] is False


def test_loop2_report_recursively_splits_exact_token_overflow(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = PipelineConfig(live=True, target_batch_tokens=128_000, max_batch_tokens=128_000, max_workers=2)
    request = DocumentStudyRunRequest(study_id="study:test", corpus_root=tmp_path, output_dir=tmp_path / "out", document_id="document:test", loop1_version_id="version:test", package_path=tmp_path / "package.json", expected_source_sha256="abc", config=config)
    processor = DocumentLoop2Processor(request.output_dir, config)
    evidence = [{"evidence_id": f"ev{i}", "kind": "finding", "statement": f"Finding {i}"} for i in range(2)]
    prepared = {"study_context": {"source_filename": "study.txt"}, "projection": {"summary": "", "evidence_items": evidence, "entities": [], "relationships": [], "visual_interpretations": [], "vertical_intervals": [], "limitations": [], "unresolved_items": []}, "evidence_index": {"evidence_ids": [x["evidence_id"] for x in evidence], "by_id": {x["evidence_id"]: x for x in evidence}}}
    rendering = {"study": {"id": "study:test"}, "primary_rendering_mode": "report_only", "capabilities": {"report": True}, "layers": [], "vertical_profiles": [], "features": [], "coverage": {}}
    def count_tokens(instructions, content, schema):
        payload = json.loads(content)
        count = len(payload.get("evidence_units", []))
        return 200_000 if count > 1 else 500
    monkeypatch.setattr(processor.client, "count_tokens", count_tokens)
    monkeypatch.setattr(processor.client, "complete", lambda **kwargs: {"schema_version": "report-synthesis.v1", "report_id": "temporary", "executive_overview": {"headline": "h", "abstract": "a", "key_finding_ids": [], "key_stat_callout_ids": [], "generation_mode": "model"}, "themes": [], "chapters": [], "findings": [], "stat_callouts": [], "uncertainties": [], "coverage": {"summary": "s", "source_count": 1, "feature_count": 0, "finding_count": 0, "limitations": []}})
    processor._report(request, rendering, prepared, tmp_path / "report/study_report.json", False)
    # Two evidence units plus the lossless document-context unit are split.
    assert len(list((tmp_path / "report/fragments/leaf").glob("*.json"))) == 3


def test_loop2_report_synthesis_batches_large_document_and_reconciles(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = PipelineConfig(live=True, target_batch_tokens=20_000, max_batch_tokens=128_000)
    request = DocumentStudyRunRequest(study_id="study:test", corpus_root=tmp_path, output_dir=tmp_path / "out", document_id="document:test", loop1_version_id="version:test", package_path=tmp_path / "package.json", expected_source_sha256="abc", config=config)
    processor = DocumentLoop2Processor(request.output_dir, config)
    evidence = [{"evidence_id": f"ev{i}", "kind": "observation", "statement": "x" * 4000} for i in range(70)]
    prepared = {"study_context": {"source_filename": "large.pdf"}, "projection": {"summary": "large", "evidence_items": evidence, "entities": [], "relationships": [], "visual_interpretations": [], "vertical_intervals": [], "limitations": [], "unresolved_items": []}, "evidence_index": {"evidence_ids": [x["evidence_id"] for x in evidence], "by_id": {x["evidence_id"]: x for x in evidence}}}
    rendering = {"study": {"id": "study:test"}, "primary_rendering_mode": "report_only", "capabilities": {"report": True}, "layers": [], "vertical_profiles": [], "features": [], "coverage": {}}
    phases = []
    def complete(**kwargs):
        phases.append(kwargs["phase"])
        return {"schema_version": "report-synthesis.v1", "report_id": "temporary", "executive_overview": {"headline": "h", "abstract": "a", "key_finding_ids": [], "key_stat_callout_ids": [], "generation_mode": "model"}, "themes": [], "chapters": [], "findings": [], "stat_callouts": [], "uncertainties": [], "coverage": {"summary": "s", "source_count": 1, "feature_count": 0, "finding_count": 0, "limitations": []}}
    monkeypatch.setattr(processor.client, "count_tokens", lambda *args, **kwargs: 1_000)
    monkeypatch.setattr(processor.client, "complete", complete)
    report = processor._report(request, rendering, prepared, tmp_path / "report" / "study_report.json", False)
    assert sum("report-local" in phase for phase in phases) > 1
    assert phases[-1].startswith("loop2-report-reconcile")
    assert report["report_id"] == "study:test"
    assert json.loads((tmp_path / "report" / "batches.json").read_text())["batches"]


def test_document_loop1_is_versioned_reusable_and_isolated(tmp_path: Path) -> None:
    corpus = tmp_path / "corpus"
    first = tmp_path / "first.geojson"
    second = tmp_path / "second.geojson"
    first.write_text(json.dumps({"type": "FeatureCollection", "features": []}), encoding="utf-8")
    second.write_text(json.dumps({"type": "FeatureCollection", "features": []}), encoding="utf-8")
    config = PipelineConfig(live=False)
    processor = DocumentLoop1Processor(corpus, config)
    first_result = processor.process(DocumentRunRequest(corpus_id="test", objective="test", source=first, output_dir=corpus, config=config))
    second_result = processor.process(DocumentRunRequest(corpus_id="test", objective="test", source=second, output_dir=corpus, config=config))
    reused = processor.process(DocumentRunRequest(corpus_id="test", objective="test", source=first, output_dir=corpus, config=config))
    assert first_result["status"] == second_result["status"] == "complete"
    assert first_result["document_id"] != second_result["document_id"]
    assert reused["reused"] is True
    manifest = json.loads((corpus / "corpus_manifest.json").read_text(encoding="utf-8"))
    assert manifest["counts"]["active_documents"] == 2


def test_document_loop1_stage_ranges_persist_artifacts_and_telemetry(tmp_path: Path) -> None:
    source = tmp_path / "records.csv"
    source.write_text("id,depth\nBH-1,30\n", encoding="utf-8")
    corpus = tmp_path / "corpus"
    config = PipelineConfig(live=False, max_workers=4)
    request = DocumentRunRequest(corpus_id="test", objective="test", source=source, output_dir=corpus, config=config)
    processor = DocumentLoop1Processor(corpus, config)
    materialized = processor.process(request, start_step=1, end_step=2)
    assert materialized["status"] == "partial"
    version_root = corpus / "documents" / materialized["document_id"] / "versions" / materialized["version_id"]
    assert (version_root / "bundle.json").exists()
    extracted = processor.process(request, start_step=3, end_step=3)
    assert extracted["last_completed_stage"] == 3
    telemetry = json.loads((version_root / "stage_telemetry.json").read_text(encoding="utf-8"))
    assert set(telemetry["stages"]) == {"1", "2", "3"}
    assert telemetry["stages"]["3"]["runs"][-1]["duration_seconds"] >= 0


def test_stage3_reuses_prior_materialization_when_batching_config_changes(tmp_path: Path) -> None:
    source = tmp_path / "records.csv"
    source.write_text("id,depth\nBH-1,30\n", encoding="utf-8")
    corpus = tmp_path / "corpus"
    old_config = PipelineConfig(live=False, target_batch_tokens=100_000, max_batch_tokens=110_000)
    old_request = DocumentRunRequest(corpus_id="test", objective="test", source=source, output_dir=corpus, config=old_config)
    old_result = DocumentLoop1Processor(corpus, old_config).process(old_request, start_step=1, end_step=2)
    new_config = PipelineConfig(live=False, target_batch_tokens=120_000, max_batch_tokens=128_000)
    new_request = DocumentRunRequest(corpus_id="test", objective="test", source=source, output_dir=corpus, config=new_config)
    new_result = DocumentLoop1Processor(corpus, new_config).process(new_request, start_step=3, end_step=3)
    assert new_result["version_id"] != old_result["version_id"]
    new_root = corpus / "documents" / new_result["document_id"] / "versions" / new_result["version_id"]
    assert (new_root / "bundle.json").exists()
    assert (new_root / "reused_materialization.json").exists()
    assert next((new_root / "sources").rglob("records.csv")).read_text(encoding="utf-8").startswith("id,depth")


def test_stage_range_requires_prior_artifacts(tmp_path: Path) -> None:
    source = tmp_path / "records.csv"
    source.write_text("id,depth\nBH-1,30\n", encoding="utf-8")
    corpus = tmp_path / "corpus"
    config = PipelineConfig(live=False)
    request = DocumentRunRequest(corpus_id="test", objective="test", source=source, output_dir=corpus, config=config)
    with pytest.raises(RuntimeError, match="stage 2 artifact is missing"):
        DocumentLoop1Processor(corpus, config).process(request, start_step=3, end_step=3)

