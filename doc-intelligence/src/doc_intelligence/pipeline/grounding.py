from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

from doc_intelligence.models.document import ContentBlock, Page, TableData
from doc_intelligence.models.task import EvidenceReference, ExtractedField, VerificationStatus


def normalize_token_str(s: str) -> str:
    """Normalize string for robust OCR/whitespace-invariant comparisons."""
    if not s:
        return ""
    # Remove all non-alphanumeric chars and lowercase
    return re.sub(r"[^a-zA-Z0-9]", "", s).lower()


class GroundingVerifier:
    """Verifies that an extracted field actually exists in the claimed source page, table, row, or column."""

    @classmethod
    def verify_field_in_page(
        cls,
        page: Page,
        field_name: str,
        value: Any,
        claimed_source_text: str,
        table_hint: Optional[str] = None,
        row_hint: Optional[int] = None,
    ) -> Tuple[VerificationStatus, Optional[EvidenceReference], str]:
        if value is None or str(value).strip().lower() in ("null", "none", "n/a", "unknown", ""):
            return (
                VerificationStatus.NOT_FOUND_IN_SEARCHED_SCOPE,
                None,
                "Value not present in examined document scope.",
            )

        str_val = str(value).strip()
        norm_val = normalize_token_str(str_val)
        norm_source = normalize_token_str(claimed_source_text)
        norm_page_text = normalize_token_str(page.text)

        # 1. First verify if table context is cited or available
        table_matched: Optional[TableData] = None
        matched_row_idx: Optional[int] = None
        matched_col_name: Optional[str] = None

        if page.tables:
            for t in page.tables:
                for r_idx, row in enumerate(t.rows):
                    row_joined = " ".join(row)
                    norm_row = normalize_token_str(row_joined)

                    # Check if both value and source text (or entity identity) match this specific row
                    if norm_val in norm_row:
                        table_matched = t
                        matched_row_idx = r_idx
                        # Find matching column
                        for c_idx, cell in enumerate(row):
                            if norm_val in normalize_token_str(cell):
                                if c_idx < len(t.headers):
                                    matched_col_name = t.headers[c_idx].strip()
                                break
                        break
                if table_matched:
                    break

        # 2. Check ContentBlocks for text and bounding box
        matched_bbox = None
        matched_block = None
        for b in page.blocks:
            norm_b = normalize_token_str(b.text)
            if norm_val in norm_b or (norm_source and norm_source[:20] in norm_b):
                matched_bbox = b.bbox
                matched_block = b
                break

        # If grounded in a specific table row
        if table_matched and matched_row_idx is not None:
            evidence = EvidenceReference(
                document_id=page.metadata.get("document_id", "doc"),
                pdf_page_number=page.page_number,
                printed_page_number=page.printed_page_number,
                table_id=table_matched.table_id,
                row_index=matched_row_idx,
                column_name=matched_col_name,
                source_text=claimed_source_text or " ".join(table_matched.rows[matched_row_idx]),
                normalized_match=True,
                bbox=table_matched.bbox or matched_bbox,
            )
            return (
                VerificationStatus.GROUNDED,
                evidence,
                f"Field confirmed in table {table_matched.table_id}, row {matched_row_idx+1}.",
            )

        # 3. If grounded in page body text
        if norm_val in norm_page_text or (norm_source and norm_source in norm_page_text):
            evidence = EvidenceReference(
                document_id=page.metadata.get("document_id", "doc"),
                pdf_page_number=page.page_number,
                printed_page_number=page.printed_page_number,
                source_text=claimed_source_text,
                normalized_match=True,
                bbox=matched_bbox,
            )
            return (
                VerificationStatus.GROUNDED,
                evidence,
                "Field confirmed on source page.",
            )

        # 4. If neither value nor claimed text matches the page -> AMBIGUOUS / FAILED GROUNDING
        evidence = EvidenceReference(
            document_id=page.metadata.get("document_id", "doc"),
            pdf_page_number=page.page_number,
            printed_page_number=page.printed_page_number,
            source_text=claimed_source_text,
            normalized_match=False,
            confidence=0.3,
        )
        return (
            VerificationStatus.AMBIGUOUS,
            evidence,
            f"Value '{str_val}' or source quote could not be strictly grounded on page {page.page_number}.",
        )
