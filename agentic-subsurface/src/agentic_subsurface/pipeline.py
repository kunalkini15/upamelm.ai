from __future__ import annotations

import base64
import json
from pathlib import Path
from typing import Any

from .adapters import AdapterRegistry
from .batching import EvidenceBatch, SemanticBatcher
from .models import ExtractionResult, RunRequest, SourceBundle
from .prompts import EXTRACTION_INSTRUCTIONS, EXTRACTION_PROMPT_VERSION, NARRATIVE_INSTRUCTIONS, NARRATIVE_PROMPT_VERSION, REPORT_INSTRUCTIONS, REPORT_PROMPT_VERSION, SYNTHESIS_INSTRUCTIONS, SYNTHESIS_PROMPT_VERSION
from .provider import IncompleteResponse, MuseClient
from .schemas import extraction_schema, narratives_schema, report_schema, scientific_schema
from .util import read_json, stable_id, write_json


def _data_url(path: Path) -> str:
    suffix = path.suffix.lower()
    mime = "image/webp" if suffix == ".webp" else "image/png" if suffix == ".png" else "image/jpeg"
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode('ascii')}"


class AgenticSubsurfacePipeline:
    def __init__(self, request: RunRequest):
        self.request = request
        self.root = request.output_dir.resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.registry = AdapterRegistry(request.config.render_dpi)
        self.client = MuseClient(self.root, request.config)

    def run(self, resume: bool = True) -> dict[str, Any]:
        write_json(self.root / "run_request.json", self.request.model_dump(mode="json"))
        bundles = self.materialize(resume=resume)
        batches = SemanticBatcher(self.request.config.target_batch_tokens, self.request.config.max_batch_tokens, self.request.config.max_images_per_batch).build(bundles)
        write_json(self.root / "loop1" / "batch_manifest.json", [{"batch_id": b.batch_id, "estimated_tokens": b.estimated_tokens, "unit_ids": [u.unit_id for u in b.units], "visual_artifact_ids": b.visual_artifact_ids} for b in batches])
        extractions = self.extract(bundles, batches, resume=resume)
        evidence_pack = self.consolidate_and_validate(bundles, batches, extractions)
        ui_package = self.synthesize(bundles, evidence_pack, resume=resume)
        narratives = self.narrate(ui_package, evidence_pack, resume=resume)
        report = self.report(ui_package, evidence_pack, resume=resume)
        ui_package["report_synthesis"] = report
        narrative_by_id = {item.get("feature_id"): item for item in narratives.get("feature_insights", []) if isinstance(item, dict)}
        for feature in ui_package.get("features", []):
            if feature.get("id") in narrative_by_id: feature["narrative"] = narrative_by_id[feature["id"]]
        write_json(self.root / "final" / "ui_consolidated_package.json", ui_package)
        status = {"status": "completed", "run_id": self.request.run_id, "sources": len(bundles), "batches": len(batches), "evidence_items": len(evidence_pack.get("evidence_items", [])), "features": len(ui_package.get("features", [])), "output": "final/ui_consolidated_package.json", "cost": self.client.ledger.get("totals", {})}
        write_json(self.root / "status.json", status)
        return status

    def materialize(self, resume: bool) -> list[SourceBundle]:
        bundles: list[SourceBundle] = []
        for path in self.request.sources:
            path = Path(path).resolve()
            if not path.exists(): raise FileNotFoundError(path)
            bundle = self.registry.materialize(path, self.root)
            target = self.root / "sources" / bundle.source_id / "bundle.json"
            write_json(target, bundle.model_dump(mode="json"))
            bundles.append(bundle)
        write_json(self.root / "source_manifest.json", [bundle.model_dump(mode="json") for bundle in bundles])
        return bundles

    def _artifact_index(self, bundles: list[SourceBundle]) -> dict[str, Any]:
        return {artifact.artifact_id: artifact for bundle in bundles for artifact in bundle.artifacts}

    def _batch_content(self, batch: EvidenceBatch, bundles: list[SourceBundle]) -> list[dict[str, Any]]:
        source_profile = [{"source_id": b.source_id, "filename": b.filename, "media_type": b.media_type, "adapter": b.adapter, "capabilities": b.capabilities, "structured_assets": b.structured_assets, "spatial_assets": b.spatial_assets, "visual_assets": [{k: v for k, v in x.items() if k != "path"} for x in b.visual_assets]} for b in bundles]
        prompt = json.dumps({"objective": self.request.objective, "batch_id": batch.batch_id, "source_profile": source_profile}, ensure_ascii=False) + batch.model_text()
        content: list[dict[str, Any]] = [{"type": "input_text", "text": prompt}]
        index = self._artifact_index(bundles)
        for aid in batch.visual_artifact_ids:
            artifact = index.get(aid)
            if not artifact: continue
            path = self.root / artifact.path
            if path.exists(): content.append({"type": "input_image", "image_url": _data_url(path), "detail": "high"})
        return [{"role": "user", "content": content}]

    def extract(self, bundles: list[SourceBundle], batches: list[EvidenceBatch], resume: bool) -> list[ExtractionResult]:
        output: list[ExtractionResult] = []
        for batch in batches:
            output.extend(self._extract_batch(bundles, batch, resume))
        return output

    def _extract_batch(self, bundles: list[SourceBundle], batch: EvidenceBatch, resume: bool) -> list[ExtractionResult]:
        target = self.root / "loop1" / "batches" / f"{batch.batch_id}.json"
        if resume and target.exists(): return [ExtractionResult.model_validate(read_json(target))]
        # Image tokens are not captured by the local text estimator. Keep live
        # leaf batches deliberately smaller; Meta's exact counter still guards
        # every resulting request.
        if self.request.config.live and batch.estimated_tokens > 100_000 and len(batch.units) > 1:
            return [item for child in self._split_batch(batch) for item in self._extract_batch(bundles, child, resume)]
        if not self.request.config.live:
            result = ExtractionResult(batch_id=batch.batch_id, summary="Offline artifact-only extraction; model extraction not run.", limitations=["live=false"])
        else:
            try:
                raw = self.client.complete(phase=f"extract-{batch.batch_id}", instructions=EXTRACTION_INSTRUCTIONS, input_content=self._batch_content(batch, bundles), schema=extraction_schema(), max_output_tokens=self.request.config.max_output_tokens, reasoning_effort="high", cache_key=f"agentic-subsurface:{EXTRACTION_PROMPT_VERSION}")
            except IncompleteResponse as exc:
                if exc.reason not in {"max_output_tokens", "max_tokens", "length"} or len(batch.units) <= 1: raise
                return [item for child in self._split_batch(batch) for item in self._extract_batch(bundles, child, resume)]
            raw["batch_id"] = batch.batch_id
            result = ExtractionResult.model_validate(raw)
        write_json(target, result.model_dump(mode="json"))
        return [result]

    def _split_batch(self, batch: EvidenceBatch) -> list[EvidenceBatch]:
        midpoint = len(batch.units) // 2
        children = []
        for suffix, units in (("a", batch.units[:midpoint]), ("b", batch.units[midpoint:])):
            refs = []
            for unit in units:
                for aid in unit.artifact_refs:
                    if aid not in refs and len(refs) < self.request.config.max_images_per_batch: refs.append(aid)
            children.append(EvidenceBatch(batch_id=f"{batch.batch_id}-{suffix}", units=units, estimated_tokens=sum(max(1, len(u.text)//3)+80 for u in units), visual_artifact_ids=refs))
        return children

    def consolidate_and_validate(self, bundles: list[SourceBundle], batches: list[EvidenceBatch], results: list[ExtractionResult]) -> dict[str, Any]:
        artifacts = self._artifact_index(bundles)
        unit_ids = {unit.unit_id for bundle in bundles for unit in bundle.units}
        issues: list[dict[str, Any]] = []
        seen: set[str] = set()
        items = []
        for result in results:
            for item in result.evidence_items:
                if item.evidence_id in seen:
                    issues.append({"severity": "warning", "code": "duplicate_evidence_id", "id": item.evidence_id})
                    continue
                seen.add(item.evidence_id)
                valid_refs = []
                for ref in item.evidence:
                    if ref.artifact_id not in artifacts:
                        issues.append({"severity": "error", "code": "unknown_artifact", "id": item.evidence_id, "artifact_id": ref.artifact_id})
                        continue
                    # Collection-level and image-level evidence may resolve
                    # directly to an artifact rather than a text content unit.
                    if ref.locator.unit_id and ref.locator.unit_id not in unit_ids and ref.locator.unit_id not in artifacts:
                        issues.append({"severity": "error", "code": "unknown_unit", "id": item.evidence_id, "unit_id": ref.locator.unit_id})
                        continue
                    valid_refs.append(ref)
                if valid_refs:
                    item.evidence = valid_refs
                    items.append(item.model_dump(mode="json"))
        deterministic_assets = [{"source_id": b.source_id, "structured_assets": b.structured_assets, "spatial_assets": b.spatial_assets, "visual_assets": b.visual_assets} for b in bundles]
        pack = {"schema_version": "evidence.v1", "run_id": self.request.run_id, "objective": self.request.objective, "sources": [{"source_id": b.source_id, "filename": b.filename, "sha256": b.sha256, "adapter": b.adapter} for b in bundles], "deterministic_assets": deterministic_assets, "entities": [x for r in results for x in r.entities], "evidence_items": items, "spatial_features": [x for r in results for x in r.spatial_features], "vertical_intervals": [x for r in results for x in r.vertical_intervals], "relationships": [x for r in results for x in r.relationships], "visual_interpretations": [x for r in results for x in r.visual_interpretations], "limitations": list(dict.fromkeys(x for r in results for x in r.limitations)), "unresolved_items": list(dict.fromkeys(x for r in results for x in r.unresolved_items)), "coverage": {"source_units": len(unit_ids), "units_batched": len({u.unit_id for b in batches for u in b.units}), "batches": len(batches), "visual_assets": sum(len(b.visual_assets) for b in bundles), "inspected_visuals": len([x for r in results for x in r.visual_interpretations]), "valid_evidence_items": len(items), "validation_errors": sum(x["severity"] == "error" for x in issues)}}
        write_json(self.root / "loop1" / "evidence_package.json", pack)
        write_json(self.root / "loop1" / "validation_report.json", {"valid": not any(x["severity"] == "error" for x in issues), "issues": issues, "coverage": pack["coverage"]})
        return pack

    def _call_or_read(self, target: Path, *, phase: str, instructions: str, payload: Any, schema: dict[str, Any], cache_key: str, resume: bool, max_output_tokens: int | None = None) -> dict[str, Any]:
        if resume and target.exists(): return read_json(target)
        if not self.request.config.live: return {}
        result = self.client.complete(phase=phase, instructions=instructions, input_content=json.dumps(payload, ensure_ascii=False, default=str), schema=schema, max_output_tokens=max_output_tokens, reasoning_effort="high", cache_key=cache_key)
        write_json(target, result)
        return result

    def synthesize(self, bundles: list[SourceBundle], pack: dict[str, Any], resume: bool) -> dict[str, Any]:
        target = self.root / "loop2" / "scientific_package.json"
        result = self._call_or_read(target, phase="spatial-synthesis", instructions=SYNTHESIS_INSTRUCTIONS, payload=pack, schema=scientific_schema(), cache_key=f"agentic-subsurface:{SYNTHESIS_PROMPT_VERSION}", resume=resume, max_output_tokens=30_000)
        if not result:
            result = {"schema_version": "1.0", "report": {"id": self.request.run_id, "title": self.request.objective}, "study_areas": [], "features": [], "observations": [], "intervals": [], "sources": [], "extensions": {"datasets": self._deterministic_datasets(bundles), "relationships": []}}
        else:
            result.setdefault("extensions", {}).setdefault("datasets", []).extend(self._deterministic_datasets(bundles))
        write_json(target, result)
        self._validate_ui(result)
        return result

    def _deterministic_datasets(self, bundles: list[SourceBundle]) -> list[dict[str, Any]]:
        datasets = []
        for bundle in bundles:
            for asset in bundle.structured_assets + bundle.spatial_assets:
                datasets.append({"id": asset.get("asset_id"), "name": asset.get("kind", "source dataset"), "source_id": bundle.source_id, **asset})
        return datasets

    def _validate_ui(self, package: dict[str, Any]) -> None:
        issues = []
        feature_ids = {x.get("id") for x in package.get("features", []) if isinstance(x, dict)}
        source_ids = {x.get("id") for x in package.get("sources", []) if isinstance(x, dict)}
        for idx, feature in enumerate(package.get("features", [])):
            geometry = feature.get("geometry")
            if geometry and geometry.get("type") == "Point":
                coords = geometry.get("coordinates") or []
                if len(coords) < 2 or not (-180 <= coords[0] <= 180 and -90 <= coords[1] <= 90): issues.append({"path": f"features[{idx}].geometry", "message": "invalid point coordinates"})
        for idx, interval in enumerate(package.get("intervals", [])):
            if interval.get("feature_id") and interval["feature_id"] not in feature_ids: issues.append({"path": f"intervals[{idx}].feature_id", "message": "unknown feature"})
            if interval.get("start") is not None and interval.get("end") is not None and interval["end"] <= interval["start"]: issues.append({"path": f"intervals[{idx}]", "message": "invalid interval"})
        write_json(self.root / "loop2" / "ui_validation.json", {"valid": not issues, "issues": issues, "counts": {"features": len(feature_ids), "sources": len(source_ids)}})

    def narrate(self, package: dict[str, Any], pack: dict[str, Any], resume: bool) -> dict[str, Any]:
        target = self.root / "loop2" / "feature_narratives.json"
        contexts = {"features": package.get("features", []), "observations": package.get("observations", []), "intervals": package.get("intervals", []), "relationships": package.get("extensions", {}).get("relationships", []), "evidence_items": pack.get("evidence_items", [])}
        result = self._call_or_read(target, phase="feature-narratives", instructions=NARRATIVE_INSTRUCTIONS, payload=contexts, schema=narratives_schema(), cache_key=f"agentic-subsurface:{NARRATIVE_PROMPT_VERSION}", resume=resume, max_output_tokens=20_000)
        if not result: result = {"feature_insights": [], "limitations": ["live=false"]}
        write_json(target, result)
        return result

    def report(self, package: dict[str, Any], pack: dict[str, Any], resume: bool) -> dict[str, Any]:
        target = self.root / "loop2" / "report_synthesis.json"
        result = self._call_or_read(target, phase="report-synthesis", instructions=REPORT_INSTRUCTIONS, payload={"scientific_package": package, "evidence_package": pack}, schema=report_schema(), cache_key=f"agentic-subsurface:{REPORT_PROMPT_VERSION}", resume=resume, max_output_tokens=30_000)
        if not result: result = {"schema_version": "report-synthesis.v1", "report_id": self.request.run_id, "executive_overview": {"headline": self.request.objective, "abstract": "Offline artifact preparation completed; live synthesis was not run.", "key_finding_ids": [], "key_stat_callout_ids": []}, "themes": [], "chapters": [], "findings": [], "stat_callouts": [], "uncertainties": [], "coverage": pack.get("coverage", {})}
        write_json(target, result)
        return result

