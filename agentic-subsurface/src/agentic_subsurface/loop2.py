from __future__ import annotations

import hashlib
import json
import os
import sys
import tempfile
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Callable

from .models import DocumentStudyRunRequest
from .prompts import STUDY_EXECUTIVE_INSTRUCTIONS, STUDY_EXECUTIVE_PROMPT_VERSION, STUDY_NARRATIVE_INSTRUCTIONS, STUDY_NARRATIVE_PROMPT_VERSION, STUDY_RENDERING_INSTRUCTIONS, STUDY_RENDERING_PROMPT_VERSION, STUDY_RENDERING_RECONCILIATION_INSTRUCTIONS, STUDY_RENDERING_RECONCILIATION_PROMPT_VERSION, STUDY_REPORT_INSTRUCTIONS, STUDY_REPORT_PROMPT_VERSION
from .provider import IncompleteResponse, MuseClient
from .schemas import report_executive_schema, report_schema, study_rendering_plan_schema, study_target_narrative_batch_schema
from .util import read_json, sha256_file, stable_id

LOOP2_CODE_VERSION = "document-loop2.v14"
RENDER_MATERIALIZATION_VERSION = "render-materialization.v2"
STAGES = {1: "prepare_document_study", 2: "synthesize_ui_rendering_package", 3: "generate_feature_narratives", 4: "generate_study_report", 5: "validate_consolidate_and_activate"}
STAGE_ARTIFACT_DIRS = {1: "stages/preparation", 2: "stages/rendering", 3: "stages/narratives", 4: "stages/report", 5: "final"}


def _write(path: Path, value: Any) -> None:
    """Atomically persist a checkpoint so interruption cannot corrupt it."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, indent=2, ensure_ascii=False, default=str)
            handle.write("\n"); handle.flush(); os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)


class DocumentLoop2Processor:
    """Turn one immutable Loop 1 package into one independently versioned UI study."""

    def __init__(self, output_root: Path, config: Any):
        self.root, self.config = output_root.resolve(), config
        self.root.mkdir(parents=True, exist_ok=True)
        self.client = MuseClient(self.root, config, shared_ledger_path=self.root / "telemetry" / "cost_ledger.json")
        self._progress_lock = threading.RLock()

    def _progress(self, root: Path, stage: int, event: str, message: str, **details: Any) -> None:
        record = {"at": datetime.now(UTC).isoformat(), "stage": stage, "event": event, "message": message, **details}
        path = root / "progress.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        with self._progress_lock:
            with path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(record, ensure_ascii=False, default=str) + "\n")
                handle.flush(); os.fsync(handle.fileno())
            print(f"[loop2][stage {stage}] {message}", file=sys.stderr, flush=True)

    def _soft_token_ceiling(self) -> int:
        """Allow the requested ~128K operating band without tiny cleanup calls."""
        target = int(getattr(self.config, "target_batch_tokens", 128_000))
        maximum = int(getattr(self.config, "max_batch_tokens", 128_000))
        return max(maximum, int(target * 1.10))

    def _reconciliation_ceiling(self) -> int:
        """Attempt a single smart reconciliation up to 256K input tokens."""
        available = int(getattr(self.config, "context_window", 1_048_576)) - int(getattr(self.config, "max_output_tokens", 128_000)) - int(getattr(self.config, "reserve_tokens", 80_000))
        return min(256_000, available)

    @staticmethod
    def _parallel_pair(left: Callable[[], Any], right: Callable[[], Any]) -> tuple[Any, Any]:
        """Run adaptive child work concurrently and return it in source order."""
        with ThreadPoolExecutor(max_workers=2, thread_name_prefix="loop2-adaptive-split") as pool:
            left_future = pool.submit(left)
            right_future = pool.submit(right)
            return left_future.result(), right_future.result()

    def process(self, request: DocumentStudyRunRequest, resume: bool = True, start_step: int = 1, end_step: int = 5) -> dict[str, Any]:
        if not 1 <= start_step <= end_step <= 5: raise ValueError("stage range must satisfy 1 <= start_step <= end_step <= 5")
        source_path = request.package_path.resolve()
        source = self._loop1_package(request, source_path)
        source_sha = sha256_file(source_path)
        semantic = request.config.model_dump(exclude={"max_cost_usd", "live", "max_workers", "materialization_mode", "materialization_workers", "materialization_chunk_size", "materialization_memory_limit_mb", "materialization_backend", "materialization_pressure_limit_pct"})
        version_id = stable_id("study-version", request.loop1_version_id, source_sha, LOOP2_CODE_VERSION, STUDY_RENDERING_PROMPT_VERSION, STUDY_NARRATIVE_PROMPT_VERSION, STUDY_REPORT_PROMPT_VERSION, json.dumps(semantic, sort_keys=True))
        root = self.root / "documents" / request.document_id / "versions" / version_id
        final_path = root / "final" / "study_package.json"
        if resume and start_step == 1 and end_step == 5 and final_path.exists():
            final = read_json(final_path)
            if final.get("status") in {"complete", "complete_with_limitations"}:
                if request.activate: self._activate(request.document_id, version_id, final_path, final)
                return self._result(request, version_id, final, True)

        preparation_root = root / "stages/preparation"
        snapshot_path = preparation_root / "snapshot.json"
        evidence_path = preparation_root / "synthesis_projection.json"
        if start_step <= 1 <= end_step:
            prepared = self._stage(
                root, 1,
                lambda: self._prepare(self._snapshot(request, source, source_path, source_sha, version_id, snapshot_path), evidence_path),
                lambda x: {**x["audit"]["counts"], **x["audit"]["reference_integrity"], "native_asset_count": x["audit"]["native_asset_count"]},
            )
        else: prepared = self._require(evidence_path, 1)
        if end_step == 1: return self._partial(request, version_id, start_step, end_step, root)

        rendering_path = root / "stages/rendering/ui_rendering_package.json"
        if start_step <= 2 <= end_step:
            rendering = self._stage(root, 2, lambda: self._render(request, prepared, rendering_path, resume), lambda x: {"features": len(x.get("features", [])), "intervals": len(x.get("intervals", [])), "datasets": len(x.get("extensions", {}).get("datasets", []))})
        else: rendering = self._require(rendering_path, 2)
        if end_step == 2: return self._partial(request, version_id, start_step, end_step, root)

        narrative_path = root / "stages/narratives/ui_narrative_package.json"
        if start_step <= 3 <= end_step:
            narratives = self._stage(root, 3, lambda: self._narrate(rendering, prepared, narrative_path, resume), lambda x: x["coverage"])
        else: narratives = self._require(narrative_path, 3)
        if end_step == 3: return self._partial(request, version_id, start_step, end_step, root)

        report_path = root / "stages/report/study_report.json"
        if start_step <= 4 <= end_step:
            report = self._stage(root, 4, lambda: self._report(request, rendering, prepared, report_path, resume), lambda x: {"findings": len(x.get("findings", [])), "chapters": len(x.get("chapters", []))})
        else: report = self._require(report_path, 4)
        if end_step == 4: return self._partial(request, version_id, start_step, end_step, root)

        final = self._stage(root, 5, lambda: self._consolidate(request, version_id, rendering, narratives, report, prepared, final_path), lambda x: {"status": x["status"], **x["validation"]["counts"]})
        if request.activate: self._activate(request.document_id, version_id, final_path, final)
        self._refresh_manifest()
        return self._result(request, version_id, final, False)

    def _stage(self, root: Path, step: int, fn: Callable[[], Any], summary: Callable[[Any], dict[str, Any]]) -> Any:
        run_id = f"stage-run-{stable_id('run', datetime.now(UTC).isoformat(), os.getpid(), time.time_ns()).split(':')[-1]}"
        started_at, started = datetime.now(UTC).isoformat(), time.perf_counter()
        calls_before = len(self.client.ledger.get("calls", []))
        call_dirs_before = {path.name for path in self.client.root.glob("call-*") if path.is_dir()}
        totals_before = dict(self.client.ledger.get("totals", {}))
        self._event(root, {"event": "stage_started", "run_id": run_id, "stage": step, "stage_name": STAGES[step], "at": started_at})
        print(f"[loop2] stage {step}/5 started: {STAGES[step]} | {root.name}", file=sys.stderr, flush=True)
        try: value = fn()
        except BaseException as exc:
            duration = time.perf_counter() - started
            details = {"error_type": type(exc).__name__, "error": str(exc)}
            self._record(root, step, run_id, started_at, duration, "failed", details, calls_before, call_dirs_before, totals_before)
            self._event(root, {"event": "stage_failed", "run_id": run_id, "stage": step, "stage_name": STAGES[step], "at": datetime.now(UTC).isoformat(), "duration_seconds": round(duration, 6), **details})
            print(f"[loop2] stage {step}/5 failed after {duration:.2f}s: {type(exc).__name__}: {exc}", file=sys.stderr, flush=True)
            raise
        duration = time.perf_counter() - started
        self._record(root, step, run_id, started_at, duration, "completed", summary(value), calls_before, call_dirs_before, totals_before)
        self._event(root, {"event": "stage_completed", "run_id": run_id, "stage": step, "stage_name": STAGES[step], "at": datetime.now(UTC).isoformat(), "duration_seconds": round(duration, 6)})
        print(f"[loop2] stage {step}/5 completed in {duration:.2f}s | artifacts: {root / STAGE_ARTIFACT_DIRS[step]}", file=sys.stderr, flush=True)
        return value

    def _record(self, root: Path, step: int, run_id: str, started: str, duration: float, status: str, details: dict[str, Any], calls_before: int, call_dirs_before: set[str], totals_before: dict[str, Any]) -> None:
        path = root / "stage_telemetry.json"
        value = read_json(path) if path.exists() else {"schema_version": "loop2-stage-telemetry.v2", "stages": {}}
        value["schema_version"] = "loop2-stage-telemetry.v2"
        calls = self.client.ledger.get("calls", [])[calls_before:]
        records_by_id = {str(record["call_id"]): record for record in calls}
        call_dirs = sorted((path for path in self.client.root.glob("call-*") if path.is_dir() and path.name not in call_dirs_before), key=lambda path: path.name)
        model_calls = []
        for call_dir in call_dirs:
            request_path, response_path, error_path = call_dir / "request.json", call_dir / "response.json", call_dir / "error.json"
            record = records_by_id.get(call_dir.name, {})
            request = read_json(request_path) if request_path.exists() else {}
            model_calls.append({
                **record, "call_id": call_dir.name, "phase": record.get("phase") or request.get("phase"),
                "status": "failed" if error_path.exists() else "completed" if response_path.exists() else "interrupted",
                "request_path": str(request_path), "response_path": str(response_path) if response_path.exists() else None,
                "error_path": str(error_path) if error_path.exists() else None,
            })
        totals_after = self.client.ledger.get("totals", {})
        cost_delta = {key: round(float(totals_after.get(key, 0)) - float(totals_before.get(key, 0)), 8) for key in ("input_tokens", "cached_input_tokens", "output_tokens", "cost_usd")}
        artifacts = self._artifact_manifest(root, step)
        value["stages"].setdefault(str(step), {"name": STAGES[step], "runs": []})["runs"].append({
            "run_id": run_id, "started_at": started, "finished_at": datetime.now(UTC).isoformat(),
            "duration_seconds": round(duration, 6), "status": status, "details": details,
            "artifacts": artifacts, "model_calls": model_calls,
            "cost_delta": cost_delta,
        })
        _write(path, value)

    @staticmethod
    def _artifact_manifest(root: Path, step: int) -> list[dict[str, Any]]:
        directory = root / STAGE_ARTIFACT_DIRS[step]
        if not directory.exists(): return []
        return [{"path": str(path.relative_to(root)), "bytes": path.stat().st_size, "sha256": sha256_file(path)} for path in sorted(directory.rglob("*")) if path.is_file()]

    @staticmethod
    def _event(root: Path, event: dict[str, Any]) -> None:
        path = root / "run_events.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(event, ensure_ascii=False, default=str) + "\n")
            handle.flush(); os.fsync(handle.fileno())

    @staticmethod
    def _require(path: Path, step: int) -> Any:
        if not path.exists(): raise RuntimeError(f"stage {step} artifact is missing: {path}; run with --start-step {step}")
        return read_json(path)

    @staticmethod
    def _loop1_package(request: DocumentStudyRunRequest, path: Path) -> dict[str, Any]:
        if not path.exists(): raise FileNotFoundError(path)
        value = read_json(path)
        if (value.get("document_id"), value.get("version_id")) != (request.document_id, request.loop1_version_id): raise ValueError("Loop 1 package identity does not match corpus_manifest.json")
        if value.get("source", {}).get("sha256") != request.expected_source_sha256: raise ValueError("Loop 1 source checksum does not match corpus_manifest.json")
        if value.get("status") != "complete" or value.get("coverage", {}).get("validation_errors") != 0: raise ValueError("Loop 1 package must be complete with zero validation errors")
        return value

    @staticmethod
    def _reference_integrity(package: dict[str, Any]) -> dict[str, Any]:
        valid_ids = {str(item["evidence_id"]) for item in package.get("evidence_items", []) if item.get("evidence_id")}
        records: list[dict[str, Any]] = []
        collections = ("entities", "spatial_features", "vertical_intervals", "relationships", "visual_interpretations")

        def object_id(item: dict[str, Any]) -> str | None:
            for key in ("entity_id", "feature_id", "interval_id", "relationship_id", "visual_id", "artifact_id"):
                if item.get(key): return str(item[key])
            return None

        def visit(value: Any, collection: str, location: str, owner_id: str | None = None) -> None:
            if isinstance(value, dict):
                current_owner = object_id(value) or owner_id
                for key, child in value.items():
                    child_location = f"{location}.{key}" if location else key
                    if key == "evidence_refs" and isinstance(child, list):
                        for reference in child:
                            ref = str(reference)
                            classification = "valid_evidence_ref" if ref in valid_ids else "unresolved_evidence_ref" if ":unresolved:" in ref.lower() else "invalid_evidence_ref"
                            records.append({"collection": collection, "location": child_location, "object_id": current_owner, "evidence_ref": ref, "classification": classification})
                    else: visit(child, collection, child_location, current_owner)
            elif isinstance(value, list):
                for index, child in enumerate(value): visit(child, collection, f"{location}[{index}]", owner_id)

        for collection in collections: visit(package.get(collection, []), collection, collection)
        counts = Counter(record["classification"] for record in records)
        unresolved = [record for record in records if record["classification"] == "unresolved_evidence_ref"]
        invalid = [record for record in records if record["classification"] == "invalid_evidence_ref"]
        return {
            "schema_version": "loop2-input-integrity.v1", "valid": not invalid,
            "counts": {"evidence_refs_checked": len(records), "valid_evidence_refs": counts["valid_evidence_ref"], "unresolved_evidence_refs": len(unresolved), "invalid_evidence_refs": len(invalid)},
            "unresolved_references": unresolved, "invalid_references": invalid,
            "policy": {"unresolved": "preserve in quarantine; never use as grounding", "invalid": "reject before evidence projection"},
        }

    @staticmethod
    def _snapshot(request: DocumentStudyRunRequest, package: dict[str, Any], path: Path, sha: str, version_id: str, target: Path) -> dict[str, Any]:
        integrity = DocumentLoop2Processor._reference_integrity(package)
        if not integrity["valid"]:
            raise ValueError(f"Loop 1 package contains {integrity['counts']['invalid_evidence_refs']} invalid evidence references")
        value = {"schema_version": "loop2-document-input.v2", "created_at": datetime.now(UTC).isoformat(), "document_id": request.document_id, "loop1_version_id": request.loop1_version_id, "study_version_id": version_id, "package_path": str(path), "package_sha256": sha, "input_integrity": integrity, "package": package}
        _write(target.parent / "input_integrity_audit.json", integrity)
        _write(target, value); return value

    @staticmethod
    def _transport_value(value: Any, mapping: dict[str, str]) -> Any:
        if isinstance(value, dict): return {key: DocumentLoop2Processor._transport_value(child, mapping) for key, child in value.items()}
        if isinstance(value, list): return [DocumentLoop2Processor._transport_value(child, mapping) for child in value]
        if isinstance(value, str): return mapping.get(value, value)
        return value

    @staticmethod
    def _columnarize(value: Any) -> Any:
        """Losslessly remove repeated object keys from homogeneous model inputs."""
        if isinstance(value, dict):
            return {key: DocumentLoop2Processor._columnarize(child) for key, child in value.items()}
        if isinstance(value, list):
            if len(value) > 1 and all(isinstance(item, dict) for item in value):
                fields = list(dict.fromkeys(key for item in value for key in item))
                rows = []
                for item in value:
                    present = "".join("1" if field in item else "0" for field in fields)
                    rows.append([present, *[DocumentLoop2Processor._columnarize(item[field]) for field in fields if field in item]])
                return {"$table": True, "fields": fields, "rows": rows}
            return [DocumentLoop2Processor._columnarize(child) for child in value]
        return value

    @staticmethod
    def _decolumnarize(value: Any) -> Any:
        if isinstance(value, dict) and value.get("$table") is True and isinstance(value.get("fields"), list) and isinstance(value.get("rows"), list):
            result = []
            for row in value["rows"]:
                present, values = str(row[0]), iter(row[1:])
                result.append({field: DocumentLoop2Processor._decolumnarize(next(values)) for index, field in enumerate(value["fields"]) if index < len(present) and present[index] == "1"})
            return result
        if isinstance(value, dict): return {key: DocumentLoop2Processor._decolumnarize(child) for key, child in value.items()}
        if isinstance(value, list): return [DocumentLoop2Processor._decolumnarize(child) for child in value]
        return value

    @staticmethod
    def _semantic_transport(projection: dict[str, Any], assets: list[dict[str, Any]]) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
        """Encode canonical science once; handles are reversible and never exposed as canonical IDs."""
        specifications = (
            ("evidence_items", "evidence_id", "E"), ("entities", "entity_id", "N"),
            ("spatial_features", "feature_id", "F"), ("vertical_intervals", "interval_id", "I"),
            ("relationships", "relationship_id", "R"), ("visual_interpretations", "visual_id", "V"),
        )
        canonical_to_handle: dict[str, str] = {}
        handle_to_canonical: dict[str, str] = {}
        for collection, key, prefix in specifications:
            position = 0
            for item in projection.get(collection, []):
                canonical = item.get(key) if isinstance(item, dict) else None
                if canonical is None or str(canonical) in canonical_to_handle: continue
                position += 1; handle = f"{prefix}{position:04d}"
                canonical_to_handle[str(canonical)] = handle; handle_to_canonical[handle] = str(canonical)
        asset_position = 0
        for item in assets:
            canonical = item.get("asset_id") or item.get("visual_id")
            if canonical is None or str(canonical) in canonical_to_handle: continue
            asset_position += 1; handle = f"A{asset_position:04d}"
            canonical_to_handle[str(canonical)] = handle; handle_to_canonical[handle] = str(canonical)
        encoded_projection = DocumentLoop2Processor._transport_value(projection, canonical_to_handle)
        encoded_assets = DocumentLoop2Processor._transport_value(assets, canonical_to_handle)
        transport = {"schema_version": "loop2-semantic-transport.v1", "projection": encoded_projection, "native_assets": encoded_assets}
        handle_map = {"schema_version": "loop2-semantic-handle-map.v1", "canonical_to_handle": canonical_to_handle, "handle_to_canonical": handle_to_canonical}
        restored_projection = DocumentLoop2Processor._transport_value(encoded_projection, handle_to_canonical)
        restored_assets = DocumentLoop2Processor._transport_value(encoded_assets, handle_to_canonical)
        canonical = lambda value: json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
        projection_text, restored_projection_text = canonical(projection), canonical(restored_projection)
        assets_text, restored_assets_text = canonical(assets), canonical(restored_assets)
        audit = {
            "schema_version": "loop2-semantic-transport-audit.v1",
            "round_trip_exact": projection_text == restored_projection_text and assets_text == restored_assets_text,
            "projection_sha256": hashlib.sha256(projection_text.encode()).hexdigest(),
            "restored_projection_sha256": hashlib.sha256(restored_projection_text.encode()).hexdigest(),
            "native_assets_sha256": hashlib.sha256(assets_text.encode()).hexdigest(),
            "restored_native_assets_sha256": hashlib.sha256(restored_assets_text.encode()).hexdigest(),
            "handle_count": len(handle_to_canonical),
            "policy": {"evidence_ranked": False, "evidence_truncated": False, "evidence_merged": False, "canonical_objects_duplicated": False, "canonical_ids_exposed_to_model": False},
        }
        if not audit["round_trip_exact"]: raise ValueError("semantic transport failed exact round-trip validation")
        return transport, handle_map, audit

    @staticmethod
    def _source_position(value: Any) -> tuple[int, int, int, str]:
        """Return a stable document-order key from the strongest available locator."""
        pages: list[int] = []
        rows: list[int] = []
        sequences: list[int] = []
        artifact_ids: list[str] = []

        def visit(item: Any) -> None:
            if isinstance(item, dict):
                for key in ("page", "page_number"):
                    if isinstance(item.get(key), int): pages.append(int(item[key]))
                if isinstance(item.get("row"), int): rows.append(int(item["row"]))
                if isinstance(item.get("sequence"), int): sequences.append(int(item["sequence"]))
                if item.get("artifact_id"): artifact_ids.append(str(item["artifact_id"]))
                for child in item.values(): visit(child)
            elif isinstance(item, list):
                for child in item: visit(child)

        visit(value)
        maximum = 2**31 - 1
        return (min(pages, default=maximum), min(rows, default=maximum), min(sequences, default=maximum), min(artifact_ids, default=""))

    @staticmethod
    def _ordered_transport_units(transport: dict[str, Any]) -> list[dict[str, Any]]:
        """Store every semantic object once and order it by its cited source position."""
        projection = transport["projection"]
        evidence_positions: dict[str, tuple[int, int, int, str]] = {}
        units: list[dict[str, Any]] = []
        for ordinal, item in enumerate(projection.get("evidence_items", [])):
            evidence_id = str(item["evidence_id"])
            position = DocumentLoop2Processor._source_position(item)
            evidence_positions[evidence_id] = position
            units.append({"unit_id": evidence_id, "kind": "evidence", "evidence_ids": [evidence_id], "evidence_item": item, "source_position": [*position[:3]], "_ordinal": ordinal})
        collection_offset = len(units)
        for collection in ("entities", "spatial_features", "vertical_intervals", "relationships", "visual_interpretations"):
            for index, item in enumerate(projection.get(collection, []), 1):
                references = [str(ref) for ref in item.get("evidence_refs", [])]
                positions = [evidence_positions[ref] for ref in references if ref in evidence_positions]
                position = min(positions, default=DocumentLoop2Processor._source_position(item))
                identifier = next((str(item[key]) for key in ("entity_id", "feature_id", "interval_id", "relationship_id", "visual_id", "artifact_id") if item.get(key)), f"{collection}:{index}")
                units.append({"unit_id": identifier, "kind": "source_object", "collection": collection, "evidence_ids": references, "object": item, "source_position": [*position[:3]], "_ordinal": collection_offset + len(units)})
        for index, asset in enumerate(transport.get("native_assets", []), 1):
            compact = {key: value for key, value in asset.items() if key != "resolved_path"}
            identifier = asset.get("asset_id") or asset.get("visual_id") or f"asset:{index}"
            position = DocumentLoop2Processor._source_position(asset)
            units.append({"unit_id": str(identifier), "kind": "native_asset", "evidence_ids": [], "asset": compact, "source_position": [*position[:3]], "_ordinal": collection_offset + len(units)})
        units.sort(key=lambda unit: (*unit["source_position"], unit["_ordinal"]))
        for source_sequence, unit in enumerate(units, 1):
            unit.pop("_ordinal", None)
            unit["source_sequence"] = source_sequence
        units.append({"unit_id": "document-context", "kind": "document_context", "evidence_ids": [], "source": projection.get("source"), "summary": projection.get("summary", ""), "limitations": projection.get("limitations", []), "unresolved_items": projection.get("unresolved_items", []), "source_sequence": len(units) + 1})
        return units

    @staticmethod
    def _prepare(snapshot: dict[str, Any], target: Path) -> dict[str, Any]:
        package = snapshot["package"]
        names = ("evidence_items", "entities", "spatial_features", "vertical_intervals", "relationships", "visual_interpretations")
        projection = {"schema_version": "study-evidence-projection.v2", "document_id": package["document_id"], "loop1_version_id": package["version_id"], "source": package["source"], "summary": package.get("summary", ""), **{name: json.loads(json.dumps(package.get(name, []))) for name in names}, "limitations": package.get("limitations", []), "unresolved_items": package.get("unresolved_items", [])}
        valid_evidence_ids = {str(item["evidence_id"]) for item in projection["evidence_items"] if item.get("evidence_id")}

        def quarantine(value: Any) -> None:
            if isinstance(value, dict):
                refs = value.get("evidence_refs")
                if isinstance(refs, list):
                    value["evidence_refs"] = [str(ref) for ref in refs if str(ref) in valid_evidence_ids]
                    unresolved = [str(ref) for ref in refs if str(ref) not in valid_evidence_ids]
                    if unresolved: value["unresolved_evidence_refs"] = unresolved
                for child in value.values(): quarantine(child)
            elif isinstance(value, list):
                for child in value: quarantine(child)

        for name in names[1:]: quarantine(projection[name])
        base, assets = Path(snapshot["package_path"]).parent, []
        for asset_class, key in (("structured", "structured_assets"), ("spatial", "spatial_assets"), ("visual", "visual_assets")):
            for asset in package.get(key, []):
                item = {"asset_class": asset_class, "document_id": package["document_id"], **asset}
                if asset.get("path"): item["resolved_path"] = str((base / asset["path"]).resolve())
                assets.append(item)
        by_id = {str(x["evidence_id"]): x for x in projection["evidence_items"] if x.get("evidence_id")}
        counts = {name: len(projection[name]) for name in names}
        study_context = {"source_filename": package["source"]["filename"], "media_type": package["source"]["media_type"], "adapter": package["source"]["adapter"], "document_summary": package.get("summary", ""), "evidence_counts": counts, "native_asset_classes": dict(Counter(x["asset_class"] for x in assets)), "native_asset_kinds": dict(Counter(str(x.get("kind", "unknown")) for x in assets)), "available_capabilities": {"spatial_evidence": bool(package.get("spatial_features") or package.get("spatial_assets")), "vertical_evidence": bool(package.get("vertical_intervals")), "structured_evidence": bool(package.get("structured_assets")), "visual_evidence": bool(package.get("visual_interpretations"))}}
        integrity = snapshot.get("input_integrity") or DocumentLoop2Processor._reference_integrity(package)
        transport, handle_map, transport_audit = DocumentLoop2Processor._semantic_transport(projection, assets)
        transport["ordered_units"] = DocumentLoop2Processor._ordered_transport_units(transport)
        value = {"projection": projection, "study_context": study_context, "evidence_index": {"by_id": by_id, "evidence_ids": sorted(by_id)}, "native_assets": assets, "semantic_transport": transport, "semantic_handle_map": handle_map, "audit": {"counts": counts, "identifiers_preserved": True, "native_asset_count": len(assets), "reference_integrity": integrity["counts"], "unresolved_references_quarantined": integrity["counts"]["unresolved_evidence_refs"], "semantic_transport": transport_audit}}
        expanded_units = DocumentLoop2Processor._expanded_render_evidence_units(value)
        compact_units = DocumentLoop2Processor._render_evidence_units(value)
        compact_json = lambda item: json.dumps(item, ensure_ascii=False, separators=(",", ":"), default=str)
        expanded_chars, compact_chars = len(compact_json(expanded_units)), len(compact_json(compact_units))
        transport_audit.update({"expanded_prompt_characters": expanded_chars, "compact_prompt_characters": compact_chars, "character_reduction": expanded_chars - compact_chars, "reduction_percent": round(100 * (expanded_chars - compact_chars) / expanded_chars, 2) if expanded_chars else 0.0, "expanded_estimated_tokens": max(1, (expanded_chars + 2) // 3), "compact_estimated_tokens": max(1, (compact_chars + 2) // 3)})
        _write(target, value); _write(target.parent / "native_asset_registry.json", assets); _write(target.parent / "semantic_transport.json", transport); _write(target.parent / "semantic_handle_map.json", handle_map); _write(target.parent / "semantic_transport_audit.json", transport_audit); _write(target.parent / "projection_audit.json", value["audit"]); return value

    @staticmethod
    def _geometry(value: Any) -> dict[str, Any] | None:
        if isinstance(value, str):
            try: value = json.loads(value)
            except (TypeError, json.JSONDecodeError): return None
        if not isinstance(value, dict) or not isinstance(value.get("type"), str): return None
        if value["type"] == "GeometryCollection":
            geometries = value.get("geometries")
            return value if isinstance(geometries, list) and all(DocumentLoop2Processor._geometry(x) for x in geometries) else None
        coordinates = value.get("coordinates")
        def numeric_tree(item: Any) -> bool:
            return isinstance(item, (int, float)) and not isinstance(item, bool) or isinstance(item, list) and bool(item) and all(numeric_tree(x) for x in item)
        def pairs(item: Any) -> list[list[float]]:
            if isinstance(item, list) and len(item) >= 2 and all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in item[:2]): return [item]
            return [pair for child in item for pair in pairs(child)] if isinstance(item, list) else []
        coordinate_pairs = pairs(coordinates)
        geographic = bool(coordinate_pairs) and all(-180 <= pair[0] <= 180 and -90 <= pair[1] <= 90 for pair in coordinate_pairs)
        return value if numeric_tree(coordinates) and geographic else None

    @staticmethod
    def _properties(value: Any) -> list[dict[str, Any]]:
        if isinstance(value, list): return [x for x in value if isinstance(x, dict)]
        if isinstance(value, dict): return [{"name": str(k), "value": v, "unit": None} for k, v in value.items()]
        return []

    @staticmethod
    def _deterministic_rendering(request: DocumentStudyRunRequest, prepared: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
        p, assets = prepared["projection"], prepared["native_assets"]
        spatial_assets = {str(x.get("asset_id")): x for x in assets if x["asset_class"] == "spatial" and x.get("asset_id")}
        evidence_by_asset: dict[str, list[str]] = {}
        for evidence_item in p.get("evidence_items", []):
            evidence_id = evidence_item.get("evidence_id")
            for reference in evidence_item.get("evidence", []):
                artifact_id = reference.get("artifact_id") if isinstance(reference, dict) else None
                if artifact_id and evidence_id: evidence_by_asset.setdefault(str(artifact_id), []).append(str(evidence_id))
        features, native_backed, nonrenderable, quarantined = [], [], [], []
        for raw in p.get("spatial_features", []):
            fid = str(raw.get("feature_id") or stable_id("feature", request.document_id, len(features) + len(nonrenderable)))
            geometry = DocumentLoop2Processor._geometry(raw.get("geometry_json") or raw.get("geometry"))
            lat, lon = raw.get("latitude"), raw.get("longitude")
            if geometry is None and isinstance(lat, (int, float)) and isinstance(lon, (int, float)) and -90 <= lat <= 90 and -180 <= lon <= 180:
                geometry = {"type": "Point", "coordinates": [lon, lat]}
            item = {"id": fid, "name": str(raw.get("name") or fid), "type": str(raw.get("type") or "feature"), "geometry": geometry, "properties": DocumentLoop2Processor._properties(raw.get("properties")), "source_refs": list(raw.get("evidence_refs") or []), "dataset_ids": [str(raw["source_asset_id"])] if raw.get("source_asset_id") in spatial_assets else [], "fidelity": str(raw.get("fidelity") or "reported"), "source_identifier": raw.get("source_identifier") or raw.get("original_feature_id")}
            if geometry is not None: features.append(item)
            elif raw.get("source_asset_id") in spatial_assets: native_backed.append({"id": fid, "reason": "native_layer_backed", "source_asset_id": raw["source_asset_id"], "source_refs": item["source_refs"]})
            elif raw.get("latitude") is not None or raw.get("longitude") is not None or raw.get("geometry_json") not in (None, "", {}): quarantined.append({"id": fid, "reason": "invalid_or_incomplete_geometry", "source_refs": item["source_refs"]})
            else: nonrenderable.append({"id": fid, "reason": "no_explicit_geometry", "source_refs": item["source_refs"]})

        layers = []
        for aid, asset in spatial_assets.items():
            counts = asset.get("geometry_type_counts") or {}
            layers.append({"id": stable_id("layer", request.document_id, aid), "name": str(asset.get("name") or asset.get("kind") or "Native spatial layer"), "kind": "native_vector", "render_type": "geojson" if str(asset.get("path", "")).lower().endswith(".geojson") else "native_vector", "source_asset_id": aid, "path": asset.get("path"), "resolved_path": asset.get("resolved_path"), "format": "geojson" if str(asset.get("path", "")).lower().endswith(".geojson") else "unknown", "delivery_mode": "file", "feature_count": asset.get("feature_count"), "geometry_types": sorted(counts) or list(asset.get("geometry_types") or []), "default_visible": True, "selection_mode": "layer", "semantic_category": "native_spatial_data", "source_refs": list(dict.fromkeys(evidence_by_asset.get(aid, [])))})
        for feature_type, members in sorted(((k, [x for x in features if x["type"] == k]) for k in {x["type"] for x in features}), key=lambda x: x[0]):
            layers.append({"id": stable_id("layer", request.document_id, "features", feature_type), "name": feature_type.replace("_", " ").title(), "kind": "generated_features", "render_type": "geojson_features", "feature_ids": [x["id"] for x in members], "feature_count": len(members), "geometry_types": sorted({x["geometry"]["type"] for x in members}), "default_visible": True, "selection_mode": "feature", "semantic_category": feature_type, "source_refs": sorted({r for x in members for r in x["source_refs"]})})

        intervals = []
        for raw in p.get("vertical_intervals", []):
            intervals.append({"id": str(raw.get("interval_id")), "name": str(raw.get("name") or raw.get("type") or "Interval"), "type": str(raw.get("type") or "interval"), "axis": raw.get("axis"), "reference": raw.get("reference"), "start": raw.get("start"), "end": raw.get("end"), "thickness": raw.get("thickness"), "unit": raw.get("unit"), "material": raw.get("material"), "qualifier": raw.get("qualifier"), "fidelity": raw.get("fidelity"), "feature_id": raw.get("feature_id"), "source_refs": list(raw.get("evidence_refs") or [])})
        profile_groups: dict[str, list[dict[str, Any]]] = {}
        for interval in intervals: profile_groups.setdefault(str(interval.get("feature_id") or "study"), []).append(interval)
        profiles = [{"id": stable_id("profile", request.document_id, owner), "name": f"{owner} vertical profile" if owner != "study" else "Study vertical profile", "feature_id": None if owner == "study" else owner, "interval_ids": [x["id"] for x in values], "axis": next((x.get("axis") for x in values if x.get("axis")), "depth"), "reference": next((x.get("reference") for x in values if x.get("reference")), "unspecified"), "semantic_category": "vertical_profile", "source_refs": sorted({r for x in values for r in x["source_refs"]})} for owner, values in profile_groups.items()]

        observations = []
        for raw in p.get("evidence_items", []):
            if raw.get("value") is None and raw.get("kind") not in {"measurement", "observation", "statistic", "calculation"}: continue
            observations.append({"id": str(raw.get("evidence_id")), "type": str(raw.get("kind") or "observation"), "subject": raw.get("subject"), "statement": raw.get("statement"), "value": raw.get("value"), "unit": raw.get("unit"), "confidence": raw.get("confidence"), "basis": raw.get("basis"), "source_refs": [str(raw.get("evidence_id"))]})
        structured = [{"id": str(x.get("asset_id") or stable_id("resource", request.document_id, x.get("path"))), "kind": str(x.get("kind") or "structured_resource"), "path": x.get("path"), "resolved_path": x.get("resolved_path"), "row_count": x.get("row_count"), "columns": x.get("columns", []), "ui_role": "evidence_resource", "source_refs": list(dict.fromkeys(evidence_by_asset.get(str(x.get("asset_id")), [])))} for x in assets if x["asset_class"] == "structured"]

        targets = [{"id": stable_id("target", request.document_id, "study"), "kind": "study", "object_id": request.study_id, "priority": "primary", "source_refs": []}]
        targets += [{"id": stable_id("target", x["id"]), "kind": "layer", "object_id": x["id"], "priority": "primary", "source_refs": x["source_refs"]} for x in layers]
        targets += [{"id": stable_id("target", x["id"]), "kind": "vertical_profile", "object_id": x["id"], "priority": "primary", "source_refs": x["source_refs"]} for x in profiles]
        targets += [{"id": stable_id("target", x["id"]), "kind": "feature", "object_id": x["id"], "priority": "secondary", "source_refs": x["source_refs"]} for x in features if x["source_refs"]]

        capabilities = {"map": bool(features or layers), "native_vector_layers": bool(spatial_assets), "generated_features": bool(features), "vertical_profiles": bool(profiles), "structured_resources": bool(structured), "feature_selection": bool(features), "layer_selection": bool(layers), "report": True}
        active = sum(bool(capabilities[k]) for k in ("native_vector_layers", "generated_features", "vertical_profiles", "structured_resources"))
        mode = "mixed" if active > 1 else "native_layer" if capabilities["native_vector_layers"] else "interactive_spatial" if capabilities["generated_features"] else "vertical" if capabilities["vertical_profiles"] else "structured_data" if capabilities["structured_resources"] else "report_only"
        linked = {r for x in features for r in x["source_refs"]} | {r for x in intervals for r in x["source_refs"]} | {r for x in layers for r in x["source_refs"]}
        evidence_ids = set(prepared["evidence_index"]["evidence_ids"])
        coverage = {"loop1_spatial_features": len(p.get("spatial_features", [])), "renderable_features": len(features), "native_layer_backed_concepts": len(native_backed), "non_renderable_spatial_concepts": len(nonrenderable), "quarantined_spatial_concepts": len(quarantined), "dropped_spatial_features": 0, "loop1_vertical_intervals": len(p.get("vertical_intervals", [])), "rendered_intervals": len(intervals), "dropped_intervals": 0, "loop1_evidence_items": len(evidence_ids), "evidence_linked_to_ui": len(evidence_ids & linked), "evidence_retained_for_report": len(evidence_ids - linked), "discarded_evidence_items": 0}
        result = {"schema_version": "study-rendering.v1", "study": {"id": request.study_id, "document_id": request.document_id, "title": p["source"]["filename"], "short_title": p["source"]["filename"], "domain": "technical_study", "summary": p.get("summary", "")}, "primary_rendering_mode": mode, "capabilities": capabilities, "layers": layers, "features": features, "observations": observations, "vertical_profiles": profiles, "intervals": intervals, "structured_resources": structured, "narrative_targets": targets, "non_renderable": {"spatial_concepts": nonrenderable, "native_layer_backed_concepts": native_backed, "quarantined_spatial_concepts": quarantined}, "evidence_sidecar": {"report_evidence_ids": sorted(evidence_ids - linked)}, "coverage": coverage, "limitations": list(p.get("limitations", [])), "semantic_presentation": {}}
        handles = {"layers": [{"handle": x["id"], "kind": x["kind"], "name": x["name"], "feature_count": x.get("feature_count"), "geometry_types": x.get("geometry_types", [])} for x in layers], "profiles": [{"handle": x["id"], "name": x["name"], "interval_count": len(x["interval_ids"])} for x in profiles], "feature_groups": [{"handle": x["id"], "name": x["name"], "feature_count": x.get("feature_count")} for x in layers if x["kind"] == "generated_features"]}
        return result, handles

    @staticmethod
    def _expanded_render_evidence_units(prepared: dict[str, Any]) -> list[dict[str, Any]]:
        """Legacy expanded representation retained only for compaction measurement."""
        projection = prepared["projection"]
        evidence = projection.get("evidence_items", [])
        by_ref: dict[str, dict[str, list[dict[str, Any]]]] = {str(item["evidence_id"]): {} for item in evidence if item.get("evidence_id")}
        orphaned: dict[str, list[dict[str, Any]]] = {}
        for collection in ("entities", "spatial_features", "vertical_intervals", "relationships", "visual_interpretations"):
            for item in projection.get(collection, []):
                refs = [str(ref) for ref in item.get("evidence_refs", [])]
                linked = False
                for ref in refs:
                    if ref in by_ref:
                        by_ref[ref].setdefault(collection, []).append(item); linked = True
                if not linked: orphaned.setdefault(collection, []).append(item)
        units = [{"unit_id": str(item["evidence_id"]), "kind": "evidence", "evidence_ids": [str(item["evidence_id"])], "evidence_item": item, "related_objects": by_ref.get(str(item["evidence_id"]), {})} for item in evidence if item.get("evidence_id")]
        for asset in prepared.get("native_assets", []):
            compact = {key: value for key, value in asset.items() if key != "resolved_path"}
            units.append({"unit_id": f"asset:{asset.get('asset_id') or asset.get('visual_id') or len(units)}", "kind": "native_asset", "evidence_ids": [], "asset": compact})
        for collection, items in orphaned.items():
            for index, item in enumerate(items, 1):
                units.append({"unit_id": f"orphan:{collection}:{index}", "kind": "unlinked_source_object", "evidence_ids": [], "collection": collection, "object": item})
        units.append({"unit_id": "document-context", "kind": "document_context", "evidence_ids": [], "summary": projection.get("summary", ""), "limitations": projection.get("limitations", []), "unresolved_items": projection.get("unresolved_items", [])})
        return units

    @staticmethod
    def _render_evidence_units(prepared: dict[str, Any]) -> list[dict[str, Any]]:
        """Return one-copy, handle-encoded semantic units for model transport."""
        transport = prepared.get("semantic_transport")
        if not transport: return DocumentLoop2Processor._expanded_render_evidence_units(prepared)
        return json.loads(json.dumps(transport.get("ordered_units") or DocumentLoop2Processor._ordered_transport_units(transport)))

    def _preceding_context(self, units: list[dict[str, Any]]) -> list[dict[str, Any]]:
        budget = int(getattr(self.config, "overlap_tokens", 6_000))
        selected: list[dict[str, Any]] = []
        used = 0
        for unit in reversed(units):
            weight = self._estimated_tokens(unit) + 40
            if selected and used + weight > budget: break
            if weight > budget and not selected: continue
            selected.append(unit); used += weight
        return list(reversed(selected))

    @staticmethod
    def _estimated_tokens(value: Any) -> int:
        return max(1, (len(json.dumps(value, ensure_ascii=False, default=str)) + 2) // 3)

    def _pack_render_units(self, prepared: dict[str, Any], units: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
        target = int(getattr(self.config, "target_batch_tokens", 128_000))
        overhead = self._estimated_tokens({"study_context": prepared["study_context"], "native_asset_count": len(prepared.get("native_assets", []))}) + 2_000
        batches: list[list[dict[str, Any]]] = []
        current: list[dict[str, Any]] = []
        current_tokens = overhead
        for unit in units:
            weight = self._estimated_tokens(unit) + 40
            if current and current_tokens + weight > target:
                batches.append(current); current, current_tokens = [], overhead
            current.append(unit); current_tokens += weight
        if current: batches.append(current)
        return batches

    @staticmethod
    def _split_render_units(units: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        if len(units) <= 1: raise ValueError("cannot recursively split an irreducible Stage 2 evidence unit")
        weights = [DocumentLoop2Processor._estimated_tokens(unit) for unit in units]
        target, running, midpoint = sum(weights) / 2, 0, 1
        for index, weight in enumerate(weights[:-1], 1):
            running += weight
            midpoint = index
            if running >= target: break
        return units[:midpoint], units[midpoint:]

    @staticmethod
    def _normalize_local_render_plan(plan: dict[str, Any], units: list[dict[str, Any]], handle_to_canonical: dict[str, str] | None = None) -> tuple[dict[str, Any], dict[str, Any]]:
        """Enforce immutable batch ownership without discarding owned model output."""
        value = json.loads(json.dumps(plan))
        mapping = handle_to_canonical or {}
        canonical = lambda identifier: mapping.get(str(identifier), str(identifier))
        owned_unit_ids = {canonical(unit.get("unit_id")) for unit in units}
        owned_evidence_ids = {canonical(unit["evidence_item"]["evidence_id"]) for unit in units if unit.get("kind") == "evidence" and isinstance(unit.get("evidence_item"), dict) and unit["evidence_item"].get("evidence_id")}
        original_dispositions = value.get("evidence_dispositions", [])
        value["evidence_dispositions"] = [item for item in original_dispositions if str(item.get("evidence_id")) in owned_evidence_ids]
        counts = Counter(str(item.get("evidence_id")) for item in value["evidence_dispositions"])
        missing = sorted(owned_evidence_ids - set(counts))
        duplicates = sorted(identifier for identifier, count in counts.items() if count != 1)
        if missing or duplicates:
            raise ValueError(f"local rendering plan violates owned evidence coverage: missing={missing[:10]}, duplicates={duplicates[:10]}")
        referenced_targets = {str(target) for item in value["evidence_dispositions"] for target in item.get("target_ids", [])}
        collections = ("layers", "features", "observations", "intervals", "vertical_profiles", "structured_resources")
        removed_object_ids: list[str] = []
        for collection in collections:
            kept = []
            for item in value.get(collection, []):
                identifier = str(item.get("id"))
                source_ids = {str(source) for source in item.get("source_object_ids", [])}
                evidence_refs = {str(ref) for ref in item.get("evidence_refs", [])}
                asset_ids = {str(source) for source in item.get("source_asset_ids", [])}
                if item.get("source_asset_id"): asset_ids.add(str(item["source_asset_id"]))
                if identifier in referenced_targets or source_ids & owned_unit_ids or evidence_refs & owned_evidence_ids or asset_ids & owned_unit_ids:
                    kept.append(item)
                else:
                    removed_object_ids.append(identifier)
            value[collection] = kept
        value["unsupported_objects"] = [item for item in value.get("unsupported_objects", []) if str(item.get("source_id")) in owned_unit_ids]
        audit = {
            "owned_evidence_count": len(owned_evidence_ids),
            "kept_disposition_count": len(value["evidence_dispositions"]),
            "context_dispositions_removed": len(original_dispositions) - len(value["evidence_dispositions"]),
            "context_only_objects_removed": len(removed_object_ids),
            "removed_object_ids": removed_object_ids,
        }
        return value, audit

    @staticmethod
    def _assemble_render_plans(local_plans: list[dict[str, Any]], semantic_plan: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
        """Deterministic evidence-preserving skeleton plus bounded semantic dressing."""
        collections = ("layers", "features", "observations", "intervals", "vertical_profiles", "structured_resources")
        result = {key: json.loads(json.dumps(semantic_plan.get(key))) for key in ("title", "short_title", "domain", "summary", "primary_rendering_mode")}
        duplicate_ids: dict[str, list[str]] = {}
        for collection in collections:
            seen: dict[str, dict[str, Any]] = {}
            ordered: list[dict[str, Any]] = []
            for plan in local_plans:
                for item in plan.get(collection, []):
                    identifier = str(item.get("id"))
                    if identifier in seen:
                        if seen[identifier] != item: duplicate_ids.setdefault(collection, []).append(identifier)
                        continue
                    seen[identifier] = item; ordered.append(json.loads(json.dumps(item)))
            # Reconciliation may contribute a genuinely cross-boundary object,
            # but it can never replace or remove an evidence-bearing leaf object.
            semantic_additions = 0
            for item in semantic_plan.get(collection, []):
                identifier = str(item.get("id"))
                if identifier not in seen:
                    seen[identifier] = item; ordered.append(json.loads(json.dumps(item))); semantic_additions += 1
            result[collection] = ordered
            result.setdefault("_semantic_additions", {})[collection] = semantic_additions
        if duplicate_ids: raise ValueError(f"conflicting duplicate object IDs across local rendering plans: {duplicate_ids}")
        dispositions = [json.loads(json.dumps(item)) for plan in local_plans for item in plan.get("evidence_dispositions", [])]
        result["evidence_dispositions"] = dispositions
        unsupported: list[dict[str, Any]] = []
        unsupported_keys: set[tuple[str, str]] = set()
        for plan in local_plans:
            for item in plan.get("unsupported_objects", []):
                key = (str(item.get("source_kind")), str(item.get("source_id")))
                if key not in unsupported_keys: unsupported_keys.add(key); unsupported.append(json.loads(json.dumps(item)))
        result["unsupported_objects"] = unsupported
        result["limitations"] = list(dict.fromkeys(str(item) for plan in [*local_plans, semantic_plan] for item in plan.get("limitations", [])))
        additions = result.pop("_semantic_additions")
        audit = {
            "strategy": "deterministic leaf preservation with additive semantic reconciliation",
            "local_plan_count": len(local_plans),
            "object_counts": {collection: len(result[collection]) for collection in collections},
            "semantic_additions": additions,
            "evidence_disposition_count": len(dispositions),
            "unsupported_object_count": len(unsupported),
            "model_reconciliation_allowed_to_delete_leaf_objects": False,
        }
        return result, audit

    @staticmethod
    def _repair_render_plan_integrity(plan: dict[str, Any], prepared: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
        """Make only provenance-safe referential repairs and expose every repair."""
        value = json.loads(json.dumps(plan))
        evidence_by_id = prepared["evidence_index"]["by_id"]
        valid_assets = {str(item.get("asset_id") or item.get("visual_id")) for item in prepared.get("native_assets", []) if item.get("asset_id") or item.get("visual_id")}
        repairs: list[dict[str, Any]] = []

        # An explicit unsupported classification is the strongest available
        # renderability decision. Reconciliation can otherwise preserve the
        # same source ID on a broad layer/feature from a leaf plan, producing
        # contradictory coverage even though the source was correctly rejected.
        # Remove only the contradictory provenance link; retain the UI object,
        # unsupported record, evidence and explanation for full auditability.
        unsupported_spatial_ids = {
            str(item.get("source_id"))
            for item in value.get("unsupported_objects", [])
            if item.get("source_kind") == "spatial_feature" and item.get("source_id")
        }
        unsupported_interval_ids = {
            str(item.get("source_id"))
            for item in value.get("unsupported_objects", [])
            if item.get("source_kind") == "vertical_interval" and item.get("source_id")
        }
        for collection, blocked_ids in (
            ("features", unsupported_spatial_ids),
            ("layers", unsupported_spatial_ids),
            ("intervals", unsupported_interval_ids),
        ):
            for item in value.get(collection, []):
                original = [str(source) for source in item.get("source_object_ids", [])]
                removed = [source for source in original if source in blocked_ids]
                if not removed:
                    continue
                item["source_object_ids"] = [source for source in original if source not in blocked_ids]
                repairs.append({
                    "kind": "unsupported_classification_overrode_renderable_link",
                    "collection": collection,
                    "object_id": item.get("id"),
                    "source_object_ids": removed,
                })

        for feature in value.get("features", []):
            coordinate_refs = [str(ref) for ref in feature.get("coordinate_evidence_refs", [])]
            evidence_refs = [str(ref) for ref in feature.get("evidence_refs", [])]
            missing_refs = [ref for ref in coordinate_refs if ref not in evidence_refs]
            if missing_refs:
                feature["evidence_refs"] = list(dict.fromkeys(evidence_refs + missing_refs))
                repairs.append({"kind": "coordinate_refs_promoted_to_evidence_refs", "object_id": feature.get("id"), "evidence_refs": missing_refs})
            asset_id = feature.get("source_asset_id")
            if asset_id is not None and str(asset_id) not in valid_assets:
                feature["source_asset_id"] = None
                repairs.append({"kind": "invalid_native_asset_link_removed", "object_id": feature.get("id"), "source_asset_id": asset_id, "provenance_retained_in": ["source_object_ids", "evidence_refs"]})

        collections = ("layers", "features", "observations", "intervals", "vertical_profiles", "structured_resources")
        known_ids = {str(item.get("id")) for collection in collections for item in value.get(collection, []) if item.get("id")}
        missing_targets: dict[str, list[str]] = {}
        for disposition in value.get("evidence_dispositions", []):
            evidence_id = str(disposition.get("evidence_id"))
            for target_id in disposition.get("target_ids", []):
                target = str(target_id)
                if target not in known_ids: missing_targets.setdefault(target, []).append(evidence_id)
        for target_id, evidence_ids in missing_targets.items():
            refs = list(dict.fromkeys(ref for ref in evidence_ids if ref in evidence_by_id))
            evidence = [evidence_by_id[ref] for ref in refs]
            statements = list(dict.fromkeys(str(item.get("statement", "")).strip() for item in evidence if item.get("statement")))
            subjects = list(dict.fromkeys(str(item.get("subject", "")).strip() for item in evidence if item.get("subject")))
            units = list(dict.fromkeys(str(item.get("unit")) for item in evidence if item.get("unit") is not None))
            value.get("observations", []).append({
                "id": target_id, "type": "evidence_fallback", "category": None,
                "subject_id": subjects[0] if len(subjects) == 1 else None,
                "statement": " ".join(statements), "value": None,
                "unit": units[0] if len(units) == 1 else None,
                "qualifier": "Deterministically materialized from evidence because the semantic plan referenced this target without emitting its object.",
                "fidelity": "source_supported", "evidence_refs": refs,
            })
            known_ids.add(target_id)
            repairs.append({"kind": "missing_observation_target_materialized", "object_id": target_id, "evidence_refs": refs})

        classified_spatial = {str(source) for item in value.get("features", []) + value.get("layers", []) for source in item.get("source_object_ids", [])}
        classified_spatial |= {str(item.get("source_id")) for item in value.get("unsupported_objects", []) if item.get("source_kind") == "spatial_feature"}
        classified_intervals = {str(source) for item in value.get("intervals", []) for source in item.get("source_object_ids", [])}
        classified_intervals |= {str(item.get("source_id")) for item in value.get("unsupported_objects", []) if item.get("source_kind") == "vertical_interval"}
        for source in prepared["projection"].get("spatial_features", []):
            source_id = str(source.get("feature_id"))
            if source_id and source_id not in classified_spatial:
                value.setdefault("unsupported_objects", []).append({"source_id": source_id, "source_kind": "spatial_feature", "reason": "Semantic planner did not classify this source object; retained explicitly as unsupported rather than dropped.", "evidence_refs": [str(ref) for ref in source.get("evidence_refs", []) if str(ref) in evidence_by_id]})
                repairs.append({"kind": "unclassified_source_object_retained", "source_kind": "spatial_feature", "source_id": source_id})
        for source in prepared["projection"].get("vertical_intervals", []):
            source_id = str(source.get("interval_id"))
            if source_id and source_id not in classified_intervals:
                value.setdefault("unsupported_objects", []).append({"source_id": source_id, "source_kind": "vertical_interval", "reason": "Semantic planner did not classify this source object; retained explicitly as unsupported rather than dropped.", "evidence_refs": [str(ref) for ref in source.get("evidence_refs", []) if str(ref) in evidence_by_id]})
                repairs.append({"kind": "unclassified_source_object_retained", "source_kind": "vertical_interval", "source_id": source_id})
        audit = {"schema_version": "loop2-render-integrity-repair.v1", "repair_count": len(repairs), "repairs": repairs, "policy": {"evidence_deleted": False, "source_object_deleted": False, "coordinates_invented": False, "semantic_claims_invented": False}}
        return value, audit

    def _render_fragment(self, request: DocumentStudyRunRequest, prepared: dict[str, Any], root: Path, batch_id: str, units: list[dict[str, Any]], resume: bool, context_units: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
        path = root / "fragments" / "leaf" / f"{batch_id}.json"
        if resume and path.exists():
            self._progress(root, 2, "batch_reused", f"reused {batch_id}", batch_id=batch_id)
            normalized, audit = self._normalize_local_render_plan(read_json(path), units, prepared.get("semantic_handle_map", {}).get("handle_to_canonical", {}))
            _write(root / "fragments" / "normalization" / f"{batch_id}.json", audit)
            return [normalized]
        context_units = context_units or []
        owned_evidence_ids = sorted({str(unit["evidence_item"]["evidence_id"]) for unit in units if unit.get("kind") == "evidence" and isinstance(unit.get("evidence_item"), dict) and unit["evidence_item"].get("evidence_id")})
        payload = {"study_context": prepared["study_context"], "scope": {"kind": "local_evidence_batch", "batch_id": batch_id, "owned_unit_ids": [str(unit.get("unit_id")) for unit in units], "owned_evidence_ids": owned_evidence_ids, "evidence_ids": owned_evidence_ids, "preceding_context_unit_ids": [str(unit.get("unit_id")) for unit in context_units], "instruction": "Process owned units in source order. Earlier units are context-only for boundary continuity: do not emit dispositions or standalone candidates solely for context-only units."}, "preceding_context_units": context_units, "evidence_units": units}
        prompt = json.dumps(payload, ensure_ascii=False, default=str)
        schema = study_rendering_plan_schema()
        counted = self.client.count_tokens(STUDY_RENDERING_INSTRUCTIONS, prompt, schema)
        maximum = self._soft_token_ceiling()
        if counted > maximum:
            left, right = self._split_render_units(units)
            self._progress(root, 2, "batch_split", f"split {batch_id}: exact input {counted:,} exceeds {maximum:,}", batch_id=batch_id, exact_input_tokens=counted, child_batch_ids=[f"{batch_id}-a", f"{batch_id}-b"])
            right_context = self._preceding_context(context_units + left)
            left_result, right_result = self._parallel_pair(
                lambda: self._render_fragment(request, prepared, root, f"{batch_id}-a", left, resume, context_units),
                lambda: self._render_fragment(request, prepared, root, f"{batch_id}-b", right, resume, right_context),
            )
            return left_result + right_result
        self._progress(root, 2, "batch_started", f"{batch_id} started ({counted:,} input tokens)", batch_id=batch_id, exact_input_tokens=counted, unit_count=len(units))
        try:
            plan = self.client.complete(phase=f"loop2-render-{stable_id('batch', request.document_id, batch_id)}", instructions=STUDY_RENDERING_INSTRUCTIONS, input_content=prompt, schema=schema, max_output_tokens=self.config.max_output_tokens, reasoning_effort="high", cache_key=f"agentic-subsurface:{STUDY_RENDERING_PROMPT_VERSION}:fragment", counted_input_tokens=counted)
        except IncompleteResponse as exc:
            if len(units) <= 1: raise
            left, right = self._split_render_units(units)
            self._event(root.parent.parent, {"event": "render_batch_split", "batch_id": batch_id, "reason": exc.reason, "child_batch_ids": [f"{batch_id}-a", f"{batch_id}-b"], "at": datetime.now(UTC).isoformat()})
            self._progress(root, 2, "batch_split", f"split incomplete {batch_id}: {exc.reason}", batch_id=batch_id, reason=exc.reason, child_batch_ids=[f"{batch_id}-a", f"{batch_id}-b"])
            right_context = self._preceding_context(context_units + left)
            left_result, right_result = self._parallel_pair(
                lambda: self._render_fragment(request, prepared, root, f"{batch_id}-a", left, resume, context_units),
                lambda: self._render_fragment(request, prepared, root, f"{batch_id}-b", right, resume, right_context),
            )
            return left_result + right_result
        plan = self._transport_value(plan, prepared.get("semantic_handle_map", {}).get("handle_to_canonical", {}))
        _write(path, plan)
        plan, audit = self._normalize_local_render_plan(plan, units, prepared.get("semantic_handle_map", {}).get("handle_to_canonical", {}))
        _write(root / "fragments" / "normalization" / f"{batch_id}.json", audit)
        self._progress(root, 2, "batch_completed", f"{batch_id} completed", batch_id=batch_id, exact_input_tokens=counted)
        return [plan]

    def _reconcile_render_plans(self, request: DocumentStudyRunRequest, prepared: dict[str, Any], root: Path, plans: list[dict[str, Any]], resume: bool, level: int = 1) -> dict[str, Any]:
        if len(plans) == 1: return plans[0]

        schema = study_rendering_plan_schema()
        canonical_to_handle = prepared.get("semantic_handle_map", {}).get("canonical_to_handle", {})

        def request_for(group: list[dict[str, Any]], group_index: int) -> tuple[str, int]:
            encoded_group = self._transport_value(group, canonical_to_handle)
            compact_group = self._columnarize(encoded_group)
            if self._decolumnarize(compact_group) != encoded_group: raise ValueError("Stage 2 reconciliation transport failed exact round-trip validation")
            payload = {"study_context": prepared["study_context"], "scope": {"kind": "reconciliation", "level": level, "group": group_index, "instruction": "Return one complete rendering plan using the supplied compact handles. child_plans uses a lossless columnar form: fields names the columns, each row begins with a presence bitmap followed by values for present fields. Preserve every child evidence disposition and grounded candidate; the host restores canonical identifiers."}, "child_plans": compact_group}
            prompt = json.dumps(payload, ensure_ascii=False, default=str)
            return prompt, self.client.count_tokens(STUDY_RENDERING_RECONCILIATION_INSTRUCTIONS, prompt, schema)

        full_prompt, full_count = request_for(plans, 1)
        reconciliation_ceiling = self._reconciliation_ceiling()
        # Reconcile everything in one call when it fits in 256K. Above that,
        # build source-ordered groups in the normal ~128K operating band.
        batch_target = self._soft_token_ceiling()
        if full_count <= reconciliation_ceiling:
            groups = [plans]
            precomputed = {1: (full_prompt, full_count)}
            decision = "single_global_call"
        else:
            groups, current = [], []
            for plan in plans:
                candidate = current + [plan]
                _, candidate_count = request_for(candidate, len(groups) + 1)
                if current and candidate_count > batch_target:
                    groups.append(current); current = [plan]
                else:
                    current = candidate
            if current: groups.append(current)
            # A singleton is already reconciled. Pairing is attempted only to
            # guarantee progress; exact preflight below adaptively splits it.
            if len(groups) >= len(plans):
                groups = [plans[index:index + 2] for index in range(0, len(plans), 2)]
            precomputed = {}
            decision = "split_to_128k_groups"
        workers = min(self.config.max_workers, max(1, len(groups)))
        self._progress(root, 2, "reconciliation_level_started", f"reconciliation level {level}: exact global input={full_count:,}; policy={decision}; {len(plans)} plans -> {len(groups)} groups with {workers} workers", level=level, input_plan_count=len(plans), exact_global_input_tokens=full_count, reconciliation_ceiling_tokens=reconciliation_ceiling, group_target_tokens=batch_target, decision=decision, group_count=len(groups), workers=workers)

        def reconcile_group(index: int, group: list[dict[str, Any]]) -> dict[str, Any]:
            if len(group) == 1: return group[0]
            key = stable_id("reconcile", request.document_id, level, index, *(stable_id("plan", json.dumps(x, sort_keys=True, default=str)) for x in group))
            path = root / "fragments" / "reconciliation" / f"level-{level:02d}-{index:04d}-{key.split(':')[-1]}.json"
            if resume and path.exists():
                self._progress(root, 2, "reconciliation_group_reused", f"reused reconciliation level {level} group {index}", level=level, group=index, child_plan_count=len(group))
                return read_json(path)
            prompt, counted = precomputed.get(index) or request_for(group, index)
            if counted > reconciliation_ceiling:
                if len(group) <= 2: raise ValueError(f"irreducible Stage 2 reconciliation pair exceeds {reconciliation_ceiling:,} tokens")
                midpoint = len(group) // 2
                left_result, right_result = self._parallel_pair(
                    lambda: self._reconcile_render_plans(request, prepared, root, group[:midpoint], resume, level + 1),
                    lambda: self._reconcile_render_plans(request, prepared, root, group[midpoint:], resume, level + 1),
                )
                return self._reconcile_render_plans(request, prepared, root, [left_result, right_result], resume, level + 1)
            self._progress(root, 2, "reconciliation_group_started", f"reconciliation level {level} group {index} started ({counted:,} input tokens)", level=level, group=index, child_plan_count=len(group), exact_input_tokens=counted)
            try:
                result = self.client.complete(phase=f"loop2-render-reconcile-{request.document_id}-{level:02d}-{index:04d}", instructions=STUDY_RENDERING_RECONCILIATION_INSTRUCTIONS, input_content=prompt, schema=schema, max_output_tokens=self.config.max_output_tokens, reasoning_effort="high", cache_key=f"agentic-subsurface:{STUDY_RENDERING_RECONCILIATION_PROMPT_VERSION}", counted_input_tokens=counted)
            except IncompleteResponse as exc:
                if len(group) <= 2: raise
                midpoint = len(group) // 2
                left_result, right_result = self._parallel_pair(
                    lambda: self._reconcile_render_plans(request, prepared, root, group[:midpoint], resume, level + 1),
                    lambda: self._reconcile_render_plans(request, prepared, root, group[midpoint:], resume, level + 1),
                )
                result = self._reconcile_render_plans(request, prepared, root, [left_result, right_result], resume, level + 1)
                self._progress(root, 2, "reconciliation_group_split", f"split incomplete reconciliation level {level} group {index}: {exc.reason}", level=level, group=index, reason=exc.reason)
            result = self._transport_value(result, prepared.get("semantic_handle_map", {}).get("handle_to_canonical", {}))
            _write(path, result)
            self._progress(root, 2, "reconciliation_group_completed", f"reconciliation level {level} group {index} completed", level=level, group=index, exact_input_tokens=counted)
            return result

        reconciled: dict[int, dict[str, Any]] = {}
        with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="loop2-render-reconcile") as pool:
            futures = {pool.submit(reconcile_group, index, group): index for index, group in enumerate(groups, 1)}
            for future in as_completed(futures): reconciled[futures[future]] = future.result()
        next_level = [reconciled[index] for index in sorted(reconciled)]
        self._progress(root, 2, "reconciliation_level_completed", f"reconciliation level {level} completed: {len(next_level)} plans remain", level=level, output_plan_count=len(next_level))
        return next_level[0] if len(next_level) == 1 else self._reconcile_render_plans(request, prepared, root, next_level, resume, level + 1)

    @staticmethod
    def _materialize_render_plan(request: DocumentStudyRunRequest, prepared: dict[str, Any], plan: dict[str, Any]) -> dict[str, Any]:
        evidence_ids = set(prepared["evidence_index"]["evidence_ids"])
        assets = {str(item.get("asset_id") or item.get("visual_id")): item for item in prepared.get("native_assets", []) if item.get("asset_id") or item.get("visual_id")}
        dispositions = plan.get("evidence_dispositions", [])
        counts = Counter(str(item.get("evidence_id")) for item in dispositions)
        missing = sorted(evidence_ids - set(counts)); duplicate = sorted(key for key, count in counts.items() if count > 1); unknown = sorted(set(counts) - evidence_ids)
        issues = []
        if missing: issues.append({"path": "evidence_dispositions", "message": f"missing {len(missing)} evidence IDs", "sample": missing[:20]})
        if duplicate: issues.append({"path": "evidence_dispositions", "message": f"duplicate {len(duplicate)} evidence IDs", "sample": duplicate[:20]})
        if unknown: issues.append({"path": "evidence_dispositions", "message": f"unknown {len(unknown)} evidence IDs", "sample": unknown[:20]})

        def valid_refs(item: dict[str, Any], path: str) -> list[str]:
            refs = [str(ref) for ref in item.get("evidence_refs", [])]
            bad = sorted(set(refs) - evidence_ids)
            if bad: issues.append({"path": path, "message": "unknown evidence references", "sample": bad[:20]})
            return [ref for ref in refs if ref in evidence_ids]

        features = []
        raw_spatial = {str(item.get("feature_id")): item for item in prepared["projection"].get("spatial_features", []) if item.get("feature_id")}
        evidence_by_id = prepared["evidence_index"]["by_id"]

        def evidence_contains_number(value: Any, target: float) -> bool:
            if isinstance(value, (int, float)) and not isinstance(value, bool): return abs(float(value) - target) < 1e-9
            if isinstance(value, dict): return any(evidence_contains_number(child, target) for child in value.values())
            if isinstance(value, list): return any(evidence_contains_number(child, target) for child in value)
            if isinstance(value, str):
                import re
                for token in re.findall(r"[-+]?\d+(?:\.\d+)?", value):
                    try:
                        if abs(float(token) - target) < 1e-9: return True
                    except ValueError: pass
            return False

        def evidence_contains_geometry(value: Any, target: dict[str, Any]) -> bool:
            if isinstance(value, dict):
                if DocumentLoop2Processor._geometry(value) == target: return True
                return any(evidence_contains_geometry(child, target) for child in value.values())
            if isinstance(value, list): return any(evidence_contains_geometry(child, target) for child in value)
            if isinstance(value, str) and value.lstrip().startswith("{"):
                try: return evidence_contains_geometry(json.loads(value), target)
                except json.JSONDecodeError: return False
            return False

        for index, raw in enumerate(plan.get("features", [])):
            refs = valid_refs(raw, f"features[{index}]")
            coordinate_refs = [str(ref) for ref in raw.get("coordinate_evidence_refs", [])]
            if set(coordinate_refs) - set(refs): issues.append({"path": f"features[{index}].coordinate_evidence_refs", "message": "coordinate references must also be feature evidence references"})
            geometry = DocumentLoop2Processor._geometry(raw.get("geometry_json"))
            lat, lon = raw.get("latitude"), raw.get("longitude")
            if geometry is None and isinstance(lat, (int, float)) and isinstance(lon, (int, float)) and -90 <= lat <= 90 and -180 <= lon <= 180: geometry = {"type": "Point", "coordinates": [lon, lat]}
            if geometry is not None:
                grounded = False
                for source_id in raw.get("source_object_ids", []):
                    source = raw_spatial.get(str(source_id))
                    if not source: continue
                    source_geometry = DocumentLoop2Processor._geometry(source.get("geometry_json") or source.get("geometry"))
                    if source_geometry == geometry: grounded = True
                    if geometry.get("type") == "Point" and source.get("latitude") == geometry["coordinates"][1] and source.get("longitude") == geometry["coordinates"][0]: grounded = True
                cited_evidence = [evidence_by_id[ref] for ref in coordinate_refs if ref in evidence_by_id]
                if geometry.get("type") == "Point":
                    longitude, latitude = geometry["coordinates"][:2]
                    if any(evidence_contains_number(item, float(latitude)) for item in cited_evidence) and any(evidence_contains_number(item, float(longitude)) for item in cited_evidence): grounded = True
                elif any(evidence_contains_geometry(item, geometry) for item in cited_evidence): grounded = True
                if not coordinate_refs or not grounded: issues.append({"path": f"features[{index}].geometry", "message": "geometry lacks an exact source-object and coordinate-evidence provenance chain"})
            asset_id = raw.get("source_asset_id")
            if asset_id is not None and str(asset_id) not in assets: issues.append({"path": f"features[{index}].source_asset_id", "message": f"unknown native asset {asset_id}"})
            features.append({"id": str(raw["id"]), "name": raw["name"], "type": raw["type"], "geometry": geometry, "location_description": raw.get("location_description"), "properties": raw.get("properties", []), "source_refs": refs, "dataset_ids": [str(asset_id)] if asset_id else [], "fidelity": raw.get("fidelity", "reported"), "source_object_ids": raw.get("source_object_ids", [])})

        feature_ids = {item["id"] for item in features}
        profiles = [{**item, "source_refs": valid_refs(item, f"vertical_profiles[{index}]")} for index, item in enumerate(plan.get("vertical_profiles", []))]
        profile_ids = {str(item["id"]) for item in profiles}
        resources = []
        for index, item in enumerate(plan.get("structured_resources", [])):
            aid = str(item.get("source_asset_id"))
            asset = assets.get(aid)
            if asset is None: issues.append({"path": f"structured_resources[{index}].source_asset_id", "message": f"unknown native asset {aid}"}); continue
            resources.append({**item, "source_refs": valid_refs(item, f"structured_resources[{index}]"), "path": asset.get("path"), "resolved_path": asset.get("resolved_path"), "row_count": asset.get("row_count"), "columns": asset.get("columns", [])})
        resource_ids = {str(item["id"]) for item in resources}
        layers = []
        for index, item in enumerate(plan.get("layers", [])):
            source_assets = [str(value) for value in item.get("source_asset_ids", [])]
            bad_assets = sorted(set(source_assets) - set(assets))
            if bad_assets: issues.append({"path": f"layers[{index}].source_asset_ids", "message": "unknown native assets", "sample": bad_assets})
            bad_members = sorted((set(item.get("feature_ids", [])) - feature_ids) | (set(item.get("profile_ids", [])) - profile_ids) | (set(item.get("resource_ids", [])) - resource_ids))
            if bad_members: issues.append({"path": f"layers[{index}]", "message": "unknown member IDs", "sample": bad_members})
            materialized = {**item, "source_refs": valid_refs(item, f"layers[{index}]")}
            if len(source_assets) == 1:
                asset = assets.get(source_assets[0], {})
                materialized.update({"source_asset_id": source_assets[0], "path": asset.get("path"), "resolved_path": asset.get("resolved_path"), "format": "geojson" if str(asset.get("path", "")).lower().endswith(".geojson") else str(asset.get("kind", "native")), "delivery_mode": "file", "feature_count": asset.get("feature_count"), "geometry_types": sorted((asset.get("geometry_type_counts") or {}).keys())})
            layers.append(materialized)

        intervals = [{**item, "source_refs": valid_refs(item, f"intervals[{index}]")} for index, item in enumerate(plan.get("intervals", []))]
        observations = [{**item, "source_refs": valid_refs(item, f"observations[{index}]")} for index, item in enumerate(plan.get("observations", []))]
        planned_ids = [str(item["id"]) for collection in (layers, features, profiles, resources, intervals, observations) for item in collection]
        duplicate_ids = sorted(value for value, count in Counter(planned_ids).items() if count > 1)
        if duplicate_ids: issues.append({"path": "rendering_objects", "message": "duplicate model-authored object IDs", "sample": duplicate_ids[:20]})
        known_target_ids = feature_ids | profile_ids | resource_ids | {str(item["id"]) for item in layers} | {str(item["id"]) for item in intervals} | {str(item["id"]) for item in observations}
        for index, disposition in enumerate(dispositions):
            target_ids = {str(value) for value in disposition.get("target_ids", [])}
            bad_targets = sorted(target_ids - known_target_ids)
            if bad_targets: issues.append({"path": f"evidence_dispositions[{index}].target_ids", "message": "unknown rendering targets", "sample": bad_targets[:20]})
            if disposition.get("disposition") == "rendered" and not target_ids:
                issues.append({"path": f"evidence_dispositions[{index}]", "message": "rendered evidence requires at least one target ID"})
        source_spatial_ids = {str(item.get("feature_id")) for item in prepared["projection"].get("spatial_features", []) if item.get("feature_id")}
        source_interval_ids = {str(item.get("interval_id")) for item in prepared["projection"].get("vertical_intervals", []) if item.get("interval_id")}
        rendered_declared_source_ids = {str(value) for item in plan.get("features", []) + plan.get("layers", []) for value in item.get("source_object_ids", [])} & source_spatial_ids
        unsupported_spatial_ids = {str(item.get("source_id")) for item in plan.get("unsupported_objects", []) if item.get("source_kind") == "spatial_feature"} & source_spatial_ids
        classified_source_ids = rendered_declared_source_ids | unsupported_spatial_ids
        rendered_interval_ids = {str(value) for item in plan.get("intervals", []) for value in item.get("source_object_ids", [])} & source_interval_ids
        unsupported_interval_ids = {str(item.get("source_id")) for item in plan.get("unsupported_objects", []) if item.get("source_kind") == "vertical_interval"} & source_interval_ids
        classified_interval_ids = rendered_interval_ids | unsupported_interval_ids
        missing_spatial = sorted(source_spatial_ids - classified_source_ids); missing_intervals = sorted(source_interval_ids - classified_interval_ids)
        if missing_spatial: issues.append({"path": "coverage.spatial_features", "message": f"unclassified {len(missing_spatial)} Loop 1 spatial features", "sample": missing_spatial[:20]})
        if missing_intervals: issues.append({"path": "coverage.vertical_intervals", "message": f"unclassified {len(missing_intervals)} Loop 1 intervals", "sample": missing_intervals[:20]})
        contradictory_spatial = sorted(unsupported_spatial_ids & rendered_declared_source_ids)
        if contradictory_spatial: issues.append({"path": "coverage.spatial_features", "message": "source spatial features are both rendered and unsupported", "sample": contradictory_spatial[:20]})
        if issues: raise ValueError(f"Stage 2 LLM rendering plan failed deterministic validation: {issues[:5]}")

        rendered_refs = {ref for collection in (layers, features, profiles, resources, intervals, observations) for item in collection for ref in item.get("source_refs", [])}
        by_disposition = Counter(item["disposition"] for item in dispositions)
        capabilities = {"map": bool(features or layers), "native_vector_layers": any(item.get("source_asset_ids") for item in layers), "generated_features": bool(features), "vertical_profiles": bool(profiles), "structured_resources": bool(resources), "feature_selection": bool(features), "layer_selection": bool(layers), "report": True}
        targets = [{"id": stable_id("target", request.document_id, "study"), "kind": "study", "object_id": request.study_id, "priority": "primary", "source_refs": []}]
        targets += [{"id": stable_id("target", item["id"]), "kind": "layer", "object_id": item["id"], "priority": "primary", "source_refs": item.get("source_refs", [])} for item in layers]
        targets += [{"id": stable_id("target", item["id"]), "kind": "vertical_profile", "object_id": item["id"], "priority": "primary", "source_refs": item.get("source_refs", [])} for item in profiles]
        targets += [{"id": stable_id("target", item["id"]), "kind": "feature", "object_id": item["id"], "priority": "secondary", "source_refs": item.get("source_refs", [])} for item in features if item.get("source_refs")]
        native_source_ids = {str(value) for item in plan.get("layers", []) if item.get("source_asset_ids") for value in item.get("source_object_ids", [])} & source_spatial_ids
        rendered_source_ids = ({str(value) for item in plan.get("features", []) + [layer for layer in plan.get("layers", []) if not layer.get("source_asset_ids")] for value in item.get("source_object_ids", [])} & source_spatial_ids) - native_source_ids
        nonrendered_source_ids = unsupported_spatial_ids - native_source_ids - rendered_source_ids
        coverage = {"loop1_spatial_features": len(source_spatial_ids), "renderable_features": len(rendered_source_ids), "native_layer_backed_concepts": len(native_source_ids), "non_renderable_spatial_concepts": len(nonrendered_source_ids), "quarantined_spatial_concepts": 0, "dropped_spatial_features": 0, "loop1_vertical_intervals": len(source_interval_ids), "rendered_intervals": len(rendered_interval_ids), "unsupported_intervals": len(unsupported_interval_ids), "dropped_intervals": 0, "loop1_evidence_items": len(evidence_ids), "evidence_linked_to_ui": len(rendered_refs), "evidence_retained_for_report": by_disposition["report_only"] + by_disposition["narrative_only"], "unsupported_evidence_items": by_disposition["unsupported"], "quarantined_evidence_items": by_disposition["quarantined"], "discarded_evidence_items": 0, "evidence_dispositions": dict(by_disposition)}
        return {"schema_version": "study-rendering.v2", "materialization_version": RENDER_MATERIALIZATION_VERSION, "study": {"id": request.study_id, "document_id": request.document_id, "title": plan["title"], "short_title": plan["short_title"], "domain": plan["domain"], "summary": plan["summary"]}, "primary_rendering_mode": plan["primary_rendering_mode"], "capabilities": capabilities, "layers": layers, "features": features, "observations": observations, "vertical_profiles": profiles, "intervals": intervals, "structured_resources": resources, "narrative_targets": targets, "non_renderable": {"objects": plan.get("unsupported_objects", [])}, "evidence_sidecar": {"dispositions": dispositions, "report_evidence_ids": sorted(item["evidence_id"] for item in dispositions if item["disposition"] in {"report_only", "narrative_only"})}, "coverage": coverage, "limitations": list(dict.fromkeys(prepared["projection"].get("limitations", []) + plan.get("limitations", []))), "semantic_presentation": {"source": "llm_rendering_plan"}}

    def _render(self, request: DocumentStudyRunRequest, prepared: dict[str, Any], target: Path, resume: bool) -> dict[str, Any]:
        if resume and target.exists():
            existing = read_json(target)
            if existing.get("materialization_version") == RENDER_MATERIALIZATION_VERSION: return existing
            self._progress(target.parent, 2, "materialization_upgrade", f"rebuilding deterministic rendering materialization for {RENDER_MATERIALIZATION_VERSION} from model checkpoints", prior_materialization_version=existing.get("materialization_version"), materialization_version=RENDER_MATERIALIZATION_VERSION)
        if not self.config.live: raise RuntimeError("Loop 2 Stage 2 is an LLM semantic rendering stage; rerun with --live")
        root = target.parent
        units = self._render_evidence_units(prepared)
        batches = self._pack_render_units(prepared, units)
        batch_contexts: list[list[dict[str, Any]]] = []
        preceding: list[dict[str, Any]] = []
        for batch in batches:
            batch_contexts.append(self._preceding_context(preceding))
            preceding.extend(batch)
        _write(root / "evidence_units.json", units)
        _write(root / "batch_manifest.json", {"schema_version": "loop2-render-batches.v2", "ordering": "source_position", "overlap_policy": "preceding_context_only", "unit_count": len(units), "batch_count": len(batches), "batches": [{"batch_id": f"batch-{index:04d}", "unit_count": len(batch), "owned_unit_ids": [unit["unit_id"] for unit in batch], "preceding_context_unit_ids": [unit["unit_id"] for unit in batch_contexts[index - 1]], "evidence_ids": sorted(str(unit["evidence_item"]["evidence_id"]) for unit in batch if unit.get("kind") == "evidence" and isinstance(unit.get("evidence_item"), dict) and unit["evidence_item"].get("evidence_id")), "estimated_tokens": self._estimated_tokens(batch) + self._estimated_tokens(batch_contexts[index - 1])} for index, batch in enumerate(batches, 1)]})
        workers = min(self.config.max_workers, max(1, len(batches)))
        self._progress(root, 2, "batching_completed", f"prepared {len(batches)} evidence batches from {len(units)} units; workers={workers}; target≈{self.config.target_batch_tokens:,} tokens", batch_count=len(batches), unit_count=len(units), workers=workers, target_tokens=self.config.target_batch_tokens)
        fragments_by_batch: dict[int, list[dict[str, Any]]] = {}
        with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="loop2-render") as pool:
            futures = {pool.submit(self._render_fragment, request, prepared, root, f"batch-{index:04d}", batch, resume, batch_contexts[index - 1]): index for index, batch in enumerate(batches, 1)}
            for completed, future in enumerate(as_completed(futures), 1):
                fragments_by_batch[futures[future]] = future.result()
                self._progress(root, 2, "batch_progress", f"initial rendering batches completed: {completed}/{len(batches)}", completed=completed, total=len(batches))
        fragments = [fragment for index in sorted(fragments_by_batch) for fragment in fragments_by_batch[index]]
        _write(root / "fragment_manifest.json", {"leaf_fragment_count": len(fragments)})
        semantic_plan = self._reconcile_render_plans(request, prepared, root, fragments, resume)
        _write(root / "semantic_reconciliation_plan.json", semantic_plan)
        plan, assembly_audit = self._assemble_render_plans(fragments, semantic_plan)
        _write(root / "assembled_rendering_plan.json", plan)
        plan, integrity_repair_audit = self._repair_render_plan_integrity(plan, prepared)
        _write(root / "reconciliation_assembly_audit.json", assembly_audit)
        _write(root / "integrity_repair_audit.json", integrity_repair_audit)
        _write(root / "reconciled_rendering_plan.json", plan)
        self._progress(root, 2, "reconciliation_completed", "rendering reconciliation completed; deterministic validation started", leaf_fragment_count=len(fragments))
        rendering = self._materialize_render_plan(request, prepared, plan)
        _write(root / "renderable_features.json", rendering["features"])
        _write(root / "native_layers.json", [item for item in rendering["layers"] if item.get("source_asset_ids")])
        _write(root / "vertical_profiles.json", rendering["vertical_profiles"])
        _write(root / "structured_resources.json", rendering["structured_resources"])
        _write(root / "narrative_target_registry.json", rendering["narrative_targets"])
        _write(root / "renderability_registry.json", rendering["non_renderable"])
        _write(root / "coverage_audit.json", rendering["coverage"])
        _write(target, rendering)
        self._progress(root, 2, "validation_completed", "rendering package validated and written", features=len(rendering["features"]), layers=len(rendering["layers"]), profiles=len(rendering["vertical_profiles"]), discarded_evidence_items=rendering["coverage"].get("discarded_evidence_items"))
        return rendering

    def _narrate(self, rendering: dict[str, Any], prepared: dict[str, Any], target: Path, resume: bool) -> dict[str, Any]:
        by_id, evidence = prepared["evidence_index"]["by_id"], prepared["projection"]["evidence_items"]
        objects = {str(x["id"]): x for x in rendering.get("features", []) if isinstance(x, dict) and x.get("id") and isinstance(x.get("geometry"), dict)}
        jobs: list[dict[str, Any]] = []
        excluded = Counter()
        for narrative_target in rendering.get("narrative_targets", []):
            tid, oid, kind = str(narrative_target["id"]), str(narrative_target["object_id"]), str(narrative_target["kind"])
            if kind != "feature": excluded["not_individual_feature"] += 1; continue
            obj = objects.get(oid)
            if obj is None: excluded["feature_without_valid_geometry"] += 1; continue
            refs = {str(x) for x in narrative_target.get("source_refs", [])}
            refs.update(str(x) for x in obj.get("source_refs", []))
            linked_observations = [x for x in rendering.get("observations", []) if str(x.get("feature_id")) == oid or bool(refs & set(map(str, x.get("source_refs", []))))]
            linked_profiles = [x for x in rendering.get("vertical_profiles", []) if str(x.get("feature_id")) == oid]
            linked_interval_ids = set(map(str, obj.get("interval_ids", [])))
            for profile in linked_profiles: linked_interval_ids.update(map(str, profile.get("interval_ids", [])))
            linked_intervals = [x for x in rendering.get("intervals", []) if str(x.get("feature_id")) == oid or str(x.get("id")) in linked_interval_ids or bool(refs & set(map(str, x.get("source_refs", []))))]
            linked_layers = [x for x in rendering.get("layers", []) if oid in set(map(str, x.get("feature_ids", [])))]
            for item in linked_observations + linked_profiles + linked_intervals + linked_layers:
                refs.update(map(str, item.get("source_refs", [])))
            direct = [by_id[x] for x in refs if x in by_id]
            if not direct:
                terms = {str(obj.get("name", obj.get("title", ""))).lower(), str(obj.get("type", obj.get("kind", ""))).lower()} - {""}
                direct = [x for x in evidence if any(t and t in json.dumps(x, ensure_ascii=False).lower() for t in terms)][:30]
            context = {"target_kind": kind, "target": obj, "observations": linked_observations[:30], "vertical_profiles": linked_profiles[:10], "intervals": linked_intervals[:50], "layers": linked_layers[:10], "evidence_items": direct[:50]}
            jobs.append({"target_id": tid, "target_kind": kind, "object_id": oid, "context": context, "path": target.parent / "fragments" / f"{stable_id('target', tid)}.json"})
        _write(target.parent / "eligibility_audit.json", {"schema_version": "loop2-narrative-eligibility.v1", "policy": "only individually selectable features with deterministically valid geometry", "rendering_target_count": len(rendering.get("narrative_targets", [])), "eligible_feature_count": len(jobs), "excluded": dict(excluded), "model_call_required": bool(jobs)})

        generated: dict[str, dict[str, Any]] = {}
        pending = []
        for job in jobs:
            if resume and job["path"].exists(): generated[job["target_id"]] = read_json(job["path"])
            else: pending.append(job)

        if not self.config.live:
            for job in pending:
                context = job["context"]
                item = {"status": "limited", "headline": str(context["target"].get("name") or context["target"].get("title") or job["object_id"]), "summary": "", "why_it_matters": "", "visual_takeaway": "", "insights": [], "secondary_context": None, "evidence_refs": [], "limitations": ["live=false"], "target_id": job["target_id"], "target_kind": job["target_kind"], "object_id": job["object_id"]}
                _write(job["path"], item); generated[job["target_id"]] = item
        else:
            schema = study_target_narrative_batch_schema()
            canonical_to_handle = prepared.get("semantic_handle_map", {}).get("canonical_to_handle", {})
            handle_to_canonical = prepared.get("semantic_handle_map", {}).get("handle_to_canonical", {})
            target_tokens = int(getattr(self.config, "target_batch_tokens", 128_000))
            maximum = self._soft_token_ceiling()
            overhead = self._estimated_tokens({"study_context": prepared["study_context"]}) + 2_000
            batches: list[list[dict[str, Any]]] = []
            current: list[dict[str, Any]] = []
            current_tokens = overhead
            for job in pending:
                weight = self._estimated_tokens({"target_id": job["target_id"], **job["context"]}) + 40
                if current and current_tokens + weight > target_tokens:
                    batches.append(current); current, current_tokens = [], overhead
                current.append(job); current_tokens += weight
            if current: batches.append(current)
            _write(target.parent / "batch_manifest.json", {"schema_version": "loop2-narrative-batches.v1", "target_count": len(jobs), "pending_target_count": len(pending), "batch_count": len(batches), "target_batch_tokens": target_tokens, "batches": [{"batch_id": f"batch-{index:04d}", "target_ids": [job["target_id"] for job in batch], "estimated_tokens": overhead + sum(self._estimated_tokens(job["context"]) + 40 for job in batch)} for index, batch in enumerate(batches, 1)]})
            workers = min(self.config.max_workers, max(1, len(batches)))
            self._progress(target.parent, 3, "batching_completed", f"prepared {len(batches)} narrative batches for {len(pending)} pending targets; workers={workers}; target≈{target_tokens:,} tokens", batch_count=len(batches), pending_targets=len(pending), workers=workers, target_tokens=target_tokens)

            def split_jobs(batch: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
                if len(batch) <= 1: raise ValueError("cannot split an irreducible Stage 3 narrative target")
                weights = [self._estimated_tokens(job["context"]) for job in batch]
                threshold, running, midpoint = sum(weights) / 2, 0, 1
                for index, weight in enumerate(weights[:-1], 1):
                    running += weight; midpoint = index
                    if running >= threshold: break
                return batch[:midpoint], batch[midpoint:]

            def generate_batch(batch_id: str, batch: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
                payload = {"study_context": prepared["study_context"], "targets": [{"target_id": job["target_id"], **self._transport_value(job["context"], canonical_to_handle)} for job in batch]}
                prompt = json.dumps(payload, ensure_ascii=False, default=str)
                counted = self.client.count_tokens(STUDY_NARRATIVE_INSTRUCTIONS, prompt, schema)
                if counted > maximum:
                    left, right = split_jobs(batch)
                    self._progress(target.parent, 3, "batch_split", f"split narrative {batch_id}: exact input {counted:,} exceeds {maximum:,}", batch_id=batch_id, exact_input_tokens=counted)
                    return {**generate_batch(f"{batch_id}-a", left), **generate_batch(f"{batch_id}-b", right)}
                self._progress(target.parent, 3, "batch_started", f"{batch_id} started ({counted:,} input tokens)", batch_id=batch_id, exact_input_tokens=counted, target_count=len(batch))
                try:
                    response = self.client.complete(phase=f"loop2-narrative-{batch_id}", instructions=STUDY_NARRATIVE_INSTRUCTIONS, input_content=prompt, schema=schema, max_output_tokens=self.config.max_output_tokens, reasoning_effort="high", cache_key=f"agentic-subsurface:{STUDY_NARRATIVE_PROMPT_VERSION}", counted_input_tokens=counted)
                except IncompleteResponse as exc:
                    left, right = split_jobs(batch)
                    self._progress(target.parent, 3, "batch_split", f"split incomplete narrative {batch_id}: {exc.reason}", batch_id=batch_id, reason=exc.reason)
                    return {**generate_batch(f"{batch_id}-a", left), **generate_batch(f"{batch_id}-b", right)}
                requested = {job["target_id"]: job for job in batch}
                returned = [self._transport_value(item, handle_to_canonical) for item in response.get("narratives", []) if isinstance(item, dict)]
                counts = Counter(str(item.get("target_id")) for item in returned)
                if set(counts) != set(requested) or any(count != 1 for count in counts.values()):
                    raise ValueError(f"Stage 3 batch {batch_id} did not return exactly one narrative for every target")
                result = {}
                for item in returned:
                    tid = str(item["target_id"]); job = requested[tid]; context = job["context"]
                    allowed = set(by_id) & {str(x.get("evidence_id")) for x in context["evidence_items"]}
                    invalid = sorted(set(map(str, item.get("evidence_refs", []))) - allowed)
                    for insight in item.get("insights", []): invalid.extend(sorted(set(map(str, insight.get("evidence_refs", []))) - allowed))
                    if invalid: raise ValueError(f"Stage 3 batch {batch_id} returned unsupported evidence refs for {tid}: {sorted(set(invalid))[:10]}")
                    item.update({"status": "complete" if item.get("summary") or item.get("insights") else "limited", "target_kind": job["target_kind"], "object_id": job["object_id"]})
                    _write(job["path"], item); result[tid] = item
                self._progress(target.parent, 3, "batch_completed", f"{batch_id} completed", batch_id=batch_id, exact_input_tokens=counted, target_count=len(batch))
                return result

            with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="loop2-narrative") as pool:
                futures = {pool.submit(generate_batch, f"batch-{index:04d}", batch): index for index, batch in enumerate(batches, 1)}
                for completed, future in enumerate(as_completed(futures), 1):
                    generated.update(future.result())
                    self._progress(target.parent, 3, "batch_progress", f"narrative batches completed: {completed}/{len(batches)}", completed=completed, total=len(batches))

        missing_targets = sorted({job["target_id"] for job in jobs} - set(generated))
        if missing_targets:
            _write(target.parent / "reconciliation_audit.json", {"valid": False, "strategy": "deterministic target-id reconciliation", "eligible_targets": len(jobs), "reconciled_targets": len(generated), "missing_targets": missing_targets, "duplicate_targets": []})
            raise ValueError(f"Stage 3 narrative target reconciliation is missing {len(missing_targets)} targets")
        items = [generated[job["target_id"]] for job in jobs]
        by_kind = dict(Counter(x["target_kind"] for x in items))
        duplicate_targets = sorted(target_id for target_id, count in Counter(item.get("target_id") for item in items).items() if count > 1)
        _write(target.parent / "reconciliation_audit.json", {"valid": not missing_targets and not duplicate_targets, "strategy": "deterministic target-id reconciliation; targets are independent and model batches return exactly one narrative per target", "eligible_targets": len(jobs), "reconciled_targets": len(items), "missing_targets": missing_targets, "duplicate_targets": duplicate_targets})
        if missing_targets or duplicate_targets: raise ValueError("Stage 3 narrative target reconciliation failed")
        value = {"schema_version": "ui-narrative.v2", "study_id": rendering["study"]["id"], "audience": "general_nontechnical", "target_insights": items, "coverage": {"eligibility_policy": "features_with_valid_geometry_only", "eligible_targets": len(jobs), "targets_with_narratives": sum(bool(x.get("summary") or x.get("insights")) for x in items), "limited_targets": sum(x.get("status") == "limited" for x in items), "targets_by_kind": by_kind, "empty_reason": "no_individually_renderable_features" if not jobs else None}, "limitations": ["live=false"] if not self.config.live else []}
        _write(target, value)
        self._progress(target.parent, 3, "reconciliation_completed", f"reconciled {len(items)} narratives by immutable target ID", target_count=len(items))
        return value

    def _report(self, request: DocumentStudyRunRequest, rendering: dict[str, Any], prepared: dict[str, Any], target: Path, resume: bool) -> dict[str, Any]:
        if resume and target.exists(): return read_json(target)
        if self.config.live:
            projection = prepared["projection"]
            canonical_to_handle = prepared.get("semantic_handle_map", {}).get("canonical_to_handle", {})
            handle_to_canonical = prepared.get("semantic_handle_map", {}).get("handle_to_canonical", {})
            compact_rendering = {"study": rendering.get("study"), "primary_rendering_mode": rendering.get("primary_rendering_mode"), "capabilities": rendering.get("capabilities"), "layers": [{k: x.get(k) for k in ("id", "name", "kind", "feature_count", "semantic_category")} for x in rendering.get("layers", [])], "vertical_profiles": [{k: x.get(k) for k in ("id", "name", "feature_id", "axis", "reference")} for x in rendering.get("vertical_profiles", [])], "coverage": rendering.get("coverage")}
            target_tokens = int(getattr(self.config, "target_batch_tokens", 128_000))
            maximum = self._soft_token_ceiling()
            overhead = self._estimated_tokens({"study_context": prepared["study_context"], "ui_rendering_summary": compact_rendering}) + 2_000
            units = self._render_evidence_units(prepared)
            batches: list[list[dict[str, Any]]] = []
            current: list[dict[str, Any]] = []
            current_tokens = overhead
            for unit in units:
                weight = self._estimated_tokens(unit) + 40
                if current and current_tokens + weight > target_tokens:
                    batches.append(current); current, current_tokens = [], overhead
                current.append(unit); current_tokens += weight
            if current or not batches: batches.append(current)

            def split_units(batch: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
                if len(batch) <= 1: raise ValueError("cannot split an irreducible Stage 4 report evidence unit")
                weights = [self._estimated_tokens(unit) for unit in batch]
                threshold, running, midpoint = sum(weights) / 2, 0, 1
                for index, weight in enumerate(weights[:-1], 1):
                    running += weight; midpoint = index
                    if running >= threshold: break
                return batch[:midpoint], batch[midpoint:]

            batch_contexts: list[list[dict[str, Any]]] = []
            preceding: list[dict[str, Any]] = []
            for batch in batches:
                batch_contexts.append(self._preceding_context(preceding)); preceding.extend(batch)
            batch_manifest = {"schema_version": "study-report-batches.v3", "ordering": "source_position", "input_representation": "stage1_semantic_transport", "overlap_policy": "preceding_context_only", "unit_count": len(units), "batch_count": len(batches), "target_batch_tokens": target_tokens, "batches": [{"batch_id": f"batch-{index:04d}", "owned_unit_ids": [unit["unit_id"] for unit in batch], "preceding_context_unit_ids": [unit["unit_id"] for unit in batch_contexts[index - 1]], "estimated_tokens": overhead + sum(self._estimated_tokens(unit) + 40 for unit in batch) + self._estimated_tokens(batch_contexts[index - 1])} for index, batch in enumerate(batches, 1)]}
            _write(target.parent / "batches.json", batch_manifest)
            workers = min(self.config.max_workers, max(1, len(batches)))
            self._progress(target.parent, 4, "batching_completed", f"prepared {len(batches)} report evidence batches from {len(units)} units; workers={workers}; target≈{target_tokens:,} tokens", batch_count=len(batches), unit_count=len(units), workers=workers, target_tokens=target_tokens)

            def generate_fragment(batch_id: str, batch: list[dict[str, Any]], context_units: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
                fragment_path = target.parent / "fragments" / "leaf" / f"{batch_id}.json"
                if resume and fragment_path.exists(): return [read_json(fragment_path)]
                context_units = context_units or []
                payload = {"study_context": prepared["study_context"], "ui_rendering_summary": self._transport_value(compact_rendering, canonical_to_handle), "scope": {"batch_id": batch_id, "owned_unit_ids": [unit["unit_id"] for unit in batch], "preceding_context_unit_ids": [unit["unit_id"] for unit in context_units], "instruction": "Analyze owned units in source order as one part of this document. Preceding units are context-only for boundary continuity: do not create a standalone finding solely from context-only material. Preserve supplied evidence handles and do not claim whole-document completeness."}, "preceding_context_units": context_units, "evidence_units": batch}
                prompt = json.dumps(payload, ensure_ascii=False, default=str)
                schema = report_schema()
                counted = self.client.count_tokens(STUDY_REPORT_INSTRUCTIONS, prompt, schema)
                if counted > maximum:
                    left, right = split_units(batch)
                    self._progress(target.parent, 4, "batch_split", f"split report {batch_id}: exact input {counted:,} exceeds {maximum:,}", batch_id=batch_id, exact_input_tokens=counted)
                    right_context = self._preceding_context(context_units + left)
                    return generate_fragment(f"{batch_id}-a", left, context_units) + generate_fragment(f"{batch_id}-b", right, right_context)
                self._progress(target.parent, 4, "batch_started", f"{batch_id} started ({counted:,} input tokens)", batch_id=batch_id, exact_input_tokens=counted, unit_count=len(batch))
                try:
                    fragment = self.client.complete(phase=f"loop2-report-local-{request.document_id}-{batch_id}", instructions=STUDY_REPORT_INSTRUCTIONS, input_content=prompt, schema=schema, max_output_tokens=self.config.max_output_tokens, reasoning_effort="high", cache_key=f"agentic-subsurface:{STUDY_REPORT_PROMPT_VERSION}:fragment", counted_input_tokens=counted)
                except IncompleteResponse as exc:
                    left, right = split_units(batch)
                    self._progress(target.parent, 4, "batch_split", f"split incomplete report {batch_id}: {exc.reason}", batch_id=batch_id, reason=exc.reason)
                    right_context = self._preceding_context(context_units + left)
                    return generate_fragment(f"{batch_id}-a", left, context_units) + generate_fragment(f"{batch_id}-b", right, right_context)
                fragment = self._transport_value(fragment, handle_to_canonical)
                _write(fragment_path, fragment)
                self._progress(target.parent, 4, "batch_completed", f"{batch_id} completed", batch_id=batch_id, exact_input_tokens=counted)
                return [fragment]

            fragments_by_batch: dict[int, list[dict[str, Any]]] = {}
            with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="loop2-report") as pool:
                futures = {pool.submit(generate_fragment, f"batch-{index:04d}", batch, batch_contexts[index - 1]): index for index, batch in enumerate(batches, 1)}
                for completed, future in enumerate(as_completed(futures), 1):
                    fragments_by_batch[futures[future]] = future.result()
                    self._progress(target.parent, 4, "batch_progress", f"report batches completed: {completed}/{len(batches)}", completed=completed, total=len(batches))
            fragments = [fragment for index in sorted(fragments_by_batch) for fragment in fragments_by_batch[index]]

            report_schema_value = report_schema()

            def report_reconciliation_request(group: list[dict[str, Any]]) -> tuple[str, int]:
                encoded_fragments = self._transport_value(group, canonical_to_handle)
                compact_fragments = self._columnarize(encoded_fragments)
                if self._decolumnarize(compact_fragments) != encoded_fragments: raise ValueError("Stage 4 reconciliation transport failed exact round-trip validation")
                reconciliation = {"study_context": prepared["study_context"], "ui_rendering_summary": self._transport_value(compact_rendering, canonical_to_handle), "document_summary": projection.get("summary"), "source_limitations": projection.get("limitations", []), "unresolved_items": projection.get("unresolved_items", []), "local_report_fragments": compact_fragments, "instruction": "Reconcile adjacent source-ordered fragments into one non-duplicative report for this single document. local_report_fragments uses a lossless columnar form: fields names columns and each row starts with a presence bitmap. Preserve grounded evidence handles, source order where meaningful, minority findings, and all material limitations. Do not make cross-document claims."}
                prompt = json.dumps(reconciliation, ensure_ascii=False, default=str)
                return prompt, self.client.count_tokens(STUDY_REPORT_INSTRUCTIONS, prompt, report_schema_value)

            def reconcile_group(group: list[dict[str, Any]], level: int, index: int) -> dict[str, Any]:
                if len(group) == 1: return group[0]
                key = stable_id("report-reconcile", request.document_id, level, index, *(stable_id("fragment", json.dumps(item, sort_keys=True, default=str)) for item in group))
                path = target.parent / "fragments" / "reconciliation" / f"level-{level:02d}-{index:04d}-{key.split(':')[-1]}.json"
                if resume and path.exists(): return read_json(path)
                prompt, counted = report_reconciliation_request(group)
                reconciliation_ceiling = self._reconciliation_ceiling()
                if counted > reconciliation_ceiling:
                    raise ValueError(f"Stage 4 reconciliation group exceeds the {reconciliation_ceiling:,}-token hard ceiling after 128K packing")
                self._progress(target.parent, 4, "reconciliation_group_started", f"report reconciliation level {level} group {index} started ({counted:,} input tokens)", level=level, group=index, child_report_count=len(group), exact_input_tokens=counted)
                try:
                    result = self.client.complete(phase=f"loop2-report-reconcile-{request.document_id}-{level:02d}-{index:04d}", instructions=STUDY_REPORT_INSTRUCTIONS, input_content=prompt, schema=report_schema_value, max_output_tokens=self.config.max_output_tokens, reasoning_effort="high", cache_key=f"agentic-subsurface:{STUDY_REPORT_PROMPT_VERSION}:reconcile", counted_input_tokens=counted)
                except IncompleteResponse as exc:
                    if len(group) <= 2: raise
                    midpoint = len(group) // 2
                    result = reconcile_group([reconcile_reports(group[:midpoint], level + 1), reconcile_reports(group[midpoint:], level + 1)], level + 1, index)
                    self._progress(target.parent, 4, "reconciliation_group_split", f"split incomplete report reconciliation level {level} group {index}: {exc.reason}", level=level, group=index, reason=exc.reason)
                result = self._transport_value(result, handle_to_canonical)
                _write(path, result)
                self._progress(target.parent, 4, "reconciliation_group_completed", f"report reconciliation level {level} group {index} completed", level=level, group=index, exact_input_tokens=counted)
                return result

            def reconcile_reports(reports: list[dict[str, Any]], level: int = 1) -> dict[str, Any]:
                if len(reports) == 1: return reports[0]
                _, full_count = report_reconciliation_request(reports)
                reconciliation_ceiling = self._reconciliation_ceiling()
                if full_count <= reconciliation_ceiling:
                    groups = [reports]
                    decision = "single_global_call"
                else:
                    groups, current_group = [], []
                    for report in reports:
                        candidate = current_group + [report]
                        _, candidate_count = report_reconciliation_request(candidate)
                        if current_group and candidate_count > maximum:
                            groups.append(current_group); current_group = [report]
                        else:
                            current_group = candidate
                    if current_group: groups.append(current_group)
                    if len(groups) >= len(reports):
                        groups = [reports[index:index + 2] for index in range(0, len(reports), 2)]
                    decision = "split_to_128k_groups"
                reconciled: dict[int, dict[str, Any]] = {}
                workers = min(self.config.max_workers, len(groups))
                self._progress(target.parent, 4, "reconciliation_level_started", f"report reconciliation level {level}: exact global input={full_count:,}; policy={decision}; {len(reports)} reports -> {len(groups)} groups with {workers} workers", level=level, input_report_count=len(reports), exact_global_input_tokens=full_count, reconciliation_ceiling_tokens=reconciliation_ceiling, group_target_tokens=maximum, decision=decision, group_count=len(groups), workers=workers)
                with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="loop2-report-reconcile") as pool:
                    futures = {pool.submit(reconcile_group, group, level, index): index for index, group in enumerate(groups, 1)}
                    for future in as_completed(futures): reconciled[futures[future]] = future.result()
                next_level = [reconciled[index] for index in sorted(reconciled)]
                self._progress(target.parent, 4, "reconciliation_level_completed", f"report reconciliation level {level} completed: {len(next_level)} reports remain", level=level, output_report_count=len(next_level))
                return reconcile_reports(next_level, level + 1)

            value = reconcile_reports(fragments)
            value["report_id"] = request.study_id
            allowed_evidence = set(prepared["evidence_index"]["evidence_ids"])
            invalid_refs = []
            for collection in ("chapters", "findings", "stat_callouts"):
                for item in value.get(collection, []):
                    refs = item.get("evidence_refs", [])
                    invalid_refs.extend({"collection": collection, "id": item.get("id"), "evidence_ref": ref} for ref in refs if ref not in allowed_evidence)
                    item["evidence_refs"] = [ref for ref in refs if ref in allowed_evidence]
            _write(target.parent / "validation_report.json", {"valid": not invalid_refs, "invalid_evidence_refs": invalid_refs, "batch_count": len(batches)})
            if invalid_refs: raise ValueError(f"Stage 4 report contains {len(invalid_refs)} unsupported evidence references")
            if value.get("findings") or value.get("stat_callouts"):
                executive_payload = {
                    "study_context": prepared["study_context"],
                    "themes": [{k: item.get(k) for k in ("id", "title", "summary")} for item in value.get("themes", [])],
                    "findings": [{k: item.get(k) for k in ("id", "title", "statement", "why_it_matters", "confidence")} for item in value.get("findings", [])],
                    "stat_callouts": [{k: item.get(k) for k in ("id", "label", "value", "minimum", "maximum", "category", "unit", "qualifier")} for item in value.get("stat_callouts", [])],
                    "uncertainties": value.get("uncertainties", []),
                    "instruction": "Replace only the executive overview. The detailed report already preserves exhaustive evidence; do not repeat every measurement here.",
                }
                executive_prompt = json.dumps(executive_payload, ensure_ascii=False, default=str)
                executive_schema = report_executive_schema()
                executive_tokens = self.client.count_tokens(STUDY_EXECUTIVE_INSTRUCTIONS, executive_prompt, executive_schema)
                if executive_tokens > maximum:
                    raise ValueError(f"Stage 4 executive overview input exceeds the {maximum:,}-token ceiling")
                self._progress(target.parent, 4, "executive_started", f"plain-language executive overview started ({executive_tokens:,} input tokens)", exact_input_tokens=executive_tokens)
                executive = self.client.complete(phase=f"loop2-report-executive-{request.document_id}", instructions=STUDY_EXECUTIVE_INSTRUCTIONS, input_content=executive_prompt, schema=executive_schema, max_output_tokens=self.config.max_output_tokens, reasoning_effort="high", cache_key=f"agentic-subsurface:{STUDY_EXECUTIVE_PROMPT_VERSION}", counted_input_tokens=executive_tokens)
                finding_ids = {str(item.get("id")) for item in value.get("findings", [])}
                stat_ids = {str(item.get("id")) for item in value.get("stat_callouts", [])}
                invalid_finding_ids = sorted(set(map(str, executive.get("key_finding_ids", []))) - finding_ids)
                invalid_stat_ids = sorted(set(map(str, executive.get("key_stat_callout_ids", []))) - stat_ids)
                if invalid_finding_ids or invalid_stat_ids:
                    raise ValueError(f"Stage 4 executive overview returned unknown report IDs: findings={invalid_finding_ids[:5]}, stats={invalid_stat_ids[:5]}")
                value["executive_overview"] = {**executive, "generation_mode": "dedicated_plain_language_pass"}
                self._progress(target.parent, 4, "executive_completed", "plain-language executive overview completed", exact_input_tokens=executive_tokens)
            value["audience"] = "general_nontechnical"
            self._progress(target.parent, 4, "validation_completed", f"report reconciliation and evidence-reference validation completed; invalid refs={len(invalid_refs)}", invalid_evidence_refs=len(invalid_refs), batch_count=len(batches))
        else: value = {"schema_version": "report-synthesis.v1", "report_id": request.study_id, "audience": "general_nontechnical", "executive_overview": {"headline": prepared["projection"]["source"]["filename"], "abstract": "Offline study preparation completed.", "key_finding_ids": [], "key_stat_callout_ids": [], "generation_mode": "offline"}, "themes": [], "chapters": [], "findings": [], "stat_callouts": [], "uncertainties": [], "coverage": {"summary": "Live synthesis was not run.", "source_count": 1, "feature_count": len(rendering.get("features", [])), "finding_count": 0, "limitations": ["live=false"]}}
        _write(target, value); return value

    @staticmethod
    def _consolidate(request: DocumentStudyRunRequest, version_id: str, rendering: dict[str, Any], narratives: dict[str, Any], report: dict[str, Any], prepared: dict[str, Any], target: Path) -> dict[str, Any]:
        object_ids = [str(x.get("id")) for key in ("features", "layers", "vertical_profiles", "intervals", "structured_resources") for x in rendering.get(key, []) if x.get("id")]
        duplicate = sorted(x for x, n in Counter(object_ids).items() if n > 1)
        target_registry = {str(x["id"]): x for x in rendering.get("narrative_targets", [])}
        narrative_by_id = {str(x.get("target_id")): x for x in narratives.get("target_insights", []) if x.get("target_id")}
        unknown = sorted(set(narrative_by_id) - set(target_registry))
        issues = [{"path": "rendering_objects", "message": f"duplicate object ID {x}"} for x in duplicate] + [{"path": "narratives", "message": f"unknown narrative target ID {x}"} for x in unknown]
        coverage = rendering.get("coverage", {})
        if coverage.get("dropped_spatial_features") or coverage.get("dropped_intervals") or coverage.get("discarded_evidence_items"):
            issues.append({"path": "coverage", "message": "rendering coverage reports discarded Loop 1 content"})
        classified = sum(int(coverage.get(k, 0)) for k in ("renderable_features", "native_layer_backed_concepts", "non_renderable_spatial_concepts", "quarantined_spatial_concepts"))
        if classified != int(coverage.get("loop1_spatial_features", 0)):
            issues.append({"path": "coverage.loop1_spatial_features", "message": "spatial classification counts do not reconcile"})
        scientific, merged = json.loads(json.dumps(rendering)), json.loads(json.dumps(rendering))
        overview = report.get("executive_overview", {})
        if overview.get("headline"): merged.setdefault("study", {})["title"] = overview["headline"]
        if overview.get("abstract"): merged.setdefault("study", {})["summary"] = overview["abstract"]
        object_by_id = {str(x["id"]): x for key in ("features", "layers", "vertical_profiles") for x in merged.get(key, []) if x.get("id")}
        if merged.get("study", {}).get("id"): object_by_id[str(merged["study"]["id"])] = merged["study"]
        for tid, narrative in narrative_by_id.items():
            registry = target_registry.get(tid)
            obj = object_by_id.get(str(registry.get("object_id"))) if registry else None
            if obj is not None: obj["narrative"] = narrative
        merged["study_report"] = report
        limitations = list(dict.fromkeys(prepared["projection"].get("limitations", []) + narratives.get("limitations", [])))
        status = "incomplete" if issues else "complete_with_limitations" if limitations else "complete"
        final = {"schema_version": "document-study.v2", "study_id": request.study_id, "study_version_id": version_id, "document_id": request.document_id, "loop1_version_id": request.loop1_version_id, "status": status, "source": prepared["projection"]["source"], "primary_rendering_mode": merged.get("primary_rendering_mode"), "capabilities": merged.get("capabilities", {}), "rendering_package": merged, "scientific_rendering_package": scientific, "narrative_package": narratives, "report": report, "native_assets": prepared["native_assets"], "limitations": limitations, "unresolved_items": prepared["projection"].get("unresolved_items", []), "validation": {"valid": not issues, "issues": issues, "counts": {"features": len(rendering.get("features", [])), "layers": len(rendering.get("layers", [])), "profiles": len(rendering.get("vertical_profiles", [])), "narratives": len(narrative_by_id), "issues": len(issues)}, "scientific_package_preserved": scientific == rendering}}
        _write(target.parent.parent / "validation_report.json", final["validation"]); _write(target, final); return final

    def _activate(self, document_id: str, version_id: str, target: Path, final: dict[str, Any]) -> None:
        if final.get("status") not in {"complete", "complete_with_limitations"}: raise ValueError("cannot activate an incomplete Loop 2 study")
        _write(self.root / "documents" / document_id / "active.json", {"document_id": document_id, "study_version_id": version_id, "loop1_version_id": final["loop1_version_id"], "package_path": str(target.relative_to(self.root)), "status": final["status"]})

    def _refresh_manifest(self) -> None:
        active = [read_json(x) for x in sorted((self.root / "documents").glob("*/active.json"))]
        _write(self.root / "study_manifest.json", {"schema_version": "study-manifest.v1", "active_studies": active, "counts": {"active_studies": len(active)}})

    def _partial(self, request: DocumentStudyRunRequest, version_id: str, start: int, end: int, root: Path) -> dict[str, Any]:
        value = {"document_id": request.document_id, "study_version_id": version_id, "status": "partial", "executed_stage_range": [start, end], "last_completed_stage": end, "stage_name": STAGES[end], **self._inspection_paths(root), "cost": self.client.ledger.get("totals", {})}; _write(root / "partial_status.json", value); return value

    def _result(self, request: DocumentStudyRunRequest, version_id: str, final: dict[str, Any], reused: bool) -> dict[str, Any]:
        root = self.root / "documents" / request.document_id / "versions" / version_id
        return {"document_id": request.document_id, "study_version_id": version_id, "status": final["status"], "reused": reused, "validation": final["validation"], **self._inspection_paths(root), "cost": self.client.ledger.get("totals", {})}

    def _inspection_paths(self, root: Path) -> dict[str, Any]:
        return {"version_root": str(root), "stage_telemetry": str(root / "stage_telemetry.json"), "run_events": str(root / "run_events.jsonl"), "artifacts_root": str(root / "stages"), "model_io_root": str(self.client.root), "cost_ledger": str(self.client.ledger_path)}


def requests_from_manifest(corpus_root: Path, output_root: Path, config: Any, document_ids: list[str] | None = None, activate: bool = True) -> list[DocumentStudyRunRequest]:
    manifest_path = corpus_root.resolve() / "corpus_manifest.json"
    if not manifest_path.exists(): raise FileNotFoundError(f"Loop 1 corpus manifest is missing: {manifest_path}")
    selected, requests = set(document_ids or []), []
    for item in read_json(manifest_path).get("active_documents", []):
        if selected and item["document_id"] not in selected: continue
        requests.append(DocumentStudyRunRequest(study_id=stable_id("study", item["document_id"]), corpus_root=corpus_root, output_dir=output_root, document_id=item["document_id"], loop1_version_id=item["version_id"], package_path=corpus_root / item["package_path"], expected_source_sha256=item["source_sha256"], config=config, activate=activate))
    missing = selected - {x.document_id for x in requests}
    if missing: raise ValueError(f"requested document IDs are not active in corpus_manifest.json: {sorted(missing)}")
    if not requests: raise RuntimeError("corpus_manifest.json contains no selected active documents")
    return requests


def process_studies(requests: list[DocumentStudyRunRequest], resume: bool = True, start_step: int = 1, end_step: int = 5) -> list[dict[str, Any]]:
    if not requests: return []
    processor = DocumentLoop2Processor(requests[0].output_dir, requests[0].config)
    return [processor.process(request, resume=resume, start_step=start_step, end_step=end_step) for request in requests]
