from __future__ import annotations

import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, List, Optional

from doc_intelligence.indexing.indexer import DocumentIndexer
from doc_intelligence.models.document import BoundingBox, ContentBlock, Page, ParsedDocument
from doc_intelligence.models.index import DocumentIndex
from doc_intelligence.models.task import (
    CoverageManifest,
    CoverageScope,
    EvidenceReference,
    ExecutionTraceStep,
    ExtractedField,
    ExtractedFinding,
    IntelligenceResult,
    TaskSpecification,
    VerificationStatus,
)
from doc_intelligence.pipeline.coverage import CoveragePlanner
from doc_intelligence.pipeline.grounding import GroundingVerifier
from doc_intelligence.providers.base import BaseModelProvider


class IntelligencePipeline:
    """Orchestrates Stage 3 through Stage 6 with coverage planning, grounding, and Muse Spark."""

    def __init__(
        self,
        model_provider: BaseModelProvider,
        escalation_provider: Optional[BaseModelProvider] = None,
        max_model_calls: int = 15,
        max_tokens_budget: int = 50000,
    ):
        self.model_provider = model_provider
        self.escalation_provider = escalation_provider or model_provider
        self.max_model_calls = max_model_calls
        self.max_tokens_budget = max_tokens_budget

    def run(
        self,
        document: ParsedDocument,
        task: Optional[TaskSpecification] = None,
        index: Optional[DocumentIndex] = None,
    ) -> IntelligenceResult:
        trace: List[ExecutionTraceStep] = []
        calls_count = 0
        tokens_count = 0

        # Stage 3: Indexing
        t_start = time.perf_counter()
        if not index:
            index = DocumentIndexer.build_index(document)
        trace.append(
            ExecutionTraceStep(
                step_id=f"step_{len(trace)+1}",
                stage="Stage 3: Indexing",
                action="Build Document Structural Index",
                details={
                    "total_pages": index.total_pages,
                    "sections_indexed": len(index.sections),
                    "tables_indexed": len(index.tables),
                    "unique_tokens": len(index.vocabulary),
                },
                duration_seconds=round(time.perf_counter() - t_start, 4),
                success=True,
            )
        )

        if not task:
            return IntelligenceResult(
                task_id=None,
                document_metadata=document.metadata,
                document_index=index,
                coverage_manifest=None,
                findings=[],
                execution_trace=trace,
                total_tokens_used=0,
                total_model_calls=0,
                status="completed_index_only",
            )

        # Stage 4: Coverage Planning and Range Expansion
        t_start = time.perf_counter()
        planned_pages, coverage_manifest = CoveragePlanner.plan_coverage(
            document=document,
            index=index,
            task=task,
        )
        trace.append(
            ExecutionTraceStep(
                step_id=f"step_{len(trace)+1}",
                stage="Stage 4: Coverage Planning",
                action="Expand Candidate Pages into Coverage Manifest",
                details={
                    "scope_requested": task.coverage_scope.value,
                    "candidate_pages": coverage_manifest.candidate_pages,
                    "planned_pages": planned_pages,
                    "coverage_status": coverage_manifest.status,
                },
                duration_seconds=round(time.perf_counter() - t_start, 4),
                success=True,
            )
        )

        # Stage 5: Table-Aware Incremental Batching & Muse Spark Extraction
        findings_map: Dict[str, ExtractedFinding] = {}  # entity_id / finding_id -> finding
        review_queue: List[Dict[str, Any]] = []

        # Batch pages in chunks of 2 pages max to preserve table context & tokens
        page_chunks: List[List[int]] = [planned_pages[i : i + 2] for i in range(0, len(planned_pages), 2)]

        # Independent page chunks are safe to process concurrently. Failed
        # attempts are counted before dispatch so timeouts cannot bypass the
        # task call budget.
        available_calls = max(0, self.max_model_calls - calls_count)
        selected_chunks = page_chunks[:available_calls]
        calls_count += len(selected_chunks)
        successfully_processed_pages: set[int] = set()
        failed_or_unprocessed_pages: Dict[int, str] = {}
        for chunk in page_chunks[len(selected_chunks):]:
            for page in chunk:
                failed_or_unprocessed_pages[page] = "Not dispatched because the model-call budget was exhausted"

        def run_chunk(page_subset: List[int]):
            retrieved_contexts: List[Dict[str, Any]] = []
            for p_num in page_subset:
                p_obj = document.get_page(p_num)
                if p_obj:
                    tables_repr = [t.markdown or f"Table {t.table_id} (Headers: {t.headers}, Rows: {t.rows})" for t in p_obj.tables]
                    retrieved_contexts.append({"page_number": p_num, "printed_page_number": p_obj.printed_page_number, "text": p_obj.text, "tables": tables_repr})
            prompt = self._build_extraction_prompt(task, retrieved_contexts)
            system_inst = ("You are an objective document intelligence engine powered by Muse Spark. "
                            "Only extract records explicitly stated in the provided text and tables. "
                            "Do NOT guess, extrapolate or combine unrelated rows. "
                            "For tabular records, retain row association, entity identifiers, and verbatim quotes.")
            started = time.perf_counter()
            try:
                response = self.model_provider.complete(prompt=prompt, system_instruction=system_inst, json_mode=True)
                return page_subset, response, None, time.perf_counter() - started
            except Exception as exc:
                return page_subset, None, exc, time.perf_counter() - started

        worker_count = max(1, min(len(selected_chunks), 3))
        with ThreadPoolExecutor(max_workers=worker_count, thread_name_prefix="di-extract") as executor:
            futures = [executor.submit(run_chunk, pages) for pages in selected_chunks]
            for future in as_completed(futures):
                page_subset, resp, error, duration = future.result()
                if error:
                    for page in page_subset:
                        failed_or_unprocessed_pages[page] = f"Model extraction failed: {error}"
                    trace.append(ExecutionTraceStep(step_id=f"step_{len(trace)+1}", stage="Stage 5: AI Extraction", action=f"Failed model call on pages {page_subset}", details={"error": str(error), "pages": page_subset}, duration_seconds=round(duration, 4), success=False, error_message=str(error)))
                    continue
                successfully_processed_pages.update(page_subset)
                tokens_count += resp.total_tokens
                trace.append(ExecutionTraceStep(step_id=f"step_{len(trace)+1}", stage="Stage 5: AI Extraction", action=f"Extract records from pages {page_subset}", details={"provider": self.model_provider.provider_name, "pages": page_subset, "prompt_tokens": resp.prompt_tokens, "completion_tokens": resp.completion_tokens}, model_name=resp.model_name, prompt_tokens=resp.prompt_tokens, completion_tokens=resp.completion_tokens, duration_seconds=round(duration, 4), success=True))
                self._verify_and_integrate_findings(document=document, task=task, raw_findings=(resp.parsed_json or {}).get("findings", []), model_name=resp.model_name, findings_map=findings_map, review_queue=review_queue)

        if len(page_chunks) > len(selected_chunks):
            trace.append(ExecutionTraceStep(step_id=f"step_{len(trace)+1}", stage="Stage 5: AI Extraction", action="Budget limit reached", details={"attempted_calls": len(selected_chunks), "skipped_chunks": len(page_chunks) - len(selected_chunks), "tokens_count": tokens_count}, success=False, error_message="Configured model call budget reached; remaining chunks were not dispatched."))

        # Coverage must describe pages actually sent successfully to Muse, not
        # merely pages selected by the deterministic coverage planner.
        coverage_manifest.processed_pages = sorted(successfully_processed_pages)
        coverage_manifest.skipped_pages.update(failed_or_unprocessed_pages)
        coverage_manifest.status = "complete" if not coverage_manifest.skipped_pages else "partial"

        # Stage 6B: Selective second-pass repair for flagged ambiguous records
        if review_queue and task.allow_escalation and calls_count < self.max_model_calls:
            t_repair_start = time.perf_counter()
            self._attempt_selective_repair(
                document=document,
                task=task,
                findings_map=findings_map,
                review_queue=review_queue,
                trace=trace,
                calls_counter_ref={"calls": calls_count, "tokens": tokens_count},
            )

        final_findings = list(findings_map.values())

        return IntelligenceResult(
            task_id=task.task_id,
            document_metadata=document.metadata,
            document_index=index,
            coverage_manifest=coverage_manifest,
            findings=final_findings,
            review_queue=review_queue,
            execution_trace=trace,
            total_tokens_used=tokens_count,
            total_model_calls=calls_count,
            status="completed",
        )

    def _build_extraction_prompt(
        self, task: TaskSpecification, retrieved_contexts: List[Dict[str, Any]]
    ) -> str:
        prompt_parts = [
            f"TASK ID: {task.task_id}",
            f"OBJECTIVE: {task.objective}",
        ]
        if task.instructions:
            prompt_parts.append(f"INSTRUCTIONS: {task.instructions}")

        if task.fields:
            prompt_parts.append(f"FIELDS TO EXTRACT: {json.dumps(task.fields)}")

        if task.output_schema:
            prompt_parts.append(f"EXPECTED SCHEMA: {json.dumps(task.output_schema)}")

        prompt_parts.append("\nDOCUMENT SCOPE (Selected pages):")
        for ctx in retrieved_contexts:
            p_no = ctx["page_number"]
            printed_p = f" (Printed Folio: {ctx['printed_page_number']})" if ctx.get("printed_page_number") else ""
            prompt_parts.append(f"\n=== PAGE {p_no}{printed_p} ===")
            prompt_parts.append(ctx["text"])
            if ctx.get("tables"):
                prompt_parts.append("\nTABLES ON THIS PAGE:")
                for t in ctx["tables"]:
                    prompt_parts.append(t)

        prompt_parts.append(
            "\nRESPONSE FORMAT:\n"
            "Return valid JSON matching this exact structure:\n"
            "{\n"
            '  "findings": [\n'
            "    {\n"
            '      "entity_id": "<unique entity identifier e.g. Well ID or name>",\n'
            '      "values": { "<field_name>": "<value or null>" },\n'
            '      "units": { "<field_name>": "<unit if mentioned or null>" },\n'
            '      "nested_records": [ ... ],\n'
            '      "page_number": <1-based integer page where observed>,\n'
            '      "source_text": "<verbatim row or sentence from document>"\n'
            "    }\n"
            "  ]\n"
            "}"
        )
        return "\n".join(prompt_parts)

    def _verify_and_integrate_findings(
        self,
        document: ParsedDocument,
        task: TaskSpecification,
        raw_findings: List[Dict[str, Any]],
        model_name: str,
        findings_map: Dict[str, ExtractedFinding],
        review_queue: List[Dict[str, Any]],
    ) -> None:
        for item in raw_findings:
            raw_entity_id = item.get("entity_id") or item.get("finding_id") or f"rec_{len(findings_map)+1}"
            clean_entity_key = str(raw_entity_id).strip()
            page_num = item.get("page_number", 1)
            source_text = str(item.get("source_text") or "").strip()
            values = item.get("values") or {}
            if not isinstance(values, dict):
                values = {}
            units = item.get("units") or {}
            if not isinstance(units, dict):
                units = {}
            nested_records = item.get("nested_records") or []
            if not isinstance(nested_records, list):
                nested_records = []

            page_obj = document.get_page(page_num)
            has_ambiguity = False
            fields_dict: Dict[str, ExtractedField] = {}

            target_fields = task.fields if task.fields else list(values.keys())

            for field_name in target_fields:
                val = values.get(field_name)
                unit_val = units.get(field_name)

                if page_obj:
                    v_status, evidence, note = GroundingVerifier.verify_field_in_page(
                        page=page_obj,
                        field_name=field_name,
                        value=val,
                        claimed_source_text=source_text,
                    )
                else:
                    v_status = VerificationStatus.NOT_ASSESSED
                    evidence = None
                    note = f"Page {page_num} was not retrieved in searched scope."

                if evidence:
                    evidence.model_name = model_name
                    evidence.document_id = document.metadata.document_id
                    if page_obj:
                        evidence.printed_page_number = page_obj.printed_page_number

                if v_status == VerificationStatus.AMBIGUOUS:
                    has_ambiguity = True

                fields_dict[field_name] = ExtractedField(
                    field_name=field_name,
                    value=val,
                    raw_value=str(val) if val is not None else None,
                    unit=unit_val,
                    status=v_status,
                    evidence=evidence,
                    validation_notes=note,
                )

            # Key by composite key if multiple observations exist for the same entity over time (date/year)
            date_key = str(values.get("date") or values.get("year") or "").strip()
            composite_key = f"{clean_entity_key}_{date_key}" if date_key else clean_entity_key

            # Deduplication & Merge by composite_key
            if composite_key in findings_map:
                existing = findings_map[composite_key]
                # Merge fields and nested observations
                for f_name, f_field in fields_dict.items():
                    if f_name not in existing.fields or existing.fields[f_name].value is None:
                        existing.fields[f_name] = f_field
                    elif f_field.value is not None and existing.fields[f_name].value != f_field.value:
                        # Conflict detected: keep visible
                        existing.is_ambiguous = True
                        existing.review_required = True
                        existing.review_reason = (
                            f"Conflicting value for {f_name}: '{existing.fields[f_name].value}' vs '{f_field.value}'"
                        )
                if nested_records:
                    existing.nested_records.extend(nested_records)
            else:
                finding = ExtractedFinding(
                    finding_id=f"finding_{len(findings_map)+1}",
                    entity_id=clean_entity_key,
                    fields=fields_dict,
                    nested_records=nested_records,
                    raw_response=item,
                    is_ambiguous=has_ambiguity,
                    review_required=has_ambiguity,
                    review_reason="Field grounding mismatch or unverified row" if has_ambiguity else None,
                )
                findings_map[composite_key] = finding
                if has_ambiguity:
                    review_queue.append(
                        {
                            "entity_id": composite_key,
                            "page_number": page_num,
                            "reason": finding.review_reason,
                        }
                    )

    def _attempt_selective_repair(
        self,
        document: ParsedDocument,
        task: TaskSpecification,
        findings_map: Dict[str, ExtractedFinding],
        review_queue: List[Dict[str, Any]],
        trace: List[ExecutionTraceStep],
        calls_counter_ref: Dict[str, int],
    ) -> None:
        """Targeted second pass: asks model to reconsider only the disputed fields with failing check details."""
        disputed_items = review_queue[: task.max_repair_attempts]

        for item in disputed_items:
            if calls_counter_ref["calls"] >= self.max_model_calls:
                break

            eid = item["entity_id"]
            finding = findings_map.get(eid)
            if not finding:
                continue

            page_num = item["page_number"]
            page_obj = document.get_page(page_num)
            if not page_obj:
                continue

            # Identify ambiguous fields
            ambiguous_fields = [fn for fn, f in finding.fields.items() if f.status == VerificationStatus.AMBIGUOUS]
            if not ambiguous_fields:
                continue

            repair_prompt = (
                f"REPAIR REQUEST FOR ENTITY: {eid}\n"
                f"The following fields failed grounding verification on Page {page_num}: {ambiguous_fields}\n"
                f"PAGE CONTEXT:\n{page_obj.text}\n"
                f"Please verify exact verbatim values from the page text or specify null if not present."
            )

            try:
                resp = self.escalation_provider.complete(repair_prompt, json_mode=True)
                calls_counter_ref["calls"] += 1
                calls_counter_ref["tokens"] += resp.total_tokens

                trace.append(
                    ExecutionTraceStep(
                        step_id=f"step_{len(trace)+1}",
                        stage="Stage 6: Targeted Repair",
                        action=f"Selective recheck for {eid}",
                        details={"entity_id": eid, "fields": ambiguous_fields},
                        model_name=resp.model_name,
                        success=True,
                    )
                )

                # Re-verify repaired fields
                repaired_data = resp.parsed_json or {}
                repaired_values = repaired_data.get("values", {})
                for fn in ambiguous_fields:
                    if fn in repaired_values:
                        new_val = repaired_values[fn]
                        v_st, ev, note = GroundingVerifier.verify_field_in_page(
                            page=page_obj, field_name=fn, value=new_val, claimed_source_text=""
                        )
                        finding.fields[fn].value = new_val
                        finding.fields[fn].status = v_st
                        finding.fields[fn].evidence = ev
                        finding.fields[fn].validation_notes = f"Repaired: {note}"

                # Update finding ambiguity flag
                finding.is_ambiguous = any(f.status == VerificationStatus.AMBIGUOUS for f in finding.fields.values())
                finding.review_required = finding.is_ambiguous

            except Exception as err:
                trace.append(
                    ExecutionTraceStep(
                        step_id=f"step_{len(trace)+1}",
                        stage="Stage 6: Targeted Repair",
                        action=f"Repair failed for {eid}",
                        details={"error": str(err)},
                        success=False,
                        error_message=str(err),
                    )
                )
