from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


MODEL = "muse-spark-1.3-contributor"


class SourceLocator(BaseModel):
    """Resolvable pointer into a native source or deterministic derivative."""

    model_config = ConfigDict(extra="allow")
    kind: str
    artifact_id: str
    unit_id: str | None = None
    page: int | None = None
    sheet: str | None = None
    cell_range: str | None = None
    row: int | None = None
    json_pointer: str | None = None
    feature_id: str | None = None
    bbox: list[float] | None = None


class Artifact(BaseModel):
    model_config = ConfigDict(extra="allow")
    artifact_id: str
    parent_artifact_id: str | None = None
    kind: str
    media_type: str | None = None
    path: str
    sha256: str
    source_locator: SourceLocator | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class ContentUnit(BaseModel):
    model_config = ConfigDict(extra="allow")
    unit_id: str
    artifact_id: str
    kind: str
    sequence: int
    text: str = ""
    locator: SourceLocator
    artifact_refs: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class SourceBundle(BaseModel):
    bundle_version: str = "1.0"
    source_id: str
    original_path: str
    filename: str
    media_type: str
    sha256: str
    size_bytes: int
    adapter: str
    artifacts: list[Artifact] = Field(default_factory=list)
    units: list[ContentUnit] = Field(default_factory=list)
    structured_assets: list[dict[str, Any]] = Field(default_factory=list)
    visual_assets: list[dict[str, Any]] = Field(default_factory=list)
    spatial_assets: list[dict[str, Any]] = Field(default_factory=list)
    diagnostics: list[dict[str, Any]] = Field(default_factory=list)
    capabilities: list[str] = Field(default_factory=list)


class EvidenceRef(BaseModel):
    artifact_id: str
    locator: SourceLocator
    excerpt: str | None = None


class EvidenceItem(BaseModel):
    model_config = ConfigDict(extra="allow")
    evidence_id: str
    kind: str
    statement: str
    subject: str | None = None
    value: Any = None
    unit: str | None = None
    confidence: Literal["high", "medium", "low"] = "medium"
    basis: Literal["direct", "source_interpretation", "derived"] = "direct"
    evidence: list[EvidenceRef] = Field(min_length=1)
    properties: list[dict[str, Any]] = Field(default_factory=list)


class ExtractionResult(BaseModel):
    batch_id: str
    summary: str
    entities: list[dict[str, Any]] = Field(default_factory=list)
    evidence_items: list[EvidenceItem] = Field(default_factory=list)
    spatial_features: list[dict[str, Any]] = Field(default_factory=list)
    vertical_intervals: list[dict[str, Any]] = Field(default_factory=list)
    relationships: list[dict[str, Any]] = Field(default_factory=list)
    visual_interpretations: list[dict[str, Any]] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list)
    unresolved_items: list[str] = Field(default_factory=list)


class PipelineConfig(BaseModel):
    model: str = MODEL
    context_window: int = 1_048_576
    target_batch_tokens: int = 180_000
    max_batch_tokens: int = 250_000
    overlap_tokens: int = 6_000
    reserve_tokens: int = 80_000
    max_output_tokens: int = 40_000
    reasoning_effort: Literal["minimal", "low", "medium", "high"] = "high"
    max_cost_usd: float = Field(19.0, gt=0, le=20.0)
    max_images_per_batch: int = Field(20, ge=0, le=50)
    render_dpi: int = Field(130, ge=72, le=220)
    live: bool = False

    @model_validator(mode="after")
    def enforce_model_and_budget(self) -> "PipelineConfig":
        if self.model != MODEL:
            raise ValueError(f"only {MODEL} is permitted")
        if self.max_batch_tokens + self.reserve_tokens > self.context_window:
            raise ValueError("batch and reserve exceed context window")
        return self


class RunRequest(BaseModel):
    run_id: str
    objective: str
    sources: list[Path]
    output_dir: Path
    config: PipelineConfig = Field(default_factory=PipelineConfig)

