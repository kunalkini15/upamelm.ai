from __future__ import annotations

import re
from typing import List

from doc_intelligence.atlas.models import PageStructuralMetadata
from doc_intelligence.models.document import BlockType, Page


class StructuralExtractor:
    """Extracts page-level structural elements deterministically."""

    # Patterns for detecting captions, footnotes, references, and annexures
    CAPTION_PATTERN = re.compile(
        r"^(table|figure|fig\.|plate|map|chart|box|schedule|annexure)\s*[:\.\-\s]+[0-9a-zA-Z\.\-]+",
        re.IGNORECASE,
    )
    FOOTNOTE_PATTERN = re.compile(
        r"^(\*+|\†|\‡|note[:\s]|source[:\s]|disclaimer[:\s]|\[\d+\]|\(\d+\))",
        re.IGNORECASE,
    )
    ANNEXURE_PATTERN = re.compile(
        r"\b(annexure|appendix|schedule|exhibit|attachment|plate)\b\s*([0-9a-zA-Z\.\-]+)?",
        re.IGNORECASE,
    )
    REFERENCE_PATTERN = re.compile(
        r"(^\[\d+\]\s+[A-Z]|^\d+\.\s+[A-Z][a-z]+.*?\(\d{4}\)|[A-Z][a-z]+,\s+[A-Z]\..*?\(\d{4}\))"
    )

    @classmethod
    def extract_page_structure(cls, page: Page) -> PageStructuralMetadata:
        """Analyze page blocks and objects to construct PageStructuralMetadata."""
        meta = PageStructuralMetadata()

        # 1. Tables
        if page.tables:
            meta.has_tables = True
            for t in page.tables:
                meta.table_ids.append(t.table_id)
                if t.caption:
                    clean_cap = t.caption.strip()
                    if clean_cap and clean_cap not in meta.table_captions:
                        meta.table_captions.append(clean_cap)
                if t.headers:
                    h_str = " | ".join(h.strip() for h in t.headers if h.strip())
                    if h_str and h_str not in meta.table_headers:
                        meta.table_headers.append(h_str)

        # 2. Figures / Images
        if page.images:
            meta.has_figures = True
            for img in page.images:
                meta.figure_ids.append(img.image_id)
                if img.caption:
                    clean_cap = img.caption.strip()
                    if clean_cap and clean_cap not in meta.figure_captions:
                        meta.figure_captions.append(clean_cap)

        # 3. Content Blocks (Headings, Captions, Footnotes, Annexures)
        for block in page.blocks:
            text = (block.text or "").strip()
            if not text:
                continue

            first_line = text.split("\n")[0].strip()

            # Captions
            if block.block_type == BlockType.CAPTION or cls.CAPTION_PATTERN.match(first_line):
                if first_line not in meta.captions:
                    meta.captions.append(first_line[:150])

            # Footnotes
            if block.block_type == BlockType.FOOTNOTE or cls.FOOTNOTE_PATTERN.match(first_line):
                # Filter out pure headers/navigation
                if first_line not in meta.footnotes:
                    meta.footnotes.append(first_line[:200])

            # References
            if cls.REFERENCE_PATTERN.search(first_line):
                if first_line not in meta.references:
                    meta.references.append(first_line[:200])

            # Annexures / Appendices
            annex_match = cls.ANNEXURE_PATTERN.search(first_line)
            if annex_match:
                matched_str = annex_match.group(0).strip()
                full_annexure_label = first_line[:100]
                if full_annexure_label not in meta.annexures:
                    meta.annexures.append(full_annexure_label)

        # 4. Text fallback for tables and annexures if not captured in blocks
        if not meta.annexures and page.text:
            for line in page.text.split("\n")[:10]:
                line_str = line.strip()
                if cls.ANNEXURE_PATTERN.match(line_str):
                    meta.annexures.append(line_str[:100])
                    break

        return meta
