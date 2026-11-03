from __future__ import annotations

import json
from pathlib import Path

import pytest
import pymupdf

from agentic_subsurface.adapters import AdapterRegistry
from agentic_subsurface.batching import SemanticBatcher
from agentic_subsurface.models import MODEL, PipelineConfig, RunRequest
from agentic_subsurface.models import DocumentRunRequest
from agentic_subsurface.loop1 import DocumentLoop1Processor
from agentic_subsurface.pipeline import AgenticSubsurfacePipeline
from agentic_subsurface.provider import BudgetExceeded, MuseClient


def test_model_and_budget_are_hard_limited() -> None:
    with pytest.raises(ValueError): PipelineConfig(model="muse-spark-1.3")
    with pytest.raises(ValueError): PipelineConfig(max_cost_usd=20.01)
    with pytest.raises(ValueError): PipelineConfig(max_workers=33)


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


def test_stage_range_requires_prior_artifacts(tmp_path: Path) -> None:
    source = tmp_path / "records.csv"
    source.write_text("id,depth\nBH-1,30\n", encoding="utf-8")
    corpus = tmp_path / "corpus"
    config = PipelineConfig(live=False)
    request = DocumentRunRequest(corpus_id="test", objective="test", source=source, output_dir=corpus, config=config)
    with pytest.raises(RuntimeError, match="stage 2 artifact is missing"):
        DocumentLoop1Processor(corpus, config).process(request, start_step=3, end_step=3)

