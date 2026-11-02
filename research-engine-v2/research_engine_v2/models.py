from __future__ import annotations

from pathlib import Path
from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field


class Source(BaseModel):
    model_config = ConfigDict(extra="allow")
    type: str = "local_document"
    path: str


class Limits(BaseModel):
    model_config = ConfigDict(extra="allow")
    max_model_calls: int | None = Field(None, ge=1)
    max_total_tokens: int | None = Field(None, ge=1)
    max_planning_turns: int | None = Field(None, ge=1)


class SynthesizerConfig(BaseModel):
    enable_analysis: bool = True
    enable_ui_synthesis: bool = True
    enable_review: bool = False
    spark_model: str = "muse-spark-1.3-contributor"
    review_model: str = "muse-wonder-1.0"
    max_spark_calls: int | None = Field(None, ge=1)
    max_total_tokens: int | None = Field(None, ge=1)
    max_output_tokens: int | None = Field(None, ge=1)
    review_max_output_tokens: int = Field(4000, ge=1)
    correction_max_output_tokens: int = Field(12000, ge=1)
    spark_reasoning_effort: str = "medium"
    review_reasoning_effort: str = "medium"
    correction_reasoning_effort: str = "medium"
    initial_context_max_chars: int = Field(80000, ge=1000)
    tool_result_max_chars: int = Field(24000, ge=1000)
    search_result_limit: int = Field(20, ge=1, le=50)
    max_retries: int = Field(1, ge=0)
    direct_synthesis_max_tokens: int = Field(80000, ge=1000)
    staged_synthesis_max_tokens: int = Field(80000, ge=1000)
    staged_group_max_tokens: int = Field(30000, ge=1000)
    ui_max_concurrency: int = Field(4, ge=1, le=16)
    estimated_chars_per_token: float = Field(3.0, gt=0)
    estimated_request_overhead_tokens: int = Field(5000, ge=0)


class Request(BaseModel):
    model_config = ConfigDict(extra="allow")
    research_id: str = Field(min_length=1)
    objective: str = Field(min_length=1)
    domain_context: str | None = None
    instructions: list[str] = Field(default_factory=list)
    desired_outcomes: list[str] = Field(default_factory=list)
    sources: list[Source] = Field(min_length=1)
    context: dict[str, Any] = Field(default_factory=dict)
    limits: Limits = Field(default_factory=Limits)


class CallUsage(BaseModel):
    input_tokens: int = 0
    cached_input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    cost_usd: float | None = None


class PlanningState(BaseModel):
    model_config = ConfigDict(extra="allow")
    research_id: str
    phase: Literal["preflight", "atlas_discovery", "plan_formation", "reconnaissance", "plan_ready", "failed", "stalled", "cancelled"] = "preflight"
    atlas_observed: bool = False
    plan_revision: int = 0
    document_understanding: dict[str, Any] = Field(default_factory=dict)
    research_questions: list[Any] = Field(default_factory=list)
    page_targets: list[Any] = Field(default_factory=list)
    target_map: list[Any] = Field(default_factory=list)
    proposed_tasks: list[Any] = Field(default_factory=list)
    dependencies: list[Any] = Field(default_factory=list)
    uncertainties: list[Any] = Field(default_factory=list)
    limitations: list[Any] = Field(default_factory=list)
    planning_warnings: list[str] = Field(default_factory=list)
    atlas_digest: dict[str, Any] = Field(default_factory=dict)
    discovery_actions: int = 0
    discovery_signatures: list[str] = Field(default_factory=list)
    observations: list[dict[str, Any]] = Field(default_factory=list)
    artifact_ids: list[str] = Field(default_factory=list)
    calls: int = 0
    total_tokens: int = 0


class PlanningResult(BaseModel):
    model_config = ConfigDict(extra="allow")
    research_id: str
    status: str
    objective: str
    document_understanding: dict[str, Any] = Field(default_factory=dict)
    research_questions: list[Any] = Field(default_factory=list)
    page_targets: list[Any] = Field(default_factory=list)
    target_map: list[Any] = Field(default_factory=list)
    proposed_extraction_tasks: list[Any] = Field(default_factory=list)
    dependencies: list[Any] = Field(default_factory=list)
    uncertainties: list[Any] = Field(default_factory=list)
    limitations: list[Any] = Field(default_factory=list)
    planning_warnings: list[str] = Field(default_factory=list)
    plan_artifact_id: str | None = None
    plan_version: int | None = None
    usage_summary: dict[str, Any] = Field(default_factory=dict)
    artifact_manifest: str = "manifest.json"


class ExecutionState(BaseModel):
    model_config = ConfigDict(extra="allow")
    research_id: str
    phase: Literal["orienting", "extracting", "evaluating", "replanning", "reporting", "completed", "partial", "failed", "stalled", "cancelled"] = "orienting"
    active_plan_version: int = 0
    findings: list[Any] = Field(default_factory=list)
    evidence: list[Any] = Field(default_factory=list)
    contradictions: list[Any] = Field(default_factory=list)
    unresolved_questions: list[Any] = Field(default_factory=list)
    observations: list[dict[str, Any]] = Field(default_factory=list)
    artifact_ids: list[str] = Field(default_factory=list)
    report_version: int | None = None
    report_limitations: list[Any] = Field(default_factory=list)
    report_unresolved_questions: list[Any] = Field(default_factory=list)
    extraction_artifacts: list[dict[str, Any]] = Field(default_factory=list)
    completed_task_ids: list[str] = Field(default_factory=list)
    extraction_bundle_complete: bool = False
    evidence_manifest_version: int | None = None
    current_task: str | None = None
    no_progress_actions: int = 0
    repeated_failures: dict[str, int] = Field(default_factory=dict)
    recent_action_signatures: list[str] = Field(default_factory=list)
    recovery_message: str | None = None
    calls: int = 0
    total_tokens: int = 0


class ExecutionResult(BaseModel):
    model_config = ConfigDict(extra="allow")
    research_id: str
    status: str
    objective: str
    active_plan_version: int
    finding_count: int = 0
    evidence_count: int = 0
    unresolved_questions: list[Any] = Field(default_factory=list)
    contradictions: list[Any] = Field(default_factory=list)
    report_artifact_id: str | None = None
    report_version: int | None = None
    evidence_manifest_artifact_id: str | None = None
    evidence_manifest_version: int | None = None
    usage_summary: dict[str, Any] = Field(default_factory=dict)


class PageTarget(BaseModel):
    model_config = ConfigDict(extra="allow")
    target_id: str
    document_id: str
    pages: list[int] = Field(default_factory=list)
    reason: str = ""
    expected_information: str = ""
    instructions: str = ""
    priority: str = "normal"
    structural_hints: list[str] = Field(default_factory=list)
    evidence_requirements: list[str] = Field(default_factory=list)
    required_modalities: list[str] = Field(default_factory=list)
    downstream_uses: list[str] = Field(default_factory=list)
    completion_criteria: list[str] = Field(default_factory=list)
    status: str = "required"


class ExtractionPlan(BaseModel):
    model_config = ConfigDict(extra="allow")
    schema_version: str = "1"
    plan_id: str = "research_plan"
    research_id: str
    objective: str
    document_id: str | None = None
    document_hash: str | None = None
    page_count: int | None = None
    atlas_hash: str | None = None
    instructions: list[str] = Field(default_factory=list)
    page_targets: list[PageTarget] = Field(default_factory=list)


class ExtractorConfig(BaseModel):
    soft_chunk_pages: int = Field(5, ge=1)
    hard_chunk_pages: int = Field(8, ge=1)
    max_concurrency: int = Field(3, ge=1)
    max_model_calls: int | None = Field(None, ge=1)
    max_total_tokens: int | None = Field(None, ge=1)
    max_output_tokens: int | None = Field(5000, ge=1)
    timeout_seconds: float = Field(120.0, gt=0)
    max_retries: int = Field(1, ge=0)
    digest_base_tokens: int = Field(100, ge=1)
    digest_max_tokens: int = Field(350, ge=1)
    reasoning_effort: str = "low"
    adaptive_chunk_chars: int = Field(120000, ge=1000)
    visual_max_pages_per_call: int = Field(5, ge=1)
    enable_visual_escalation: bool = True
    enable_group_consolidation: bool = True
    visual_screen_long_edge: int = Field(768, ge=256)
    visual_detail_long_edge: int = Field(1280, ge=512)
    target_id: str | None = None
    chunk_id: str | None = None
    max_chunks: int | None = Field(None, ge=1)


class ExtractionResult(BaseModel):
    model_config = ConfigDict(extra="allow")
    research_id: str
    plan_id: str
    status: str
    objective: str
    target_count: int = 0
    chunk_count: int = 0
    completed_chunks: int = 0
    failed_chunks: int = 0
    evidence_manifest_path: str | None = None
    compact_bundle_path: str | None = None
    limitations: list[str] = Field(default_factory=list)
    coverage: dict[str, Any] = Field(default_factory=dict)
    usage_summary: dict[str, Any] = Field(default_factory=dict)
    artifacts: list[dict[str, Any]] = Field(default_factory=list)
