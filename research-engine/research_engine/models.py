from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field, ConfigDict

Status = Literal[
    "running",
    "completed",
    "completed_with_limitations",
    "partial",
    "stalled",
    "ceiling_reached",
    "cancelled",
    "blocked",
    "failed",
]
ToolStatus = Literal["success", "empty", "retryable_error", "fatal_error", "skipped"]


class SourceSpec(BaseModel):
    type: Literal["local_document"] = "local_document"
    path: str


class Budget(BaseModel):
    max_model_calls: Optional[int] = Field(None, ge=1)
    max_total_tokens: Optional[int] = Field(None, ge=1)
    max_agent_steps: Optional[int] = Field(None, ge=1)
    max_retries_per_issue: Optional[int] = Field(None, ge=0)
    max_output_tokens: Optional[int] = Field(None, ge=1)


class ResearchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    research_id: str = Field(min_length=1)
    objective: str = Field(min_length=1)
    domain_context: Optional[str] = None
    sources: List[SourceSpec] = Field(min_length=1)
    research_questions: List[str] = Field(default_factory=list)
    instructions: List[str] = Field(default_factory=list)
    desired_outcomes: List[Any] = Field(default_factory=list)
    budget: Budget = Field(default_factory=Budget)


class ExtractionTask(BaseModel):
    model_config = ConfigDict(extra="ignore")
    task_id: str = Field(min_length=1)
    objective: str = Field(min_length=1)
    question_ids: List[str] = Field(default_factory=list)
    fields: List[Any] = Field(default_factory=list)
    instructions: Any = ""
    coverage_scope: str = "sample"
    max_relevant_pages: Optional[int] = Field(None, ge=1)
    expand_annexures: bool = True


class ResearchDecision(BaseModel):
    # Muse may add useful metadata (for example document_id) around the
    # decision envelope. Unknown additive fields must not invalidate a turn.
    model_config = ConfigDict(extra="ignore")
    action: Literal[
        "list_sources",
        "inspect_source",
        "search_source",
        "read_evidence",
        "extract_information",
        "compare_findings",
        "calculate",
        "revise_plan",
        "assess_progress",
        "complete_investigation",
        "finish_investigation",
        "synthesize_findings",
        "workspace_list",
        "workspace_search",
        "workspace_get",
        "workspace_upsert",
    ]
    arguments: Dict[str, Any] = Field(default_factory=dict)
    reason: str = ""
    plan: List[str] = Field(default_factory=list)
    pending_questions: List[str] = Field(default_factory=list)


class ToolResult(BaseModel):
    status: ToolStatus
    summary: str = ""
    payload: Any = None
    evidence_ids: List[str] = Field(default_factory=list)
    coverage: Dict[str, Any] = Field(default_factory=dict)
    issues: List[str] = Field(default_factory=list)
    model_usage: Dict[str, Any] = Field(default_factory=dict)


class EvidenceRef(BaseModel):
    finding_id: Optional[str] = None
    document_id: str
    page: int
    table_id: Optional[str] = None
    section: Optional[str] = None
    snippet: str = ""
    geographic_scope: Optional[str] = None
    temporal_scope: Optional[str] = None


class Claim(BaseModel):
    claim_id: str
    text: str
    value: Any = None
    status: Literal[
        "extracted",
        "grounded",
        "human_verified",
        "interpretation",
        "unresolved",
        "ambiguous",
        "needs_review",
        "not_assessed",
    ] = "grounded"
    evidence: List[EvidenceRef] = Field(default_factory=list)
    contradictions: List[str] = Field(default_factory=list)
    notes: Optional[str] = None


class Conflict(BaseModel):
    conflict_id: str
    description: str
    claim_ids: List[str] = Field(default_factory=list)
    status: Literal["unresolved", "resolved", "not_a_conflict"] = "unresolved"
    notes: Optional[str] = None


class TraceEvent(BaseModel):
    sequence: int
    timestamp: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    action: str
    tool: Optional[str] = None
    arguments: Dict[str, Any] = Field(default_factory=dict)
    reason: str = ""
    result_status: Literal["success", "error", "skipped"] = "success"
    evidence_ids: List[str] = Field(default_factory=list)
    latency_seconds: float = 0.0
    model_usage: Dict[str, Any] = Field(default_factory=dict)


class ResearchState(BaseModel):
    research_id: str
    objective: str
    request_snapshot: Dict[str, Any] = Field(default_factory=dict)
    workspace_path: Optional[str] = None
    final_artifact_ids: List[str] = Field(default_factory=list)
    recent_observations: List[Dict[str, Any]] = Field(default_factory=list)
    consecutive_failures: int = 0
    source_documents: Dict[str, Dict[str, Any]] = Field(default_factory=dict)
    plan: List[str] = Field(default_factory=list)
    pending_questions: List[str] = Field(default_factory=list)
    completed_tasks: List[str] = Field(default_factory=list)
    evidence: List[EvidenceRef] = Field(default_factory=list)
    findings: List[Claim] = Field(default_factory=list)
    conclusions: List[Claim] = Field(default_factory=list)
    conflicts: List[Conflict] = Field(default_factory=list)
    trace: List[TraceEvent] = Field(default_factory=list)
    last_tool_result: Optional[ToolResult] = None
    extraction_tasks: List[Dict[str, Any]] = Field(default_factory=list)
    issues: List[str] = Field(default_factory=list)
    stated_limitations: List[str] = Field(default_factory=list)
    coverage: Dict[str, Any] = Field(default_factory=dict)
    calculations: List[Dict[str, Any]] = Field(default_factory=list)
    evidence_version: int = 0
    summary: str = ""
    model_usage: Dict[str, Any] = Field(
        default_factory=lambda: {
            "calls": 0,
            "input_tokens": 0,
            "output_tokens": 0,
            "total_tokens": 0,
            "nested_calls": 0,
            "nested_tokens": 0,
            "models": [],
            "request_details": [],
            "cost_usd": None,
            "cost_status": "not_provided",
        }
    )
    status: Status = "running"
    step: int = 0
    conversation: List[Dict[str, Any]] = Field(default_factory=list)
    no_progress_turns: int = 0
    workspace_revision: int = 0
    run_id: str = ""
    last_tool_fingerprint: str = ""
    tool_outcomes: Dict[str, bool] = Field(default_factory=dict)
    tool_error_counts: Dict[str, int] = Field(default_factory=dict)
    pending_tool_calls: List[Dict[str, Any]] = Field(default_factory=list)
    finish_requested: bool = False
    compaction_count: int = 0


class ResearchResult(BaseModel):
    research_id: str
    status: Status
    objective: str
    summary: str = ""
    key_findings: List[Claim] = Field(default_factory=list)
    conclusions: List[Claim] = Field(default_factory=list)
    structured_entities: List[Dict[str, Any]] = Field(default_factory=list)
    evidence: List[EvidenceRef] = Field(default_factory=list)
    contradictions: List[Conflict] = Field(default_factory=list)
    limitations: List[str] = Field(default_factory=list)
    unanswered_questions: List[str] = Field(default_factory=list)
    source_coverage: Dict[str, Any] = Field(default_factory=dict)
    model_usage: Dict[str, Any] = Field(default_factory=dict)
    execution_trace: List[TraceEvent] = Field(default_factory=list)
    research_plan: List[str] = Field(default_factory=list)
    issues: List[str] = Field(default_factory=list)
    coverage: Dict[str, Any] = Field(default_factory=dict)
    calculations: List[Dict[str, Any]] = Field(default_factory=list)
    extraction_tasks: List[Dict[str, Any]] = Field(default_factory=list)
    workspace_path: Optional[str] = None
    final_artifact_ids: List[str] = Field(default_factory=list)
