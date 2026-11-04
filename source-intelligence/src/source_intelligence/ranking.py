from __future__ import annotations

import re
from datetime import date

from .models import Candidate, CanonicalCapability, Category, CityRequest, EvidenceContribution


STATIC_CAPABILITIES = {
    CanonicalCapability.BOREHOLE_LITHOLOGY,
    CanonicalCapability.ROCKHEAD_DEPTH,
    CanonicalCapability.SOIL_HORIZON,
    CanonicalCapability.SOIL_MAPPING_UNIT,
    CanonicalCapability.GEOTECHNICAL_BORELOG,
    CanonicalCapability.AQUIFER_BOUNDARY,
    CanonicalCapability.FRACTURE_ZONE,
    CanonicalCapability.UTILITY_ALIGNMENT,
    CanonicalCapability.UTILITY_INVERT_LEVEL,
}

DYNAMIC_CAPABILITIES = {
    CanonicalCapability.GROUNDWATER_LEVEL,
    CanonicalCapability.GROUNDWATER_QUALITY,
    CanonicalCapability.INSAR_VELOCITY,
    CanonicalCapability.SUBSIDENCE_OBSERVATION,
}


def _age_years(as_of: date, observed: date) -> float:
    return max(0.0, (as_of - observed).days / 365.2425)


class CandidateRanker:
    def evaluate(self, candidate: Candidate, request: CityRequest) -> Candidate:
        candidate.rejection_reasons = []
        rule = request.freshness[candidate.category]
        evidence = candidate.date_evidence
        if not candidate.inspected or not candidate.download_url:
            candidate.rejection_reasons.append("not_inspectable")
        if candidate.geographic_relevance < 0.35:
            candidate.rejection_reasons.append("insufficient_geographic_relevance")
        if candidate.category_relevance < 0.35:
            candidate.limitations.append("low_keyword_overlap")
        if candidate.authority_score < 0.5:
            candidate.limitations.append("publisher_authority_unverified")
        title = candidate.title.lower()
        excluded_title_terms = ("curriculum vitae", "_cv_", " cv ", "press release", "workshop", "winter school", "training notice")
        if candidate.document_suitability is False or any(term in f" {title} " for term in excluded_title_terms):
            candidate.rejection_reasons.append("not_a_substantive_scientific_source")
        if not evidence.publication_date:
            candidate.limitations.append("unknown_publication_date")
        elif _age_years(request.as_of_date, evidence.publication_date) > rule.max_publication_age_years and candidate.category != Category.GEOLOGY_LITHOLOGY:
            candidate.rejection_reasons.append("stale_publication")
        contributions = candidate.evidence_contributions
        if not contributions:
            default_capability = {
                Category.AQUIFER_GROUNDWATER: CanonicalCapability.GROUNDWATER_LEVEL,
                Category.GEOLOGY_LITHOLOGY: CanonicalCapability.BOREHOLE_LITHOLOGY,
                Category.SOIL_LAND: CanonicalCapability.SOIL_HORIZON,
                Category.GROUNDWATER_QUALITY: CanonicalCapability.GROUNDWATER_QUALITY,
                Category.GEOHAZARDS_URBAN_SUBSURFACE: CanonicalCapability.SUBSIDENCE_OBSERVATION,
            }[candidate.category]
            contributions = [EvidenceContribution(capability=default_capability, category=candidate.category, confidence=0.25)]
            candidate.evidence_contributions = contributions
        for contribution in contributions:
            if contribution.capability in STATIC_CAPABILITIES:
                contribution.freshness_status = "not_time_sensitive"
                if not contribution.observation_date_text:
                    contribution.limitations.append("unknown_observation_date")
            elif contribution.capability in DYNAMIC_CAPABILITIES:
                years = [int(value) for value in re.findall(r"\b(?:19|20)\d{2}\b", contribution.observation_date_text or "")]
                contribution_observed = date(max(years), 1, 1) if years else evidence.data_period_end
                if not contribution_observed:
                    contribution.freshness_status = "unknown"
                    contribution.limitations.append("unknown_observation_date")
                    if "unknown_observation_date" not in candidate.limitations:
                        candidate.limitations.append("unknown_observation_date")
                elif _age_years(request.as_of_date, contribution_observed) > rule.max_data_age_years:
                    contribution.freshness_status = "stale"
                    contribution.limitations.append("stale_dynamic_observation")
                else:
                    contribution.freshness_status = "current"
        if any(item.capability in STATIC_CAPABILITIES for item in contributions):
            candidate.rejection_reasons = [reason for reason in candidate.rejection_reasons if reason != "stale_publication"]
            if evidence.publication_date and _age_years(request.as_of_date, evidence.publication_date) > rule.max_publication_age_years:
                candidate.limitations.append("older_publication_with_static_evidence")
        usable = [item for item in contributions if item.freshness_status != "stale"]
        if not usable:
            candidate.rejection_reasons.append("all_evidence_contributions_stale")
            candidate.rejection_reasons.append("stale_data")
        elif any(item.freshness_status == "stale" for item in contributions):
            candidate.limitations.append("contains_stale_dynamic_contributions")
        candidate.eligible = not candidate.rejection_reasons
        if candidate.eligible:
            candidate.lifecycle_status = "shortlisted"
            data_recency = (max(0.0, 1 - _age_years(request.as_of_date, evidence.data_period_end) / max(1, rule.max_data_age_years))
                            if evidence.data_period_end else 0.35)
            candidate.score = round(
                0.25 * candidate.geographic_relevance + 0.20 * candidate.category_relevance + 0.20 * data_recency +
                0.20 * candidate.authority_score + 0.10 * candidate.scientific_utility +
                0.05 * evidence.confidence, 6,
            )
        else:
            candidate.score = 0
        return candidate
