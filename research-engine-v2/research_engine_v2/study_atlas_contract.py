"""Strict generation and consumer contracts for report-level Study Atlas output."""
from __future__ import annotations

from typing import Any

ATLAS_SCHEMA_VERSION = "report-synthesis.v1"


def _obj(properties: dict[str, Any]) -> dict[str, Any]:
    return {"type": "object", "additionalProperties": False, "properties": properties, "required": list(properties)}


def _nullable(kind: str) -> dict[str, Any]:
    return {"anyOf": [{"type": kind}, {"type": "null"}]}


def _nullable_object(properties: dict[str, Any]) -> dict[str, Any]:
    return {"anyOf": [_obj(properties), {"type": "null"}]}


def discovery_schema() -> dict[str, Any]:
    theme = _obj({"title": {"type": "string"}, "summary": {"type": "string"}, "group_handles": {"type": "array", "items": {"type": "string"}}, "priority": {"type": "integer"}})
    return _obj({"themes": {"type": "array", "items": theme}, "background_group_handles": {"type": "array", "items": {"type": "string"}}})


def theme_schema() -> dict[str, Any]:
    callout = _obj({"label": {"type": "string"}, "value": _nullable("number"), "value_range": _nullable_object({"minimum": _nullable("number"), "maximum": _nullable("number")}), "category": _nullable("string"), "unit": _nullable("string"), "qualifier": _nullable("string"), "handles": {"type": "array", "items": {"type": "string"}}})
    finding = _obj({
        "title": {"type": "string"}, "statement": {"type": "string"}, "why_it_matters": {"type": "string"},
        "scope": {"type": "string"}, "pattern_type": {"type": "string"}, "basis": {"type": "string", "enum": ["source_stated", "synthesized_pattern", "deterministic_derived"]},
        "confidence": {"type": "string", "enum": ["high", "medium", "low"]}, "handles": {"type": "array", "items": {"type": "string"}}, "stat_callouts": {"type": "array", "items": callout},
    })
    return _obj({"title": {"type": "string"}, "summary": {"type": "string"}, "chapter_narrative": {"type": "string"}, "findings": {"type": "array", "items": finding}, "uncertainties": {"type": "array", "items": {"type": "string"}}})


def reconciliation_schema() -> dict[str, Any]:
    mapping = _obj({"alias": {"type": "string"}, "canonical": {"type": "string"}})
    return _obj({"mappings": {"type": "array", "items": mapping}, "conflicts": {"type": "array", "items": {"type": "string"}}})


def executive_schema() -> dict[str, Any]:
    return _obj({"headline": {"type": "string"}, "abstract": {"type": "string"}, "finding_handles": {"type": "array", "items": {"type": "string"}}, "stat_handles": {"type": "array", "items": {"type": "string"}}})


def validate_atlas(package: dict[str, Any], ui: dict[str, Any], evidence_ids: set[str]) -> dict[str, Any]:
    issues: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    if package.get("schema_version") != ATLAS_SCHEMA_VERSION:
        issues.append({"path": "schema_version", "message": "unsupported Study Atlas schema"})
    report_id = (ui.get("report") or {}).get("id")
    if package.get("report_id") != report_id:
        issues.append({"path": "report_id", "message": "report_id must match scientific package"})
    feature_ids = {str(x.get("id")) for x in ui.get("features", []) if isinstance(x, dict) and x.get("id")}
    area_ids = {str(x.get("id")) for x in ui.get("study_areas", []) if isinstance(x, dict) and x.get("id")}
    observation_ids = {str(x.get("id")) for x in ui.get("observations", []) if isinstance(x, dict) and x.get("id")}
    interval_ids = {str(x.get("id")) for x in ui.get("intervals", []) if isinstance(x, dict) and x.get("id")}
    dataset_ids = {str(x.get("id")) for x in ui.get("extensions", {}).get("datasets", []) if isinstance(x, dict) and x.get("id")}
    findings = package.get("findings", []) if isinstance(package.get("findings"), list) else []
    finding_ids = {str(x.get("id")) for x in findings if isinstance(x, dict) and x.get("id")}
    if len(finding_ids) != len(findings):
        issues.append({"path": "findings", "message": "finding IDs must be unique"})
    callouts = package.get("stat_callouts", []) if isinstance(package.get("stat_callouts"), list) else []
    callout_ids = {str(x.get("id")) for x in callouts if isinstance(x, dict) and x.get("id")}
    if len(callout_ids) != len(callouts):
        issues.append({"path": "stat_callouts", "message": "stat callout IDs must be unique"})
    for i, callout in enumerate(callouts):
        if not isinstance(callout, dict):
            issues.append({"path": f"stat_callouts[{i}]", "message": "stat callout must be an object"}); continue
        if sum(callout.get(key) is not None for key in ("value", "value_range", "category")) != 1:
            issues.append({"path": f"stat_callouts[{i}]", "message": "exactly one scalar, range, or category representation is required"})
        for ref in callout.get("evidence_refs", []):
            if ref not in evidence_ids: warnings.append({"path": f"stat_callouts[{i}].evidence_refs", "message": f"unknown evidence reference {ref}"})
    for i, finding in enumerate(findings):
        if not isinstance(finding, dict):
            issues.append({"path": f"findings[{i}]", "message": "finding must be an object"}); continue
        for field, allowed in (("feature_ids", feature_ids), ("study_area_ids", area_ids), ("observation_ids", observation_ids), ("interval_ids", interval_ids), ("dataset_ids", dataset_ids)):
            for ref in finding.get(field, []):
                if ref not in allowed: warnings.append({"path": f"findings[{i}].{field}", "message": f"unknown {field[:-4]} reference {ref}"})
        for ref in finding.get("evidence_refs", []):
            if ref not in evidence_ids: warnings.append({"path": f"findings[{i}].evidence_refs", "message": f"unknown evidence reference {ref}"})
    for chapter_index, chapter in enumerate(package.get("chapters", []) if isinstance(package.get("chapters"), list) else []):
        if not isinstance(chapter, dict): continue
        for ref in chapter.get("finding_ids", []):
            if ref not in finding_ids: issues.append({"path": f"chapters[{chapter_index}].finding_ids", "message": f"unknown finding {ref}"})
        for field, allowed in (("focal_feature_ids", feature_ids), ("focal_study_area_ids", area_ids), ("focal_observation_ids", observation_ids), ("focal_interval_ids", interval_ids), ("focal_dataset_ids", dataset_ids)):
            for ref in chapter.get(field, []):
                if ref not in allowed: warnings.append({"path": f"chapters[{chapter_index}].{field}", "message": f"unknown focal reference {ref}"})
    chapters = package.get("chapters", []) if isinstance(package.get("chapters"), list) else []
    if len({str(x.get("id")) for x in chapters if isinstance(x, dict) and x.get("id")}) != len(chapters):
        issues.append({"path": "chapters", "message": "chapter IDs must be unique"})
    executive = package.get("executive_overview") or {}
    for ref in executive.get("key_finding_ids", []):
        if ref not in finding_ids: issues.append({"path": "executive_overview.key_finding_ids", "message": f"unknown finding {ref}"})
    for ref in executive.get("key_stat_callout_ids", []):
        if ref not in callout_ids: issues.append({"path": "executive_overview.key_stat_callout_ids", "message": f"unknown stat callout {ref}"})
    usable = sum(bool(x.get("statement") and x.get("evidence_refs")) for x in findings if isinstance(x, dict))
    if findings and usable == 0: issues.append({"path": "findings", "message": "no grounded findings are available"})
    return {"valid": not issues, "issues": issues, "warnings": warnings, "counts": {"themes": len(package.get("themes", [])), "chapters": len(package.get("chapters", [])), "findings": len(findings), "usable_findings": usable, "stat_callouts": len(callouts)}}
