"""Contracts for model-owned UI feature interpretation and host assembly."""
from __future__ import annotations
import re
from typing import Any

NARRATIVE_SCHEMA_VERSION = "ui-synthesis.v3"
FEATURE_RESPONSE_SCHEMA_VERSION = "ui-feature-response.v1"
INSIGHT_TYPES = ["groundwater_quality", "water_level", "water_level_trend", "aquifer_depth", "lithology", "well_construction", "yield_or_discharge", "geological_transition", "regional_reference", "infrastructure_inventory", "combined_signal", "insufficient_evidence"]

def _obj(properties: dict[str, Any]) -> dict[str, Any]:
    return {"type": "object", "additionalProperties": False, "properties": properties, "required": list(properties)}

def _nullable(kind: str) -> dict[str, Any]:
    return {"anyOf": [{"type": kind}, {"type": "null"}]}

def feature_generation_schema(allowed: dict[str, list[str]] | None = None) -> dict[str, Any]:
    # Keep handles syntactically constrained but do not use an enum here.  An
    # unknown handle must reach host reconciliation so it can be dropped and
    # audited without turning an otherwise useful narrative into a failed call.
    handle = {"type": "string", "pattern": r"^e[0-9]+$"}
    insight = _obj({"type": {"type": "string", "enum": ["comparison", "measurement", "trend", "geology", "context", "location", "inventory"]}, "title": {"type": "string"}, "explanation": {"type": "string"}, "evidence_handles": {"type": "array", "items": handle}})
    return _obj({"insight_type": {"type": "string", "enum": INSIGHT_TYPES}, "headline": {"type": "string"}, "summary": {"type": "string"}, "why_it_matters": {"type": "string"}, "visual_takeaway": {"type": "string"}, "insights": {"type": "array", "items": insight}, "secondary_context": _nullable("string")})

def _numeric_tokens(value: Any) -> set[str]:
    return {x.replace(",", "") for x in re.findall(r"(?<![A-Za-z])[-+]?\d+(?:\.\d+)?", str(value))}

def validate_feature_insight(item: dict[str, Any], context: dict[str, Any], requested_id: str | None = None) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    if requested_id is not None and item.get("feature_id") != requested_id:
        issues.append({"path": "feature_id", "message": f"must equal requested feature {requested_id}"})
    handles = set(context.get("allowed_references", {}).get("evidence_handles", []))
    text = " ".join(str(item.get(k) or "") for k in ("headline", "summary", "why_it_matters", "visual_takeaway", "secondary_context"))
    for i, detail in enumerate(item.get("insights", [])):
        if not detail.get("evidence_handles"):
            issues.append({"path": f"insights[{i}]", "message": "insight has no evidence handle"})
        for value in detail.get("evidence_handles", []):
            if value not in handles:
                issues.append({"path": f"insights[{i}].evidence_handles", "message": f"unknown evidence handle {value}"})
        text += " " + str(detail.get("title") or "") + " " + str(detail.get("explanation") or "")
    allowed_numbers: set[str] = set()
    for source in (context.get("feature", {}), *context.get("observations", []), *context.get("intervals", []), *context.get("derived_signals", []), *context.get("evidence_units", []), *context.get("peer_context", [])):
        allowed_numbers |= _numeric_tokens(source)
    unsupported = _numeric_tokens(text) - allowed_numbers
    if unsupported:
        issues.append({"path": "narrative_text", "message": f"unsupported numeric claims: {sorted(unsupported)}"})
    if re.search(r"\[(?:obs|int|dataset|src)[^\]]*\]", text, re.I):
        issues.append({"path": "narrative_text", "message": "inline citation token is not allowed"})
    return issues

def validate_narrative(package: dict[str, Any], ui: dict[str, Any], evidence_ids: set[str], expected_feature_ids: set[str] | None = None) -> dict[str, Any]:
    issues: list[dict[str, Any]] = []; warnings: list[dict[str, Any]] = []
    feature_ids = {x.get("id") for x in ui.get("features", []) if isinstance(x, dict)}
    observation_ids = {x.get("id") for x in ui.get("observations", []) if isinstance(x, dict)}
    interval_ids = {x.get("id") for x in ui.get("intervals", []) if isinstance(x, dict)}
    dataset_ids = {x.get("id") for x in ui.get("extensions", {}).get("datasets", []) if isinstance(x, dict)}
    if package.get("schema_version") != NARRATIVE_SCHEMA_VERSION: issues.append({"path": "schema_version", "message": "unsupported UI synthesis schema version"})
    if package.get("report_id") != (ui.get("report") or {}).get("id"): issues.append({"path": "report_id", "message": "report_id must match UI package"})
    items = package.get("feature_insights", []); seen: set[str] = set(); usable = 0
    for i, item in enumerate(items):
        fid = item.get("feature_id") if isinstance(item, dict) else None
        if fid not in feature_ids: issues.append({"path": f"feature_insights[{i}]", "message": "unknown feature_id"})
        if expected_feature_ids is not None and fid not in expected_feature_ids: issues.append({"path": f"feature_insights[{i}]", "message": "feature is outside active narrative scope"})
        if fid in seen: issues.append({"path": f"feature_insights[{i}]", "message": "duplicate feature_id"})
        seen.add(fid)
        if item.get("summary") and item.get("insights"): usable += 1
        for ref in item.get("evidence_refs", []):
            if ref not in evidence_ids: warnings.append({"path": f"feature_insights[{i}].evidence_refs", "message": f"unknown evidence reference {ref}"})
        for j, detail in enumerate(item.get("insights", [])):
            for field, allowed in (("observation_ids", observation_ids), ("interval_ids", interval_ids), ("dataset_ids", dataset_ids)):
                for ref in detail.get(field, []):
                    if ref not in allowed: warnings.append({"path": f"feature_insights[{i}].insights[{j}].{field}", "message": f"unknown {field[:-4]} reference {ref}"})
    expected = feature_ids if expected_feature_ids is None else set(expected_feature_ids)
    missing = expected - seen
    for fid in sorted(missing): issues.append({"path": "feature_insights", "message": f"missing feature insight {fid}"})
    if expected and usable == 0: issues.append({"path": "feature_insights", "message": "package contains no usable feature insights"})
    return {"valid": not issues, "issues": issues, "warnings": warnings, "counts": {"features": len(items), "missing_features": len(missing), "usable_features": usable, "insights": sum(len(x.get("insights", [])) for x in items if isinstance(x, dict))}}
