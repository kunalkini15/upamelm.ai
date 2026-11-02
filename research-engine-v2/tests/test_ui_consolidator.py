import json

import pytest

from research_engine_v2.ui_consolidator import consolidate_ui_packages


def _write_packages(tmp_path):
    rendering = {
        "schema_version": "1.0",
        "report": {"id": "r1"},
        "study_areas": [{"id": "a1"}],
        "features": [{"id": "f1", "geometry": {"type": "Point", "coordinates": [1, 2]}}, {"id": "f2", "properties": {"name": "unmapped"}}],
        "observations": [{"id": "o1"}], "intervals": [], "sources": [], "extensions": {"datasets": [], "relationships": []},
    }
    narrative = {
        "schema_version": "ui-synthesis.v3", "report_id": "r1",
        "feature_insights": [{"feature_id": "f1", "status": "complete", "summary": "Useful", "insights": [], "evidence_refs": []}],
        "coverage": {"features_with_narratives": 1},
    }
    (tmp_path / "ui_rendering_package.json").write_text(json.dumps(rendering), encoding="utf-8")
    (tmp_path / "ui_synthesis_package.json").write_text(json.dumps(narrative), encoding="utf-8")


def test_consolidator_embeds_by_exact_id_and_preserves_unmatched_features(tmp_path):
    _write_packages(tmp_path)
    result = consolidate_ui_packages(tmp_path)
    package = json.loads((tmp_path / "ui_consolidated_package.json").read_text())
    assert result["status"] == "completed"
    assert package["schema_version"] == "ui-consolidated.v1"
    assert package["features"][0]["narrative"]["summary"] == "Useful"
    assert "narrative" not in package["features"][1]
    assert package["observations"] == [{"id": "o1"}]
    assert result["report"]["joined_feature_count"] == 1


def test_consolidator_rejects_report_mismatch(tmp_path):
    _write_packages(tmp_path)
    narrative = json.loads((tmp_path / "ui_synthesis_package.json").read_text())
    narrative["report_id"] = "different"
    (tmp_path / "ui_synthesis_package.json").write_text(json.dumps(narrative), encoding="utf-8")
    with pytest.raises(ValueError, match="different report IDs"):
        consolidate_ui_packages(tmp_path)


def test_consolidator_audits_unknown_narrative_ids(tmp_path):
    _write_packages(tmp_path)
    narrative = json.loads((tmp_path / "ui_synthesis_package.json").read_text())
    narrative["feature_insights"].append({"feature_id": "unknown", "summary": "ignored", "insights": []})
    (tmp_path / "ui_synthesis_package.json").write_text(json.dumps(narrative), encoding="utf-8")
    result = consolidate_ui_packages(tmp_path)
    assert result["report"]["unknown_narrative_feature_ids"] == ["unknown"]
    assert len(json.loads((tmp_path / "ui_consolidated_package.json").read_text())["features"]) == 2


def test_consolidator_rejects_duplicate_ids(tmp_path):
    _write_packages(tmp_path)
    rendering = json.loads((tmp_path / "ui_rendering_package.json").read_text())
    rendering["features"].append({"id": "f1"})
    (tmp_path / "ui_rendering_package.json").write_text(json.dumps(rendering), encoding="utf-8")
    with pytest.raises(ValueError, match="duplicate scientific"):
        consolidate_ui_packages(tmp_path)
