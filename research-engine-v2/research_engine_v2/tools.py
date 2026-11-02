from __future__ import annotations

from typing import Any


def bounded_selectors(arguments: dict[str, Any]) -> bool:
    selectors = arguments.get("selectors") or {}
    return bool(selectors.get("pages") or selectors.get("sections") or str(selectors.get("query") or "").strip())


def resolve_pages(atlas: Any, selectors: dict[str, Any]) -> list[int]:
    pages = {int(x) for x in selectors.get("pages", []) if str(x).isdigit()}
    for section_id in selectors.get("sections", []) or []:
        section = atlas.get_section(str(section_id))
        if not section:
            raise ValueError(f"unknown Atlas section: {section_id}")
        pages.update(range(section.start_page, section.end_page + 1))
    query = str(selectors.get("query") or "").strip()
    if query:
        pages.update(x.page_number for x in atlas.search(query, top_k=20))
    if not pages:
        raise ValueError("selectors did not resolve to any pages")
    return sorted(p for p in pages if 1 <= p <= atlas.total_pages)
