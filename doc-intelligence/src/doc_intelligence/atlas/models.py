from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple
from pydantic import BaseModel, Field


class AtlasSection(BaseModel):
    """Represents a section or subsection within the document hierarchy."""
    section_id: str
    title: str
    level: int = 1
    start_page: int  # 1-based physical PDF page
    end_page: int    # 1-based physical PDF page (inclusive)
    printed_start_page: Optional[str] = None
    printed_end_page: Optional[str] = None
    source: str = "inferred"  # "original_bookmark" | "original_toc" | "inferred"
    parent_id: Optional[str] = None
    subsections: List[AtlasSection] = Field(default_factory=list)

    @property
    def page_span(self) -> int:
        return max(1, self.end_page - self.start_page + 1)


class PageStructuralMetadata(BaseModel):
    """Structural elements detected on a specific page."""
    has_tables: bool = False
    table_ids: List[str] = Field(default_factory=list)
    table_captions: List[str] = Field(default_factory=list)
    table_headers: List[str] = Field(default_factory=list)
    has_figures: bool = False
    figure_ids: List[str] = Field(default_factory=list)
    figure_captions: List[str] = Field(default_factory=list)
    captions: List[str] = Field(default_factory=list)
    footnotes: List[str] = Field(default_factory=list)
    references: List[str] = Field(default_factory=list)
    annexures: List[str] = Field(default_factory=list)


class AtlasPage(BaseModel):
    """Rich intelligence profile for a single document page."""
    page_number: int  # 1-based physical page
    printed_page_number: Optional[str] = None
    section_ids: List[str] = Field(default_factory=list)
    section_titles: List[str] = Field(default_factory=list)
    keyphrases: List[str] = Field(default_factory=list)  # at least 15 deterministic keyphrases (where text permits)
    structural_metadata: PageStructuralMetadata = Field(default_factory=PageStructuralMetadata)
    char_count: int = 0
    word_count: int = 0
    preview_snippet: str = ""


class SearchResultItem(BaseModel):
    """A scored result from ranked Atlas retrieval."""
    page_number: int
    printed_page_number: Optional[str] = None
    score: float
    matched_sections: List[str] = Field(default_factory=list)
    matched_keyphrases: List[str] = Field(default_factory=list)
    matched_tables: List[str] = Field(default_factory=list)
    section_range: Optional[Tuple[int, int]] = None  # (start_page, end_page)
    preview_snippet: str = ""


class DocumentAtlas(BaseModel):
    """Complete structured, searchable map of a document."""
    document_id: str
    filename: str
    total_pages: int
    sections: List[AtlasSection] = Field(default_factory=list)
    pages: List[AtlasPage] = Field(default_factory=list)
    toc_source: str = "inferred"  # "original_bookmark" | "original_toc" | "inferred"
    toc_pages: List[int] = Field(default_factory=list)
    vocabulary: Dict[str, List[int]] = Field(default_factory=dict)
    bm25_stats: Dict[str, Any] = Field(default_factory=dict)

    def get_page(self, page_number: int) -> Optional[AtlasPage]:
        for p in self.pages:
            if p.page_number == page_number:
                return p
        return None

    def get_section(self, identifier: str) -> Optional[AtlasSection]:
        """Find a section by section_id or title substring match."""
        clean_id = identifier.strip().lower()

        def _search_sections(sections: List[AtlasSection]) -> Optional[AtlasSection]:
            for s in sections:
                if s.section_id.lower() == clean_id or s.title.strip().lower() == clean_id:
                    return s
                if clean_id in s.title.lower():
                    return s
                child_match = _search_sections(s.subsections)
                if child_match:
                    return child_match
            return None

        return _search_sections(self.sections)

    def get_section_range(self, identifier: str) -> Optional[Tuple[int, int]]:
        """Returns (start_page, end_page) for a section."""
        sec = self.get_section(identifier)
        if sec:
            return (sec.start_page, sec.end_page)
        return None

    def search(
        self,
        query: str,
        top_k: int = 5,
        expand_section_range: bool = False,
    ) -> List[SearchResultItem]:
        """Ranked hybrid retrieval over the Document Atlas."""
        from doc_intelligence.atlas.search import AtlasSearcher
        return AtlasSearcher.search(self, query=query, top_k=top_k, expand_section_range=expand_section_range)

    def to_dict(self) -> Dict[str, Any]:
        return self.model_dump(mode="json")

    def to_llm_context(
        self,
        format: str = "json",
        include_table_headers: bool = True,
    ) -> str | Dict[str, Any]:
        """
        Export an ultra-efficient, high-density Document Atlas tailored for injection into
        an LLM prompt / context window.

        Eliminates backend inverted index stats and raw serialization bloat while preserving:
          - Full section hierarchy and physical PDF page bounds
          - Content-adaptive, non-redundant keyphrases per page
          - Exact table counts, headers, and figure indicators

        Args:
            format: "json" (compact minified dict/json string) or "markdown" (delimited text).
            include_table_headers: Whether to include parsed table headers for structural awareness.
        """
        sections_summary = [
            {
                "id": s.section_id,
                "title": s.title,
                "pages": [s.start_page, s.end_page],
                "level": s.level,
                "source": s.source,
                "subsections": [
                    {"id": sub.section_id, "title": sub.title, "pages": [sub.start_page, sub.end_page]}
                    for sub in s.subsections
                ],
            }
            for s in self.sections
        ]

        pages_summary = []
        for p in self.pages:
            p_data: Dict[str, Any] = {
                "page": p.page_number,
                "section": p.section_titles[0] if p.section_titles else None,
                "keyphrases": p.keyphrases,
            }
            if p.printed_page_number:
                p_data["printed_page"] = p.printed_page_number
            if p.structural_metadata.has_tables:
                p_data["has_tables"] = True
                if include_table_headers and p.structural_metadata.table_headers:
                    # Clean newlines from headers for compactness
                    p_data["table_headers"] = [
                        h.replace("\n", " ").strip() for h in p.structural_metadata.table_headers
                    ]
            if p.structural_metadata.has_figures:
                p_data["has_figures"] = True
            if p.structural_metadata.annexures:
                p_data["annexures"] = p.structural_metadata.annexures
            pages_summary.append(p_data)

        if format == "markdown":
            lines = [
                f"# DOCUMENT ATLAS: {self.filename} ({self.total_pages} pages, source: {self.toc_source})",
                "\n## SECTIONS HIERARCHY",
            ]
            for s in self.sections:
                lines.append(f"- {s.title} (pp. {s.start_page}-{s.end_page})")
                for sub in s.subsections:
                    lines.append(f"  * {sub.title} (pp. {sub.start_page}-{sub.end_page})")

            lines.append("\n## PAGE MAP")
            for p_dict in pages_summary:
                sec_str = f"[{p_dict['section']}] " if p_dict.get("section") else ""
                kp_str = ", ".join(p_dict.get("keyphrases", []))
                extras = []
                if p_dict.get("has_tables"):
                    tbls = p_dict.get("table_headers", [])
                    extras.append(f"Tables({len(tbls)}): {'; '.join(tbls)}" if tbls else "Tables")
                if p_dict.get("has_figures"):
                    extras.append("Figures")
                extras_str = f" | {' | '.join(extras)}" if extras else ""
                lines.append(f"p.{p_dict['page']} {sec_str}: {kp_str}{extras_str}")
            return "\n".join(lines)

        # Default: compact dictionary representation for clean JSON serialization
        return {
            "document_id": self.document_id,
            "filename": self.filename,
            "total_pages": self.total_pages,
            "toc_source": self.toc_source,
            "toc_pages": self.toc_pages,
            "sections": sections_summary,
            "pages": pages_summary,
        }
