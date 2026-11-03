from __future__ import annotations

import base64
import json
import os
import shutil
import sys
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterable

from .adapters import AdapterRegistry
from .batching import EvidenceBatch, SemanticBatcher
from .models import DocumentRunRequest, ExtractionResult, SourceBundle
from .prompts import (
    EXTRACTION_INSTRUCTIONS,
    EXTRACTION_PROMPT_VERSION,
    VISUAL_CLASSIFICATION_INSTRUCTIONS,
    VISUAL_CLASSIFICATION_PROMPT_VERSION,
    VISUAL_EXTRACTION_INSTRUCTIONS,
    VISUAL_EXTRACTION_PROMPT_VERSION,
)
from .provider import IncompleteResponse, MuseClient
from .schemas import extraction_schema, visual_classification_schema
from .util import read_json, sha256_file, stable_id, write_json


LOOP1_CODE_VERSION = "document-loop1.v4"
DOCUMENT_PACKAGE_SCHEMA = "document-evidence.v2"
MEANINGFUL_CLASSES = {"table", "map", "borehole_log", "geological_section", "chart", "engineering_drawing", "photograph", "other"}
STAGES = {
    1: "identify_and_version",
    2: "materialize_native_content",
    3: "extract_text_and_structured_evidence",
    4: "classify_visuals",
    5: "extract_visual_evidence",
    6: "consolidate_and_validate_provenance",
    7: "validate_coverage",
    8: "activate_document_version",
}


def _chunks(values: list[Any], size: int) -> Iterable[list[Any]]:
    for start in range(0, len(values), size):
        yield values[start:start + size]


def _data_url(path: Path) -> str:
    mime = "image/png" if path.suffix.lower() == ".png" else "image/webp" if path.suffix.lower() == ".webp" else "image/jpeg"
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode('ascii')}"


class DocumentLoop1Processor:
    """Append-only, document-isolated Loop 1 with an aggregate corpus budget."""

    def __init__(self, corpus_root: Path, config: Any):
        self.root = corpus_root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.config = config
        self.registry = AdapterRegistry(config.render_dpi)
        self.client = MuseClient(self.root, config, shared_ledger_path=self.root / "telemetry" / "cost_ledger.json")
        self._progress_lock = threading.Lock()

    def process(self, request: DocumentRunRequest, resume: bool = True, start_step: int = 1, end_step: int = 8) -> dict[str, Any]:
        if not 1 <= start_step <= end_step <= 8:
            raise ValueError("stage range must satisfy 1 <= start_step <= end_step <= 8")
        source = request.source.resolve()
        if not source.exists():
            raise FileNotFoundError(source)
        checksum = sha256_file(source)
        document_id = stable_id("document", source.name)
        processing_fingerprint = request.config.model_dump(exclude={"max_cost_usd", "live", "max_workers", "materialization_mode", "materialization_workers", "materialization_chunk_size", "materialization_memory_limit_mb", "materialization_backend", "materialization_pressure_limit_pct"})
        version_id = stable_id("version", checksum, LOOP1_CODE_VERSION, EXTRACTION_PROMPT_VERSION, VISUAL_CLASSIFICATION_PROMPT_VERSION, VISUAL_EXTRACTION_PROMPT_VERSION, json.dumps(processing_fingerprint, sort_keys=True))
        version_root = self.root / "documents" / document_id / "versions" / version_id
        package_target = version_root / "document_evidence_package.json"
        if resume and package_target.exists() and start_step == 1 and end_step == 8:
            package = read_json(package_target)
            if package.get("status") == "complete":
                if request.activate:
                    self._activate(document_id, version_id, package)
                return self._result(package, reused=True)

        descriptor = request.model_dump(mode="json") | {"document_id": document_id, "version_id": version_id, "source_sha256": checksum, "stage_range": {"start": start_step, "end": end_step}, "stage_catalog": STAGES}
        if self._selected(1, start_step, end_step):
            self._run_stage(version_root, 1, lambda: write_json(version_root / "request.json", descriptor), lambda _: {"document_id": document_id, "version_id": version_id})
        if end_step == 1:
            return self._partial_result(document_id, version_id, source.name, start_step, end_step, version_root)
        bundle_target = version_root / "bundle.json"
        def materialize() -> SourceBundle:
            if resume and bundle_target.exists():
                return SourceBundle.model_validate(read_json(bundle_target))
            value = self.registry.materialize(source, version_root, request.config, resume=resume)
            write_json(bundle_target, value.model_dump(mode="json"))
            return value
        if self._selected(2, start_step, end_step):
            bundle = self._run_stage(version_root, 2, materialize, lambda value: {"adapter": value.adapter, "units": len(value.units), "artifacts": len(value.artifacts), "visuals": len(value.visual_assets), "structured_assets": len(value.structured_assets)})
        else:
            bundle = self._require_or_reuse_bundle(bundle_target, version_root, document_id, checksum, 2)
        if end_step == 2:
            return self._partial_result(document_id, version_id, bundle.filename, start_step, end_step, version_root)
        corpus_context = self._corpus_context(exclude_document_id=document_id, include_ids=request.context_document_ids)

        batches = SemanticBatcher(request.config.target_batch_tokens, request.config.max_batch_tokens, 0).build([bundle])
        write_json(version_root / "stages" / "text" / "manifest.json", [self._batch_manifest(batch) for batch in batches])
        if self._selected(3, start_step, end_step):
            text_results = self._run_stage(version_root, 3, lambda: self._extract_text(request, version_root, bundle, batches, corpus_context, resume), lambda value: {"batches": len(value), "evidence_items": sum(len(x.evidence_items) for x in value)})
        else:
            text_results = self._load_extraction_results(version_root / "stages" / "text" / "results", 3)
        if end_step == 3:
            return self._partial_result(document_id, version_id, bundle.filename, start_step, end_step, version_root)

        if self._selected(4, start_step, end_step):
            classifications = self._run_stage(version_root, 4, lambda: self._classify_visuals(request, version_root, bundle, corpus_context, resume), lambda value: {"visuals": len(value), "meaningful": sum(bool(x.get("meaningful")) for x in value), "unresolved": sum(x.get("status") != "classified" for x in value)})
        else:
            classifications = self._require_json(version_root / "stages" / "visual_classification" / "registry.json", 4)
        if end_step == 4:
            return self._partial_result(document_id, version_id, bundle.filename, start_step, end_step, version_root)

        if self._selected(5, start_step, end_step):
            visual_results = self._run_stage(version_root, 5, lambda: self._extract_visuals(request, version_root, bundle, corpus_context, classifications, resume), lambda value: {"batches": len(value), "interpretations": sum(len(x.visual_interpretations) for x in value), "evidence_items": sum(len(x.evidence_items) for x in value)})
        else:
            visual_results = self._load_extraction_results(version_root / "stages" / "visual_extraction", 5)
        if end_step == 5:
            return self._partial_result(document_id, version_id, bundle.filename, start_step, end_step, version_root)

        results = text_results + visual_results
        candidate_target = version_root / "document_evidence_package.candidate.json"
        if self._selected(6, start_step, end_step):
            package = self._run_stage(version_root, 6, lambda: self._consolidate(request, version_root, document_id, version_id, bundle, batches, results, classifications), lambda value: {"evidence_items": len(value["evidence_items"]), "entities": len(value["entities"]), "provenance_errors": value["coverage"]["validation_errors"]})
        else:
            package = self._require_json(candidate_target, 6)
        if end_step == 6:
            return self._partial_result(document_id, version_id, bundle.filename, start_step, end_step, version_root)

        if self._selected(7, start_step, end_step):
            package = self._run_stage(version_root, 7, lambda: self._validate_coverage(version_root, package), lambda value: {"status": value["status"], **value["coverage"]})
        else:
            package = self._require_json(package_target, 7)
        if end_step == 7:
            return self._result(package, reused=False) | {"executed_stage_range": [start_step, end_step]}

        if self._selected(8, start_step, end_step):
            def activate() -> dict[str, Any]:
                if request.activate:
                    self._activate(document_id, version_id, package)
                self._refresh_corpus_manifest()
                return {"activated": bool(request.activate), "status": package["status"]}
            self._run_stage(version_root, 8, activate, lambda value: value)
        return self._result(package, reused=False)

    @staticmethod
    def _selected(step: int, start_step: int, end_step: int) -> bool:
        return start_step <= step <= end_step

    def _run_stage(self, root: Path, step: int, function: Any, summarize: Any) -> Any:
        started_at = datetime.now(UTC).isoformat()
        started = time.perf_counter()
        try:
            value = function()
        except BaseException as exc:
            self._record_stage(root, step, started_at, time.perf_counter() - started, "failed", {"error_type": type(exc).__name__, "error": str(exc)})
            raise
        self._record_stage(root, step, started_at, time.perf_counter() - started, "completed", summarize(value))
        return value

    def _record_stage(self, root: Path, step: int, started_at: str, duration: float, status: str, details: dict[str, Any]) -> None:
        target = root / "stage_telemetry.json"
        telemetry = read_json(target) if target.exists() else {"schema_version": "loop1-stage-telemetry.v1", "stages": {}}
        record = {"started_at": started_at, "finished_at": datetime.now(UTC).isoformat(), "duration_seconds": round(duration, 6), "status": status, "details": details}
        telemetry["stages"].setdefault(str(step), {"name": STAGES[step], "runs": []})["runs"].append(record)
        write_json(target, telemetry)

    @staticmethod
    def _require_bundle(target: Path, prerequisite_step: int) -> SourceBundle:
        if not target.exists():
            raise RuntimeError(f"stage {prerequisite_step} artifact is missing: {target}; run with --start-step {prerequisite_step}")
        return SourceBundle.model_validate(read_json(target))

    def _require_or_reuse_bundle(self, target: Path, version_root: Path, document_id: str, checksum: str, prerequisite_step: int) -> SourceBundle:
        if target.exists():
            return SourceBundle.model_validate(read_json(target))
        versions_root = self.root / "documents" / document_id / "versions"
        candidates = sorted(
            (path for path in versions_root.glob("*/bundle.json") if path != target),
            key=lambda path: path.stat().st_mtime,
            reverse=True,
        )
        for candidate in candidates:
            value = SourceBundle.model_validate(read_json(candidate))
            if value.sha256 != checksum:
                continue
            previous_root = candidate.parent
            source_tree = previous_root / "sources"
            destination = version_root / "sources"
            if source_tree.exists() and not destination.exists():
                def link_or_copy(source: str, target_path: str) -> str:
                    try:
                        os.link(source, target_path)
                        return target_path
                    except OSError:
                        return shutil.copy2(source, target_path)
                shutil.copytree(source_tree, destination, copy_function=link_or_copy)
            write_json(target, value.model_dump(mode="json"))
            write_json(version_root / "reused_materialization.json", {
                "source_version_root": str(previous_root),
                "source_bundle": str(candidate),
                "source_sha256": checksum,
                "method": "hardlink_or_copy",
            })
            return value
        raise RuntimeError(f"stage {prerequisite_step} artifact is missing: {target}; run with --start-step {prerequisite_step}")

    @staticmethod
    def _require_json(target: Path, prerequisite_step: int) -> Any:
        if not target.exists():
            raise RuntimeError(f"stage {prerequisite_step} artifact is missing: {target}; run with --start-step {prerequisite_step}")
        return read_json(target)

    @staticmethod
    def _load_extraction_results(directory: Path, prerequisite_step: int) -> list[ExtractionResult]:
        paths = sorted(directory.glob("*.json")) if directory.exists() else []
        if not paths:
            raise RuntimeError(f"stage {prerequisite_step} artifacts are missing under {directory}; run with --start-step {prerequisite_step}")
        return [ExtractionResult.model_validate(read_json(path)) for path in paths if path.name != "manifest.json"]

    def _partial_result(self, document_id: str, version_id: str, filename: str, start_step: int, end_step: int, root: Path) -> dict[str, Any]:
        result = {"document_id": document_id, "version_id": version_id, "filename": filename, "status": "partial", "executed_stage_range": [start_step, end_step], "last_completed_stage": end_step, "stage_name": STAGES[end_step], "stage_telemetry": str(root / "stage_telemetry.json"), "cost": self.client.ledger.get("totals", {})}
        write_json(root / "partial_status.json", result)
        return result

    def _result(self, package: dict[str, Any], reused: bool) -> dict[str, Any]:
        return {
            "document_id": package["document_id"], "version_id": package["version_id"], "filename": package["source"]["filename"],
            "status": package["status"], "coverage": package["coverage"], "reused": reused,
            "cost": self.client.ledger.get("totals", {}),
        }

    def _corpus_context(self, exclude_document_id: str, include_ids: list[str] | None) -> list[dict[str, Any]]:
        context = []
        docs_root = self.root / "documents"
        if not docs_root.exists():
            return context
        for active in sorted(docs_root.glob("*/active.json")):
            pointer = read_json(active)
            if pointer["document_id"] == exclude_document_id or (include_ids is not None and pointer["document_id"] not in include_ids):
                continue
            package_path = self.root / pointer["package_path"]
            if not package_path.exists():
                continue
            package = read_json(package_path)
            context.append({
                "document_id": package["document_id"], "version_id": package["version_id"], "filename": package["source"]["filename"],
                "media_type": package["source"]["media_type"], "summary": package.get("summary", ""),
                "entity_names": [x.get("name") for x in package.get("entities", [])[:100]],
                "known_locations": [x.get("name") for x in package.get("spatial_features", [])[:100]],
                "limitations": package.get("limitations", [])[:30],
            })
        return context

    @staticmethod
    def _batch_manifest(batch: EvidenceBatch) -> dict[str, Any]:
        return {"batch_id": batch.batch_id, "source_id": batch.source_id, "estimated_tokens": batch.estimated_tokens, "unit_ids": [u.unit_id for u in batch.units]}

    def _extract_text(self, request: DocumentRunRequest, root: Path, bundle: SourceBundle, batches: list[EvidenceBatch], context: list[dict[str, Any]], resume: bool) -> list[ExtractionResult]:
        # Initial 128K evidence batches run concurrently. A batch is reduced
        # only when Meta explicitly reports output-token exhaustion.
        workers = min(request.config.max_workers, max(1, len(batches)))
        stage_started = time.perf_counter()
        progress_path = root / "stages" / "text" / "progress.jsonl"
        if not resume and progress_path.exists():
            progress_path.unlink()
        self._stage3_event(root, "stage_started", f"Starting {len(batches)} initial evidence batches; workers={workers} target={request.config.target_batch_tokens:,} tokens", initial_batches=len(batches), workers=workers, target_batch_tokens=request.config.target_batch_tokens, max_output_tokens=request.config.max_output_tokens, resume=resume)
        groups: list[list[ExtractionResult] | None] = [None] * len(batches)
        completed = 0
        try:
            with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="loop1-text") as executor:
                futures = {executor.submit(self._extract_text_batch, request, root, bundle, batch, context, resume): index for index, batch in enumerate(batches)}
                for future in as_completed(futures):
                    index = futures[future]
                    groups[index] = future.result()
                    completed += 1
                    elapsed = time.perf_counter() - stage_started
                    eta = elapsed / completed * (len(batches) - completed) if completed else None
                    self._stage3_event(root, "initial_batch_finished", f"Initial batches {completed}/{len(batches)} ({completed * 100 // max(1, len(batches))}%) | leaf results={len(groups[index] or [])} | elapsed={elapsed:.1f}s | ETA={eta:.0f}s", completed=completed, total=len(batches), initial_batch_id=batches[index].batch_id, leaf_results=len(groups[index] or []), elapsed_seconds=round(elapsed, 3), eta_seconds=round(eta, 3) if eta is not None else None)
        except BaseException as exc:
            elapsed = time.perf_counter() - stage_started
            self._stage3_event(root, "stage_failed", f"Failed after {elapsed:.1f}s | initial batches completed={completed}/{len(batches)} | {type(exc).__name__}: {exc}", duration_seconds=round(elapsed, 3), completed_initial_batches=completed, total_initial_batches=len(batches), error_type=type(exc).__name__, error=str(exc))
            raise
        flattened = [result for group in groups if group is not None for result in group]
        elapsed = time.perf_counter() - stage_started
        self._stage3_event(root, "stage_completed", f"Completed in {elapsed:.1f}s | initial batches={len(batches)} leaf batches={len(flattened)} evidence items={sum(len(result.evidence_items) for result in flattened)}", duration_seconds=round(elapsed, 3), initial_batches=len(batches), leaf_batches=len(flattened), evidence_items=sum(len(result.evidence_items) for result in flattened), cost_totals=self.client.ledger.get("totals", {}))
        return flattened

    def _extract_text_batch(self, request: DocumentRunRequest, root: Path, bundle: SourceBundle, batch: EvidenceBatch, context: list[dict[str, Any]], resume: bool) -> list[ExtractionResult]:
        target = root / "stages" / "text" / "results" / f"{batch.batch_id}.json"
        if resume and target.exists():
            self._stage3_event(root, "batch_reused", f"Reusing {batch.batch_id}", batch_id=batch.batch_id, estimated_tokens=batch.estimated_tokens, unit_count=len(batch.units))
            return [ExtractionResult.model_validate(read_json(target))]
        batch_started = time.perf_counter()
        self._stage3_event(root, "batch_started", f"Started {batch.batch_id} | estimated={batch.estimated_tokens:,} tokens units={len(batch.units)}", batch_id=batch.batch_id, estimated_tokens=batch.estimated_tokens, unit_count=len(batch.units))
        if not request.config.live:
            result = ExtractionResult(batch_id=batch.batch_id, summary="Offline deterministic materialization only", limitations=["live=false"])
        else:
            profile = {"source_id": bundle.source_id, "filename": bundle.filename, "media_type": bundle.media_type, "adapter": bundle.adapter, "capabilities": bundle.capabilities, "structured_assets": bundle.structured_assets, "spatial_assets": bundle.spatial_assets}
            payload = json.dumps({"objective": request.objective, "current_document": profile, "other_document_catalog": context, "batch_id": batch.batch_id}, ensure_ascii=False) + batch.model_text()
            schema = extraction_schema()
            phase = f"document-text-{batch.batch_id}"
            try:
                exact_input_tokens = self.client.count_tokens(EXTRACTION_INSTRUCTIONS, payload, schema)
                self._stage3_event(root, "batch_counted", f"Counted {batch.batch_id} | exact request input={exact_input_tokens:,} tokens", batch_id=batch.batch_id, exact_input_tokens=exact_input_tokens)
                raw = self.client.complete(phase=phase, instructions=EXTRACTION_INSTRUCTIONS, input_content=payload, schema=schema, max_output_tokens=request.config.max_output_tokens, reasoning_effort="high", cache_key=f"agentic-subsurface:{EXTRACTION_PROMPT_VERSION}", counted_input_tokens=exact_input_tokens)
                raw["batch_id"] = batch.batch_id
                result = ExtractionResult.model_validate(raw)
            except IncompleteResponse as exc:
                if exc.reason != "max_output_tokens":
                    self._stage3_event(root, "batch_failed", f"Failed {batch.batch_id} without splitting | IncompleteResponse: {exc.reason}", batch_id=batch.batch_id, error_type=type(exc).__name__, error=str(exc), split=False, duration_seconds=round(time.perf_counter() - batch_started, 3))
                    raise
                children = self._split_batch(batch)
                usage = self.client.latest_call_for_phase(phase)
                self._stage3_event(root, "batch_split", f"Meta exhausted output tokens for {batch.batch_id}; splitting {batch.estimated_tokens:,} -> " + " + ".join(f"{child.estimated_tokens:,}" for child in children), batch_id=batch.batch_id, reason=exc.reason, parent_estimated_tokens=batch.estimated_tokens, child_batch_ids=[child.batch_id for child in children], child_estimated_tokens=[child.estimated_tokens for child in children], model_usage=usage)
                return [x for child in children for x in self._extract_text_batch(request, root, bundle, child, context, resume)]
            except BaseException as exc:
                self._stage3_event(root, "batch_failed", f"Failed {batch.batch_id} without splitting | {type(exc).__name__}: {exc}", batch_id=batch.batch_id, error_type=type(exc).__name__, error=str(exc), split=False, duration_seconds=round(time.perf_counter() - batch_started, 3))
                raise
        write_json(target, result.model_dump(mode="json"))
        usage = self.client.latest_call_for_phase(phase) if request.config.live else None
        usage_text = f" | input={usage['input_tokens']:,} output={usage['output_tokens']:,} cost=${usage['cost_usd']:.4f}" if usage else ""
        self._stage3_event(root, "batch_completed", f"Completed {batch.batch_id} in {time.perf_counter() - batch_started:.1f}s | evidence={len(result.evidence_items)} entities={len(result.entities)}{usage_text}", batch_id=batch.batch_id, duration_seconds=round(time.perf_counter() - batch_started, 3), evidence_items=len(result.evidence_items), entities=len(result.entities), output_path=str(target), model_usage=usage)
        return [result]

    def _stage3_event(self, root: Path, event: str, message: str, **details: Any) -> None:
        record = {"timestamp": datetime.now(UTC).isoformat(), "stage": 3, "event": event, "message": message, **details}
        target = root / "stages" / "text" / "progress.jsonl"
        with self._progress_lock:
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(record, ensure_ascii=False, default=str) + "\n")
            print(f"[stage 3] {message}", file=sys.stderr, flush=True)

    def _split_batch(self, batch: EvidenceBatch) -> list[EvidenceBatch]:
        if len(batch.units) == 1:
            unit = batch.units[0]
            if len(unit.text) < 2:
                raise ValueError(f"cannot split irreducible source unit in batch {batch.batch_id}")
            midpoint = len(unit.text) // 2
            # Prefer a nearby semantic boundary without allowing one child to
            # become pathologically small.
            lower, upper = len(unit.text) // 3, len(unit.text) * 2 // 3
            candidates = [position for marker in ("\n\n", "\n", ". ", " ") for position in (unit.text.rfind(marker, lower, midpoint + 1), unit.text.find(marker, midpoint, upper)) if position >= lower]
            if candidates:
                midpoint = min(candidates, key=lambda position: abs(position - midpoint))
            left_text, right_text = unit.text[:midpoint], unit.text[midpoint:]
            if not left_text or not right_text:
                raise ValueError(f"cannot split irreducible source unit in batch {batch.batch_id}")
            children = []
            for suffix, text in (("a", left_text), ("b", right_text)):
                metadata = dict(unit.metadata) | {"segmented_from_unit_id": unit.unit_id, "segment": suffix}
                segment = unit.model_copy(update={"unit_id": f"{unit.unit_id}:segment-{suffix}", "text": text, "metadata": metadata})
                children.append(EvidenceBatch(batch_id=f"{batch.batch_id}-{suffix}", source_id=batch.source_id, units=[segment], estimated_tokens=max(1, len(text) // 3) + 80))
            return children
        if not batch.units:
            raise ValueError(f"cannot split empty batch {batch.batch_id}")
        weights = [max(1, len(unit.text) // 3) + 80 for unit in batch.units]
        target = sum(weights) / 2
        running = 0
        midpoint = 1
        best_distance = float("inf")
        for index, weight in enumerate(weights[:-1], 1):
            running += weight
            distance = abs(target - running)
            if distance < best_distance:
                midpoint, best_distance = index, distance
        return [EvidenceBatch(batch_id=f"{batch.batch_id}-{suffix}", source_id=batch.source_id, units=units, estimated_tokens=sum(max(1, len(u.text) // 3) + 80 for u in units)) for suffix, units in (("a", batch.units[:midpoint]), ("b", batch.units[midpoint:]))]

    def _visual_content(self, root: Path, visuals: list[dict[str, Any]], header: dict[str, Any]) -> list[dict[str, Any]]:
        content: list[dict[str, Any]] = [{"type": "input_text", "text": json.dumps(header, ensure_ascii=False)}]
        for visual in visuals:
            path = root / visual["path"]
            content.append({"type": "input_text", "text": json.dumps({k: v for k, v in visual.items() if k != "path"}, ensure_ascii=False)})
            content.append({"type": "input_image", "image_url": _data_url(path), "detail": "high"})
        return [{"role": "user", "content": content}]

    def _classify_visuals(self, request: DocumentRunRequest, root: Path, bundle: SourceBundle, context: list[dict[str, Any]], resume: bool) -> list[dict[str, Any]]:
        visuals = bundle.visual_assets
        results: list[dict[str, Any]] = []
        jobs = list(enumerate(_chunks(visuals, request.config.visual_classification_batch_size), 1))
        with ThreadPoolExecutor(max_workers=min(request.config.max_workers, max(1, len(jobs))), thread_name_prefix="loop1-classify") as executor:
            responses = list(executor.map(lambda job: self._classify_visual_group(request, root, bundle, context, job[0], job[1], resume), jobs))
        for (_, group), response in zip(jobs, responses):
            by_id = {x.get("artifact_id"): x for x in response.get("classifications", [])}
            for visual in group:
                item = by_id.get(visual["artifact_id"])
                if item is None:
                    item = {"artifact_id": visual["artifact_id"], "classification": "other", "meaningful": True, "reason": "classifier omitted artifact; requires recovery", "duplicate_of": None, "suggested_extraction": "deep_visual", "status": "unresolved"}
                else:
                    item["status"] = "classified"
                item["page"] = visual.get("page")
                results.append(item)
        write_json(root / "stages" / "visual_classification" / "registry.json", results)
        return results

    def _classify_visual_group(self, request: DocumentRunRequest, root: Path, bundle: SourceBundle, context: list[dict[str, Any]], index: int, group: list[dict[str, Any]], resume: bool) -> dict[str, Any]:
        target = root / "stages" / "visual_classification" / f"batch-{index:04d}.json"
        if resume and target.exists():
            return read_json(target)
        if not request.config.live:
            response = {"classifications": [{"artifact_id": v["artifact_id"], "classification": "other", "meaningful": True, "reason": "offline-unclassified", "duplicate_of": None, "suggested_extraction": "deep_visual"} for v in group], "limitations": ["live=false"]}
        else:
            header = {"objective": request.objective, "document": {"source_id": bundle.source_id, "filename": bundle.filename}, "artifact_ids_in_order": [v["artifact_id"] for v in group], "other_document_catalog": context}
            response = self.client.complete(phase=f"visual-classify-{bundle.source_id}-{index:04d}", instructions=VISUAL_CLASSIFICATION_INSTRUCTIONS, input_content=self._visual_content(root, group, header), schema=visual_classification_schema(), max_output_tokens=16_000, reasoning_effort="high", cache_key=f"agentic-subsurface:{VISUAL_CLASSIFICATION_PROMPT_VERSION}")
        write_json(target, response)
        return response

    def _extract_visuals(self, request: DocumentRunRequest, root: Path, bundle: SourceBundle, context: list[dict[str, Any]], classifications: list[dict[str, Any]], resume: bool) -> list[ExtractionResult]:
        visual_by_id = {v["artifact_id"]: v for v in bundle.visual_assets}
        meaningful = [visual_by_id[x["artifact_id"]] for x in classifications if x.get("meaningful") and x["artifact_id"] in visual_by_id]
        jobs = [(group, f"batch-{index:04d}") for index, group in enumerate(_chunks(meaningful, request.config.visual_extraction_batch_size), 1)]
        with ThreadPoolExecutor(max_workers=min(request.config.max_workers, max(1, len(jobs))), thread_name_prefix="loop1-visual") as executor:
            groups = list(executor.map(lambda job: self._extract_visual_group(request, root, bundle, context, classifications, job[0], job[1], resume), jobs))
        return [result for group in groups for result in group]

    def _extract_visual_group(self, request: DocumentRunRequest, root: Path, bundle: SourceBundle, context: list[dict[str, Any]], classifications: list[dict[str, Any]], group: list[dict[str, Any]], batch_id: str, resume: bool) -> list[ExtractionResult]:
        target = root / "stages" / "visual_extraction" / f"{batch_id}.json"
        if resume and target.exists():
            result = ExtractionResult.model_validate(read_json(target))
        elif not request.config.live:
            result = ExtractionResult(batch_id=f"visual-{batch_id}", summary="Offline visual extraction not run", limitations=["live=false"])
            write_json(target, result.model_dump(mode="json"))
        else:
            header = {"objective": request.objective, "document": {"source_id": bundle.source_id, "filename": bundle.filename}, "required_artifact_ids": [v["artifact_id"] for v in group], "classifications": [x for x in classifications if x["artifact_id"] in {v["artifact_id"] for v in group}], "other_document_catalog": context}
            try:
                raw = self.client.complete(phase=f"visual-extract-{bundle.source_id}-{batch_id}", instructions=VISUAL_EXTRACTION_INSTRUCTIONS, input_content=self._visual_content(root, group, header), schema=extraction_schema(), max_output_tokens=request.config.max_output_tokens, reasoning_effort="high", cache_key=f"agentic-subsurface:{VISUAL_EXTRACTION_PROMPT_VERSION}")
            except IncompleteResponse as exc:
                if exc.reason != "max_output_tokens" or len(group) <= 1:
                    raise
                midpoint = len(group) // 2
                return self._extract_visual_group(request, root, bundle, context, classifications, group[:midpoint], f"{batch_id}-a", resume) + self._extract_visual_group(request, root, bundle, context, classifications, group[midpoint:], f"{batch_id}-b", resume)
            raw["batch_id"] = f"visual-{batch_id}"
            result = ExtractionResult.model_validate(raw)
            write_json(target, result.model_dump(mode="json"))
        return [result]

    def _consolidate(self, request: DocumentRunRequest, root: Path, document_id: str, version_id: str, bundle: SourceBundle, batches: list[EvidenceBatch], results: list[ExtractionResult], classifications: list[dict[str, Any]]) -> dict[str, Any]:
        artifacts = {x.artifact_id: x for x in bundle.artifacts}
        unit_ids = {x.unit_id for x in bundle.units}
        issues: list[dict[str, Any]] = []
        evidence_items = []
        seen = set()
        for result in results:
            for item in result.evidence_items:
                if item.evidence_id in seen:
                    issues.append({"severity": "warning", "code": "duplicate_evidence_id", "id": item.evidence_id})
                    continue
                seen.add(item.evidence_id)
                valid = []
                for ref in item.evidence:
                    if ref.artifact_id not in artifacts:
                        issues.append({"severity": "error", "code": "unknown_artifact", "id": item.evidence_id, "artifact_id": ref.artifact_id})
                    elif ref.locator.unit_id and ref.locator.unit_id not in unit_ids and ref.locator.unit_id not in artifacts:
                        issues.append({"severity": "error", "code": "unknown_unit", "id": item.evidence_id, "unit_id": ref.locator.unit_id})
                    else:
                        valid.append(ref)
                if valid:
                    item.evidence = valid
                    evidence_items.append(item.model_dump(mode="json"))

        classified_ids = {x["artifact_id"] for x in classifications if x.get("status") == "classified"}
        meaningful_ids = {x["artifact_id"] for x in classifications if x.get("meaningful")}
        interpreted_ids = {x.get("artifact_id") for r in results for x in r.visual_interpretations if x.get("artifact_id")}
        visual_ids = {x["artifact_id"] for x in bundle.visual_assets}
        table_ids = {x["asset_id"] for x in bundle.structured_assets if x.get("kind") in {"pdf_table", "table", "spreadsheet_sheet"}}
        batched_units = {u.unit_id for batch in batches for u in batch.units}
        table_unit_ids = {u.unit_id for u in bundle.units if u.artifact_id in table_ids}
        coverage = {
            "source_units": len(unit_ids), "units_batched": len(batched_units), "unbatched_units": sorted(unit_ids - batched_units),
            "visual_assets": len(visual_ids), "visuals_classified": len(classified_ids), "unclassified_visuals": sorted(visual_ids - classified_ids),
            "meaningful_visuals": len(meaningful_ids), "meaningful_visuals_interpreted": len(meaningful_ids & interpreted_ids), "uninterpreted_meaningful_visuals": sorted(meaningful_ids - interpreted_ids),
            "structured_assets": len(bundle.structured_assets), "table_assets": len(table_ids), "table_units_batched": len(table_unit_ids & batched_units), "unprocessed_table_units": sorted(table_unit_ids - batched_units),
            "valid_evidence_items": len(evidence_items), "validation_errors": sum(x["severity"] == "error" for x in issues),
        }
        package = {
            "schema_version": DOCUMENT_PACKAGE_SCHEMA, "document_id": document_id, "version_id": version_id, "status": "candidate",
            "objective": request.objective, "source": {"source_id": bundle.source_id, "filename": bundle.filename, "media_type": bundle.media_type, "sha256": bundle.sha256, "adapter": bundle.adapter, "original_path": bundle.original_path},
            "processing": {"loop1_code_version": LOOP1_CODE_VERSION, "model": request.config.model, "prompt_versions": [EXTRACTION_PROMPT_VERSION, VISUAL_CLASSIFICATION_PROMPT_VERSION, VISUAL_EXTRACTION_PROMPT_VERSION]},
            "artifacts": [x.model_dump(mode="json") for x in bundle.artifacts], "structured_assets": bundle.structured_assets, "spatial_assets": bundle.spatial_assets, "visual_assets": bundle.visual_assets,
            "visual_classifications": classifications, "entities": [x for r in results for x in r.entities], "evidence_items": evidence_items,
            "spatial_features": [x for r in results for x in r.spatial_features], "vertical_intervals": [x for r in results for x in r.vertical_intervals], "relationships": [x for r in results for x in r.relationships],
            "visual_interpretations": [x for r in results for x in r.visual_interpretations], "summary": " ".join(r.summary for r in results if r.summary),
            "limitations": list(dict.fromkeys(x for r in results for x in r.limitations)), "unresolved_items": list(dict.fromkeys(x for r in results for x in r.unresolved_items)), "coverage": coverage,
        }
        write_json(root / "document_evidence_package.candidate.json", package)
        write_json(root / "provenance_report.json", {"valid": coverage["validation_errors"] == 0, "issues": issues})
        return package

    def _validate_coverage(self, root: Path, package: dict[str, Any]) -> dict[str, Any]:
        coverage = package["coverage"]
        complete = not coverage["unbatched_units"] and not coverage["unclassified_visuals"] and not coverage["uninterpreted_meaningful_visuals"] and not coverage["unprocessed_table_units"] and coverage["validation_errors"] == 0
        package = dict(package)
        package["status"] = "complete" if complete else "incomplete"
        provenance = read_json(root / "provenance_report.json") if (root / "provenance_report.json").exists() else {"issues": []}
        write_json(root / "document_evidence_package.json", package)
        write_json(root / "validation_report.json", {"valid": complete, "issues": provenance.get("issues", []), "coverage": coverage})
        return package

    def _activate(self, document_id: str, version_id: str, package: dict[str, Any]) -> None:
        if package.get("status") != "complete":
            raise ValueError("cannot activate an incomplete document package")
        path = Path("documents") / document_id / "versions" / version_id / "document_evidence_package.json"
        write_json(self.root / "documents" / document_id / "active.json", {"document_id": document_id, "version_id": version_id, "package_path": str(path), "source_sha256": package["source"]["sha256"]})

    def _refresh_corpus_manifest(self) -> None:
        active = []
        for pointer_path in sorted((self.root / "documents").glob("*/active.json")):
            active.append(read_json(pointer_path))
        write_json(self.root / "corpus_manifest.json", {"schema_version": "corpus-manifest.v1", "active_documents": active, "counts": {"active_documents": len(active)}, "cost": self.client.ledger.get("totals", {})})


def process_corpus(requests: list[DocumentRunRequest], resume: bool = True, start_step: int = 1, end_step: int = 8) -> list[dict[str, Any]]:
    if not requests:
        return []
    processor = DocumentLoop1Processor(requests[0].output_dir, requests[0].config)
    return [processor.process(request, resume=resume, start_step=start_step, end_step=end_step) for request in requests]
