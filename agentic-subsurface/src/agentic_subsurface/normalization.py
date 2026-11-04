from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
from typing import Any

from .models import ExtractionResult


ID_FIELDS = {
    "evidence_items": ("evidence_id", "evidence"),
    "entities": ("entity_id", "entity"),
    "spatial_features": ("feature_id", "feature"),
    "vertical_intervals": ("interval_id", "interval"),
    "relationships": ("relationship_id", "relationship"),
}


def normalize_extraction_result_ids(
    document_id: str,
    result: ExtractionResult,
    *,
    scope_id: str | None = None,
) -> tuple[ExtractionResult, list[dict[str, Any]], dict[str, Any]]:
    """Namespace model-generated IDs without mutating saved extraction artifacts.

    Model IDs are local to a response. This creates a deterministic document +
    batch namespace, rewrites schema-defined references, and retains unresolved
    references with warnings rather than deleting their containing objects.
    Native artifact/source locator IDs are deliberately untouched.
    """

    payload = deepcopy(result.model_dump(mode="json"))
    batch_id = result.batch_id
    scope = scope_id or batch_id
    prefix = f"{document_id}:{scope}"
    issues: list[dict[str, Any]] = []
    mappings: dict[str, dict[str, list[str]]] = {}
    rewritten_counts: dict[str, int] = {}

    for collection, (id_field, kind) in ID_FIELDS.items():
        by_original: dict[str, list[str]] = defaultdict(list)
        objects = payload.get(collection, [])
        for index, item in enumerate(objects, 1):
            original = str(item.get(id_field) or f"missing-{index}")
            occurrence = len(by_original[original]) + 1
            suffix = f":{occurrence}" if occurrence > 1 else ""
            normalized = f"{prefix}:{kind}:{original}{suffix}"
            item[f"original_{id_field}"] = item.get(id_field)
            item[id_field] = normalized
            by_original[original].append(normalized)
            if occurrence > 1:
                issues.append({
                    "severity": "warning",
                    "code": "duplicate_local_generated_id",
                    "document_id": document_id,
                    "batch_id": batch_id,
                    "collection": collection,
                    "field": id_field,
                    "original_id": original,
                    "normalized_id": normalized,
                })
        mappings[kind] = dict(by_original)
        rewritten_counts[collection] = len(objects)

    evidence_map = mappings["evidence"]
    feature_map = mappings["feature"]
    # Relationship endpoints can address any generated object type. Prefer the
    # domain objects most commonly used as endpoints while reporting ambiguity.
    endpoint_maps = [mappings["entity"], feature_map, mappings["interval"], evidence_map]

    def resolve(original: Any, candidate_maps: list[dict[str, list[str]]], *, field: str, owner: str) -> Any:
        if original is None:
            return None
        key = str(original)
        candidates: list[str] = []
        for candidate_map in candidate_maps:
            candidates.extend(candidate_map.get(key, []))
        if not candidates:
            issues.append({
                "severity": "warning",
                "code": "unresolved_generated_reference",
                "document_id": document_id,
                "batch_id": batch_id,
                "owner": owner,
                "field": field,
                "original_id": key,
            })
            # Retain a deterministic, explicitly unresolved ID so the reference
            # is never silently erased and cannot collide with another batch.
            return f"{prefix}:unresolved:{key}"
        if len(candidates) > 1:
            issues.append({
                "severity": "warning",
                "code": "ambiguous_generated_reference",
                "document_id": document_id,
                "batch_id": batch_id,
                "owner": owner,
                "field": field,
                "original_id": key,
                "candidates": candidates,
                "selected": candidates[0],
            })
        return candidates[0]

    def rewrite_evidence_refs(item: dict[str, Any], owner: str) -> None:
        if "evidence_refs" in item:
            item["evidence_refs"] = [
                resolve(ref, [evidence_map], field="evidence_refs", owner=owner)
                for ref in item.get("evidence_refs", [])
            ]

    for collection in ("entities", "spatial_features", "vertical_intervals", "relationships", "visual_interpretations"):
        for index, item in enumerate(payload.get(collection, []), 1):
            rewrite_evidence_refs(item, f"{collection}[{index}]")

    for index, interval in enumerate(payload.get("vertical_intervals", []), 1):
        if interval.get("feature_id") is not None:
            interval["feature_id"] = resolve(
                interval["feature_id"], [feature_map], field="feature_id", owner=f"vertical_intervals[{index}]"
            )

    for index, relationship in enumerate(payload.get("relationships", []), 1):
        for field in ("from_id", "to_id"):
            relationship[field] = resolve(
                relationship.get(field), endpoint_maps, field=field, owner=f"relationships[{index}]"
            )

    stats = {
        "document_id": document_id,
        "batch_id": batch_id,
        "scope_id": scope,
        "rewritten": rewritten_counts,
        "warnings": len(issues),
        "unresolved_references": sum(issue["code"] == "unresolved_generated_reference" for issue in issues),
        "ambiguous_references": sum(issue["code"] == "ambiguous_generated_reference" for issue in issues),
        "duplicate_local_ids": sum(issue["code"] == "duplicate_local_generated_id" for issue in issues),
    }
    return ExtractionResult.model_validate(payload), issues, stats

