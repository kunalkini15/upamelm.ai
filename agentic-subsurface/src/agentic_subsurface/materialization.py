from __future__ import annotations

import json
import math
import os
import sys
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
    written_paths: set[Path] = set()

    def collect_paths(value: Any, key: str | None = None) -> None:
        if isinstance(value, dict):
            for child_key, child in value.items():
                collect_paths(child, child_key)
        elif isinstance(value, list):
            for child in value:
                collect_paths(child, key)
        elif isinstance(value, str) and key in {"path", "text_path", "source_path"}:
            candidate = Path(root) / value
            if candidate.is_file():
                written_paths.add(candidate)

    collect_paths(output)
    result = MaterializationWorkResult(
        work_unit_id=unit.work_unit_id,
        ordinal=unit.ordinal,
        duration_seconds=time.perf_counter() - started,
        output=output,
        counts={key: len(value) for key, value in output.items() if isinstance(value, list)},
        bytes_read=unit.estimated_bytes,
        bytes_written=sum(path.stat().st_size for path in written_paths),
    )
    return result.model_dump(mode="json")


class MaterializationScheduler:
    """Resource-aware, resumable executor for a single document's native work units."""

    def __init__(self, config: PipelineConfig):
        self.config = config

    def run(self, adapter: Any, source: Path, root: Path, source_id: str, resume: bool = True) -> SourceBundle:
        stage_root = root / "stages" / "materialization"
        stage_root.mkdir(parents=True, exist_ok=True)
        self._log(f"[stage 2] Discovering native units in {source.name}...")
        discovery_started = time.perf_counter()
        plan = adapter.discover(source, root, source_id, self.config)
        plan = self._select_execution(plan)
        discovery_duration = time.perf_counter() - discovery_started
        write_json(stage_root / "plan.json", plan.model_dump(mode="json", exclude={"work_units"}))
        write_json(stage_root / "work_units.json", [unit.model_dump(mode="json") for unit in plan.work_units])
        self._log(
            f"[stage 2] Found {plan.total_native_units} {plan.work_unit_kind}; "
            f"backend={plan.selected_backend} workers={plan.selected_workers} "
            f"chunk_size={plan.chunk_size} work_units={len(plan.work_units)}"
        )

        execution_started = time.perf_counter()
        reused_before_execution = sum((stage_root / "results" / f"{unit.work_unit_id}.json").exists() for unit in plan.work_units) if resume else 0
        results = self._execute(adapter, source, root, source_id, plan, stage_root, resume)
        execution_duration = time.perf_counter() - execution_started
        merge_started = time.perf_counter()
        ordered = sorted(results, key=lambda result: result.ordinal)
        self._log(f"[stage 2] Merging {len(ordered)} work-unit results...")
        bundle = adapter.merge_work_results(source, root, source_id, plan, ordered)
        merge_duration = time.perf_counter() - merge_started
        write_json(stage_root / "merge_report.json", {
            "source_id": source_id,
            "work_units_expected": len(plan.work_units),
            "work_units_merged": len(ordered),
            "ordinals": [result.ordinal for result in ordered],
            "bundle_counts": {"artifacts": len(bundle.artifacts), "units": len(bundle.units), "structured_assets": len(bundle.structured_assets), "visual_assets": len(bundle.visual_assets), "spatial_assets": len(bundle.spatial_assets)},
        })
        total_duration = discovery_duration + execution_duration + merge_duration
        bytes_written = sum(result.bytes_written for result in ordered)
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
            "bytes_written_by_workers": bytes_written,
            "durations": {"discovery_seconds": discovery_duration, "execution_seconds": execution_duration, "merge_seconds": merge_duration, "total_seconds": total_duration},
        })
        self._log(
            f"[stage 2] Completed in {total_duration:.1f}s | artifacts={len(bundle.artifacts)} "
            f"visuals={len(bundle.visual_assets)} tables={len(bundle.structured_assets)} "
            f"written={bytes_written / (1024 * 1024):.1f} MiB"
        )
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
            cpu_limit = adaptive_worker_capacity(backend)
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
        # High CPU is expected for process-backed extraction and is not alone a
        # reason to starve the pool. Memory and sustained I/O pressure are the
        # signals that can make concurrent materialization unsafe.
        return sample["memory_percent"] >= limit or (sample["disk_busy_percent"] is not None and sample["disk_busy_percent"] >= limit)

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
        total_units = len(plan.work_units)
        native_done = sum(max(1, (unit.end or 0) - (unit.start or 0)) for unit in plan.work_units if unit.work_unit_id in completed)
        execution_started = time.perf_counter()
        last_log = 0.0
        last_percent = -1

        def report(force: bool = False) -> None:
            nonlocal last_log, last_percent
            now = time.perf_counter()
            done = len(completed)
            percent = int(done * 100 / max(1, total_units))
            if not force and now - last_log < 2.0 and percent < last_percent + 10:
                return
            elapsed = now - execution_started
            eta = (elapsed / done * (total_units - done)) if done else None
            eta_text = f"{eta:.0f}s" if eta is not None else "calculating"
            self._log(
                f"[stage 2] {done}/{total_units} work units ({percent}%) | "
                f"native units {native_done}/{plan.total_native_units} | "
                f"elapsed {elapsed:.1f}s | ETA {eta_text}"
            )
            last_log, last_percent = now, percent

        if completed:
            self._log(f"[stage 2] Reusing {len(completed)}/{total_units} completed work units")
            report(force=True)
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
                native_done += max(1, (unit.end or 0) - (unit.start or 0))
                report()
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
                        native_done += max(1, (unit.end or 0) - (unit.start or 0))
                        report()
        report(force=True)
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

    @staticmethod
    def _log(message: str) -> None:
        print(message, file=sys.stderr, flush=True)


def adaptive_worker_capacity(backend: str) -> int:
    """Return a host-derived capacity without encoding document-size constants."""
    logical = max(1, os.cpu_count() or 1)
    if backend != "process":
        return logical
    physical = max(1, psutil.cpu_count(logical=False) or logical)
    # Native PDF/image libraries also use memory bandwidth and filesystem I/O.
    # Reserve roughly one third of physical cores to prevent oversubscription;
    # manual mode remains available for dedicated batch hosts.
    return max(1, math.ceil(physical * 2 / 3))


def adaptive_chunk_size(total_units: int, worker_limit: int, explicit: int | None) -> int:
    if explicit:
        return explicit
    if total_units <= 0:
        return 1
    # Keep enough independently schedulable tasks to balance heterogeneous
    # pages/records. Native units often vary far more than their byte size.
    return max(1, math.ceil(total_units / max(1, worker_limit * 8)))
