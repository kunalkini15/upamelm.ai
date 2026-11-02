"""Deterministically merge the scientific UI package with feature narratives."""
from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

from .artifacts import ArtifactStore


CONSOLIDATED_SCHEMA_VERSION = "ui-consolidated.v1"


def _load_object(path: Path, label: str) -> dict[str, Any]:
    if not path.exists():
        raise ValueError(f"missing {label}: {path}")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"invalid {label}: {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be a JSON object: {path}")
    return value


def _duplicate_ids(items: Any) -> list[str]:
    seen: set[str] = set()
    duplicate: list[str] = []
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict) or not item.get("id"):
            continue
        ident = str(item["id"])
        if ident in seen and ident not in duplicate:
            duplicate.append(ident)
        seen.add(ident)
    return duplicate


def consolidate_ui_packages(synthesis_dir: Path, output_path: Path | None = None) -> dict[str, Any]:
    """Merge package artifacts and atomically publish the consolidated package."""
    synthesis_dir = Path(synthesis_dir)
    rendering = _load_object(synthesis_dir / "ui_rendering_package.json", "UI rendering package")
    narrative = _load_object(synthesis_dir / "ui_synthesis_package.json", "UI synthesis package")
    if rendering.get("schema_version") != "1.0":
        raise ValueError("UI rendering package must use schema_version 1.0")
    if rendering.get("report", {}).get("id") != narrative.get("report_id"):
        raise ValueError("rendering and narrative packages have different report IDs")
    rendering_features = rendering.get("features")
    if not isinstance(rendering_features, list):
        raise ValueError("UI rendering package features must be an array")
    scientific_duplicates = _duplicate_ids(rendering_features)
    if scientific_duplicates:
        raise ValueError(f"duplicate scientific feature IDs: {scientific_duplicates[:5]}")
    narrative_items = narrative.get("feature_insights")
    if not isinstance(narrative_items, list):
        raise ValueError("UI synthesis package feature_insights must be an array")
    narrative_duplicates = _duplicate_ids(narrative_items)
    if narrative_duplicates:
        raise ValueError(f"duplicate narrative feature IDs: {narrative_duplicates[:5]}")

    feature_ids = {str(item["id"]) for item in rendering_features if isinstance(item, dict) and item.get("id")}
    narratives: dict[str, dict[str, Any]] = {}
    unknown_ids: list[str] = []
    for item in narrative_items:
        if not isinstance(item, dict) or not item.get("feature_id"):
            continue
        fid = str(item["feature_id"])
        if fid not in feature_ids:
            unknown_ids.append(fid)
            continue
        embedded = copy.deepcopy(item)
        embedded.pop("feature_id", None)
        narratives[fid] = embedded

    merged = copy.deepcopy(rendering)
    merged["schema_version"] = CONSOLIDATED_SCHEMA_VERSION
    merged["scientific_schema_version"] = rendering.get("schema_version")
    merged["narrative_schema_version"] = narrative.get("schema_version")
    merged["features"] = []
    for original in rendering_features:
        feature = copy.deepcopy(original)
        if isinstance(feature, dict):
            feature.pop("narrative", None)
            fid = str(feature.get("id")) if feature.get("id") else None
            if fid in narratives:
                feature["narrative"] = narratives[fid]
        merged["features"].append(feature)
    merged["narrative_coverage"] = copy.deepcopy(narrative.get("coverage", {}))

    # Verify enrichment did not mutate the scientific package.
    original_scientific = copy.deepcopy(rendering)
    original_scientific.pop("schema_version", None)
    merged_scientific = copy.deepcopy(merged)
    for key in ("schema_version", "scientific_schema_version", "narrative_schema_version", "narrative_coverage"):
        merged_scientific.pop(key, None)
    for feature in merged_scientific.get("features", []):
        if isinstance(feature, dict):
            feature.pop("narrative", None)
    if merged_scientific != original_scientific:
        raise ValueError("consolidation changed the scientific rendering package")

    report = {
        "schema_version": "ui-consolidation.v1",
        "valid": True,
        "scientific_feature_count": len(rendering_features),
        "narrative_feature_count": len(narrative_items),
        "joined_feature_count": len(narratives),
        "features_without_narratives": len(feature_ids - set(narratives)),
        "unknown_narrative_feature_ids": sorted(set(unknown_ids)),
        "scientific_duplicate_ids": scientific_duplicates,
        "narrative_duplicate_ids": narrative_duplicates,
        "report_id": rendering.get("report", {}).get("id"),
        "warnings": ([{"message": "narrative references unknown feature", "feature_ids": sorted(set(unknown_ids))}] if unknown_ids else []),
    }
    store = ArtifactStore(synthesis_dir)
    store.write_json("ui_consolidation_report.json", report)
    destination = output_path or (synthesis_dir / "ui_consolidated_package.json")
    destination = Path(destination)
    if destination.parent != synthesis_dir:
        destination.parent.mkdir(parents=True, exist_ok=True)
    # ArtifactStore provides atomic replacement; use it directly for the normal
    # synthesis directory and its private atomic helper for an explicit output.
    if destination == synthesis_dir / "ui_consolidated_package.json":
        store.write_json(destination.name, merged)
    else:
        data = json.dumps(merged, indent=2, ensure_ascii=False, default=str) + "\n"
        store._atomic(destination, data)
    return {"status": "completed", "path": str(destination), "report": report}
