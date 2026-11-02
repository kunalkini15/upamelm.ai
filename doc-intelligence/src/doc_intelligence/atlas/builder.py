from __future__ import annotations

import json
import logging
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

from doc_intelligence.atlas.keyphrases import KeyphraseExtractor
from doc_intelligence.atlas.models import AtlasPage, AtlasSection, DocumentAtlas
from doc_intelligence.atlas.structure import StructuralExtractor
from doc_intelligence.atlas.toc import TOCExtractor
from doc_intelligence.indexing.indexer import tokenize
from doc_intelligence.models.document import ParsedDocument
from doc_intelligence.parsers.registry import ParserRegistry
from doc_intelligence.providers.base import BaseModelProvider

logger = logging.getLogger(__name__)


class DocumentAtlasBuilder:
    """Orchestrates building a reusable, searchable Document Atlas from a parsed document."""

    @classmethod
    def build(
        cls,
        parsed_doc: ParsedDocument,
        provider: Optional[BaseModelProvider] = None,
        max_toc_pages: int = 20,
    ) -> DocumentAtlas:
        """Construct the complete DocumentAtlas for a ParsedDocument."""
        total_pages = len(parsed_doc.pages)
        doc_id = parsed_doc.metadata.document_id
        filename = parsed_doc.metadata.filename

        # Auto-initialize model provider if not explicitly passed
        if provider is None:
            try:
                from doc_intelligence.providers.factory import ProviderFactory
                provider = ProviderFactory.create()
                logger.info(
                    "Auto-initialized model provider for Document Atlas: %s",
                    getattr(provider, "model", getattr(provider, "provider_name", "muse")),
                )
            except Exception as e:
                logger.warning("Could not auto-initialize model provider: %s", e)
                provider = None

        logger.info("Building Document Atlas for '%s' (%d pages)...", filename, total_pages)

        # 1. Discover or infer Table of Contents
        sections, toc_source, toc_pages = TOCExtractor.extract_or_infer_toc(
            parsed_doc=parsed_doc,
            provider=provider,
            max_toc_pages=max_toc_pages,
        )

        # Collect flat sections for mapping pages to sections
        all_sections: List[AtlasSection] = []
        def _collect(secs: List[AtlasSection]):
            for s in secs:
                all_sections.append(s)
                _collect(s.subsections)
        _collect(sections)

        # 2. Build corpus-wide statistics and vocabulary index
        corpus_dfs: Dict[str, int] = Counter()
        vocabulary: Dict[str, List[int]] = {}
        page_lengths: Dict[str, int] = {}
        total_words = 0

        for page in parsed_doc.pages:
            tokens = tokenize(page.text or "")
            word_count = len(tokens)
            page_lengths[str(page.page_number)] = word_count
            total_words += word_count

            unique_tokens = set(tokens)
            for token in unique_tokens:
                corpus_dfs[token] += 1
                if token not in vocabulary:
                    vocabulary[token] = []
                vocabulary[token].append(page.page_number)

        avgdl = float(total_words) / max(1.0, float(total_pages))
        bm25_stats = {
            "avgdl": avgdl,
            "page_lengths": page_lengths,
            "doc_freqs": dict(corpus_dfs),
        }

        # 3. Process each page: Keyphrases, structural metadata, and section links
        atlas_pages: List[AtlasPage] = []
        for page in parsed_doc.pages:
            p_num = page.page_number
            text = page.text or ""

            # Extract content-adaptive, deduplicated keyphrases
            kps = KeyphraseExtractor.extract_page_keyphrases(
                page_text=text,
                corpus_dfs=corpus_dfs,
                total_pages=total_pages,
            )

            # Structural metadata
            struct_meta = StructuralExtractor.extract_page_structure(page)

            # Section membership
            sec_ids: List[str] = []
            sec_titles: List[str] = []
            for s in all_sections:
                if s.start_page <= p_num <= s.end_page:
                    sec_ids.append(s.section_id)
                    sec_titles.append(s.title)

            # Clean preview snippet
            snippet = " ".join(text.split()[:50])

            atlas_page = AtlasPage(
                page_number=p_num,
                printed_page_number=page.printed_page_number,
                section_ids=sec_ids,
                section_titles=sec_titles,
                keyphrases=kps,
                structural_metadata=struct_meta,
                char_count=len(text),
                word_count=page_lengths.get(str(p_num), 0),
                preview_snippet=snippet,
            )
            atlas_pages.append(atlas_page)

        atlas = DocumentAtlas(
            document_id=doc_id,
            filename=filename,
            total_pages=total_pages,
            sections=sections,
            pages=atlas_pages,
            toc_source=toc_source,
            toc_pages=toc_pages,
            vocabulary=vocabulary,
            bm25_stats=bm25_stats,
        )

        logger.info(
            "Document Atlas built successfully: %d sections (%s), %d pages mapped.",
            len(sections),
            toc_source,
            len(atlas_pages),
        )
        return atlas

    @classmethod
    def build_from_file(
        cls,
        file_path: str,
        parser_name: str = "pymupdf",
        provider: Optional[BaseModelProvider] = None,
        max_toc_pages: int = 20,
    ) -> DocumentAtlas:
        """Parse file and construct Document Atlas in one step."""
        parser = ParserRegistry.get(parser_name)
        parsed_doc = parser.parse(file_path)
        return cls.build(parsed_doc, provider=provider, max_toc_pages=max_toc_pages)

    @classmethod
    def save_to_json(
        cls,
        atlas: DocumentAtlas,
        output_path: str | Path,
        efficient: bool = True,
    ) -> None:
        """
        Serialize DocumentAtlas to a JSON file.
        
        Args:
            atlas: The DocumentAtlas to save.
            output_path: Target path for the JSON file.
            efficient: When True (default), writes the compact, clean structured format
                       optimized for LLM context ingestion without token bloat.
        """
        out = Path(output_path)
        out.parent.mkdir(parents=True, exist_ok=True)
        data = atlas.to_llm_context(format="json") if efficient else atlas.to_dict()
        with open(out, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        logger.info("Saved %s Document Atlas to %s", "efficient" if efficient else "raw", out)

    @classmethod
    def load_from_json(cls, json_path: str | Path) -> DocumentAtlas:
        """
        Deserialize DocumentAtlas from a JSON file.
        Supports both full raw DocumentAtlas dumps and compact/efficient LLM context JSON.
        """
        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        # If data is in the efficient format (keys 'id', 'pages' with 'page', etc.)
        if "sections" in data and data["sections"] and "id" in data["sections"][0]:
            # Reconstruct sections
            def _parse_sec(s_dict: Dict[str, Any]) -> AtlasSection:
                start_p, end_p = s_dict.get("pages", [1, 1])
                subsecs = [_parse_sec(sub) for sub in s_dict.get("subsections", [])]
                return AtlasSection(
                    section_id=s_dict.get("id", ""),
                    title=s_dict.get("title", ""),
                    level=s_dict.get("level", 1),
                    start_page=start_p,
                    end_page=end_p,
                    source=s_dict.get("source", "original_toc"),
                    subsections=subsecs,
                )

            rebuilt_sections = [_parse_sec(s) for s in data.get("sections", [])]

            # Reconstruct pages
            rebuilt_pages = []
            for p in data.get("pages", []):
                p_num = p.get("page", 1)
                sec_titles = [p["section"]] if p.get("section") else []
                kps = p.get("keyphrases", [])
                tbl_headers = p.get("table_headers", [])
                has_tables = p.get("has_tables", bool(tbl_headers))
                has_figs = p.get("has_figures", False)
                annexures = p.get("annexures", [])

                rebuilt_pages.append(
                    AtlasPage(
                        page_number=p_num,
                        printed_page_number=p.get("printed_page"),
                        section_titles=sec_titles,
                        keyphrases=kps,
                        structural_metadata={
                            "has_tables": has_tables,
                            "table_headers": tbl_headers,
                            "has_figures": has_figs,
                            "annexures": annexures,
                        },
                    )
                )

            return DocumentAtlas(
                document_id=data.get("document_id", "doc_unknown"),
                filename=data.get("filename", "unknown.pdf"),
                total_pages=data.get("total_pages", len(rebuilt_pages)),
                toc_source=data.get("toc_source", "original_toc"),
                toc_pages=data.get("toc_pages", []),
                sections=rebuilt_sections,
                pages=rebuilt_pages,
            )

        return DocumentAtlas.model_validate(data)
