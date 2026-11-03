from __future__ import annotations

import json
import math
import os
import time
import traceback
from concurrent.futures import FIRST_COMPLETED, ProcessPoolExecutor, ThreadPoolExecutor, wait
from pathlib import Path
from typing import Any, Literal

import psutil
from pydantic import BaseModel, Field

from .models import PipelineConfig, SourceBundle
from .util import read_json, write_json


class MaterializationWorkUnit(BaseModel):
    work_unit_id: str
    ordinal: int
    kind: str
    start: int | None = None
    end: int | None = None
    estimated_bytes: int = 0
    estimated_memory_mb: int = 64
    payload: dict[str, Any] = Field(default_factory=dict)


class MaterializationPlan(BaseModel):
    schema_version: str = "materialization-plan.v1"
    source_id: str
    adapter: str
    work_unit_kind: str
    total_native_units: int
    estimated_work: int
    preferred_backend: Literal["process", "thread", "sequential"]
    selected_backend: Literal["process", "thread", "sequential"] = "sequential"
    selected_workers: int = 1
    chunk_size: int = 1
    work_units: list[MaterializationWorkUnit] = Field(default_factory=list)


class MaterializationWorkResult(BaseModel):
    schema_version: str = "materialization-work-result.v1"
    work_unit_id: str
    ordinal: int
    status: Literal["completed"] = "completed"
    duration_seconds: float
    output: dict[str, Any]
    counts: dict[str, int] = Field(default_factory=dict)
    bytes_read: int = 0
    bytes_written: int = 0


def execute_materialization_unit(adapter: Any, source: str, root: str, source_id: str, unit_data: dict[str, Any]) -> dict[str, Any]:
    unit = MaterializationWorkUnit.model_validate(unit_data)
    started = time.perf_counter()
    output = adapter.process_work_unit(Path(source), Path(root), source_id, unit)
    result = MaterializationWorkResult(
        work_unit_id=unit.work_unit_id,
        ordinal=unit.ordinal,
        duration_seconds=time.perf_counter() - started,
        output=output,
        counts={key: len(value) for key, value in output.items() if isinstance(value, list)},
        bytes_read=unit.estimated_bytes,
        bytes_written=sum(int(item.get("size_bytes", 0)) for item in output.get("written_files", []) if isinstance(item, dict)),
    )
    return result.model_dump(mode="json")


class MaterializationScheduler:
    """Resource-aware, resumable executor for a single document's native work units."""

    def __init__(self, config: PipelineConfig):
        self.config = config

    def run(self, adapter: Any, source: Path, root: Path, source_id: str, resume: bool = True) -> SourceBundle:
        stage_root = root / "stages" / "materialization"
        stage_root.mkdir(parents=True, exist_ok=True)
        discovery_started = time.perf_counter()
        plan = adapter.discover(source, root, source_id, self.config)
        plan = self._select_execution(plan)
        discovery_duration = time.perf_counter() - discovery_started
        write_json(stage_root / "plan.json", plan.model_dump(mode="json", exclude={"work_units"}))
        write_json(stage_root / "work_units.json", [unit.model_dump(mode="json") for unit in plan.work_units])

        execution_started = time.perf_counter()
        reused_before_execution = sum((stage_root / "results" / f"{unit.work_unit_id}.json").exists() for unit in plan.work_units) if resume else 0
        results = self._execute(adapter, source, root, source_id, plan, stage_root, resume)
        execution_duration = time.perf_counter() - execution_started
        merge_started = time.perf_counter()
        ordered = sorted(results, key=lambda result: result.ordinal)
        bundle = adapter.merge_work_results(source, root, source_id, plan, ordered)
        merge_duration = time.perf_counter() - merge_started
        write_json(stage_root / "merge_report.json", {
            "source_id": source_id,
            "work_units_expected": len(plan.work_units),
            "work_units_merged": len(ordered),
            "ordinals": [result.ordinal for result in ordered],
            "bundle_counts": {"artifacts": len(bundle.artifacts), "units": len(bundle.units), "structured_assets": len(bundle.structured_assets), "visual_assets": len(bundle.visual_assets), "spatial_assets": len(bundle.spatial_assets)},
        })
        write_json(stage_root / "summary.json", {
            "status": "completed",
            "adapter": plan.adapter,
            "backend": plan.selected_backend,
            "workers": plan.selected_workers,
            "chunk_size": plan.chunk_size,
            "total_native_units": plan.total_native_units,
            "work_units": len(plan.work_units),
            "reused_work_units": reused_before_execution,
            "bytes_read_estimate": sum(result.bytes_read for result in ordered),
            "bytes_written_by_workers": sum(result.bytes_written for result in ordered),
            "durations": {"discovery_seconds": discovery_duration, "execution_seconds": execution_duration, "merge_seconds": merge_duration, "total_seconds": discovery_duration + execution_duration + merge_duration},
        })
        return bundle

    def _select_execution(self, plan: MaterializationPlan) -> MaterializationPlan:
        if not plan.work_units:
            plan.selected_backend = "sequential"
            plan.selected_workers = 1
            return plan
        logical_cpu_limit = max(1, os.cpu_count() or 1)
        available_mb = int(psutil.virtual_memory().available / (1024 * 1024))
        memory_budget = self.config.materialization_memory_limit_mb or max(128, int(available_mb * 0.7))
        per_worker_mb = max(1, max(unit.estimated_memory_mb for unit in plan.work_units))
        memory_limit = max(1, memory_budget // per_worker_mb)
        backend = plan.preferred_backend if self.config.materialization_backend == "auto" else self.config.materialization_backend
        if self.config.materialization_mode == "manual" and self.config.materialization_workers is None:
            raise ValueError("manual materialization mode requires --materialization-workers")
        if self.config.materialization_mode == "manual":
            configured = self.config.materialization_workers or 1
            cpu_limit = configured
        else:
            physical = psutil.cpu_count(logical=False) or logical_cpu_limit
            cpu_limit = physical if backend == "process" else logical_cpu_limit
            configured = self.config.materialization_workers or cpu_limit
        workers = min(configured, cpu_limit, memory_limit, len(plan.work_units))
        if backend == "sequential" or workers <= 1:
            backend, workers = "sequential", 1
        plan.selected_backend = backend
        plan.selected_workers = workers
        return plan

    def _resource_sample(self, active: int, queued: int, previous_disk: tuple[float, Any] | None) -> tuple[dict[str, Any], tuple[float, Any]]:
        now = time.monotonic()
        memory = psutil.virtual_memory()
        disk = psutil.disk_io_counters()
        busy_pct = None
        if previous_disk and disk and getattr(disk, "busy_time", None) is not None:
            elapsed = max(0.001, now - previous_disk[0])
            busy_delta = max(0, disk.busy_time - previous_disk[1].busy_time)
            busy_pct = min(100.0, busy_delta / (elapsed * 10.0))
        sample = {"timestamp": time.time(), "cpu_percent": psutil.cpu_percent(interval=None), "memory_percent": memory.percent, "memory_available_mb": int(memory.available / (1024 * 1024)), "disk_busy_percent": busy_pct, "active_workers": active, "queued_units": queued}
        return sample, (now, disk)

    def _under_pressure(self, sample: dict[str, Any]) -> bool:
        limit = self.config.materialization_pressure_limit_pct
        return sample["cpu_percent"] >= limit or sample["memory_percent"] >= limit or (sample["disk_busy_percent"] is not None and sample["disk_busy_percent"] >= limit)

    def _execute(self, adapter: Any, source: Path, root: Path, source_id: str, plan: MaterializationPlan, stage_root: Path, resume: bool) -> list[MaterializationWorkResult]:
        results_root = stage_root / "results"
        failures_root = stage_root / "failures"
        results_root.mkdir(parents=True, exist_ok=True)
        failures_root.mkdir(parents=True, exist_ok=True)
        completed: dict[str, MaterializationWorkResult] = {}
        pending: list[MaterializationWorkUnit] = []
        for unit in plan.work_units:
            target = results_root / f"{unit.work_unit_id}.json"
            if resume and target.exists():
                try:
                    completed[unit.work_unit_id] = MaterializationWorkResult.model_validate(read_json(target))
                    continue
                except Exception:
                    pass
            pending.append(unit)
        if not pending:
            return [completed[unit.work_unit_id] for unit in plan.work_units]

        samples_path = stage_root / "resource_samples.jsonl"
        previous_disk = None
        if plan.selected_backend == "sequential":
            for unit in pending:
                sample, previous_disk = self._resource_sample(1, len(pending), previous_disk)
                self._append_jsonl(samples_path, sample)
                result = self._execute_one(adapter, source, root, source_id, unit, failures_root)
                write_json(results_root / f"{unit.work_unit_id}.json", result.model_dump(mode="json"))
                completed[unit.work_unit_id] = result
        else:
            executor_type = ProcessPoolExecutor if plan.selected_backend == "process" else ThreadPoolExecutor
            with executor_type(max_workers=plan.selected_workers) as executor:
                inflight: dict[Any, MaterializationWorkUnit] = {}
                cursor = 0
                while cursor < len(pending) or inflight:
                    sample, previous_disk = self._resource_sample(len(inflight), len(pending) - cursor, previous_disk)
                    self._append_jsonl(samples_path, sample)
                    pressure = self._under_pressure(sample)
                    while (not pressure or not inflight) and cursor < len(pending) and len(inflight) < plan.selected_workers:
                        unit = pending[cursor]
                        cursor += 1
                        future = executor.submit(execute_materialization_unit, adapter, str(source), str(root), source_id, unit.model_dump(mode="json"))
                        inflight[future] = unit
                    if not inflight:
                        time.sleep(0.1)
                        continue
                    done, _ = wait(inflight, return_when=FIRST_COMPLETED)
                    for future in done:
                        unit = inflight.pop(future)
                        try:
                            result = MaterializationWorkResult.model_validate(future.result())
                        except BaseException as exc:
                            self._write_failure(failures_root, unit, exc)
                            for other in inflight:
                                other.cancel()
                            raise
                        write_json(results_root / f"{unit.work_unit_id}.json", result.model_dump(mode="json"))
                        completed[unit.work_unit_id] = result
        return [completed[unit.work_unit_id] for unit in plan.work_units]

    def _execute_one(self, adapter: Any, source: Path, root: Path, source_id: str, unit: MaterializationWorkUnit, failures_root: Path) -> MaterializationWorkResult:
        try:
            return MaterializationWorkResult.model_validate(execute_materialization_unit(adapter, str(source), str(root), source_id, unit.model_dump(mode="json")))
        except BaseException as exc:
            self._write_failure(failures_root, unit, exc)
            raise

    @staticmethod
    def _write_failure(root: Path, unit: MaterializationWorkUnit, exc: BaseException) -> None:
        write_json(root / f"{unit.work_unit_id}.json", {"work_unit": unit.model_dump(mode="json"), "error_type": type(exc).__name__, "error": str(exc), "traceback": traceback.format_exc()})

    @staticmethod
    def _append_jsonl(path: Path, value: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(value, ensure_ascii=False, default=str) + "\n")


def adaptive_chunk_size(total_units: int, worker_limit: int, explicit: int | None) -> int:
    if explicit:
        return explicit
    if total_units <= 0:
        return 1
    # Keep several independently schedulable tasks per worker for work stealing.
    return max(1, math.ceil(total_units / max(1, worker_limit * 4)))
