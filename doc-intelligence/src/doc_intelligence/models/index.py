from __future__ import annotations

from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field
from doc_intelligence.models.document import BoundingBox


class SectionNode(BaseModel):
    title: str
    level: int = 1
    page_number: int
    bbox: Optional[BoundingBox] = None


class TableIndexItem(BaseModel):
    table_id: str
    page_number: int
    caption: Optional[str] = None
    column_count: int = 0
    row_count: int = 0


class FigureIndexItem(BaseModel):
    image_id: str
    page_number: int
    caption: Optional[str] = None


class PageQualityIndicator(BaseModel):
    page_number: int
    character_count: int = 0
    word_count: int = 0
    has_tables: bool = False
    has_images: bool = False
    is_scanned_suspicion: bool = False  # True if low text density but images present
    confidence_score: float = 1.0


class PageSummary(BaseModel):
    page_number: int
    printed_page_number: Optional[str] = None
    char_count: int
    word_count: int
    top_keywords: List[str] = Field(default_factory=list)
    has_tables: bool = False
    has_figures: bool = False
    preview_snippet: str = ""


class DocumentIndex(BaseModel):
    document_id: str
    total_pages: int
    sections: List[SectionNode] = Field(default_factory=list)
    tables: List[TableIndexItem] = Field(default_factory=list)
    figures: List[FigureIndexItem] = Field(default_factory=list)
    page_summaries: List[PageSummary] = Field(default_factory=list)
    quality_indicators: List[PageQualityIndicator] = Field(default_factory=list)
    vocabulary: Dict[str, List[int]] = Field(default_factory=dict)  # keyword -> [page_numbers]
