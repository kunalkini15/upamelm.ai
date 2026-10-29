from __future__ import annotations

import re
from typing import Dict, List, Set, Tuple

from doc_intelligence.indexing.indexer import DocumentIndexer
from doc_intelligence.models.document import ParsedDocument
from doc_intelligence.models.index import DocumentIndex
from doc_intelligence.models.task import CoverageManifest, CoverageScope, TaskSpecification


class CoveragePlanner:
    """Plans retrieval and expands seed candidate pages into complete section/annexure sequences."""

    @classmethod
    def plan_coverage(
        cls,
        document: ParsedDocument,
        index: DocumentIndex,
        task: TaskSpecification,
    ) -> Tuple[List[int], CoverageManifest]:
        query_terms = [task.objective] + (task.fields or [])
        clean_terms = []
        for q in query_terms:
            clean_terms.extend([t.lower() for t in re.findall(r"\b[a-zA-Z0-9_\-]{3,}\b", q.lower())])

        # 1. Direct section title matching
        section_direct_pages: List[int] = []
        candidate_sections: List[str] = []
        high_value_keywords = {"annexure", "table", "basic", "monitoring", "wells", "inventory", "water", "level"}

        for s in index.sections:
            s_title_lower = s.title.lower()
            matched_kw = [k for k in clean_terms if k in s_title_lower]
            if matched_kw:
                candidate_sections.append(s.title)
                if any(h in s_title_lower for h in high_value_keywords):
                    section_direct_pages.append(s.page_number)

        # 2. Seed pages from vocabulary index
        seed_pages = DocumentIndexer.query_relevant_pages(
            index, query_terms=query_terms, max_pages=task.max_relevant_pages
        )

        candidate_seeds: List[int] = []
        for p in section_direct_pages:
            if p not in candidate_seeds:
                candidate_seeds.append(p)
        for sp in seed_pages:
            if sp not in candidate_seeds:
                candidate_seeds.append(sp)

        # 3. Deterministic Annexure / Section Continuation Expansion across following pages
        expanded_pages: List[int] = list(candidate_seeds)
        if task.expand_annexures:
            for seed in list(candidate_seeds):
                p_obj = document.get_page(seed)
                if p_obj and p_obj.tables:
                    curr = seed + 1
                    while curr <= document.metadata.page_count:
                        next_p = document.get_page(curr)
                        if not next_p or not next_p.tables:
                            break
                        if next_p.blocks and any(b.level == 1 and "annexure" in b.text.lower() for b in next_p.blocks):
                            break
                        if curr not in expanded_pages:
                            expanded_pages.append(curr)
                        curr += 1

        # If data pages >= 14 were targeted, skip cover pages (1, 2)
        if any(p >= 14 for p in expanded_pages):
            expanded_pages = [p for p in expanded_pages if p > 2]

        all_candidate_pages = sorted(list(set(expanded_pages)))

        if task.coverage_scope == CoverageScope.SAMPLE:
            selected_pages = all_candidate_pages[: task.max_relevant_pages]
            skipped_pages = {
                p: "Exceeded max_relevant_pages budget for sample scope"
                for p in all_candidate_pages[task.max_relevant_pages :]
            }
            status = "partial" if skipped_pages else "complete"
        else:
            selected_pages = all_candidate_pages
            skipped_pages = {}
            status = "complete"

        manifest = CoverageManifest(
            scope_requested=task.coverage_scope,
            candidate_sections=candidate_sections[:10],
            candidate_pages=all_candidate_pages,
            processed_pages=selected_pages,
            skipped_pages=skipped_pages,
            status=status,
            notes=f"Planned {len(selected_pages)} pages for task '{task.task_id}'.",
        )

        return selected_pages, manifest
