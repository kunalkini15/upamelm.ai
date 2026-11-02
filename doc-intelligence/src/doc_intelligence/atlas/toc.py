from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, List, Optional, Tuple

from doc_intelligence.atlas.models import AtlasSection
from doc_intelligence.models.document import BlockType, ParsedDocument
from doc_intelligence.providers.base import BaseModelProvider

logger = logging.getLogger(__name__)

TOC_TITLE_PATTERNS = [
    re.compile(r"^\s*(table\s+of\s+contents|contents|index|list\s+of\s+tables|list\s+of\s+figures|list\s+of\s+annexures)\s*$", re.IGNORECASE),
    re.compile(r"\b(contents|table\s+of\s+contents)\b", re.IGNORECASE),
]

TOC_LINE_PATTERN = re.compile(
    r"^(?P<title>.+?)\s*(?:\.{2,}|…+|\s{3,})\s*(?P<page>[0-9ivxlcdm]+)\s*$",
    re.IGNORECASE,
)


class TOCExtractor:
    """Discovers, parses, and validates the Table of Contents of a document."""

    @classmethod
    def extract_or_infer_toc(
        cls,
        parsed_doc: ParsedDocument,
        provider: Optional[BaseModelProvider] = None,
        max_toc_pages: int = 20,
    ) -> Tuple[List[AtlasSection], str, List[int]]:
        """
        Extract structured sections from:
        1. PDF bookmarks (if authoritative and not degenerate)
        2. Printed TOC in initial 15-20 pages using Meta Muse Spark LLM
        3. DocumentIndexer inferred headings hierarchy fallback

        Returns:
            (sections, source_type, toc_page_numbers)
        """
        total_pages = len(parsed_doc.pages)
        if total_pages == 0:
            return ([], "inferred", [])

        # Auto-initialize model provider if not explicitly passed
        if provider is None:
            try:
                from doc_intelligence.providers.factory import ProviderFactory
                provider = ProviderFactory.create()
                logger.info(
                    "Auto-initialized model provider for TOC: %s",
                    getattr(provider, "model", getattr(provider, "provider_name", "muse")),
                )
            except Exception as e:
                logger.warning("Could not auto-initialize model provider for TOC: %s", e)
                provider = None

        # Build mapping of printed_page_number -> physical_page_number
        printed_to_physical: Dict[str, int] = {}
        for p in parsed_doc.pages:
            if p.printed_page_number:
                printed_to_physical[p.printed_page_number.strip()] = p.page_number

        # -------------------------------------------------------------
        # 1. Check PDF bookmarks (verify not degenerate)
        # -------------------------------------------------------------
        bookmarks = parsed_doc.metadata.custom_metadata.get("bookmarks")
        is_degenerate_bm = cls._is_degenerate_bookmark_set(bookmarks, total_pages)

        if bookmarks and not is_degenerate_bm:
            logger.info("Found %d authoritative PDF bookmarks; constructing bookmark-based Atlas sections.", len(bookmarks))
            sections = cls._build_sections_from_bookmarks(bookmarks, total_pages)
            if sections:
                return (sections, "original_bookmark", [])

        # -------------------------------------------------------------
        # 2. Check initial 15-20 pages for printed Table of Contents
        # -------------------------------------------------------------
        toc_pages, toc_text = cls._find_toc_pages(parsed_doc, max_pages=max_toc_pages)
        if toc_pages and toc_text.strip():
            logger.info("Found printed TOC on physical page(s) %s", toc_pages)
            sections = None
            if provider is not None:
                sections = cls._extract_toc_with_muse(
                    toc_text=toc_text,
                    provider=provider,
                    total_pages=total_pages,
                    printed_to_physical=printed_to_physical,
                )
            
            # If Muse extraction didn't produce sections or no provider, fallback to layout-tolerant parser
            if not sections:
                sections = cls._extract_toc_with_regex(
                    toc_text=toc_text,
                    total_pages=total_pages,
                    printed_to_physical=printed_to_physical,
                )

            if sections:
                return (sections, "original_toc", toc_pages)

        # -------------------------------------------------------------
        # 3. Fallback: Infer structure from heading blocks
        # (NEVER fallback to degenerate cover bookmarks)
        # -------------------------------------------------------------
        logger.info("No authoritative TOC found; inferring structure from document headings.")
        sections = cls._infer_sections_from_headings(parsed_doc)
        return (sections, "inferred", [])

    @classmethod
    def _is_degenerate_bookmark_set(cls, bookmarks: Any, total_pages: int) -> bool:
        """Check whether PDF bookmarks are merely cover/title metadata rather than a full TOC."""
        if not bookmarks or not isinstance(bookmarks, list) or len(bookmarks) == 0:
            return True
        if len(bookmarks) <= 2 and total_pages > 5:
            return True
        # Check distinct physical pages referenced
        pages_ref = set()
        for b in bookmarks:
            try:
                if len(b) >= 3 and str(b[2]).isdigit():
                    pages_ref.add(int(b[2]))
            except Exception:
                pass
        if len(pages_ref) <= 1 and total_pages > 5:
            return True
        return False

    @classmethod
    def _build_sections_from_bookmarks(
        cls, bookmarks: List[Any], total_pages: int
    ) -> List[AtlasSection]:
        """Convert PyMuPDF outline bookmarks [[lvl, title, page], ...] to AtlasSection hierarchy."""
        flat_sections: List[AtlasSection] = []
        for i, bm in enumerate(bookmarks):
            try:
                lvl = int(bm[0])
                title = str(bm[1]).strip()
                page = int(bm[2])
                page = max(1, min(total_pages, page))
            except (IndexError, ValueError, TypeError):
                continue

            sec = AtlasSection(
                section_id=f"bm_{i + 1}",
                title=title,
                level=lvl,
                start_page=page,
                end_page=total_pages,  # will adjust below
                source="original_bookmark",
            )
            flat_sections.append(sec)

        if not flat_sections:
            return []

        # Fix end_page for each section based on the next section at same or higher level
        cls._adjust_end_pages(flat_sections, total_pages)
        return cls._nest_hierarchy(flat_sections)

    @classmethod
    def _find_toc_pages(
        cls, parsed_doc: ParsedDocument, max_pages: int = 20
    ) -> Tuple[List[int], str]:
        """Scan initial pages to locate Table of Contents text."""
        toc_pages: List[int] = []
        toc_texts: List[str] = []
        limit = min(max_pages, len(parsed_doc.pages))

        is_collecting = False
        for p_idx in range(limit):
            page = parsed_doc.pages[p_idx]
            text = page.text or ""
            lines = [line.strip() for line in text.split("\n") if line.strip()]

            has_toc_header = False
            for line in lines[:10]:
                if any(pat.match(line) or pat.search(line) for pat in TOC_TITLE_PATTERNS):
                    has_toc_header = True
                    break

            # Count lines with dotted leaders or typical TOC entries
            dotted_lines = sum(1 for line in lines if TOC_LINE_PATTERN.match(line))
            
            # Count multiline pairs (title on line i, standalone number on line i+1)
            pair_count = 0
            for i in range(len(lines) - 1):
                cur = lines[i]
                nxt = lines[i + 1]
                if (nxt.isdigit() or re.match(r"^[ivxlcdm]+$", nxt, re.IGNORECASE)) and len(cur) >= 3 and not cur.isdigit():
                    pair_count += 1

            is_toc_page = has_toc_header or (dotted_lines >= 4) or (pair_count >= 4)

            if is_toc_page:
                is_collecting = True
                toc_pages.append(page.page_number)
                toc_texts.append(text)
            elif is_collecting:
                # If we were collecting and this page continues with dotted lines or number pairs, keep it
                if dotted_lines >= 3 or pair_count >= 3:
                    toc_pages.append(page.page_number)
                    toc_texts.append(text)
                else:
                    is_collecting = False

        return (toc_pages, "\n\n".join(toc_texts))

    @classmethod
    def _extract_toc_with_muse(
        cls,
        toc_text: str,
        provider: BaseModelProvider,
        total_pages: int,
        printed_to_physical: Dict[str, int],
    ) -> Optional[List[AtlasSection]]:
        """Ask Meta Muse Spark to structure the extracted TOC text into sections and page numbers."""
        system_prompt = (
            "You are a document structure intelligence engine. Extract the Table of Contents "
            "into a clean JSON structure of sequential chapters, sections, and annexures in sequential order. "
            "Do NOT include entries from 'List of Tables' or 'List of Figures' that reference prior pages. "
            "Always return valid JSON only."
        )
        user_prompt = f"""Extract the sequential chapters, sections, and annexures with their starting page references from this Table of Contents.
Note: Titles and page numbers may appear on the same line, adjacent lines, in columns, or with dotted leaders.

---
{toc_text[:8000]}
---

Return JSON in this exact format:
{{
  "sections": [
    {{
      "title": "Title of chapter or annexure",
      "level": 1,
      "printed_page": "1"
    }}
  ]
}}"""

        try:
            response = provider.complete(
                prompt=user_prompt,
                system_instruction=system_prompt,
                json_mode=True,
                temperature=0.0,
            )
            raw = response.content.strip()
            # Clean markdown JSON code fences
            if raw.startswith("```"):
                lines = raw.split("\n")
                if lines[0].startswith("```"):
                    lines = lines[1:]
                if lines and lines[-1].startswith("```"):
                    lines = lines[:-1]
                raw = "\n".join(lines).strip()

            data = json.loads(raw)
            entries = data.get("sections", [])
            if not entries:
                return None

            flat_sections: List[AtlasSection] = []
            for i, entry in enumerate(entries):
                title = str(entry.get("title", "")).strip()
                if not title:
                    continue
                level = int(entry.get("level", 1))
                printed_p = str(entry.get("printed_page", "")).strip()

                # Validate and resolve physical page
                phys_page = cls._resolve_physical_page(printed_p, printed_to_physical, total_pages)
                flat_sections.append(
                    AtlasSection(
                        section_id=f"toc_{i + 1}",
                        title=title,
                        level=level,
                        start_page=phys_page,
                        end_page=total_pages,
                        printed_start_page=printed_p or None,
                        source="original_toc",
                    )
                )

            if flat_sections:
                cls._adjust_end_pages(flat_sections, total_pages)
                return cls._nest_hierarchy(flat_sections)

        except Exception as e:
            logger.warning("Muse TOC extraction failed: %s; falling back to layout parser.", e)

        return None

    @classmethod
    def _extract_toc_with_regex(
        cls,
        toc_text: str,
        total_pages: int,
        printed_to_physical: Dict[str, int],
    ) -> List[AtlasSection]:
        """Deterministic fallback parsing for both single-line and multiline TOC formats."""
        flat_sections: List[AtlasSection] = []
        counter = 0

        lines = [l.strip() for l in toc_text.split("\n") if l.strip()]
        i = 0
        while i < len(lines):
            line_str = lines[i]
            match = TOC_LINE_PATTERN.match(line_str)
            if match:
                title = match.group("title").strip(". -")
                printed_p = match.group("page").strip()
                if title and len(title) >= 2:
                    counter += 1
                    phys_page = cls._resolve_physical_page(printed_p, printed_to_physical, total_pages)
                    level = 2 if re.match(r"^\d+\.\d+", title) else 1
                    flat_sections.append(
                        AtlasSection(
                            section_id=f"toc_{counter}",
                            title=title,
                            level=level,
                            start_page=phys_page,
                            end_page=total_pages,
                            printed_start_page=printed_p,
                            source="original_toc",
                        )
                    )
                i += 1
                continue

            # Check multiline title-page pairs (e.g. "1 Introduction\n3")
            if i + 1 < len(lines):
                nxt = lines[i + 1]
                if (nxt.isdigit() or re.match(r"^[ivxlcdm]+$", nxt, re.IGNORECASE)) and len(line_str) >= 3 and not line_str.isdigit():
                    title = line_str.strip(". -")
                    printed_p = nxt.strip()
                    if title and not any(p.match(title) for p in TOC_TITLE_PATTERNS) and title.lower() != "page no":
                        counter += 1
                        phys_page = cls._resolve_physical_page(printed_p, printed_to_physical, total_pages)
                        level = 2 if re.match(r"^\d+\.\d+", title) else 1
                        flat_sections.append(
                            AtlasSection(
                                section_id=f"toc_{counter}",
                                title=title,
                                level=level,
                                start_page=phys_page,
                                end_page=total_pages,
                                printed_start_page=printed_p,
                                source="original_toc",
                            )
                        )
                        i += 2
                        continue
            i += 1

        if not flat_sections:
            return []

        cls._adjust_end_pages(flat_sections, total_pages)
        return cls._nest_hierarchy(flat_sections)

    @classmethod
    def _infer_sections_from_headings(cls, parsed_doc: ParsedDocument) -> List[AtlasSection]:
        """Infer hierarchy from heading and title blocks across the document."""
        total_pages = len(parsed_doc.pages)
        flat_sections: List[AtlasSection] = []
        counter = 0

        for page in parsed_doc.pages:
            p_num = page.page_number
            for block in page.blocks:
                if block.block_type in (BlockType.TITLE, BlockType.HEADING):
                    title = block.text.strip().split("\n")[0][:120]
                    if not title or len(title) < 3:
                        continue

                    # Filter out boilerplate headings or pure numbers
                    if title.isdigit() or title.lower() in {"page", "report"}:
                        continue

                    # Filter out raw table cells/measurements misclassified as headings
                    if not cls._is_valid_inferred_heading(title):
                        continue

                    counter += 1
                    level = block.level or (1 if block.block_type == BlockType.TITLE else 2)
                    flat_sections.append(
                        AtlasSection(
                            section_id=f"inf_{counter}",
                            title=title,
                            level=level,
                            start_page=p_num,
                            end_page=total_pages,
                            printed_start_page=page.printed_page_number,
                            source="inferred",
                        )
                    )

        if not flat_sections:
            # Document has no detected headings: create a single default section
            return [
                AtlasSection(
                    section_id="sec_1",
                    title=parsed_doc.metadata.title or "Full Document",
                    level=1,
                    start_page=1,
                    end_page=max(1, total_pages),
                    source="inferred",
                )
            ]

        cls._adjust_end_pages(flat_sections, total_pages)
        return cls._nest_hierarchy(flat_sections)

    @classmethod
    def _is_valid_inferred_heading(cls, title: str) -> bool:
        clean = title.strip()
        alpha_count = sum(1 for c in clean if c.isalpha())
        if alpha_count < 4:
            return False
        # Table cells with measurements or fractions e.g. "16.25/Shertha", "88.10/Bhat-Ii"
        if "/" in clean and any(c.isdigit() for c in clean):
            return False
        # Single letter or sub-bullet like "H.", "3.", "5."
        if re.match(r"^[A-Za-z0-9]\.?\s*$", clean):
            return False
        # Pure measurement ranges like "0 to 70"
        if re.match(r"^\d+\s+to\s+\d+", clean, re.IGNORECASE):
            return False
        # Common non-heading table metadata or disclosure lines
        lower = clean.lower()
        if lower.startswith((
            "towards partial", "date of disclosure", "month of pre", "month of post",
            "note :", "note ;", "state :", "district :", "block/taluk", "date of",
            "sr. no", "well id", "village name", "type of well"
        )):
            return False
        return True

    @classmethod
    def _resolve_physical_page(
        cls,
        printed_page_str: str,
        printed_to_physical: Dict[str, int],
        total_pages: int,
    ) -> int:
        """Map printed page number string (e.g. '15') to physical 1-based page index."""
        clean = printed_page_str.strip().lower()
        if clean in printed_to_physical:
            return printed_to_physical[clean]

        # Calculate folio offset if printed_to_physical contains numeric mappings
        numeric_offsets = []
        for p_str, phys in printed_to_physical.items():
            if p_str.isdigit():
                numeric_offsets.append(phys - int(p_str))

        offset = int(sorted(numeric_offsets)[len(numeric_offsets) // 2]) if numeric_offsets else 0

        # If it's a numeric digit, check if applying offset falls within document bounds
        if clean.isdigit():
            val = int(clean)
            if offset > 0 and 1 <= val + offset <= total_pages:
                return val + offset
            if 1 <= val <= total_pages:
                return val

        # Fallback to page 1
        return 1

    @classmethod
    def _adjust_end_pages(cls, flat_sections: List[AtlasSection], total_pages: int) -> None:
        """Ensure monotonic ranges and set end_page to next section's start_page - 1."""
        if not flat_sections:
            return

        # Filter out non-monotonic backwards jumps (e.g. table catalogs that jump back to earlier pages)
        monotonic: List[AtlasSection] = []
        max_seen = 0
        for s in flat_sections:
            if s.start_page >= max_seen:
                monotonic.append(s)
                max_seen = s.start_page
            else:
                logger.debug("Filtered out non-monotonic entry: %s (page %d < %d)", s.title, s.start_page, max_seen)

        flat_sections.clear()
        flat_sections.extend(monotonic)

        for i in range(len(flat_sections)):
            curr = flat_sections[i]
            if i + 1 < len(flat_sections):
                nxt = flat_sections[i + 1]
                if nxt.start_page > curr.start_page:
                    curr.end_page = max(curr.start_page, nxt.start_page - 1)
                else:
                    curr.end_page = curr.start_page
            else:
                curr.end_page = total_pages

            curr.end_page = min(total_pages, max(curr.start_page, curr.end_page))

    @classmethod
    def _nest_hierarchy(cls, flat_sections: List[AtlasSection]) -> List[AtlasSection]:
        """Nest subsections under their parent level-1 sections where appropriate."""
        if not flat_sections:
            return []

        roots: List[AtlasSection] = []
        stack: List[AtlasSection] = []

        for sec in flat_sections:
            while stack and stack[-1].level >= sec.level:
                stack.pop()

            if not stack:
                roots.append(sec)
            else:
                sec.parent_id = stack[-1].section_id
                stack[-1].subsections.append(sec)

            stack.append(sec)

        return roots
