from __future__ import annotations

import math
import re
from typing import Dict, List, Optional, Set, Tuple

from doc_intelligence.atlas.models import AtlasPage, AtlasSection, DocumentAtlas, SearchResultItem
from doc_intelligence.indexing.indexer import tokenize


def stem_token(word: str) -> str:
    """Lightweight deterministic stemmer for common suffixes."""
    w = word.lower().strip()
    for suffix in ("ing", "tion", "tions", "ies", "es", "s", "ed", "al", "ment"):
        if w.endswith(suffix) and len(w) - len(suffix) >= 3:
            return w[:-len(suffix)]
    return w


class AtlasSearcher:
    """Ranked hybrid search over the Document Atlas."""

    @classmethod
    def search(
        cls,
        atlas: DocumentAtlas,
        query: str,
        top_k: int = 5,
        expand_section_range: bool = False,
    ) -> List[SearchResultItem]:
        """
        Ranked retrieval combining:
        1. BM25 Okapi full-text scoring with morphological stemming
        2. Section & subsection title match boost (+3.0)
        3. Page keyphrase match boost (+2.0)
        4. Table header & caption match boost (+2.5)
        5. Annexure match boost (+3.5)
        6. Adjacent page context
        """
        if not atlas.pages or not query.strip():
            return []

        # Clean hyphens, slashes, and punctuation so compound phrases tokenize cleanly
        clean_query = re.sub(r"[_\-/\\]+", " ", query)
        query_tokens = tokenize(clean_query)
        if not query_tokens:
            query_tokens = [w.lower() for w in clean_query.strip().split() if len(w) >= 2]

        if not query_tokens:
            return []

        query_stems = {stem_token(qt) for qt in query_tokens}

        total_pages = len(atlas.pages)
        bm25_stats = atlas.bm25_stats or {}
        avgdl = bm25_stats.get("avgdl", 300.0)
        page_lengths = bm25_stats.get("page_lengths", {})
        doc_freqs = bm25_stats.get("doc_freqs", {})

        k1 = 1.5
        b = 0.75

        # Precompute query term IDFs
        query_idfs: Dict[str, float] = {}
        for qt in set(query_tokens):
            df = doc_freqs.get(qt, 0)
            if df > 0:
                idf = math.log((total_pages - df + 0.5) / (df + 0.5) + 1.0)
            else:
                idf = math.log((total_pages + 0.5) / 0.5 + 1.0) * 0.5
            query_idfs[qt] = max(0.1, idf)

        page_scores: Dict[int, float] = {}
        matched_sections_map: Dict[int, List[str]] = {}
        matched_keyphrases_map: Dict[int, List[str]] = {}
        matched_tables_map: Dict[int, List[str]] = {}
        section_range_map: Dict[int, Optional[Tuple[int, int]]] = {}

        # Build quick lookup of page sections and ranges
        all_sections: List[AtlasSection] = []
        def _collect_sections(sections: List[AtlasSection]):
            for s in sections:
                all_sections.append(s)
                _collect_sections(s.subsections)
        _collect_sections(atlas.sections)

        def _matches_query(target_text: str) -> bool:
            if not target_text:
                return False
            t_lower = target_text.lower()
            if any(qt in t_lower for qt in query_tokens):
                return True
            words = re.findall(r"\b[a-zA-Z0-9]{3,}\b", t_lower)
            return any(stem_token(w) in query_stems for w in words)

        for page in atlas.pages:
            p_num = page.page_number
            score = 0.0
            dl = float(page_lengths.get(str(p_num), page.word_count or 100))

            # 1. BM25 score from page text / vocabulary with stemming
            page_text_lower = (page.preview_snippet or "").lower()
            for qt in query_tokens:
                qt_stem = stem_token(qt)
                # Find matching keys in vocabulary
                matching_keys = [k for k in (qt, qt_stem) if k in atlas.vocabulary]
                if not matching_keys:
                    matching_keys = [k for k in atlas.vocabulary if stem_token(k) == qt_stem]

                tf = 0.0
                for vk in matching_keys:
                    if p_num in atlas.vocabulary[vk]:
                        tf += 1.0
                if qt in page_text_lower or qt_stem in page_text_lower:
                    tf += 1.0

                if tf > 0:
                    idf = query_idfs.get(qt, 1.0)
                    denom = tf + k1 * (1.0 - b + b * (dl / max(1.0, avgdl)))
                    bm25_term = idf * ((tf * (k1 + 1.0)) / denom)
                    score += bm25_term

            # 2. Section & Subsection Matches
            matched_secs: List[str] = []
            matching_range: Optional[Tuple[int, int]] = None
            for sec in all_sections:
                if sec.start_page <= p_num <= sec.end_page:
                    if _matches_query(sec.title):
                        matched_secs.append(sec.title)
                        score += 3.0
                        if matching_range is None:
                            matching_range = (sec.start_page, sec.end_page)

            # 3. Keyphrase Matches
            matched_kps: List[str] = []
            for kp in page.keyphrases:
                if _matches_query(kp):
                    matched_kps.append(kp)
                    score += 2.0

            # 4. Table & Figure Matches
            matched_tbls: List[str] = []
            struct = page.structural_metadata
            for cap in struct.table_captions + struct.captions:
                if _matches_query(cap):
                    matched_tbls.append(cap)
                    score += 2.5
            for hdr in struct.table_headers:
                if _matches_query(hdr):
                    matched_tbls.append(f"Header: {hdr[:60]}")
                    score += 2.0

            # 5. Annexure Matches
            if any(term in query.lower() for term in ("annexure", "appendix", "table", "schedule")):
                if struct.annexures:
                    score += 3.5

            if score > 0.0:
                page_scores[p_num] = score
                matched_sections_map[p_num] = matched_secs
                matched_keyphrases_map[p_num] = matched_kps
                matched_tables_map[p_num] = matched_tbls
                section_range_map[p_num] = matching_range

        if not page_scores:
            # If no direct matches, return first top_k pages with score 0
            return [
                SearchResultItem(
                    page_number=p.page_number,
                    printed_page_number=p.printed_page_number,
                    score=0.0,
                    preview_snippet=p.preview_snippet,
                )
                for p in atlas.pages[:top_k]
            ]

        # 6. Adjacent page context (bonus to neighbors of very high-scoring pages)
        boosted_scores: Dict[int, float] = dict(page_scores)
        for p_num, s in page_scores.items():
            if s > 3.0:
                for neighbor in (p_num - 1, p_num + 1):
                    if 1 <= neighbor <= total_pages:
                        boosted_scores[neighbor] = boosted_scores.get(neighbor, 0.0) + (s * 0.15)

        # Sort pages by final score descending
        sorted_pages = sorted(boosted_scores.items(), key=lambda x: x[1], reverse=True)

        # Build SearchResultItems
        results: List[SearchResultItem] = []
        seen_pages: Set[int] = set()

        for p_num, final_score in sorted_pages:
            if p_num in seen_pages:
                continue
            seen_pages.add(p_num)

            p_obj = atlas.get_page(p_num)
            printed_num = p_obj.printed_page_number if p_obj else None
            snippet = p_obj.preview_snippet if p_obj else ""

            res_item = SearchResultItem(
                page_number=p_num,
                printed_page_number=printed_num,
                score=round(final_score, 4),
                matched_sections=matched_sections_map.get(p_num, []),
                matched_keyphrases=matched_keyphrases_map.get(p_num, []),
                matched_tables=matched_tables_map.get(p_num, []),
                section_range=section_range_map.get(p_num),
                preview_snippet=snippet,
            )
            results.append(res_item)

            if len(results) >= top_k and not expand_section_range:
                break

        # If expand_section_range requested, also include pages in top section ranges
        if expand_section_range and results:
            top_res = results[0]
            if top_res.section_range:
                s_start, s_end = top_res.section_range
                for range_p in range(s_start, s_end + 1):
                    if range_p not in seen_pages and 1 <= range_p <= total_pages:
                        seen_pages.add(range_p)
                        p_obj = atlas.get_page(range_p)
                        results.append(
                            SearchResultItem(
                                page_number=range_p,
                                printed_page_number=p_obj.printed_page_number if p_obj else None,
                                score=round(top_res.score * 0.8, 4),
                                matched_sections=[f"Expanded from {top_res.section_range}"],
                                section_range=top_res.section_range,
                                preview_snippet=p_obj.preview_snippet if p_obj else "",
                            )
                        )

        return results[: top_k if not expand_section_range else max(top_k, len(results))]
