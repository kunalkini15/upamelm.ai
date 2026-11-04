from __future__ import annotations

from datetime import date, datetime, timezone
from enum import StrEnum
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator, model_validator


class Category(StrEnum):
    AQUIFER_GROUNDWATER = "aquifer_groundwater"
    GEOLOGY_LITHOLOGY = "geology_lithology"
    SOIL_LAND = "soil_land"
    GROUNDWATER_QUALITY = "groundwater_quality"
    GEOHAZARDS_URBAN_SUBSURFACE = "geohazards_urban_subsurface"


class CanonicalCapability(StrEnum):
    BOREHOLE_LITHOLOGY = "borehole_lithology"
    ROCKHEAD_DEPTH = "rockhead_depth"
    SOIL_HORIZON = "soil_horizon"
    SOIL_MAPPING_UNIT = "soil_mapping_unit"
    GROUNDWATER_LEVEL = "groundwater_level"
    GROUNDWATER_QUALITY = "groundwater_quality"
    AQUIFER_BOUNDARY = "aquifer_boundary"
    FRACTURE_ZONE = "fracture_zone"
    GEOTECHNICAL_BORELOG = "geotechnical_borelog"
    UTILITY_ALIGNMENT = "utility_alignment"
    UTILITY_INVERT_LEVEL = "utility_invert_level"
    INSAR_VELOCITY = "insar_velocity"
    SUBSIDENCE_OBSERVATION = "subsidence_observation"


class EvidenceContribution(BaseModel):
    capability: CanonicalCapability
    category: Category | None = None
    status: str = "unknown"
    study_scope: str = "unknown"
    observation_date_text: str | None = None
    evidence_excerpt: str | None = None
    page_or_location: str | None = None
    confidence: float = Field(0, ge=0, le=1)
    freshness_status: str = "unknown"
    limitations: list[str] = Field(default_factory=list)


DEFAULT_CATEGORIES = list(Category)


class FreshnessRule(BaseModel):
    max_data_age_years: int = Field(ge=0)
    max_publication_age_years: int = Field(ge=0)


class ExistingSourceSummary(BaseModel):
    identifier: str
    title: str = ""
    evidence_types: list[str] = Field(default_factory=list)
    geography: str | None = None
    dates: list[str] = Field(default_factory=list)


class RunBudgets(BaseModel):
    max_search_rounds: int = Field(2, ge=1, le=2)
    max_search_calls: int = Field(30, ge=1)
    max_inspected_pages: int = Field(80, ge=1)
    max_download_bytes: int = Field(500 * 1024 * 1024, ge=1)
    max_model_calls: int = Field(50, ge=1)


DEFAULT_FRESHNESS: dict[Category, FreshnessRule] = {
    Category.AQUIFER_GROUNDWATER: FreshnessRule(max_data_age_years=3, max_publication_age_years=4),
    Category.GEOLOGY_LITHOLOGY: FreshnessRule(max_data_age_years=7, max_publication_age_years=7),
    Category.SOIL_LAND: FreshnessRule(max_data_age_years=5, max_publication_age_years=5),
    Category.GROUNDWATER_QUALITY: FreshnessRule(max_data_age_years=3, max_publication_age_years=4),
    Category.GEOHAZARDS_URBAN_SUBSURFACE: FreshnessRule(max_data_age_years=5, max_publication_age_years=5),
}


class CityRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    city: str = Field(min_length=2)
    state: str = Field(min_length=2)
    country: str = "India"
    district_aliases: list[str] = Field(default_factory=list)
    city_aliases: list[str] = Field(default_factory=list)
    local_language_names: list[str] = Field(default_factory=list)
    as_of_date: date = Field(default_factory=date.today)
    categories: list[Category] = Field(default_factory=lambda: list(DEFAULT_CATEGORIES), min_length=1)
    freshness: dict[Category, FreshnessRule] = Field(default_factory=lambda: dict(DEFAULT_FRESHNESS))
    trusted_domains: list[str] = Field(default_factory=lambda: ["gov.in", "nic.in", "ac.in", "org.in"])
    preferred_publishers: list[str] = Field(default_factory=lambda: [
        "Central Ground Water Board", "Geological Survey of India", "National Remote Sensing Centre",
        "Indian Space Research Organisation", "State Ground Water Department", "Pollution Control Board",
    ])
    extra_queries: dict[Category, list[str]] = Field(default_factory=dict)
    existing_sources: list[ExistingSourceSummary] = Field(default_factory=list)
    evidence_gaps: list[str] = Field(default_factory=list)
    target_capabilities: list[str] = Field(default_factory=list)
    max_selected_source_packages: int = Field(5, ge=1, le=25)
    budgets: RunBudgets = Field(default_factory=RunBudgets)

    @field_validator("city", "state", "country")
    @classmethod
    def clean_names(cls, value: str) -> str:
        return " ".join(value.split())

    @model_validator(mode="after")
    def ensure_rules(self) -> "CityRequest":
        missing = [category for category in self.categories if category not in self.freshness]
        if missing:
            raise ValueError(f"missing freshness rules for: {', '.join(missing)}")
        return self


class SearchQuery(BaseModel):
    query_id: str
    category: Category
    text: str
    rationale: str = ""


class CoveragePlan(BaseModel):
    city: str
    as_of_date: date
    queries: list[SearchQuery]
    generated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class SearchResult(BaseModel):
    query_id: str
    category: Category
    title: str
    url: HttpUrl
    snippet: str = ""
    displayed_url: str | None = None
    provider: str
    rank: int = Field(ge=1)
    metadata: dict[str, Any] = Field(default_factory=dict)


class DateEvidence(BaseModel):
    publication_date: date | None = None
    data_period_start: date | None = None
    data_period_end: date | None = None
    basis: str = "unknown"
    confidence: float = Field(0.0, ge=0, le=1)
    excerpts: list[str] = Field(default_factory=list)
    publication_date_text: str | None = None
    observation_date_texts: list[str] = Field(default_factory=list)
    upload_or_modified_date: str | None = None
    retrieval_date: date | None = None


class Candidate(BaseModel):
    candidate_id: str
    category: Category
    title: str
    landing_url: HttpUrl
    download_url: HttpUrl | None = None
    publisher: str | None = None
    media_type: str | None = None
    content_length: int | None = None
    geographic_relevance: float = Field(0, ge=0, le=1)
    category_relevance: float = Field(0, ge=0, le=1)
    authority_score: float = Field(0, ge=0, le=1)
    scientific_utility: float = Field(0, ge=0, le=1)
    document_type: str | None = None
    document_suitability: bool | None = None
    date_evidence: DateEvidence = Field(default_factory=DateEvidence)
    inspected: bool = False
    eligible: bool = False
    score: float = 0
    rejection_reasons: list[str] = Field(default_factory=list)
    search_queries: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    lifecycle_status: str = "discovered"
    study_scope: str = "unknown"
    geographic_evidence: list[dict[str, Any]] = Field(default_factory=list)
    evidence_types: list[str] = Field(default_factory=list)
    evidence_categories: list[Category] = Field(default_factory=list)
    evidence_contributions: list[EvidenceContribution] = Field(default_factory=list)
    coordinates_available: bool | None = None
    geometry_available: bool | None = None
    depth_information_available: bool | None = None
    evidence_status: list[str] = Field(default_factory=list)
    achievable_visual_features: list[str] = Field(default_factory=list)
    overlap_with_existing_sources: list[str] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list)
    unresolved_questions: list[str] = Field(default_factory=list)
    assessment_confidence: float = Field(0, ge=0, le=1)
    content_inspection_status: str = "pending"
    page_count: int | None = None
    resolved_url: HttpUrl | None = None
    discovered_asset_urls: list[HttpUrl] = Field(default_factory=list)
    validation_results: dict[str, Any] = Field(default_factory=dict)


class AcquiredSource(BaseModel):
    source_id: str
    category: Category
    title: str
    publisher: str | None = None
    landing_url: HttpUrl
    download_url: HttpUrl
    publication_date: date | None = None
    data_period_start: date | None = None
    data_period_end: date | None = None
    freshness_basis: str
    freshness_confidence: float
    media_type: str
    filename: str
    local_path: str
    sha256: str
    size_bytes: int
    selected_score: float
    selection_reason: str
    retrieved_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    candidate_id: str | None = None
    originating_query_ids: list[str] = Field(default_factory=list)
    final_resolved_url: HttpUrl | None = None
    evidence_categories: list[Category] = Field(default_factory=list)
    evidence_types: list[str] = Field(default_factory=list)
    evidence_contributions: list[EvidenceContribution] = Field(default_factory=list)
    validation_status: str = "validated"
    validation_results: dict[str, Any] = Field(default_factory=dict)
    ingestion_targets: list[str] = Field(default_factory=lambda: ["document_processing"])
    related_asset_ids: list[str] = Field(default_factory=list)


class BudgetUsage(BaseModel):
    search_rounds: int = 0
    search_calls: int = 0
    inspected_pages: int = 0
    downloaded_bytes: int = 0
    model_calls: int = 0
    stopping_reasons: list[str] = Field(default_factory=list)


class InspectionSummary(BaseModel):
    city: str
    state: str
    shortlisted_candidate_ids: list[str] = Field(default_factory=list)
    unresolved_capabilities: list[CanonicalCapability] = Field(default_factory=list)
    projected_selection_order: list[str] = Field(default_factory=list)
    budget_usage: BudgetUsage = Field(default_factory=BudgetUsage)
    stopping_reasons: list[str] = Field(default_factory=list)


class CategoryOutcome(BaseModel):
    category: Category
    status: str
    selected_source_id: str | None = None
    reason: str | None = None
    candidates_considered: int = 0


class SourceManifest(BaseModel):
    schema_version: str = "source-intelligence.v1"
    run_id: str
    city: str
    state: str
    country: str
    as_of_date: date
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    sources: list[AcquiredSource] = Field(default_factory=list)
    coverage: list[CategoryOutcome] = Field(default_factory=list)
    budget_usage: BudgetUsage = Field(default_factory=BudgetUsage)

    def absolute_paths(self, root: Path) -> "SourceManifest":
        update = self.model_copy(deep=True)
        for source in update.sources:
            source.local_path = str((root / source.local_path).resolve())
        return update

