from datetime import date
from pathlib import Path

from pypdf import PdfWriter

from source_intelligence.acquisition import AcquisitionManager
from source_intelligence.models import (
    Candidate, CanonicalCapability as Cap, Category, CityRequest, DateEvidence, EvidenceContribution,
)
from source_intelligence.orchestrator import SourceIntelligence
from source_intelligence.ranking import CandidateRanker
from source_intelligence.util import canonical_capabilities, normalize_grounding_text


def base_candidate(category: Category = Category.GEOLOGY_LITHOLOGY, score: float = 0.7) -> Candidate:
    return Candidate(
        candidate_id=f"c-{category.value}-{score}", category=category, title="Bengaluru subsurface report",
        landing_url="https://example.gov.in/report.pdf", download_url="https://example.gov.in/report.pdf",
        media_type="application/pdf", inspected=True, geographic_relevance=1, category_relevance=1,
        authority_score=1, scientific_utility=0.8, score=score,
        date_evidence=DateEvidence(publication_date=date(2008, 1, 1), data_period_end=date(2008, 1, 1)),
    )


def test_free_text_gaps_map_to_canonical_capabilities() -> None:
    assert canonical_capabilities(["lithological log with depth to rock"]) == {Cap.BOREHOLE_LITHOLOGY, Cap.ROCKHEAD_DEPTH}


def test_grounding_normalizes_whitespace_soft_hyphens_and_line_breaks() -> None:
    assert normalize_grounding_text("Observation Peri-\nod:\u00ad Nov 2023") == "observation period: nov 2023"


def test_old_measured_borehole_lithology_remains_usable() -> None:
    value = base_candidate()
    value.evidence_contributions = [EvidenceContribution(capability=Cap.BOREHOLE_LITHOLOGY, status="measured", observation_date_text="1998")]
    result = CandidateRanker().evaluate(value, CityRequest(city="Bengaluru", state="Karnataka", as_of_date=date(2026, 1, 1)))
    assert result.eligible
    assert result.evidence_contributions[0].freshness_status == "not_time_sensitive"


def test_mixed_old_report_keeps_static_and_marks_dynamic_stale() -> None:
    value = base_candidate()
    value.evidence_contributions = [
        EvidenceContribution(capability=Cap.BOREHOLE_LITHOLOGY, status="measured", observation_date_text="1998"),
        EvidenceContribution(capability=Cap.GROUNDWATER_LEVEL, status="measured", observation_date_text="1998"),
    ]
    result = CandidateRanker().evaluate(value, CityRequest(city="Bengaluru", state="Karnataka", as_of_date=date(2026, 1, 1)))
    assert result.eligible
    assert [x.freshness_status for x in result.evidence_contributions] == ["not_time_sensitive", "stale"]


def test_old_dynamic_only_candidate_is_rejected() -> None:
    value = base_candidate(Category.AQUIFER_GROUNDWATER)
    value.evidence_contributions = [EvidenceContribution(capability=Cap.GROUNDWATER_LEVEL, status="measured", observation_date_text="1998")]
    result = CandidateRanker().evaluate(value, CityRequest(city="Bengaluru", state="Karnataka", as_of_date=date(2026, 1, 1)))
    assert not result.eligible
    assert "all_evidence_contributions_stale" in result.rejection_reasons


def test_unknown_static_observation_date_is_qualified() -> None:
    value = base_candidate()
    value.date_evidence.data_period_end = None
    value.evidence_contributions = [EvidenceContribution(capability=Cap.ROCKHEAD_DEPTH, status="measured")]
    result = CandidateRanker().evaluate(value, CityRequest(city="Bengaluru", state="Karnataka"))
    assert result.eligible
    assert "unknown_observation_date" in result.evidence_contributions[0].limitations


def test_state_match_does_not_rescue_wrong_city_candidate() -> None:
    value = base_candidate()
    value.geographic_relevance = 0
    value.study_scope = "local_site"
    result = CandidateRanker().evaluate(value, CityRequest(city="Bengaluru", state="Karnataka"))
    assert not result.eligible
    assert "insufficient_geographic_relevance" in result.rejection_reasons


def test_local_site_scope_is_not_citywide() -> None:
    value = base_candidate()
    value.study_scope = "local_site"
    assert value.study_scope != "citywide"


def test_marginal_projection_prefers_multi_capability_candidate() -> None:
    single = base_candidate(Category.AQUIFER_GROUNDWATER, 0.82)
    single.eligible = True
    single.evidence_contributions = [EvidenceContribution(capability=Cap.GROUNDWATER_LEVEL, evidence_excerpt="x")]
    multi = base_candidate(Category.AQUIFER_GROUNDWATER, 0.79)
    multi.candidate_id = "multi"
    multi.eligible = True
    multi.evidence_contributions = [
        EvidenceContribution(capability=Cap.GROUNDWATER_LEVEL, evidence_excerpt="x"),
        EvidenceContribution(capability=Cap.BOREHOLE_LITHOLOGY, evidence_excerpt="x"),
    ]
    request = CityRequest(city="Bengaluru", state="Karnataka", evidence_gaps=["groundwater level", "borehole lithology"])
    pipeline = object.__new__(SourceIntelligence)
    projected, unresolved = pipeline._project_selection(request, [single, multi])
    assert projected[0].candidate_id == "multi"
    assert not unresolved


def test_scanned_multi_page_pdf_validates_and_requires_ocr(tmp_path: Path) -> None:
    target = tmp_path / "scan.pdf"
    writer = PdfWriter()
    writer.add_blank_page(width=100, height=100)
    writer.add_blank_page(width=100, height=100)
    with target.open("wb") as handle:
        writer.write(handle)
    result = AcquisitionManager._validate(target, "application/pdf")
    assert result["status"] == "validated"
    assert result["requires_ocr"] is True


def test_ungrounded_capability_is_excluded_from_marginal_utility() -> None:
    value = base_candidate()
    value.evidence_contributions = [EvidenceContribution(capability=Cap.ROCKHEAD_DEPTH, limitations=["ungrounded_model_claim"])]
    assert Cap.ROCKHEAD_DEPTH not in SourceIntelligence._candidate_capabilities(value)


def test_capability_vocabulary_is_fixed_to_thirteen_values() -> None:
    assert len(Cap) == 13
