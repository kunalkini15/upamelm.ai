from research_engine_v2.narrative_contract import NARRATIVE_SCHEMA_VERSION, feature_generation_schema, validate_feature_insight, validate_narrative
from research_engine_v2.narrative_synthesizer import NarrativeSynthesizer


def test_narrative_units_and_lexical_retrieval_are_deterministic():
    projection = {"groups": [{"target_id": "t1", "chunks": [{"chunk_id": "c1", "target_id": "t1", "document_id": "d1", "pages": [93], "records": {"items": [{"_evidence_id": "ev1", "record_id": "r1", "site": "Nasmed", "observation": "TDS 3210 mg/L"}]}}]}]}
    units = NarrativeSynthesizer._build_units(projection)
    index = NarrativeSynthesizer._build_index(units)
    results = NarrativeSynthesizer._lexical_search("Nasmed confined water", units, set(), 8)
    assert units[0]["id"] == "ev1"
    assert index["by_record"]["r1"] == ["ev1"]
    assert results[0]["id"] == "ev1"


def test_renderability_uses_geometry_without_report_specific_cutoffs():
    eligible = NarrativeSynthesizer._feature_eligibility({"id": "f", "geometry": {"type": "Point", "coordinates": [72.1, 23.1]}})
    zero = NarrativeSynthesizer._feature_eligibility({"id": "z", "geometry": {"type": "Point", "coordinates": [0, 0]}})
    assert eligible["eligible"] and eligible["reason"] == "valid_point_geometry"
    assert zero["eligible"]


def test_renderability_falls_back_only_to_explicit_numeric_properties():
    eligible = NarrativeSynthesizer._feature_eligibility({"id": "f", "properties": {"latitude_reported": "-12.5", "longitude_x_long": "44.25"}})
    excluded = NarrativeSynthesizer._feature_eligibility({"id": "x", "properties": {"latitude": "12 N", "longitude": "44 E"}})
    assert eligible["eligible"] and eligible["coordinate_source"] == "properties"
    assert not excluded["eligible"]


def test_model_schema_has_no_host_owned_identifiers():
    schema = feature_generation_schema({"evidence_handles": ["e1", "e2"]})
    props = schema["properties"]
    assert "feature_id" not in props
    assert "insight_id" not in props
    assert "dataset_ids" not in props
    assert props["insights"]["items"]["properties"]["evidence_handles"]["items"]["pattern"] == r"^e[0-9]+$"


def test_model_response_validation_accepts_local_handles():
    context = {"feature": {"name": "Koba"}, "allowed_references": {"evidence_handles": ["e1"]}, "observations": [{"value": 520, "unit": "mg/L"}], "intervals": [], "derived_signals": [], "evidence_units": [], "peer_context": []}
    item = {"insight_type": "groundwater_quality", "headline": "Koba", "summary": "TDS was 520 mg/L.", "why_it_matters": "Useful", "visual_takeaway": "Compare", "secondary_context": None, "insights": [{"type": "measurement", "title": "TDS", "explanation": "520 mg/L", "evidence_handles": ["e1"]}]}
    assert validate_feature_insight(item, context) == []


def test_host_assembly_attaches_identity_and_resolves_handles():
    context = {"feature": {"name": "Koba"}, "evidence_handle_map": {"e1": {"evidence_ref": "ev1", "observation_ids": ["o1"], "interval_ids": [], "dataset_ids": ["d1"]}}}
    audit = {}
    item = {"insight_type": "groundwater_quality", "headline": "Koba", "summary": "Useful", "why_it_matters": "Useful", "visual_takeaway": "Compare", "secondary_context": None, "insights": [{"type": "measurement", "title": "TDS", "explanation": "Reported", "evidence_handles": ["e1", "bad"]}]}
    assembled = NarrativeSynthesizer._assemble_model_result(item, "f1", context, audit)
    assert assembled["feature_id"] == "f1"
    assert assembled["insights"][0]["observation_ids"] == ["o1"]
    assert assembled["insights"][0]["dataset_ids"] == ["d1"]
    assert assembled["insights"][0]["evidence_refs"] == ["ev1"]
    assert audit["unresolved_model_handles"]


def test_narrative_validation_rejects_empty_usable_package():
    ui = {"schema_version": "1.0", "report": {"id": "r1"}, "features": [{"id": "f1"}], "observations": [], "intervals": [], "extensions": {"datasets": []}}
    package = {"schema_version": NARRATIVE_SCHEMA_VERSION, "report_id": "r1", "feature_insights": [{"feature_id": "f1", "status": "limited", "insight_type": "insufficient_evidence", "headline": "F1", "summary": "", "why_it_matters": "", "visual_takeaway": "", "insights": [], "secondary_context": None, "evidence_refs": []}]}
    result = validate_narrative(package, ui, {"ev1"})
    assert not result["valid"]
    assert any("no usable" in x["message"] for x in result["issues"])
