from datetime import date

from source_intelligence.models import Candidate, Category, CityRequest, DateEvidence
from source_intelligence.ranking import CandidateRanker


def candidate(publication_year: int, data_year: int) -> Candidate:
    return Candidate(
        candidate_id="candidate_1", category=Category.AQUIFER_GROUNDWATER, title="Aquifer report",
        landing_url="https://example.com/report.pdf", download_url="https://example.com/report.pdf",
        media_type="application/pdf", geographic_relevance=1, category_relevance=1, authority_score=1, scientific_utility=0.8,
        date_evidence=DateEvidence(
            publication_date=date(publication_year, 12, 31), data_period_end=date(data_year, 12, 31),
            basis="document_text", confidence=0.9,
        ), inspected=True,
    )


def test_recent_candidate_is_eligible() -> None:
    request = CityRequest(city="Bengaluru", state="Karnataka", as_of_date=date(2026, 11, 3))
    result = CandidateRanker().evaluate(candidate(2025, 2025), request)
    assert result.eligible
    assert result.score > 0


def test_stale_data_is_rejected_even_with_recent_publication() -> None:
    request = CityRequest(city="Bengaluru", state="Karnataka", as_of_date=date(2026, 11, 3))
    result = CandidateRanker().evaluate(candidate(2026, 2017), request)
    assert not result.eligible
    assert "stale_data" in result.rejection_reasons


def test_unknown_data_vintage_is_qualified() -> None:
    request = CityRequest(city="Bengaluru", state="Karnataka", as_of_date=date(2026, 11, 3))
    value = candidate(2025, 2025)
    value.date_evidence.data_period_end = None
    result = CandidateRanker().evaluate(value, request)
    assert result.eligible
    assert "unknown_observation_date" in result.limitations


def test_untrusted_source_is_qualified_not_decisively_rejected() -> None:
    request = CityRequest(city="Bengaluru", state="Karnataka", as_of_date=date(2026, 11, 3))
    value = candidate(2025, 2025)
    value.authority_score = 0.35
    result = CandidateRanker().evaluate(value, request)
    assert result.eligible
    assert "publisher_authority_unverified" in result.limitations

