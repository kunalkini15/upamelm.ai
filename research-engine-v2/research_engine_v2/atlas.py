from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any


ATLAS_WINDOW_TARGET_CHARS = 12000
ATLAS_WINDOW_MAX_PAGES = 6


def prepare_atlas(source_path: str, output: Path) -> tuple[str, dict[str, Any], Any]:
    from doc_intelligence.atlas.builder import DocumentAtlasBuilder

    source = Path(source_path).expanduser().resolve()
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    document_id = f"doc_{digest[:16]}"
    atlas_path = output / "atlas" / f"{document_id}.json"
    if atlas_path.exists():
        atlas = DocumentAtlasBuilder.load_from_json(atlas_path)
    else:
        atlas = DocumentAtlasBuilder.build_from_file(str(source), parser_name="pymupdf")
        atlas.document_id = document_id
        DocumentAtlasBuilder.save_to_json(atlas, atlas_path)
    section_rows = []
    for section in atlas.sections:
        section_rows.append({"section_id": section.section_id, "title": section.title, "level": section.level, "start_page": section.start_page, "end_page": section.end_page, "source": section.source})
    counts = {"tables": 0, "figures": 0, "pages": atlas.total_pages}
    for page in atlas.pages:
        counts["tables"] += len(page.structural_metadata.table_ids)
        counts["figures"] += len(page.structural_metadata.figure_ids)
    overview = {"document_id": document_id, "filename": atlas.filename, "file_hash_sha256": digest, "total_pages": atlas.total_pages, "toc_source": atlas.toc_source, "toc_pages": atlas.toc_pages, "sections": section_rows, "candidate_windows": _candidate_windows(atlas), "content_counts": counts, "representative_keyphrases": sorted({x for p in atlas.pages for x in p.keyphrases})[:100]}
    return document_id, overview, atlas


def _candidate_windows(atlas: Any) -> list[dict[str, Any]]:
    """Create compact, structure-aware planning windows without reading page text.

    Windows stop at Atlas section boundaries and table/heading signals. They are
    candidates for Muse to assess, not extraction instructions or domain rules.
    """
    section_by_page: dict[int, dict[str, Any]] = {}
    for section in atlas.sections:
        for page in range(section.start_page, section.end_page + 1):
            section_by_page.setdefault(page, {"section_ids": [], "section_titles": []})
            section_by_page[page]["section_ids"].append(section.section_id)
            section_by_page[page]["section_titles"].append(section.title)
    windows: list[dict[str, Any]] = []
    current: list[Any] = []
    current_chars = 0
    previous_section: tuple[str, ...] | None = None

    def flush() -> None:
        nonlocal current, current_chars
        if not current:
            return
        first, last = current[0], current[-1]
        windows.append({"pages": [first.page_number, last.page_number], "section_ids": sorted({x for p in current for x in section_by_page.get(p.page_number, {}).get("section_ids", [])}), "section_titles": sorted({x for p in current for x in section_by_page.get(p.page_number, {}).get("section_titles", [])}), "keyphrases": sorted({x for p in current for x in p.keyphrases})[:20], "table_captions": sorted({x for p in current for x in p.structural_metadata.table_captions})[:12], "figure_captions": sorted({x for p in current for x in p.structural_metadata.figure_captions})[:8], "page_count": len(current)})
        current, current_chars = [], 0

    for page in atlas.pages:
        section = section_by_page.get(page.page_number, {})
        section_key = tuple(section.get("section_ids", []))
        page_chars = max(1, int(page.char_count or 0))
        structural_boundary = bool(current and (section_key != previous_section or page.structural_metadata.has_tables and current[-1].structural_metadata.has_tables))
        size_boundary = bool(current and (current_chars + page_chars > ATLAS_WINDOW_TARGET_CHARS or len(current) >= ATLAS_WINDOW_MAX_PAGES))
        if structural_boundary or size_boundary:
            flush()
        current.append(page)
        current_chars += page_chars
        previous_section = section_key
    flush()
    return windows


def inspect_atlas(atlas: Any, section_id: str | None = None, depth: int | None = None) -> dict[str, Any]:
    if not section_id:
        return {"document_id": atlas.document_id, "filename": atlas.filename, "total_pages": atlas.total_pages, "sections": [{"section_id": s.section_id, "title": s.title, "start_page": s.start_page, "end_page": s.end_page, "level": s.level} for s in atlas.sections]}
    section = atlas.get_section(section_id)
    if not section:
        raise ValueError(f"unknown Atlas section: {section_id}")
    pages = []
    for page in atlas.pages:
        if section.start_page <= page.page_number <= section.end_page:
            metadata = page.structural_metadata
            pages.append({
                "page_number": page.page_number,
                "printed_page_number": getattr(page, "printed_page_number", None),
                "keyphrases": list(page.keyphrases or []),
                "char_count": page.char_count,
                "has_tables": bool(metadata.has_tables),
                "table_captions": list(metadata.table_captions or []),
                "table_headers": list(getattr(metadata, "table_headers", []) or []),
                "has_figures": bool(getattr(metadata, "has_figures", False)),
                "figure_captions": list(metadata.figure_captions or []),
            })
    return {"document_id": atlas.document_id, "section": section.model_dump(mode="json"), "pages": pages}


def search_atlas(atlas: Any, query: str, result_limit: int = 8, expand_section: bool = False) -> dict[str, Any]:
    return {"document_id": atlas.document_id, "query": query, "results": [x.model_dump(mode="json") for x in atlas.search(query, top_k=max(1, min(result_limit, 50)), expand_section_range=expand_section)]}
