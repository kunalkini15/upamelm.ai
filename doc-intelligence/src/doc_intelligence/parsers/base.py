from __future__ import annotations

import hashlib
import mimetypes
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any, Dict, Optional
from pydantic import BaseModel, Field

from doc_intelligence.models.document import DocumentMetadata, ParsedDocument


class ParserOptions(BaseModel):
    extract_tables: bool = True
    extract_images: bool = False
    ocr_enabled: bool = False
    max_pages: Optional[int] = None
    extra_params: Dict[str, Any] = Field(default_factory=dict)


class BaseParser(ABC):
    @property
    @abstractmethod
    def name(self) -> str:
        """Name of parser (e.g. pymupdf, docling, llamaparse)."""
        pass

    @abstractmethod
    def parse(self, file_path: Path, options: Optional[ParserOptions] = None) -> ParsedDocument:
        """Parse file into normalized ParsedDocument representation."""
        pass

    def compute_metadata(self, file_path: Path, page_count: int) -> DocumentMetadata:
        """Helper to compute deterministic document metadata and stable ID."""
        file_path = Path(file_path).resolve()
        hasher = hashlib.sha256()
        file_size = file_path.stat().st_size
        with open(file_path, "rb") as f:
            while chunk := f.read(65536):
                hasher.update(chunk)
        file_hash = hasher.hexdigest()
        doc_id = f"doc_{file_hash[:16]}"
        mime_type, _ = mimetypes.guess_type(str(file_path))

        return DocumentMetadata(
            document_id=doc_id,
            filename=file_path.name,
            file_path=str(file_path),
            file_size_bytes=file_size,
            file_hash_sha256=file_hash,
            page_count=page_count,
            mime_type=mime_type or "application/pdf",
        )
