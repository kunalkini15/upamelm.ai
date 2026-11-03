from __future__ import annotations
from typing import Any

def _obj(p: dict[str, Any]) -> dict[str, Any]: return {"type":"object","additionalProperties":False,"properties":p,"required":list(p)}
def _null(t: str) -> dict[str, Any]: return {"anyOf":[{"type":t},{"type":"null"}]}
def _strs() -> dict[str, Any]: return {"type":"array","items":{"type":"string"}}
def _arr(item: dict[str, Any]) -> dict[str, Any]: return {"type":"array","items":item}

def extraction_schema() -> dict[str, Any]:
    locator=_obj({"kind":{"type":"string"},"artifact_id":{"type":"string"},"unit_id":_null("string"),"page":_null("integer"),"sheet":_null("string"),"cell_range":_null("string"),"row":_null("integer"),"json_pointer":_null("string"),"feature_id":_null("string"),"bbox":{"anyOf":[{"type":"array","items":{"type":"number"}},{"type":"null"}]}})
    ref=_obj({"artifact_id":{"type":"string"},"locator":locator,"excerpt":_null("string")})
    prop=_obj({"name":{"type":"string"},"value":{"type":"string"},"unit":_null("string")})
    item=_obj({"evidence_id":{"type":"string"},"kind":{"type":"string"},"statement":{"type":"string"},"subject":_null("string"),"value":_null("string"),"unit":_null("string"),"confidence":{"type":"string","enum":["high","medium","low"]},"basis":{"type":"string","enum":["direct","source_interpretation","derived"]},"evidence":{"type":"array","items":ref,"minItems":1},"properties":_arr(prop)})
    entity=_obj({"entity_id":{"type":"string"},"name":{"type":"string"},"type":{"type":"string"},"description":_null("string"),"aliases":_strs(),"evidence_refs":_strs()})
    spatial=_obj({"feature_id":{"type":"string"},"name":{"type":"string"},"type":{"type":"string"},"geometry_json":_null("string"),"latitude":_null("number"),"longitude":_null("number"),"source_asset_id":_null("string"),"fidelity":{"type":"string"},"evidence_refs":_strs(),"properties":_arr(prop)})
    interval=_obj({"interval_id":{"type":"string"},"feature_id":_null("string"),"name":{"type":"string"},"type":{"type":"string"},"axis":{"type":"string"},"reference":{"type":"string"},"start":_null("number"),"end":_null("number"),"unit":_null("string"),"material":_null("string"),"fidelity":{"type":"string"},"evidence_refs":_strs()})
    relation=_obj({"relationship_id":{"type":"string"},"type":{"type":"string"},"from_id":{"type":"string"},"to_id":{"type":"string"},"description":_null("string"),"evidence_refs":_strs()})
    visual=_obj({"visual_id":{"type":"string"},"artifact_id":{"type":"string"},"type":{"type":"string"},"title":_null("string"),"interpretation":{"type":"string"},"page":_null("integer"),"bbox":{"anyOf":[{"type":"array","items":{"type":"number"}},{"type":"null"}]},"evidence_refs":_strs(),"limitations":_strs()})
    return _obj({"batch_id":{"type":"string"},"summary":{"type":"string"},"entities":_arr(entity),"evidence_items":_arr(item),"spatial_features":_arr(spatial),"vertical_intervals":_arr(interval),"relationships":_arr(relation),"visual_interpretations":_arr(visual),"limitations":_strs(),"unresolved_items":_strs()})

def visual_classification_schema() -> dict[str, Any]:
    item = _obj({
        "artifact_id": {"type": "string"},
        "classification": {"type": "string", "enum": ["text_only", "duplicate", "decorative", "table", "map", "borehole_log", "geological_section", "chart", "engineering_drawing", "photograph", "other"]},
        "meaningful": {"type": "boolean"},
        "reason": {"type": "string"},
        "duplicate_of": _null("string"),
        "suggested_extraction": {"type": "string", "enum": ["none", "deep_visual", "table", "map_geometry", "diagram"]},
    })
    return _obj({"classifications": _arr(item), "limitations": _strs()})

def scientific_schema() -> dict[str, Any]:
    prop=_obj({"name":{"type":"string"},"value":{"type":"string"},"unit":_null("string")})
    report=_obj({"id":{"type":"string"},"title":{"type":"string"},"short_title":_null("string"),"date":_null("string"),"organization":_null("string"),"summary":{"type":"string"},"domain":{"type":"string"},"source_refs":_strs()})
    bounds=_obj({"east":{"type":"number"},"north":{"type":"number"},"south":{"type":"number"},"west":{"type":"number"}})
    area=_obj({"id":{"type":"string"},"name":{"type":"string"},"type":{"type":"string"},"summary":{"type":"string"},"bounds":{"anyOf":[bounds,{"type":"null"}]},"source_refs":_strs(),"aliases":_strs()})
    geometry=_obj({"type":{"type":"string"},"coordinates":{"type":"array","items":{"type":"number"}}})
    feature=_obj({"id":{"type":"string"},"name":{"type":"string"},"type":{"type":"string"},"study_area_id":_null("string"),"location_description":_null("string"),"source_identifier":_null("string"),"properties":_arr(prop),"source_refs":_strs(),"dataset_ids":_strs(),"aliases":_strs(),"geometry":{"anyOf":[geometry,{"type":"null"}]},"fidelity":{"type":"string"}})
    obs=_obj({"id":{"type":"string"},"type":{"type":"string"},"category":_null("string"),"value":_null("string"),"unit":_null("string"),"original_value":_null("string"),"date":_null("string"),"qualifier":_null("string"),"fidelity":{"type":"string"},"feature_id":_null("string"),"study_area_id":_null("string"),"source_refs":_strs()})
    interval=_obj({"id":{"type":"string"},"name":{"type":"string"},"type":{"type":"string"},"axis":{"type":"string"},"reference":{"type":"string"},"start":_null("number"),"end":_null("number"),"thickness":_null("number"),"unit":_null("string"),"material":_null("string"),"qualifier":_null("string"),"fidelity":{"type":"string"},"feature_id":_null("string"),"study_area_id":_null("string"),"source_refs":_strs()})
    source=_obj({"id":{"type":"string"},"document_id":_null("string"),"page":_null("integer"),"locator":_null("string"),"table":_null("string"),"figure":_null("string")})
    dataset=_obj({"id":{"type":"string"},"name":{"type":"string"},"kind":{"type":"string"},"source_id":{"type":"string"},"path":_null("string"),"feature_count":_null("integer"),"row_count":_null("integer"),"geometry_types":_strs(),"columns":_strs(),"source_refs":_strs()})
    rel=_obj({"id":{"type":"string"},"type":{"type":"string"},"from_id":{"type":"string"},"to_id":{"type":"string"},"description":_null("string"),"source_refs":_strs()})
    return _obj({"schema_version":{"type":"string","enum":["1.0"]},"report":report,"study_areas":_arr(area),"features":_arr(feature),"observations":_arr(obs),"intervals":_arr(interval),"sources":_arr(source),"extensions":_obj({"datasets":_arr(dataset),"relationships":_arr(rel)})})

def narratives_schema() -> dict[str, Any]:
    insight=_obj({"id":{"type":"string"},"type":{"type":"string"},"title":{"type":"string"},"explanation":{"type":"string"},"observation_ids":_strs(),"interval_ids":_strs(),"dataset_ids":_strs(),"evidence_refs":_strs(),"grounding_status":{"type":"string"}})
    feat=_obj({"feature_id":{"type":"string"},"status":{"type":"string"},"insight_type":{"type":"string"},"headline":{"type":"string"},"summary":{"type":"string"},"why_it_matters":{"type":"string"},"visual_takeaway":{"type":"string"},"insights":_arr(insight),"secondary_context":_null("string"),"evidence_refs":_strs()})
    return _obj({"feature_insights":_arr(feat),"limitations":_strs()})

def report_schema() -> dict[str, Any]:
    overview=_obj({"headline":{"type":"string"},"abstract":{"type":"string"},"key_finding_ids":_strs(),"key_stat_callout_ids":_strs(),"generation_mode":{"type":"string"}})
    theme=_obj({"id":{"type":"string"},"title":{"type":"string"},"summary":{"type":"string"},"chapter_ids":_strs(),"finding_ids":_strs()})
    chapter=_obj({"id":{"type":"string"},"theme_id":{"type":"string"},"title":{"type":"string"},"summary":{"type":"string"},"narrative":{"type":"string"},"finding_ids":_strs(),"evidence_refs":_strs(),"focal_feature_ids":_strs(),"focal_study_area_ids":_strs(),"focal_observation_ids":_strs(),"focal_interval_ids":_strs(),"focal_dataset_ids":_strs()})
    finding=_obj({"id":{"type":"string"},"title":{"type":"string"},"statement":{"type":"string"},"why_it_matters":{"type":"string"},"scope":{"type":"string"},"pattern_type":{"type":"string"},"basis":{"type":"string"},"confidence":{"type":"string"},"feature_ids":_strs(),"study_area_ids":_strs(),"observation_ids":_strs(),"interval_ids":_strs(),"dataset_ids":_strs(),"evidence_refs":_strs(),"stat_callout_ids":_strs()})
    stat=_obj({"id":{"type":"string"},"label":{"type":"string"},"kind":_null("string"),"value":_null("number"),"minimum":_null("number"),"maximum":_null("number"),"category":_null("string"),"unit":_null("string"),"qualifier":_null("string"),"evidence_refs":_strs()})
    uncertain=_obj({"id":{"type":"string"},"statement":{"type":"string"},"theme_id":_null("string")})
    coverage=_obj({"summary":{"type":"string"},"source_count":{"type":"integer"},"feature_count":{"type":"integer"},"finding_count":{"type":"integer"},"limitations":_strs()})
    return _obj({"schema_version":{"type":"string"},"report_id":{"type":"string"},"executive_overview":overview,"themes":_arr(theme),"chapters":_arr(chapter),"findings":_arr(finding),"stat_callouts":_arr(stat),"uncertainties":_arr(uncertain),"coverage":coverage})
