from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Any, Dict, List

from doc_intelligence.atlas.builder import DocumentAtlasBuilder
from doc_intelligence.atlas.models import DocumentAtlas, SearchResultItem
from doc_intelligence.atlas.toc import TOCExtractor
from doc_intelligence.parsers.pymupdf_parser import PyMuPDFParser
from doc_intelligence.providers.factory import ProviderFactory

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("atlas_validation")

OUTPUT_DIR = Path("sample_docs/atlas_validation")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

QUERIES = [
    "Aquifer characteristics",
    "Historical groundwater levels",
    "Monitoring-well inventory",
    "Groundwater quality",
    "Geological formations",
    "Groundwater recharge",
]


def validate_document(pdf_path: str, doc_name: str, use_muse: bool = True):
    logger.info("==================================================")
    logger.info(f"Validating Document: {doc_name} ({pdf_path})")
    logger.info("==================================================")

    parser = PyMuPDFParser()
    t0 = time.time()
    parsed_doc = parser.parse(pdf_path)
    parse_time = time.time() - t0
    logger.info(f"Parsed {len(parsed_doc.pages)} pages in {parse_time:.2f}s")

    provider = None
    if use_muse:
        provider = ProviderFactory.create("muse")
        logger.info(f"Initialized provider: {getattr(provider, 'model', 'default')}")

    # Build Atlas
    t1 = time.time()
    atlas = DocumentAtlasBuilder.build(parsed_doc, provider=provider)
    build_time = time.time() - t1
    logger.info(f"Built Atlas in {build_time:.2f}s (TOC source: {atlas.toc_source}, Sections: {len(atlas.sections)})")

    # Save JSON artifact
    json_path = OUTPUT_DIR / f"{doc_name}_atlas.json"
    DocumentAtlasBuilder.save_to_json(atlas, json_path)
    logger.info(f"Saved JSON artifact to {json_path}")

    # Evaluate queries
    query_results: Dict[str, List[Dict[str, Any]]] = {}
    for q in QUERIES:
        results = atlas.search(q, top_k=5, expand_section_range=True)
        query_results[q] = [
            {
                "page_number": r.page_number,
                "printed_page_number": r.printed_page_number,
                "score": r.score,
                "matched_sections": r.matched_sections,
                "matched_keyphrases": r.matched_keyphrases,
                "matched_tables": r.matched_tables,
                "section_range": r.section_range,
                "preview_snippet": r.preview_snippet[:120],
            }
            for r in results
        ]

    # Generate Markdown Report for this document
    md_path = OUTPUT_DIR / f"{doc_name}_validation.md"
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(f"# Document Atlas Validation: {doc_name}\n\n")
        f.write(f"- **File Path**: `{pdf_path}`\n")
        f.write(f"- **Total Pages**: {atlas.total_pages}\n")
        f.write(f"- **TOC Discovery Mode**: `{atlas.toc_source}`\n")
        f.write(f"- **TOC Pages**: `{atlas.toc_pages}`\n")
        f.write(f"- **Total Sections**: {len(atlas.sections)}\n")
        f.write(f"- **Build Duration**: {build_time:.2f}s\n\n")

        # 1. Document Structure / Hierarchy
        f.write("## 1. Document Structure & Hierarchy\n\n")
        f.write("| Section ID | Title | Level | PDF Pages | Printed Pages | Source |\n")
        f.write("|---|---|---|---|---|---|\n")

        def _write_sections(secs, indent=0):
            for s in secs:
                prefix = "&nbsp;&nbsp;" * indent
                p_print = f"{s.printed_start_page or ''} - {s.printed_end_page or ''}".strip(" -")
                f.write(f"| `{s.section_id}` | {prefix}{s.title} | {s.level} | {s.start_page}–{s.end_page} | {p_print or 'N/A'} | `{s.source}` |\n")
                if s.subsections:
                    _write_sections(s.subsections, indent + 1)

        _write_sections(atlas.sections)
        f.write("\n\n")

        # 2. Page-by-Page Keyphrases and Content Types
        f.write("## 2. Page-Level Intelligence (All Pages)\n\n")
        f.write("| Page | Printed Folio | Sections | Keyphrases | Content Types |\n")
        f.write("|---|---|---|---|---|\n")
        for p in atlas.pages:
            sec_display = "<br>".join(p.section_titles[:2]) if p.section_titles else "-"
            kps_display = ", ".join(p.keyphrases) if p.keyphrases else "*(none)*"
            
            content_types = []
            sm = p.structural_metadata
            if sm.has_tables:
                content_types.append(f"Tables ({len(sm.table_ids)})")
            if sm.has_figures:
                content_types.append(f"Figures ({len(sm.figure_ids)})")
            if sm.captions:
                content_types.append("Captions")
            if sm.footnotes:
                content_types.append("Footnotes")
            if sm.annexures:
                content_types.append(f"Annexures: {sm.annexures[0][:30]}")
            if sm.references:
                content_types.append("References")
            
            ct_display = ", ".join(content_types) if content_types else "Text"
            f.write(f"| {p.page_number} | {p.printed_page_number or '-'} | {sec_display} | {kps_display} | {ct_display} |\n")

        f.write("\n\n")

        # 3. Retrieval Test Results
        f.write("## 3. Retrieval Evaluation\n\n")
        for q, res_list in query_results.items():
            f.write(f"### Query: `{q}`\n\n")
            f.write("| Rank | Page | Score | Matched Sections | Matched Keyphrases / Tables | Section Range |\n")
            f.write("|---|---|---|---|---|---|\n")
            for idx, r in enumerate(res_list, 1):
                m_sec = "<br>".join(r["matched_sections"][:2]) if r["matched_sections"] else "-"
                m_kp_tbl = []
                if r["matched_keyphrases"]:
                    m_kp_tbl.append("KP: " + ", ".join(r["matched_keyphrases"][:2]))
                if r["matched_tables"]:
                    m_kp_tbl.append("TBL: " + ", ".join(r["matched_tables"][:1]))
                kp_tbl_disp = "<br>".join(m_kp_tbl) if m_kp_tbl else "-"
                rng_disp = f"{r['section_range'][0]}–{r['section_range'][1]}" if r["section_range"] else "-"
                f.write(f"| {idx} | {r['page_number']} | {r['score']:.3f} | {m_sec} | {kp_tbl_disp} | {rng_disp} |\n")
            f.write("\n")

    logger.info(f"Wrote Markdown report to {md_path}")
    return atlas, query_results


if __name__ == "__main__":
    validate_document(
        pdf_path="sample_docs/11GandhinagarGandhinagar2022.pdf",
        doc_name="11Gandhinagar",
        use_muse=True,
    )
    validate_document(
        pdf_path="sample_docs/16849256461403930555file.pdf",
        doc_name="16849256461403930555",
        use_muse=True,
    )
