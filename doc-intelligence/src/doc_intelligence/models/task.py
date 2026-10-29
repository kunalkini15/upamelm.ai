from __future__ import annotations

from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field
from doc_intelligence.models.document import BoundingBox


class VerificationStatus(str, Enum):
    # Upgraded statuses per specification while preserving backward compatibility
    EXTRACTED = "extracted"
    GROUNDED = "grounded"
    AMBIGUOUS = "ambiguous"
    NEEDS_REVIEW = "needs_review"
    NOT_FOUND_IN_SEARCHED_SCOPE = "not_found_in_searched_scope"
    NOT_ASSESSED = "not_assessed"
    HUMAN_VERIFIED = "human_verified"

    # Backward compatibility aliases
    VERIFIED = "grounded"  # Mapped to grounded to prevent false certainty
    MISSING = "not_found_in_searched_scope"


class EvidenceReference(BaseModel):
    document_id: str
    pdf_page_number: int  # 1-based PDF index
    page_number: Optional[int] = None  # Backward compatibility alias
    printed_page_number: Optional[str] = None
    section_title: Optional[str] = None
    table_id: Optional[str] = None
    table_reference: Optional[str] = None
    row_index: Optional[int] = None
    column_name: Optional[str] = None
    figure_reference: Optional[str] = None
    source_text: str = ""
    normalized_match: bool = False
    bbox: Optional[BoundingBox] = None
    extraction_method: str = "ai_model"
    model_name: Optional[str] = None
    confidence: float = 1.0

    def model_post_init(self, __context: Any) -> None:
        if self.page_number is None:
            self.page_number = self.pdf_page_number
        elif self.pdf_page_number is None:
            self.pdf_page_number = self.page_number


class ExtractedField(BaseModel):
    field_name: str
    value: Any = None
    raw_value: Optional[str] = None
    unit: Optional[str] = None
    status: VerificationStatus = VerificationStatus.EXTRACTED
    confidence: float = 1.0
    evidence: Optional[EvidenceReference] = None
    validation_notes: Optional[str] = None


class ExtractedFinding(BaseModel):
    finding_id: str
    entity_id: Optional[str] = None  # e.g., Well ID or Primary entity identifier
    fields: Dict[str, ExtractedField] = Field(default_factory=dict)
    nested_records: List[Dict[str, Any]] = Field(default_factory=list)
    raw_response: Optional[Dict[str, Any]] = None
    is_ambiguous: bool = False
    review_required: bool = False
    review_reason: Optional[str] = None


class CoverageScope(str, Enum):
    SAMPLE = "sample"  # e.g. first N records or pages
    ALL = "all"  # full coverage of identified sections/annexures


class CoverageManifest(BaseModel):
    scope_requested: CoverageScope = CoverageScope.SAMPLE
    candidate_sections: List[str] = Field(default_factory=list)
    candidate_pages: List[int] = Field(default_factory=list)
    processed_pages: List[int] = Field(default_factory=list)
    skipped_pages: Dict[int, str] = Field(default_factory=dict)  # page -> reason
    status: str = "complete"  # complete | partial | failed
    notes: Optional[str] = None


class TaskSpecification(BaseModel):
    task_id: str
    objective: str
    instructions: Optional[str] = None
    fields: List[str] = Field(default_factory=list)
    output_schema: Optional[Dict[str, Any]] = Field(default_factory=dict)
    coverage_scope: CoverageScope = CoverageScope.SAMPLE
    max_relevant_pages: int = 5
    expand_annexures: bool = True
    allow_escalation: bool = True
    max_repair_attempts: int = 2


class ExecutionTraceStep(BaseModel):
    step_id: str
    stage: str
    action: str
    details: Dict[str, Any] = Field(default_factory=dict)
    model_name: Optional[str] = None
    prompt_tokens: int = 0
    completion_tokens: int = 0
    duration_seconds: float = 0.0
    success: bool = True
    error_message: Optional[str] = None


class IntelligenceResult(BaseModel):
    task_id: Optional[str] = None
    document_metadata: Any
    document_index: Any
    coverage_manifest: Optional[CoverageManifest] = None
    findings: List[ExtractedFinding] = Field(default_factory=list)
    review_queue: List[Dict[str, Any]] = Field(default_factory=list)
    execution_trace: List[ExecutionTraceStep] = Field(default_factory=list)
    total_tokens_used: int = 0
    total_model_calls: int = 0
    status: str = "completed"
