from __future__ import annotations

from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class BlockType(str, Enum):
    TITLE = "title"
    HEADING = "heading"
    PARAGRAPH = "paragraph"
    LIST_ITEM = "list_item"
    CAPTION = "caption"
    FOOTNOTE = "footnote"
    HEADER = "header"
    FOOTER = "footer"
    CODE = "code"
    UNKNOWN = "unknown"


class BoundingBox(BaseModel):
    """Normalized coordinates: (x0, y0, x1, y1).

    May be absolute points or relative [0.0, 1.0].
    Defaults to points as reported by PDF engines.
    """
    x0: float
    y0: float
    x1: float
    y1: float

    @property
    def width(self) -> float:
        return max(0.0, self.x1 - self.x0)

    @property
    def height(self) -> float:
        return max(0.0, self.y1 - self.y0)


class ContentBlock(BaseModel):
    block_id: str
    page_number: int  # 1-based PDF index
    block_type: BlockType = BlockType.PARAGRAPH
    text: str
    level: Optional[int] = None  # Heading level e.g. 1, 2, 3
    bbox: Optional[BoundingBox] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class TableCell(BaseModel):
    text: str
    row_index: int
    col_index: int
    row_span: int = 1
    col_span: int = 1
    bbox: Optional[BoundingBox] = None


class TableData(BaseModel):
    table_id: str
    page_number: int  # 1-based PDF index
    headers: List[str] = Field(default_factory=list)
    rows: List[List[str]] = Field(default_factory=list)
    cells: List[TableCell] = Field(default_factory=list)
    caption: Optional[str] = None
    bbox: Optional[BoundingBox] = None
    markdown: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class ImageData(BaseModel):
    image_id: str
    page_number: int  # 1-based PDF index
    caption: Optional[str] = None
    bbox: Optional[BoundingBox] = None
    format: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class Page(BaseModel):
    page_number: int  # 1-based physical page index
    printed_page_number: Optional[str] = None  # Printed page folio/numeral if detected
    width: float = 0.0
    height: float = 0.0
    text: str = ""
    blocks: List[ContentBlock] = Field(default_factory=list)
    tables: List[TableData] = Field(default_factory=list)
    images: List[ImageData] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class DocumentMetadata(BaseModel):
    document_id: str
    filename: str
    file_path: str
    file_size_bytes: int
    file_hash_sha256: str
    page_count: int
    mime_type: str = "application/pdf"
    title: Optional[str] = None
    author: Optional[str] = None
    creation_date: Optional[str] = None
    custom_metadata: Dict[str, Any] = Field(default_factory=dict)


class ParsedDocument(BaseModel):
    metadata: DocumentMetadata
    pages: List[Page] = Field(default_factory=list)
    parser_name: str
    parser_version: Optional[str] = None
    parsing_time_seconds: float = 0.0
    parsing_warnings: List[str] = Field(default_factory=list)

    def get_full_text(self) -> str:
        return "\n\n".join(page.text for page in self.pages if page.text)

    def get_page(self, page_number: int) -> Optional[Page]:
        for page in self.pages:
            if page.page_number == page_number:
                return page
        return None
