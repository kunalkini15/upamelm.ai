"""Scientific-data contract for the UI-only synthesizer."""
from __future__ import annotations

import copy
import hashlib
import re
from typing import Any

UI_SCHEMA_VERSION = "1.0"
ROOT_KEYS = ("schema_version", "report", "study_areas", "features", "observations", "intervals", "sources", "extensions")
COLLECTION_KEYS = ("study_areas", "features", "observations", "intervals", "sources")


def _nullable(kind: str) -> dict[str, Any]:
    return {"anyOf": [{"type": kind}, {"type": "null"}]}


def _object(properties: dict[str, Any]) -> dict[str, Any]:
    return {"type": "object", "additionalProperties": False, "properties": properties, "required": list(properties)}


def _refs() -> dict[str, Any]:
    return {"type": "array", "items": {"type": "string"}}

def _nullable_schema(schema: dict[str, Any]) -> dict[str, Any]:
    return {"anyOf": [schema, {"type": "null"}]}

def _range_schema() -> dict[str, Any]:
    value = {"anyOf": [{"type": "number"}, {"type": "string"}, {"type": "null"}]}
    return _object({"minimum": value, "maximum": value})

def _bounds_schema() -> dict[str, Any]:
    value = {"anyOf": [{"type": "number"}, {"type": "null"}]}
    return _object({"south": value, "west": value, "north": value, "east": value})

def _geometry_schema() -> dict[str, Any]:
    coordinate = {"anyOf": [{"type": "number"}, {"type": "array", "items": {"anyOf": [
        {"type": "number"}, {"type": "array", "items": {"anyOf": [
            {"type": "number"}, {"type": "array", "items": {"type": "number"}}
        ]}}
    ]}}]}
    return _object({"type": {"type": "string"}, "coordinates": {"type": "array", "items": coordinate}, "crs": _nullable("string")})

def _attribute_schema() -> dict[str, Any]:
    return _object({"name": {"type": "string"}, "value": {"anyOf": [{"type": "string"}, {"type": "number"}, {"type": "boolean"}, {"type": "null"}]}, "unit": _nullable("string")})


def generation_schema(kind: str = "fragment") -> dict[str, Any]:
    """Strict schema: Muse requires every declared property to be required."""
    source_refs = _refs()
    study_area = _object({
        "id": {"type": "string"}, "type": {"type": "string"}, "name": {"type": "string"},
        "aliases": {"type": "array", "items": {"type": "string"}},
        "parent_study_area_id": _nullable("string"), "summary": _nullable("string"),
        "geometry": _nullable_schema(_geometry_schema()), "bounds": _nullable_schema(_bounds_schema()), "source_refs": source_refs,
    })
    feature = _object({
        "id": {"type": "string"}, "type": {"type": "string"}, "name": {"type": "string"},
        "aliases": {"type": "array", "items": {"type": "string"}}, "study_area_id": _nullable("string"),
        "source_identifier": _nullable("string"), "location_description": _nullable("string"),
        "geometry": _nullable_schema(_geometry_schema()), "properties": {"type": "array", "items": _attribute_schema()},
        "dataset_ids": {"type": "array", "items": {"type": "string"}}, "source_refs": source_refs,
    })
    observation = _object({
        "id": {"type": "string"}, "type": {"type": "string"}, "feature_id": _nullable("string"),
        "study_area_id": _nullable("string"), "value": {"anyOf": [{"type": "number"}, {"type": "string"}, {"type": "boolean"}, {"type": "null"}]},
        "value_range": _nullable_schema(_range_schema()), "category": _nullable("string"),
        "detection_limit": {"anyOf": [{"type": "number"}, {"type": "string"}, {"type": "null"}]}, "unit": _nullable("string"),
        "date": _nullable("string"), "qualifier": _nullable("string"), "fidelity": _nullable("string"),
        "original_value": _nullable("string"), "source_refs": source_refs,
    })
    interval = _object({
        "id": {"type": "string"}, "type": {"type": "string"}, "name": _nullable("string"),
        "feature_id": _nullable("string"), "study_area_id": _nullable("string"), "axis": {"type": "string"},
        "reference": {"type": "string"}, "unit": {"type": "string"},
        "start": {"anyOf": [{"type": "number"}, {"type": "string"}, {"type": "null"}]}, "end": {"anyOf": [{"type": "number"}, {"type": "string"}, {"type": "null"}]},
        "thickness": {"anyOf": [{"type": "number"}, {"type": "string"}, {"type": "null"}]}, "range": _nullable_schema(_range_schema()),
        "categorical_position": _nullable("string"), "material": _nullable("string"),
        "qualifier": _nullable("string"), "fidelity": _nullable("string"), "source_refs": source_refs,
    })
    relationship = _object({
        "id": {"type": "string"}, "type": {"type": "string"}, "from_id": {"type": "string"},
        "to_id": {"type": "string"}, "qualifier": _nullable("string"), "fidelity": _nullable("string"), "source_refs": source_refs,
    })
    source = _object({
        "id": {"type": "string"}, "document_id": _nullable("string"), "page": {"anyOf": [{"type": "integer"}, {"type": "null"}]},
        "printed_page": {"anyOf": [{"type": "string"}, {"type": "integer"}, {"type": "null"}]}, "table": _nullable("string"),
        "figure": _nullable("string"), "row": {"anyOf": [{"type": "integer"}, {"type": "null"}]},
        "source_record_id": _nullable("string"), "locator": _nullable("string"),
    })
    root = {
        "report": _object({"id": {"type": "string"}, "title": {"type": "string"}, "short_title": _nullable("string"), "date": _nullable("string"), "organization": _nullable("string"), "source_refs": source_refs}),
        "study_areas": {"type": "array", "items": study_area}, "features": {"type": "array", "items": feature},
        "observations": {"type": "array", "items": observation}, "intervals": {"type": "array", "items": interval},
        "sources": {"type": "array", "items": source},
        "extensions": _object({"datasets": {"type": "array", "items": _object({"id": {"type": "string"}, "type": {"type": "string"}, "name": {"type": "string"}, "feature_id": _nullable("string"), "study_area_id": _nullable("string"), "source_refs": source_refs})}, "relationships": {"type": "array", "items": relationship}}),
    }
    if kind == "reconciliation":
        return _object({"canonical_mappings": {"type": "array", "items": _object({"alias_id": {"type": "string"}, "canonical_id": {"type": "string"}})}})
    return _object(root)


def structured_schema() -> dict[str, Any]:
    return generation_schema("fragment")


def consumer_schema() -> dict[str, Any]:
    return copy.deepcopy(generation_schema("fragment"))


def empty_package(report: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"schema_version": UI_SCHEMA_VERSION, "report": report or {}, "study_areas": [], "features": [], "observations": [], "intervals": [], "sources": [], "extensions": {"datasets": [], "relationships": []}}


def strip_nulls(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: strip_nulls(v) for k, v in value.items() if v is not None}
    if isinstance(value, list):
        return [strip_nulls(v) for v in value]
    return value


def _identity_text(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


def _dedupe_entities(package: dict[str, Any]) -> None:
    """Merge only high-confidence repeated area/feature candidates.

    Batch-local IDs are remapped when normalized type/name/parent identity is
    identical. Ambiguous records remain separate; no fuzzy spatial inference is
    performed here.
    """
    remap: dict[str, str] = {}
    for collection, fields in (("study_areas", ("type", "name")), ("features", ("type", "name", "study_area_id"))):
        canonical_by_key: dict[tuple[str, ...], dict[str, Any]] = {}
        kept: list[dict[str, Any]] = []
        for item in package.get(collection, []):
            key = tuple(_identity_text(item.get(field)) for field in fields)
            if key in canonical_by_key:
                    winner = canonical_by_key[key]
                    old_id, new_id = str(item.get("id")), str(winner.get("id"))
                    if old_id != new_id:
                        remap[old_id] = new_id
                    for field in ("aliases", "source_refs", "dataset_ids"):
                        values = item.get(field)
                        if isinstance(values, list):
                            winner[field] = list(dict.fromkeys((winner.get(field) or []) + values))
                    if not winner.get("geometry") and item.get("geometry"):
                        winner["geometry"] = item["geometry"]
                    continue
            if not key[0] or not key[1]:
                kept.append(item)
                continue
            canonical_by_key[key] = item
            kept.append(item)
        package[collection] = kept
    if remap:
        for collection in ("features", "observations", "intervals"):
            for item in package.get(collection, []):
                for field in ("id", "feature_id", "study_area_id"):
                    if item.get(field) in remap:
                        item[field] = remap[item[field]]
        for item in package.get("extensions", {}).get("relationships", []):
            for field in ("from_id", "to_id"):
                if item.get(field) in remap:
                    item[field] = remap[item[field]]


def _collection_ids(values: Any, path: str) -> tuple[set[str], list[dict[str, Any]]]:
    ids: set[str] = set()
    issues: list[dict[str, Any]] = []
    if not isinstance(values, list):
        return ids, [{"path": path, "message": "must be an array"}]
    for i, item in enumerate(values):
        if not isinstance(item, dict) or not item.get("id"):
            issues.append({"path": f"{path}[{i}]", "message": "stable id is required"})
            continue
        ident = str(item["id"])
        if ident in ids:
            issues.append({"path": f"{path}[{i}].id", "message": "duplicate id"})
        ids.add(ident)
    return ids, issues


def validate(package: dict[str, Any]) -> dict[str, Any]:
    issues: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    if not isinstance(package, dict):
        return {"valid": False, "issues": [{"path": "$", "message": "package must be an object"}], "warnings": [], "counts": {}}
    if package.get("schema_version") != UI_SCHEMA_VERSION:
        issues.append({"path": "schema_version", "message": "unsupported schema version"})
    if set(package) != set(ROOT_KEYS):
        issues.append({"path": "$", "message": f"package must contain exactly {ROOT_KEYS}"})
    all_ids: set[str] = set()
    id_owner: dict[str, str] = {}
    for key in COLLECTION_KEYS:
        ids, local = _collection_ids(package.get(key), key)
        for ident in ids:
            if ident in id_owner:
                issues.append({"path": key, "message": f"ID {ident!r} is duplicated across collections {id_owner[ident]} and {key}"})
            id_owner[ident] = key
        all_ids.update(ids)
        issues.extend(local)
    extensions = package.get("extensions")
    if not isinstance(extensions, dict) or set(extensions) != {"datasets", "relationships"}:
        issues.append({"path": "extensions", "message": "datasets and relationships are required"})
        extensions = {"datasets": [], "relationships": []}
    _, local = _collection_ids(extensions.get("relationships"), "extensions.relationships")
    issues.extend(local)
    source_ids = {x.get("id") for x in package.get("sources", []) if isinstance(x, dict)}
    for key in (*COLLECTION_KEYS, "relationships", "datasets"):
        values = extensions.get(key) if key == "relationships" else package.get(key, [])
        if key == "datasets":
            values = extensions.get("datasets", [])
        for i, item in enumerate(values if isinstance(values, list) else []):
            if isinstance(item, dict):
                missing = [x for x in item.get("source_refs", []) if x not in source_ids]
                if missing:
                    issues.append({"path": f"{key}[{i}].source_refs", "message": f"unresolved source references: {missing}"})
    report = package.get("report")
    if not isinstance(report, dict) or not report.get("id") or not report.get("title"):
        issues.append({"path": "report", "message": "report id and title are required"})
    elif any(ref not in source_ids for ref in report.get("source_refs", [])):
        issues.append({"path": "report.source_refs", "message": "unresolved source reference"})
    for key in ("observations", "intervals"):
        for i, item in enumerate(package.get(key, []) if isinstance(package.get(key), list) else []):
            if not isinstance(item, dict):
                continue
            subject = [item.get("feature_id"), item.get("study_area_id")]
            subject_count = sum(x is not None for x in subject)
            if subject_count > 1:
                issues.append({"path": f"{key}[{i}]", "message": "exactly one feature_id or study_area_id is required"})
            elif subject_count == 0:
                warnings.append({"path": f"{key}[{i}]", "message": "unresolved subject: neither feature_id nor study_area_id is available"})
            reps = ([item.get("value"), item.get("value_range"), item.get("category"), item.get("detection_limit")] if key == "observations" else [item.get(x) for x in ("start", "end", "thickness", "range", "categorical_position")])
            if all(x is None for x in reps):
                warnings.append({"path": f"{key}[{i}]", "message": "no usable value representation"})
    for i, rel in enumerate(extensions.get("relationships", []) if isinstance(extensions.get("relationships"), list) else []):
        if isinstance(rel, dict) and (rel.get("from_id") not in all_ids or rel.get("to_id") not in all_ids):
            warnings.append({"path": f"extensions.relationships[{i}]", "message": "relationship endpoint is not a feature/study-area ID"})
    return {"valid": not issues, "issues": issues, "warnings": warnings, "counts": {k: len(package.get(k, [])) if isinstance(package.get(k), list) else 0 for k in COLLECTION_KEYS}}


def assemble(fragments: list[dict[str, Any]], report: dict[str, Any] | None = None, datasets: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    package = empty_package()
    package["report"] = report or {}
    for fragment in fragments:
        if not isinstance(fragment, dict):
            continue
        if not package["report"] and isinstance(fragment.get("report"), dict):
            package["report"] = copy.deepcopy(fragment["report"])
        for key in COLLECTION_KEYS:
            if isinstance(fragment.get(key), list):
                package[key].extend(copy.deepcopy(x) for x in fragment[key] if isinstance(x, dict))
        ext = fragment.get("extensions") or {}
        if isinstance(ext.get("relationships"), list):
            package["extensions"]["relationships"].extend(copy.deepcopy(x) for x in ext["relationships"] if isinstance(x, dict))
    package["extensions"]["datasets"] = datasets or []
    _dedupe_entities(package)
    # Relationship IDs are often generated locally by independent batches and
    # therefore may collide. Relationships are not identity-bearing subjects,
    # so make their IDs deterministic and unique at assembly time while
    # preserving every source-backed edge.
    seen_relationship_ids: set[str] = set()
    for relationship in package["extensions"]["relationships"]:
        original = str(relationship.get("id") or "relationship")
        if original not in seen_relationship_ids:
            seen_relationship_ids.add(original)
            continue
        signature = "|".join(str(relationship.get(key, "")) for key in ("type", "from_id", "to_id", "qualifier"))
        signature += "|" + ",".join(sorted(str(x) for x in relationship.get("source_refs", [])))
        suffix = hashlib.sha1(signature.encode("utf-8")).hexdigest()[:10]
        candidate = f"{original}_{suffix}"
        counter = 2
        while candidate in seen_relationship_ids:
            candidate = f"{original}_{suffix}_{counter}"
            counter += 1
        relationship["id"] = candidate
        seen_relationship_ids.add(candidate)
    package = strip_nulls(package)
    package["schema_version"] = UI_SCHEMA_VERSION
    return package
