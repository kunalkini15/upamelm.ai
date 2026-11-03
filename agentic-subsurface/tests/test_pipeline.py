from __future__ import annotations

import json
from pathlib import Path

import pytest
import pymupdf

from agentic_subsurface.adapters import AdapterRegistry
from agentic_subsurface.batching import SemanticBatcher
from agentic_subsurface.models import MODEL, PipelineConfig, RunRequest
from agentic_subsurface.pipeline import AgenticSubsurfacePipeline
from agentic_subsurface.provider import BudgetExceeded, MuseClient


def test_model_and_budget_are_hard_limited() -> None:
    with pytest.raises(ValueError): PipelineConfig(model="muse-spark-1.3")
    with pytest.raises(ValueError): PipelineConfig(max_cost_usd=20.01)


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


def test_budget_guard_uses_contributor_pricing(tmp_path: Path) -> None:
    client = MuseClient(tmp_path, PipelineConfig(max_cost_usd=0.01))
    assert client._estimated_cost(1_000_000, 1_000_000) == pytest.approx(0.30)
    with pytest.raises(BudgetExceeded): client._guard(1_000_000, 1_000_000)


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

