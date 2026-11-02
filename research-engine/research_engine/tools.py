from __future__ import annotations
import threading
import hashlib
import json
import math
import time
from pathlib import Path
from typing import List
from doc_intelligence.indexing.indexer import DocumentIndexer
from doc_intelligence.indexing.indexer import tokenize
from doc_intelligence.atlas.builder import DocumentAtlasBuilder
from doc_intelligence.models.task import CoverageScope, TaskSpecification
from doc_intelligence.parsers.registry import ParserRegistry
from doc_intelligence.pipeline.extractor import IntelligencePipeline
from doc_intelligence.providers.base import BaseModelProvider
from .logging_utils import get_logger


class _LoggedNestedProvider(BaseModelProvider):
    """Adds per-call visibility around Document Intelligence's Muse calls."""

    def __init__(
        self, delegate: BaseModelProvider, logger, token_limit=None, output_limit=None
    ):
        self.delegate = delegate
        self.logger = logger
        self.token_limit = token_limit
        self.output_limit = output_limit
        self.tokens_used = 0
        self.budget_lock = threading.Lock()

    @property
    def provider_name(self):
        return self.delegate.provider_name

    def complete(
        self,
        prompt,
        system_instruction=None,
        json_mode=False,
        temperature=0.0,
        reasoning_effort=None,
    ):
        started = time.perf_counter()
        self.logger.info(
            "nested_model_request phase=document_intelligence prompt_chars=%d json_mode=%s",
            len(prompt),
            json_mode,
        )
        try:
            if self.token_limit is None:
                cap = self.output_limit
                if cap is not None:
                    setter = getattr(self.delegate, "set_max_output_tokens", None)
                    if setter:
                        setter(cap)
                response = self.delegate.complete(
                    prompt,
                    system_instruction=system_instruction,
                    json_mode=json_mode,
                    temperature=temperature,
                    reasoning_effort=reasoning_effort or "low",
                )
            else:
                with self.budget_lock:
                    remaining = self.token_limit - self.tokens_used
                    if remaining <= 0:
                        raise RuntimeError(
                            "request token ceiling reached before nested Muse call"
                        )
                    cap = (
                        min(remaining, self.output_limit)
                        if self.output_limit is not None
                        else remaining
                    )
                    setter = getattr(self.delegate, "set_max_output_tokens", None)
                    if setter:
                        setter(cap)
                    response = self.delegate.complete(
                        prompt,
                        system_instruction=system_instruction,
                        json_mode=json_mode,
                        temperature=temperature,
                        reasoning_effort=reasoning_effort or "low",
                    )
                    observed_tokens = response.total_tokens or (
                        response.prompt_tokens + response.completion_tokens
                    )
                    self.tokens_used += max(0, int(observed_tokens))
            self.logger.info(
                "nested_model_response phase=document_intelligence model=%s prompt_tokens=%d completion_tokens=%d total_tokens=%d duration=%.2fs parsed_json=%s",
                response.model_name,
                response.prompt_tokens,
                response.completion_tokens,
                response.total_tokens,
                time.perf_counter() - started,
                bool(response.parsed_json),
            )
            return response
        except Exception as exc:
            self.logger.exception(
                "nested_model_error phase=document_intelligence duration=%.2fs error=%s",
                time.perf_counter() - started,
                exc,
            )
            raise


class DocumentIntelligenceAdapter:
    """The only Research Engine boundary to Document Intelligence."""

    def __init__(
        self,
        provider: BaseModelProvider,
        permitted_paths: List[str],
        max_model_calls=10,
        max_tokens=50000,
        cache_dir=None,
        max_output_tokens=None,
    ):
        self.logger = get_logger()
        self.provider = provider
        self.permitted = {str(Path(p).resolve()) for p in permitted_paths}
        self.docs = {}
        self.indexes = {}
        self.atlases = {}
        self.max_model_calls = max_model_calls
        self.max_tokens = max_tokens
        self.max_output_tokens = max_output_tokens
        self.cache_dir = Path(cache_dir) if cache_dir else None

    def set_cache_dir(self, cache_dir):
        self.cache_dir = Path(cache_dir)

    def list_sources(self):
        out = []
        for path in sorted(self.permitted):
            # Local paths are harness configuration, not model-facing source
            # identifiers. Keep the catalog useful without exposing them.
            if not Path(path).is_file():
                out.append({"filename": Path(path).name, "available": False})
                continue
            doc = self._load(path)
            out.append(
                {
                    "document_id": doc.metadata.document_id,
                    "filename": doc.metadata.filename,
                    "pages": doc.metadata.page_count,
                    "hash": doc.metadata.file_hash_sha256,
                    "available": True,
                }
            )
        return out

    def inspect(self, document_id, section_id=None):
        doc, idx = self._by_id(document_id)
        atlas = self._atlas(document_id)
        # Keep Atlas observations compact. Ranked page details are available
        # through search_source; returning every page here would dominate the
        # next Muse prompt and encourage repeated reconnaissance.
        if section_id:
            section = atlas.get_section(str(section_id))
            if not section:
                raise ValueError(f"unknown Atlas section {section_id!r}")
            sections = [section.model_dump()]
        else:
            sections = [
                {
                    "section_id": s.section_id,
                    "title": s.title,
                    "level": s.level,
                    "start_page": s.start_page,
                    "end_page": s.end_page,
                    "subsections": [
                        {
                            "section_id": c.section_id,
                            "title": c.title,
                            "level": c.level,
                            "start_page": c.start_page,
                            "end_page": c.end_page,
                        }
                        for c in s.subsections
                    ],
                }
                for s in atlas.sections
            ]
        return {
            "document_id": document_id,
            "filename": doc.metadata.filename,
            "hash": doc.metadata.file_hash_sha256,
            "pages": idx.total_pages,
            "atlas": {
                "toc_source": atlas.toc_source,
                "toc_pages": atlas.toc_pages,
                "section_count": len(atlas.sections),
                "sections": sections,
                "section_detail_requested": bool(section_id),
                "page_count": len(atlas.pages),
            },
            "table_count": len(idx.tables),
            "coverage": {"pages": idx.total_pages},
        }

    def search(self, document_id, query, result_limit=8):
        doc, _ = self._by_id(document_id)
        results = self._atlas(document_id).search(query, top_k=result_limit)
        return [
            {
                "document_id": document_id,
                "page": r.page_number,
                "printed_page": r.printed_page_number,
                "score": r.score,
                "matched_sections": r.matched_sections,
                "matched_keyphrases": r.matched_keyphrases,
                "matched_tables": r.matched_tables,
                "section_range": r.section_range,
                "snippet": (
                    doc.get_page(r.page_number).text[:1200]
                    if doc.get_page(r.page_number)
                    else r.preview_snippet
                ),
            }
            for r in results
        ]

    def read(self, document_id, page):
        doc, _ = self._by_id(document_id)
        p = doc.get_page(page)
        if not p:
            raise ValueError("page is outside the document")
        return {
            "document_id": document_id,
            "page": page,
            "text": p.text,
            "tables": [t.model_dump() for t in p.tables],
        }

    def extract(
        self, document_id, task_data, remaining_calls, remaining_tokens, selectors=None
    ):
        doc, idx = self._by_id(document_id)
        if (
            remaining_calls is not None
            and remaining_calls <= 0
            or remaining_tokens is not None
            and remaining_tokens <= 0
        ):
            self.logger.warning(
                "di_extraction_skipped task_id=%s document_id=%s reason=budget_exhausted remaining_calls=%s remaining_tokens=%s",
                task_data.get("task_id", "unknown"),
                document_id,
                remaining_calls,
                remaining_tokens,
            )
            return {
                "document_id": document_id,
                "findings": [],
                "coverage": {
                    "status": "skipped",
                    "reason": "budget_exhausted",
                    "total_pages": idx.total_pages,
                    "processed_pages": [],
                    "skipped_pages": {},
                },
                "review_queue": [],
                "model_calls": 0,
                "tokens": 0,
                "status": "skipped",
                "trace": [],
            }
        raw_instructions = task_data.get("instructions", "")
        instructions = (
            "; ".join(str(x) for x in raw_instructions)
            if isinstance(raw_instructions, list)
            else str(raw_instructions)
        )
        raw_scope = str(task_data.get("coverage_scope", "sample")).lower()
        scope = (
            CoverageScope.ALL
            if raw_scope == "all"
            or any(x in raw_scope for x in ("full", "entire", "complete"))
            else CoverageScope.SAMPLE
        )
        raw_fields = task_data.get("fields", [])
        fields = [
            (f.get("field_id") or f.get("name") or str(f))
            if isinstance(f, dict)
            else str(f)
            for f in raw_fields
        ]
        requested_pages = int(task_data.get("max_relevant_pages") or idx.total_pages)
        # For full coverage, the document itself—not the model's default page
        # limit—defines the retrieval ceiling. The outer research budget still
        # bounds how many chunks can be sent to Muse.
        max_pages = idx.total_pages if scope == CoverageScope.ALL else requested_pages
        task = TaskSpecification(
            task_id=task_data["task_id"],
            objective=task_data["objective"],
            instructions=instructions,
            fields=fields,
            coverage_scope=scope,
            max_relevant_pages=max_pages,
            expand_annexures=bool(task_data.get("expand_annexures", True)),
        )
        scope_doc, scope_idx = self._select_extraction_scope(
            doc, idx, selectors or {}, task
        )
        # Let the shared outer budget control the task. DI batches pages into
        # bounded chunks and will process as many independent chunks as this
        # call budget permits; no hidden per-task ceiling truncates coverage.
        # With no caller budget, the only bound is the finite selected document
        # itself (plus one repair opportunity per page). This is not a research
        # depth/token quota; it prevents an accidental unbounded DI dispatch.
        task_call_cap = (
            max(1, len(scope_doc.pages) + 1)
            if remaining_calls is None
            else max(0, remaining_calls)
        )
        # A selector-resolved subset is an explicit scope chosen by Muse. DI's
        # SAMPLE mode may otherwise re-rank and truncate it using its ordinary
        # max_relevant_pages default. Promote only this already-bounded subset
        # to ALL so every selected page reaches DI's existing extractor.
        if selectors and any(
            selectors.get(key) for key in ("pages", "sections", "query")
        ):
            task.coverage_scope = CoverageScope.ALL
            task.max_relevant_pages = len(scope_doc.pages)
            task.expand_annexures = False
        # With a token ceiling, issue nested calls one at a time so each
        # response's actual usage can govern whether another page call starts.
        if remaining_tokens is not None:
            task_call_cap = min(task_call_cap, 1)
        task_token_cap = 0 if remaining_tokens is None else max(0, remaining_tokens)
        self.logger.info(
            "di_extraction_start task_id=%s document_id=%s call_cap=%d token_cap=%s scope=%s fields=%d",
            task.task_id,
            document_id,
            task_call_cap,
            remaining_tokens,
            task.coverage_scope.value,
            len(task.fields),
        )
        result = IntelligencePipeline(
            _LoggedNestedProvider(
                self.provider, self.logger, remaining_tokens, self.max_output_tokens
            ),
            max_model_calls=task_call_cap,
            max_tokens_budget=task_token_cap,
        ).run(scope_doc, task, scope_idx)
        failed_steps = [step for step in result.execution_trace if not step.success]
        for step in failed_steps:
            self.logger.error(
                "di_nested_call_error task_id=%s stage=%s action=%s error=%s",
                task.task_id,
                step.stage,
                step.action,
                step.error_message or "unknown",
            )
        effective_status = (
            "partial"
            if failed_steps and result.findings
            else ("failed" if failed_steps and not result.findings else result.status)
        )
        self.logger.info(
            "di_extraction_complete task_id=%s status=%s findings=%d calls=%d tokens=%d coverage=%s failed_steps=%d",
            task.task_id,
            effective_status,
            len(result.findings),
            result.total_model_calls,
            result.total_tokens_used,
            result.coverage_manifest.status if result.coverage_manifest else "none",
            len(failed_steps),
        )
        coverage = (
            result.coverage_manifest.model_dump() if result.coverage_manifest else {}
        )
        coverage["total_pages"] = idx.total_pages
        if selectors:
            coverage["requested_scope"] = {
                "pages": selectors.get("pages", []),
                "sections": selectors.get("sections", []),
                "query": selectors.get("query"),
            }
        return {
            "document_id": document_id,
            "findings": [f.model_dump() for f in result.findings],
            "coverage": coverage,
            "review_queue": result.review_queue,
            "model_calls": result.total_model_calls,
            "tokens": result.total_tokens_used,
            "status": effective_status,
            "trace": [t.model_dump() for t in result.execution_trace],
        }

    def _select_extraction_scope(self, doc, index, selectors, task):
        """Pass an Atlas-resolved subset to DI while retaining original page IDs."""
        pages = selectors.get("pages") or []
        sections = selectors.get("sections") or []
        query = selectors.get("query")
        if not pages and not sections and not query:
            if task.coverage_scope == CoverageScope.ALL:
                pages = list(range(1, doc.metadata.page_count + 1))
            else:
                return doc, index
        atlas = self._atlas(doc.metadata.document_id)
        selected = {int(p) for p in pages}
        for section_name in sections:
            section = atlas.get_section(str(section_name))
            if not section:
                raise ValueError(f"unknown Atlas section {section_name!r}")
            selected.update(range(section.start_page, section.end_page + 1))
        if query:
            ranked = atlas.search(str(query), top_k=len(atlas.pages))
            matches = {item.page_number for item in ranked if item.score > 0}
            if not matches:
                raise ValueError(
                    f"Atlas query scope did not match document pages: {query}"
                )
            # Explicit page/section selectors are hard scope boundaries. A
            # broad query may narrow those boundaries, but must never expand
            # them back to pages Muse did not request.
            selected = selected.intersection(matches) if selected else matches
            if not selected:
                raise ValueError(
                    "Atlas query did not match within the explicitly selected pages or sections"
                )
        known = {p.page_number for p in doc.pages}
        invalid = sorted(selected - known)
        if invalid:
            raise ValueError(
                f"selected physical pages are outside this document: {invalid}"
            )
        selected_pages = sorted(selected)
        if not selected_pages:
            raise ValueError("the requested Atlas scope did not resolve to any pages")
        scoped_doc = doc.model_copy(
            update={"pages": [p for p in doc.pages if p.page_number in selected]}
        )
        coverage_terms = set(tokenize(task.objective + " " + " ".join(task.fields)))
        if not coverage_terms:
            coverage_terms = {"selected", "scope"}
            task.fields = list(task.fields) + ["selected_scope"]
        scoped_idx = index.model_copy(
            update={
                "sections": [s for s in index.sections if s.page_number in selected],
                "tables": [t for t in index.tables if t.page_number in selected],
                "figures": [f for f in index.figures if f.page_number in selected],
                "page_summaries": [
                    p for p in index.page_summaries if p.page_number in selected
                ],
                "quality_indicators": [
                    p for p in index.quality_indicators if p.page_number in selected
                ],
                # Make every explicitly selected page a candidate in DI's existing
                # coverage planner. The physical page numbers remain unchanged.
                "vocabulary": {term: selected_pages for term in coverage_terms},
            }
        )
        task.coverage_scope = CoverageScope.ALL
        task.max_relevant_pages = len(selected_pages)
        task.expand_annexures = False
        return scoped_doc, scoped_idx

    def _load(self, path):
        resolved = str(Path(path).resolve())
        if resolved not in self.permitted:
            raise PermissionError("source path is not explicitly permitted")
        for doc in self.docs.values():
            if str(Path(doc.metadata.file_path).resolve()) == resolved:
                return doc
        digest = hashlib.sha256(Path(resolved).read_bytes()).hexdigest()
        cached_doc = (
            self.cache_dir / f"{digest}.document.json" if self.cache_dir else None
        )
        cached_index = (
            self.cache_dir / f"{digest}.index.json" if self.cache_dir else None
        )
        if (
            cached_doc
            and cached_doc.is_file()
            and cached_index
            and cached_index.is_file()
        ):
            from doc_intelligence.models.document import ParsedDocument
            from doc_intelligence.models.index import DocumentIndex

            doc = ParsedDocument.model_validate_json(
                cached_doc.read_text(encoding="utf-8")
            )
            idx = DocumentIndex.model_validate_json(
                cached_index.read_text(encoding="utf-8")
            )
            self.logger.info(
                "document_cache_hit path=%s hash=%s", Path(resolved).name, digest[:12]
            )
        else:
            self.logger.info(
                "document_parse_start path=%s hash=%s", Path(resolved).name, digest[:12]
            )
            doc = ParserRegistry.get("pymupdf").parse(Path(resolved))
            idx = DocumentIndexer.build_index(doc)
            if self.cache_dir:
                self.cache_dir.mkdir(parents=True, exist_ok=True)
                cached_doc.write_text(doc.model_dump_json(), encoding="utf-8")
                cached_index.write_text(idx.model_dump_json(), encoding="utf-8")
            self.logger.info(
                "document_parse_complete document_id=%s pages=%d",
                doc.metadata.document_id,
                doc.metadata.page_count,
            )
        self.docs[doc.metadata.document_id] = doc
        self.indexes[doc.metadata.document_id] = idx
        atlas_path = self.cache_dir / f"{digest}.atlas.json" if self.cache_dir else None
        if atlas_path and atlas_path.is_file():
            atlas = DocumentAtlasBuilder.load_from_json(atlas_path)
        else:
            atlas = DocumentAtlasBuilder.build(doc, provider=None)
            if atlas_path:
                DocumentAtlasBuilder.save_to_json(atlas, atlas_path)
        self.atlases[doc.metadata.document_id] = atlas
        return doc

    def _atlas(self, document_id):
        if document_id not in self.atlases:
            self._by_id(document_id)
        return self.atlases[document_id]

    def _by_id(self, document_id):
        if document_id not in self.docs:
            raise ValueError(f"unknown document_id: {document_id}")
        return self.docs[document_id], self.indexes[document_id]


class ResearchTools:
    """Compatibility facade; document operations delegate to Document Intelligence."""

    def __init__(
        self,
        provider,
        permitted_paths,
        pipeline_factory=None,
        max_model_calls=10,
        max_tokens=50000,
        max_output_tokens=None,
    ):
        self.adapter = DocumentIntelligenceAdapter(
            provider,
            permitted_paths,
            max_model_calls,
            max_tokens,
            max_output_tokens=max_output_tokens,
        )
        self.provider = provider
        self.permitted = self.adapter.permitted
        self.docs = self.adapter.docs
        self.indexes = self.adapter.indexes

    def list_sources(self):
        return self.adapter.list_sources()

    def inspect_source(self, document_id, section_id=None):
        return self.adapter.inspect(document_id, section_id)

    def search_source(self, document_id, query, result_limit=8):
        return self.adapter.search(document_id, query, result_limit)

    def read_evidence(self, document_id, page):
        return self.adapter.read(document_id, page)

    def extract_information(
        self,
        document_id,
        task,
        remaining_calls=10,
        remaining_tokens=50000,
        selectors=None,
    ):
        return self.adapter.extract(
            document_id, task, remaining_calls, remaining_tokens, selectors
        )

    def compare_evidence(self, finding_ids, findings, dimensions=None):
        selected = [
            f
            for f in findings
            if not finding_ids
            or f.get("claim_id", f.get("finding_id")) in set(finding_ids)
        ]
        values = {}
        for finding in selected:
            fields = finding.get("fields", {}) or finding.get("value", {})
            for name, field in fields.items():
                value = field.get("value") if isinstance(field, dict) else field
                values.setdefault(name, {}).setdefault(str(value), []).append(
                    finding.get("claim_id", finding.get("finding_id", ""))
                )
        comparisons = [
            {
                "field": k,
                "values": v,
                "differs": len([x for x in v if x not in {"None", "null", ""}]) > 1,
            }
            for k, v in values.items()
        ]
        return {
            "finding_ids": finding_ids,
            "dimensions": dimensions or [],
            "comparisons": comparisons,
            "interpretation": "Differences are reported for research interpretation; they are not automatically classified as contradictions.",
            "conflicts": [],
        }

    def deterministic_analysis(self, values, operation):
        if operation == "count":
            return {"operation": operation, "inputs": values, "result": len(values)}
        if not values or any(not math.isfinite(v) for v in values):
            raise ValueError("values must be finite numbers")
        if operation == "mean":
            result = sum(values) / len(values)
        elif operation == "sum":
            result = sum(values)
        elif operation == "min":
            result = min(values)
        elif operation == "max":
            result = max(values)
        elif operation == "range":
            result = max(values) - min(values)
        elif operation == "difference":
            result = values[-1] - values[0]
        elif operation == "percent_change":
            if len(values) < 2 or values[0] == 0:
                raise ValueError(
                    "percent_change requires at least two values and a nonzero first value"
                )
            result = (values[-1] - values[0]) / abs(values[0]) * 100
        elif operation == "linear_trend":
            if len(values) < 2:
                raise ValueError("linear_trend requires at least two values")
            xs = list(range(len(values)))
            xmean = sum(xs) / len(xs)
            ymean = sum(values) / len(values)
            denom = sum((x - xmean) ** 2 for x in xs)
            slope = sum((x - xmean) * (y - ymean) for x, y in zip(xs, values)) / denom
            result = {
                "slope_per_observation": slope,
                "intercept": ymean - slope * xmean,
                "observations": len(values),
            }
        else:
            raise ValueError("unsupported deterministic operation")
        return {"operation": operation, "inputs": values, "result": result}

    @staticmethod
    def task_key(path, objective, questions):
        return hashlib.sha256(
            json.dumps(
                [str(Path(path).resolve()), objective, questions], sort_keys=True
            ).encode()
        ).hexdigest()[:16]
