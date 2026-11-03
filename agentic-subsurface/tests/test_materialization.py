from __future__ import annotations

import json
from pathlib import Path

import pymupdf
import pytest
from openpyxl import Workbook
from PIL import Image

from agentic_subsurface.adapters import AdapterRegistry, SourceAdapter
from agentic_subsurface.materialization import MaterializationPlan, MaterializationScheduler, MaterializationWorkResult, MaterializationWorkUnit, adaptive_chunk_size
from agentic_subsurface.models import PipelineConfig, SourceBundle


class FailingAdapter(SourceAdapter):
    def materialize(self, path: Path, root: Path, source_id: str) -> SourceBundle:
        raise NotImplementedError

    def discover(self, path: Path, root: Path, source_id: str, config: PipelineConfig) -> MaterializationPlan:
        units = [MaterializationWorkUnit(work_unit_id="ok", ordinal=1, kind="test"), MaterializationWorkUnit(work_unit_id="bad", ordinal=2, kind="test")]
        return MaterializationPlan(source_id=source_id, adapter="failing", work_unit_kind="test", total_native_units=2, estimated_work=2, preferred_backend="sequential", work_units=units)

    def process_work_unit(self, path: Path, root: Path, source_id: str, unit: MaterializationWorkUnit) -> dict:
        if unit.work_unit_id == "bad":
            raise ValueError("intentional work-unit failure")
        return {"value": unit.ordinal}

    def merge_work_results(self, path: Path, root: Path, source_id: str, plan: MaterializationPlan, results: list[MaterializationWorkResult]) -> SourceBundle:
        raise AssertionError("merge must not run after a failed unit")


def _config(workers: int, chunk: int, backend: str = "auto") -> PipelineConfig:
    return PipelineConfig(live=False, materialization_mode="manual", materialization_workers=workers, materialization_chunk_size=chunk, materialization_backend=backend)


def _bundle(path: Path, root: Path, workers: int, chunk: int, backend: str = "auto") -> dict:
    return AdapterRegistry(render_dpi=72).materialize(path, root, _config(workers, chunk, backend), resume=False).model_dump(mode="json")


def test_adaptive_partition_covers_arbitrary_document_sizes() -> None:
    for total in (5, 230, 800, 10_003):
        chunk = adaptive_chunk_size(total, worker_limit=12, explicit=None)
        ranges = [(start, min(total, start + chunk)) for start in range(0, total, chunk)]
        assert ranges[0][0] == 0
        assert ranges[-1][1] == total
        assert sum(end - start for start, end in ranges) == total
        assert all(left[1] == right[0] for left, right in zip(ranges, ranges[1:]))


def test_pdf_parallel_and_sequential_bundles_are_identical(tmp_path: Path) -> None:
    source = tmp_path / "four-pages.pdf"
    document = pymupdf.open()
    for index in range(4):
        page = document.new_page()
        page.insert_text((60, 70), f"Page {index + 1} borehole BH-{index + 1}")
        page.draw_rect((50, 90, 250, 160))
    document.save(source)
    document.close()
    sequential = _bundle(source, tmp_path / "sequential", 1, 1, "sequential")
    parallel = _bundle(source, tmp_path / "parallel", 2, 2, "process")
    assert sequential == parallel
    plan = json.loads(next((tmp_path / "parallel").glob("stages/materialization/plan.json")).read_text())
    assert plan["selected_workers"] == 2
    assert plan["selected_backend"] == "process"
    summary = json.loads((tmp_path / "parallel" / "stages" / "materialization" / "summary.json").read_text())
    assert summary["bytes_written_by_workers"] > 0


def test_materialization_emits_progress_without_polluting_result_files(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    source = tmp_path / "progress.pdf"
    document = pymupdf.open()
    document.new_page().insert_text((60, 70), "Progress")
    document.save(source)
    document.close()
    _bundle(source, tmp_path / "run", 1, 1, "sequential")
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "[stage 2] Found 1 pdf_page_range" in captured.err
    assert "[stage 2] Completed in" in captured.err


def test_csv_parallel_and_sequential_bundles_are_identical(tmp_path: Path) -> None:
    source = tmp_path / "rows.csv"
    source.write_text("id,note\n" + "\n".join(f'{i},"row {i}"' for i in range(20)) + "\n", encoding="utf-8")
    assert _bundle(source, tmp_path / "one", 1, 3, "sequential") == _bundle(source, tmp_path / "many", 4, 4, "thread")


def test_geojson_parallel_and_sequential_bundles_are_identical(tmp_path: Path) -> None:
    source = tmp_path / "points.geojson"
    features = [{"type": "Feature", "id": f"p{i}", "properties": {"name": f"P{i}"}, "geometry": {"type": "Point", "coordinates": [77 + i / 100, 12 + i / 100]}} for i in range(12)]
    source.write_text(json.dumps({"type": "FeatureCollection", "features": features}), encoding="utf-8")
    assert _bundle(source, tmp_path / "one", 1, 2, "sequential") == _bundle(source, tmp_path / "many", 3, 5, "process")


def test_kml_parallel_and_sequential_bundles_are_identical(tmp_path: Path) -> None:
    source = tmp_path / "points.kml"
    placemarks = "".join(f"<Placemark id='p{i}'><name>P{i}</name><Point><coordinates>{77+i/100},{12+i/100}</coordinates></Point></Placemark>" for i in range(10))
    source.write_text(f'<kml xmlns="http://www.opengis.net/kml/2.2"><Document>{placemarks}</Document></kml>', encoding="utf-8")
    assert _bundle(source, tmp_path / "one", 1, 2, "sequential") == _bundle(source, tmp_path / "many", 3, 4, "process")


def test_excel_parallel_and_sequential_bundles_are_identical(tmp_path: Path) -> None:
    source = tmp_path / "sheets.xlsx"
    workbook = Workbook()
    workbook.active.title = "Boreholes"
    workbook.active.append(["id", "depth"])
    workbook.active.append(["BH-1", 30])
    second = workbook.create_sheet("Soils")
    second.append(["sample", "material"])
    second.append(["S-1", "clay"])
    workbook.save(source)
    assert _bundle(source, tmp_path / "one", 1, 1, "sequential") == _bundle(source, tmp_path / "many", 2, 1, "process")


def test_text_parallel_and_sequential_bundles_are_identical(tmp_path: Path) -> None:
    source = tmp_path / "report.md"
    source.write_text("# Report\n" + "\n".join(f"Section {i}" for i in range(30)), encoding="utf-8")
    assert _bundle(source, tmp_path / "one", 1, 3, "sequential") == _bundle(source, tmp_path / "many", 4, 7, "thread")


def test_multiframe_image_parallel_and_sequential_bundles_are_identical(tmp_path: Path) -> None:
    source = tmp_path / "frames.tiff"
    frames = [Image.new("RGB", (20, 20), color=(index * 20, 0, 0)) for index in range(3)]
    frames[0].save(source, save_all=True, append_images=frames[1:])
    assert _bundle(source, tmp_path / "one", 1, 1, "sequential") == _bundle(source, tmp_path / "many", 3, 1, "process")


def test_resume_reuses_completed_work_units(tmp_path: Path) -> None:
    source = tmp_path / "resume.pdf"
    document = pymupdf.open()
    for index in range(6):
        page = document.new_page()
        page.insert_text((50, 50), f"Page {index + 1}")
    document.save(source)
    document.close()
    root = tmp_path / "run"
    registry = AdapterRegistry(render_dpi=72)
    config = _config(2, 2, "process")
    registry.materialize(source, root, config, resume=True)
    results = sorted((root / "stages" / "materialization" / "results").glob("*.json"))
    unchanged = results[0]
    unchanged_mtime = unchanged.stat().st_mtime_ns
    results[-1].unlink()
    registry.materialize(source, root, config, resume=True)
    assert unchanged.stat().st_mtime_ns == unchanged_mtime
    summary = json.loads((root / "stages" / "materialization" / "summary.json").read_text())
    assert summary["reused_work_units"] == len(results) - 1


def test_failed_work_unit_writes_isolated_failure_artifact(tmp_path: Path) -> None:
    source = tmp_path / "source.test"
    source.write_text("test", encoding="utf-8")
    with pytest.raises(ValueError, match="intentional work-unit failure"):
        MaterializationScheduler(_config(1, 1, "sequential")).run(FailingAdapter(), source, tmp_path / "run", "source:test", resume=True)
    failure = json.loads((tmp_path / "run" / "stages" / "materialization" / "failures" / "bad.json").read_text())
    assert failure["error_type"] == "ValueError"
    assert (tmp_path / "run" / "stages" / "materialization" / "results" / "ok.json").exists()


def test_pressure_does_not_deadlock_scheduler(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    source = tmp_path / "source.test"
    source.write_text("test", encoding="utf-8")
    adapter = FailingAdapter()
    # Remove the intentionally failing unit; this test only exercises submission.
    monkeypatch.setattr(adapter, "discover", lambda path, root, source_id, config: MaterializationPlan(source_id=source_id, adapter="pressure", work_unit_kind="test", total_native_units=1, estimated_work=1, preferred_backend="thread", work_units=[MaterializationWorkUnit(work_unit_id="ok", ordinal=1, kind="test")]))
    monkeypatch.setattr(adapter, "merge_work_results", lambda path, root, source_id, plan, results: SourceBundle(source_id=source_id, original_path="source.test", filename="source.test", media_type="text/plain", sha256="x", size_bytes=4, adapter="pressure"))
    scheduler = MaterializationScheduler(_config(2, 1, "thread"))
    monkeypatch.setattr(scheduler, "_resource_sample", lambda active, queued, previous: ({"cpu_percent": 99.0, "memory_percent": 99.0, "disk_busy_percent": 99.0, "active_workers": active, "queued_units": queued}, None))
    result = scheduler.run(adapter, source, tmp_path / "run", "source:test", resume=True)
    assert result.adapter == "pressure"
