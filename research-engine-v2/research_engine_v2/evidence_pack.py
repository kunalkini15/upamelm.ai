from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from .artifacts import ArtifactStore


def audit_evidence_pack(pack_path: Path) -> dict[str, Any]:
    """Return read-only quality metrics for a generated synthesis pack."""
    data = json.loads(Path(pack_path).read_text(encoding="utf-8"))
    chunks = data.get("chunk_index", [])
    records = [record for chunk in chunks for record in chunk.get("records", []) if isinstance(record, dict)]
    facts = [fact for chunk in chunks for fact in chunk.get("facts", []) if isinstance(fact, dict)]
    source_rows = [record for record in records if record.get("record_type") == "source_table_row"]
    grounded = [record for record in records + facts if record.get("evidence") or record.get("provenance")]
    located = [record for record in records if record.get("spatial_status") in {"located", "approximate", "derived"} or (record.get("lat") is not None and record.get("lon") is not None)]
    return {"pack_path": str(Path(pack_path)), "chunks": len(chunks), "groups": len(data.get("group_analyses", [])), "facts": len(facts), "records": len(records), "source_table_rows": len(source_rows), "visual_evidence": sum(len(chunk.get("visual_evidence", [])) for chunk in chunks), "located_records": len(located), "grounded_items": len(grounded), "records_without_id": sum(1 for record in records if not record.get("record_id")), "records_without_provenance": sum(1 for record in records if not (record.get("evidence") or record.get("provenance"))), "limitations": len(data.get("limitations", [])), "manifest_status": data.get("coverage", {}).get("manifest_status")}


def _build_navigation_indexes(chunks: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Build non-destructive entity and spatial indexes over canonical records."""
    entities: dict[str, dict[str, Any]] = {}
    spatial: list[dict[str, Any]] = []
    location_fields = ("site", "station", "village", "locality", "location", "location_text")
    for chunk in chunks:
        for record in chunk.get("records", []):
            if not isinstance(record, dict) or not record.get("record_id"):
                continue
            record_id = str(record["record_id"])
            for field in location_fields:
                value = record.get(field)
                if value in (None, "", []):
                    continue
                label = str(value).strip()
                entity_id = "entity:" + re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-")
                if not entity_id or entity_id == "entity:":
                    continue
                entities.setdefault(entity_id, {"entity_id": entity_id, "label": label, "aliases": [], "record_ids": [], "evidence_refs": []})
                if record_id not in entities[entity_id]["record_ids"]:
                    entities[entity_id]["record_ids"].append(record_id)
                for ref in record.get("evidence", []) if isinstance(record.get("evidence"), list) else []:
                    if ref not in entities[entity_id]["evidence_refs"]:
                        entities[entity_id]["evidence_refs"].append(ref)
            geometry = record.get("geometry")
            latitude = record.get("latitude", record.get("lat"))
            longitude = record.get("longitude", record.get("lon"))
            if geometry or (latitude is not None and longitude is not None):
                spatial.append({"record_id": record_id, "geometry": geometry or {"type": "Point", "coordinates": [longitude, latitude]}, "spatial_status": record.get("spatial_status", "located"), "evidence": record.get("evidence", [])})
    return sorted(entities.values(), key=lambda item: item["entity_id"]), spatial


def build_evidence_pack(output_dir: Path, manifest_path: Path | None = None) -> dict[str, Any]:
    """Deterministically assemble existing extractor artifacts; never calls Muse."""
    output_dir = Path(output_dir).resolve()
    artifacts = output_dir / "artifacts"
    if manifest_path is None:
        candidates = sorted((artifacts / "evidence_manifest").glob("v*.json"))
        manifest_path = candidates[-1] if candidates else None
    elif manifest_path is not None:
        manifest_path = Path(manifest_path).resolve()
    manifest: dict[str, Any] = {}
    if manifest_path and Path(manifest_path).exists():
        manifest = json.loads(Path(manifest_path).read_text(encoding="utf-8"))

    def latest_files(pattern: str) -> list[Path]:
        selected: dict[str, Path] = {}
        for candidate in sorted(artifacts.glob(pattern)):
            if candidate.parent.name in {"evidence_manifest", "complete_evidence_pack"}:
                continue
            prior = selected.get(candidate.parent.name)
            if prior is None or candidate.stem > prior.stem:
                selected[candidate.parent.name] = candidate
        return [selected[key] for key in sorted(selected)]

    chunks = []
    for path in latest_files("evidence_*/*.json"):
        if path.parent.name == "evidence_manifest":
            continue
        item = json.loads(path.read_text(encoding="utf-8"))
        extraction = item.get("extraction", {})
        chunk = item.get("chunk", {})
        # Keep only synthesis-relevant evidence in the canonical pack. The
        # lossless source pages, parser blocks, raw prompts, and usage records
        # remain available in the versioned artifact for retrieval/audit.
        chunks.append({
            "chunk_id": chunk.get("chunk_id"),
            "target_id": chunk.get("target_id"),
            "document_id": chunk.get("document_id"),
            "pages": chunk.get("pages", []),
            "parent_chunk_id": chunk.get("parent_chunk_id"),
            "artifact_id": path.parent.name,
            "artifact_version": path.stem,
            "artifact_path": str(path.relative_to(output_dir)),
            # The canonical pack carries all synthesis-relevant extracted
            # evidence. Lossless source pages, parser blocks, raw prompts, and
            # operational usage details stay in artifact_path.
            "digest": extraction.get("digest", ""),
            "facts": extraction.get("facts", []),
            "records": extraction.get("records", []),
            "relationships": extraction.get("relationships", []),
            "visual_evidence": extraction.get("visual_evidence", []),
            "coverage": extraction.get("coverage", []),
            "missing_expected_information": extraction.get("missing_expected_information", []),
            "uncertainties": extraction.get("uncertainties", []),
            "limitations": extraction.get("limitations", []),
        })
    groups = []
    for path in latest_files("group_analysis_*/*.json"):
        item = json.loads(path.read_text(encoding="utf-8"))
        analysis = item.get("analysis", {})
        groups.append({
            "artifact_id": path.parent.name,
            "artifact_version": path.stem,
            "artifact_path": str(path.relative_to(output_dir)),
            "target_id": (item.get("target") or {}).get("target_id"),
            "chunk_ids": item.get("chunk_ids", []),
            # Group analysis is the primary synthesis material. Do not embed
            # chunk records or raw source payloads alongside it.
            "analysis": {
                "analysis": analysis.get("analysis", ""),
                "key_findings": analysis.get("key_findings", []),
                "relationships": analysis.get("relationships", []),
                "uncertainties": analysis.get("uncertainties", []),
                "limitations": analysis.get("limitations", []),
                "evidence_refs": analysis.get("evidence_refs", []),
            },
        })
    entities, spatial_index = _build_navigation_indexes(chunks)

    pack = {
        "artifact_type": "complete_evidence_pack",
        "pack_version": 2,
        "research_id": manifest.get("research_id"),
        "plan_id": manifest.get("plan_id"),
        "objective": manifest.get("objective"),
        "source_inventories": manifest.get("source_inventories", []),
        "planner_targets": [{k: target.get(k) for k in ("target_id", "pages", "reason", "expected_information", "required_modalities", "completion_criteria") if k in target} for target in manifest.get("targets", [])],
        "chunk_index": chunks,
        "group_analyses": groups,
        "entities": entities,
        "spatial_index": spatial_index,
        "limitations": manifest.get("limitations", []),
        "coverage": {
            "chunk_artifacts": len(chunks),
            "group_analyses": len(groups),
            "manifest_status": manifest.get("status"),
        },
        "usage": {k: manifest.get("usage", {}).get(k) for k in ("calls", "input_tokens", "cached_input_tokens", "output_tokens", "total_tokens", "estimated_cost_usd", "model") if k in manifest.get("usage", {})},
        "assembly": {
            "deterministic": True,
            "source_manifest": str(Path(manifest_path).relative_to(output_dir)) if manifest_path else None,
            "artifact_policy": "This file contains the compact synthesis projection. Full lossless chunk artifacts remain available through artifact_path.",
        },
    }
    store = ArtifactStore(output_dir)
    path, version = store.version("complete_evidence_pack", pack)
    pack["artifact_id"] = "complete_evidence_pack"
    pack["version"] = version
    pack["path"] = str(path.relative_to(output_dir))
    store.write_json("evidence_pack.json", pack)
    return pack
