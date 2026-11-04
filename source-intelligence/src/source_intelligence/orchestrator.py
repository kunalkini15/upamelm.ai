from __future__ import annotations

import logging
import json
import ssl
from time import perf_counter
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import httpx
import truststore

from .acquisition import AcquisitionManager
from .config import Settings
from .coverage import CoveragePlanner
from .inspection import CandidateInspector
from .models import BudgetUsage, Candidate, CanonicalCapability, Category, CategoryOutcome, CityRequest, CoveragePlan, DateEvidence, EvidenceContribution, InspectionSummary, SearchQuery, SearchResult, SourceManifest
from .providers import ModelAssistant, create_model_assistant
from .ranking import CandidateRanker
from .search import SearchProvider, create_search_provider
from .util import canonical_capabilities, canonical_url, normalize_grounding_text, read_json, stable_id, write_json

LOGGER = logging.getLogger(__name__)


def _parse_date(value: Any) -> date | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


class SourceIntelligence:
    """Auditable sourcing pipeline with no dependency on downstream project modules."""

    def __init__(
        self,
        settings: Settings | None = None,
        *,
        search_provider: SearchProvider | None = None,
        model_assistant: ModelAssistant | None = None,
        client: httpx.Client | None = None,
    ):
        self.settings = settings or Settings.from_env()
        self._owns_client = client is None
        tls_context = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        self.client = client or httpx.Client(
            timeout=self.settings.timeout_seconds,
            follow_redirects=False,
            headers={"User-Agent": self.settings.user_agent, "Accept": "*/*"},
            verify=tls_context,
        )
        self.search_provider = search_provider or create_search_provider(self.settings, self.client)
        self.model_assistant = model_assistant or create_model_assistant(self.settings, self.client)
        self.planner = CoveragePlanner()
        self.inspector = CandidateInspector(self.client)
        self.ranker = CandidateRanker()
        self.acquirer = AcquisitionManager(self.client, self.settings.max_download_bytes)

    def close(self) -> None:
        if self._owns_client:
            self.client.close()

    def __enter__(self) -> "SourceIntelligence":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    @staticmethod
    def _inspection_cost(candidate: Candidate) -> int:
        """Return pages actually probed, including a bounded estimate for older run artifacts."""
        recorded = candidate.validation_results.get("inspected_page_count")
        if isinstance(recorded, int) and recorded > 0:
            return recorded
        if candidate.media_type == "application/pdf" or str(candidate.download_url or "").lower().endswith(".pdf"):
            return min(candidate.page_count or 1, 9)
        return 1

    def run(self, request: CityRequest, output: Path, *, resume: bool = False, acquire: bool = True) -> SourceManifest | InspectionSummary:
        started = perf_counter()
        output = output.resolve()
        output.mkdir(parents=True, exist_ok=True)
        mode = "full" if acquire else "inspect"
        self._progress(output, "run_started", "Starting %s run for %s, %s (resume=%s)", mode, request.city, request.state, resume,
                       mode=mode, city=request.city, state=request.state, resume=resume,
                       budgets=request.budgets.model_dump(mode="json"))
        usage_path = output / "budget_usage.json"
        usage = BudgetUsage.model_validate(read_json(usage_path)) if resume and usage_path.exists() else BudgetUsage()
        plan_path = output / "coverage_plan.json"
        if resume and plan_path.exists():
            plan = CoveragePlan.model_validate(read_json(plan_path))
            self._progress(output, "query_plan_resumed", "Reusing %d saved search queries", len(plan.queries), query_count=len(plan.queries))
        else:
            plan = self.plan_queries(request, output)
            usage.model_calls += 1
        if not resume:
            usage.search_rounds = 1

        results_path = output / "search_results.json"
        if resume and results_path.exists():
            results = [SearchResult.model_validate(item) for item in read_json(results_path)]
            self._progress(output, "search_resumed", "Reusing %d saved search results", len(results), result_count=len(results))
        else:
            results = []
            self._progress(output, "search_round_started", "Search round 1: %d queries planned; call budget %d", len(plan.queries), request.budgets.max_search_calls,
                           round=1, query_count=len(plan.queries))
            for query_index, query in enumerate(plan.queries, 1):
                if usage.search_calls >= request.budgets.max_search_calls:
                    usage.stopping_reasons.append("search_call_budget_exhausted")
                    break
                LOGGER.info("[search %d/%d] [%s] %s: %s", query_index, len(plan.queries), query.query_id, query.category.value, query.text)
                self._record_event(output, "search_started", query=query.model_dump(mode="json"))
                try:
                    query_results = self.search_provider.search(query, self.settings.max_search_results)
                    usage.search_calls += int(getattr(self.search_provider, "last_attempt_count", 1))
                    results.extend(query_results)
                    LOGGER.info("search query [%s] returned %d results", query.query_id, len(query_results))
                    self._record_event(output, "search_completed", query_id=query.query_id, result_count=len(query_results), result_urls=[str(item.url) for item in query_results])
                except Exception as exc:
                    usage.search_calls += int(getattr(self.search_provider, "last_attempt_count", 1))
                    LOGGER.warning("search failed for %s: %s", query.query_id, exc)
                    write_json(output / "errors" / f"search-{query.query_id}.json", {"error": str(exc), "query": query.model_dump(mode="json")})
            write_json(results_path, [result.model_dump(mode="json") for result in results])
            write_json(usage_path, usage)
            self._progress(output, "search_round_completed", "Search round 1 complete: %d results from %d attempts", len(results), usage.search_calls,
                           round=1, result_count=len(results), search_attempts=usage.search_calls)

        candidates = self._deduplicate(results)
        self._progress(output, "deduplication_completed", "Deduplicated %d results into %d candidates", len(results), len(candidates),
                       result_count=len(results), candidate_count=len(candidates))
        inspected_path = output / "candidates.json"
        inspection_done = output / "inspection_complete.json"
        inspection_state = read_json(inspection_done) if resume and inspection_done.exists() else {}
        prior_budget_stop = "inspection_budget_exhausted" in usage.stopping_reasons
        reopen_budget_stopped_run = prior_budget_stop
        if resume and inspected_path.exists():
            prior_candidates = [Candidate.model_validate(item) for item in read_json(inspected_path)]
            usage.inspected_pages = sum(self._inspection_cost(item) for item in prior_candidates if item.inspected)
            if usage.inspected_pages < request.budgets.max_inspected_pages:
                usage.stopping_reasons = [reason for reason in usage.stopping_reasons if reason != "inspection_budget_exhausted"]
                prior_budget_stop = False
        if (resume and inspected_path.exists() and inspection_done.exists()
                and inspection_state.get("complete") and not reopen_budget_stopped_run):
            candidates = [Candidate.model_validate(item) for item in read_json(inspected_path)]
            self._progress(output, "inspection_resumed", "Reusing %d previously inspected candidates", len(candidates), candidate_count=len(candidates))
        else:
            per_category: dict[str, int] = {}
            inspected: list[Candidate] = []
            if resume and inspected_path.exists():
                inspected = [Candidate.model_validate(item) for item in read_json(inspected_path)]
                inspected = [item for item in inspected if not item.metadata.get("model_error")]
            completed_ids = {item.candidate_id for item in inspected}
            for item in inspected:
                per_category[item.category.value] = per_category.get(item.category.value, 0) + 1
            inspection_total = min(len(candidates), self.settings.max_candidates_per_category * len(request.categories))
            self._progress(output, "inspection_started", "Inspecting up to %d candidates; page budget %d, model-call budget %d", inspection_total,
                           request.budgets.max_inspected_pages, request.budgets.max_model_calls, candidate_limit=inspection_total)
            processed_count = len(inspected)
            budget_exhausted = False
            for candidate_index, candidate in enumerate(candidates, 1):
                if candidate.candidate_id in completed_ids:
                    continue
                count = per_category.get(candidate.category.value, 0)
                if count >= self.settings.max_candidates_per_category:
                    continue
                if usage.inspected_pages >= request.budgets.max_inspected_pages:
                    if "inspection_budget_exhausted" not in usage.stopping_reasons:
                        usage.stopping_reasons.append("inspection_budget_exhausted")
                    budget_exhausted = True
                    break
                per_category[candidate.category.value] = count + 1
                processed_count += 1
                LOGGER.info("[inspect %d/%d] %s — %s", min(processed_count, inspection_total), inspection_total, candidate.category.value, candidate.title[:120])
                try:
                    candidate, sample = self.inspector.inspect(candidate, request)
                    usage.inspected_pages += self._inspection_cost(candidate)
                    prefilter = self._prefilter_rejections(candidate)
                    if prefilter:
                        candidate.rejection_reasons = prefilter
                        self._record_event(output, "candidate_prefilter_rejected", candidate_id=candidate.candidate_id, title=candidate.title, reasons=prefilter)
                        inspected.append(candidate)
                        write_json(inspected_path, [item.model_dump(mode="json") for item in inspected])
                        continue
                    if usage.model_calls < request.budgets.max_model_calls:
                        self._apply_model(candidate, request, sample)
                        usage.model_calls += 1
                    else:
                        candidate.limitations.append("model_call_budget_exhausted")
                    evaluated = self.ranker.evaluate(candidate, request)
                    inspected.append(evaluated)
                    LOGGER.info("[inspect result] %s eligible=%s score=%.3f scope=%s capabilities=%s limitations=%d rejections=%d",
                                evaluated.candidate_id, evaluated.eligible, evaluated.score, evaluated.study_scope,
                                ",".join(item.capability.value for item in evaluated.evidence_contributions) or "none",
                                len(evaluated.limitations), len(evaluated.rejection_reasons))
                    self._record_event(output, "candidate_evaluated", candidate_id=evaluated.candidate_id, title=evaluated.title, eligible=evaluated.eligible, score=evaluated.score, reasons=evaluated.rejection_reasons, model_assessment=evaluated.metadata.get("model_assessment"))
                except Exception as exc:
                    candidate.rejection_reasons = [f"inspection_failed: {exc}"]
                    inspected.append(candidate)
                    self._record_event(output, "candidate_inspection_failed", candidate_id=candidate.candidate_id, title=candidate.title, error=str(exc))
                write_json(inspected_path, [item.model_dump(mode="json") for item in inspected])
            candidates = inspected
            write_json(inspection_done, {"complete": not budget_exhausted, "candidate_count": len(candidates), "stopping_reason": "inspection_budget_exhausted" if budget_exhausted else None})
            self._progress(output, "inspection_completed", "Inspection complete: %d candidates, %d shortlisted, %d model calls used",
                           len(candidates), sum(item.eligible for item in candidates), usage.model_calls,
                           candidate_count=len(candidates), shortlisted_count=sum(item.eligible for item in candidates))

        # One bounded, targeted follow-up round for categories still lacking eligible evidence.
        unresolved = [category for category in request.categories if not any(c.category == category and c.eligible for c in candidates)]
        if (unresolved and usage.inspected_pages < request.budgets.max_inspected_pages
                and request.budgets.max_search_rounds > usage.search_rounds
                and usage.search_calls < request.budgets.max_search_calls):
            usage.search_rounds += 1
            seen_text = {q.text.casefold() for q in plan.queries}
            followups: list[SearchQuery] = []
            for category in unresolved:
                reasons = [reason for c in candidates if c.category == category for reason in c.rejection_reasons]
                gap = "complete report annexure dataset coordinates maps"
                if any("geograph" in reason for reason in reasons): gap = f'"{request.city}" city limits {gap}'
                if category.value in {"geology_lithology", "soil_land"}: gap += " borehole logs depth investigation volume"
                text = f'"{request.city}" {category.value.replace("_", " ")} {gap}'
                if text.casefold() not in seen_text:
                    followups.append(SearchQuery(query_id=stable_id("qry", category.value, text), category=category, text=text, rationale="targeted follow-up for unresolved evidence gap"))
            write_json(output / "follow_up_plan.json", {"queries": [q.model_dump(mode="json") for q in followups], "unresolved_categories": [c.value for c in unresolved]})
            self._progress(output, "follow_up_started", "Search round 2: %d targeted queries for unresolved categories: %s", len(followups),
                           ", ".join(item.value for item in unresolved), round=2, query_count=len(followups), unresolved=[item.value for item in unresolved])
            new_results: list[SearchResult] = []
            for query in followups:
                if usage.search_calls >= request.budgets.max_search_calls: break
                try:
                    values = self.search_provider.search(query, self.settings.max_search_results)
                    usage.search_calls += int(getattr(self.search_provider, "last_attempt_count", 1))
                    new_results.extend(values)
                except Exception as exc:
                    usage.search_calls += int(getattr(self.search_provider, "last_attempt_count", 1))
                    self._record_event(output, "follow_up_search_failed", query_id=query.query_id, error=str(exc))
            if new_results:
                results.extend(new_results)
                write_json(results_path, [result.model_dump(mode="json") for result in results])
                existing_ids = {c.candidate_id for c in candidates}
                for candidate in self._deduplicate(new_results):
                    if candidate.candidate_id in existing_ids or usage.inspected_pages >= request.budgets.max_inspected_pages: continue
                    try:
                        candidate, sample = self.inspector.inspect(candidate, request)
                        usage.inspected_pages += self._inspection_cost(candidate)
                        if usage.model_calls < request.budgets.max_model_calls:
                            self._apply_model(candidate, request, sample)
                            usage.model_calls += 1
                        else:
                            candidate.limitations.append("model_call_budget_exhausted")
                        candidates.append(self.ranker.evaluate(candidate, request))
                    except Exception as exc:
                        candidate.rejection_reasons = [f"inspection_failed: {exc}"]
                        candidates.append(candidate)
            write_json(usage_path, usage)
            self._progress(output, "follow_up_completed", "Search round 2 complete: %d new results; total search attempts %d", len(new_results), usage.search_calls,
                           round=2, new_result_count=len(new_results), search_attempts=usage.search_calls)

        candidates.sort(key=lambda item: (item.category.value, -item.score))
        write_json(inspected_path, [item.model_dump(mode="json") for item in candidates])
        if not acquire:
            projected, unresolved = self._project_selection(request, candidates)
            summary = InspectionSummary(
                city=request.city, state=request.state,
                shortlisted_candidate_ids=[item.candidate_id for item in candidates if item.eligible],
                unresolved_capabilities=sorted(unresolved, key=lambda item: item.value),
                projected_selection_order=[item.candidate_id for item in projected],
                budget_usage=usage, stopping_reasons=list(dict.fromkeys(usage.stopping_reasons)),
            )
            write_json(output / "inspection_summary.json", summary)
            elapsed = round(perf_counter() - started, 3)
            self._write_run_summary(output, mode, "completed", elapsed, usage,
                                    candidates=len(candidates), shortlisted=len(summary.shortlisted_candidate_ids),
                                    projected=len(summary.projected_selection_order), unresolved=[item.value for item in summary.unresolved_capabilities])
            self._progress(output, "run_completed", "Inspection run completed in %.1fs: %d shortlisted, %d projected selections, %d unresolved capabilities",
                           elapsed, len(summary.shortlisted_candidate_ids), len(summary.projected_selection_order), len(summary.unresolved_capabilities), elapsed_seconds=elapsed)
            return summary
        self._progress(output, "acquisition_started", "Beginning validated acquisition from %d shortlisted candidates; package limit %d, remaining byte budget %d",
                       sum(item.eligible for item in candidates), request.max_selected_source_packages,
                       request.budgets.max_download_bytes - usage.downloaded_bytes)
        manifest = self._acquire_selected(request, candidates, output, resume, usage)
        manifest.budget_usage = usage
        write_json(output / "source_manifest.json", manifest)
        write_json(output / "selected_sources.json", [item.model_dump(mode="json") for item in manifest.sources])
        write_json(output / "rejected_sources.json", [item.model_dump(mode="json") for item in candidates if not item.eligible])
        elapsed = round(perf_counter() - started, 3)
        self._write_run_summary(output, mode, "completed", elapsed, usage, candidates=len(candidates), shortlisted=sum(item.eligible for item in candidates),
                                selected=len(manifest.sources), coverage={item.category.value: item.status for item in manifest.coverage})
        self._progress(output, "run_completed", "Full run completed in %.1fs: %d validated sources selected; coverage %s", elapsed, len(manifest.sources),
                       ", ".join(f"{item.category.value}={item.status}" for item in manifest.coverage), elapsed_seconds=elapsed, selected=len(manifest.sources))
        return manifest

    @staticmethod
    def _candidate_capabilities(candidate: Candidate) -> set[CanonicalCapability]:
        grounded = {item.capability for item in candidate.evidence_contributions
                    if "ungrounded_model_claim" not in item.limitations and item.freshness_status != "stale"}
        if candidate.evidence_contributions:
            return grounded
        return canonical_capabilities(candidate.evidence_types) or {
            {
                Category.AQUIFER_GROUNDWATER: CanonicalCapability.GROUNDWATER_LEVEL,
                Category.GEOLOGY_LITHOLOGY: CanonicalCapability.BOREHOLE_LITHOLOGY,
                Category.SOIL_LAND: CanonicalCapability.SOIL_HORIZON,
                Category.GROUNDWATER_QUALITY: CanonicalCapability.GROUNDWATER_QUALITY,
                Category.GEOHAZARDS_URBAN_SUBSURFACE: CanonicalCapability.SUBSIDENCE_OBSERVATION,
            }[candidate.category]
        }

    def _project_selection(self, request: CityRequest, candidates: list[Candidate]) -> tuple[list[Candidate], set[CanonicalCapability]]:
        desired = canonical_capabilities([*request.evidence_gaps, *request.target_capabilities])
        if not desired:
            desired = {cap for item in candidates for cap in self._candidate_capabilities(item)}
        unmet = set(desired)
        remaining = [item for item in candidates if item.eligible]
        selected: list[Candidate] = []
        while remaining and len(selected) < request.max_selected_source_packages:
            best = max(remaining, key=lambda item: (2.0 * len(self._candidate_capabilities(item) & unmet)) + item.score)
            gain = self._candidate_capabilities(best) & unmet
            if desired and not gain:
                break
            selected.append(best)
            unmet -= self._candidate_capabilities(best)
            remaining.remove(best)
            if not unmet:
                break
        return selected, unmet

    def plan_queries(self, request: CityRequest, output: Path):
        """Run only query planning and persist its complete model audit trail."""
        output = output.resolve()
        output.mkdir(parents=True, exist_ok=True)
        started = perf_counter()
        self._progress(output, "query_planning_started", "Planning source queries for %s across %d categories", request.city, len(request.categories),
                       city=request.city, category_count=len(request.categories))
        if hasattr(self.model_assistant, "set_audit_root"):
            self.model_assistant.set_audit_root(output / "model_io")
        if hasattr(self.search_provider, "set_audit_root"):
            self.search_provider.set_audit_root(output / "search_io")
        write_json(output / "request.json", request)
        baseline = self.planner.plan(request)
        write_json(output / "deterministic_coverage_plan.json", baseline)
        LOGGER.info("Deterministic baseline created with %d queries; requesting Muse refinement", len(baseline.queries))
        try:
            plan = self.model_assistant.plan_queries(request, baseline)
            self._record_event(output, "query_plan_completed", query_count=len(plan.queries), planner=type(self.model_assistant).__name__)
        except Exception as exc:
            LOGGER.warning("Muse query planning failed; using deterministic baseline: %s", exc)
            self._record_event(output, "query_plan_failed", error=str(exc), fallback="deterministic")
            plan = baseline
        write_json(output / "coverage_plan.json", plan)
        elapsed = round(perf_counter() - started, 3)
        self._progress(output, "query_planning_completed", "Query planning completed in %.1fs: %d final queries", elapsed, len(plan.queries),
                       elapsed_seconds=elapsed, query_count=len(plan.queries))
        model_calls = 0 if type(self.model_assistant).__name__ == "NullModelAssistant" else 1
        self._write_run_summary(output, "query-planning", "completed", elapsed, BudgetUsage(model_calls=model_calls), query_count=len(plan.queries))
        return plan

    @staticmethod
    def _record_event(output: Path, event: str, **details: Any) -> None:
        path = output / "logs" / "decision_trace.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        record = {"timestamp": datetime.now(timezone.utc).isoformat(), "event": event, **details}
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=False, default=str) + "\n")

    @classmethod
    def _progress(cls, output: Path, event: str, message: str, *args: Any, **details: Any) -> None:
        LOGGER.info(message, *args)
        cls._record_event(output, event, **details)

    @staticmethod
    def _write_run_summary(output: Path, mode: str, status: str, elapsed: float, usage: BudgetUsage, **details: Any) -> None:
        write_json(output / "run_summary.json", {
            "status": status, "mode": mode, "elapsed_seconds": elapsed,
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "budget_usage": usage.model_dump(mode="json"), **details,
            "important_artifacts": {
                "human_log": "logs/source_intelligence.log",
                "decision_trace": "logs/decision_trace.jsonl",
                "coverage_plan": "coverage_plan.json",
                "candidates": "candidates.json",
                "inspection_summary": "inspection_summary.json" if mode == "inspect" else None,
                "source_manifest": "source_manifest.json" if mode == "full" else None,
            },
        })

    def _deduplicate(self, results: list[SearchResult]) -> list[Candidate]:
        candidates: dict[tuple[str, str], Candidate] = {}
        for result in results:
            key = (result.category.value, canonical_url(str(result.url)))
            if key not in candidates:
                candidates[key] = self.inspector.from_result(result)
            else:
                candidates[key].search_queries.append(result.query_id)
        return list(candidates.values())

    @staticmethod
    def _prefilter_rejections(candidate: Candidate) -> list[str]:
        reasons: list[str] = []
        # Cheap scores are ranking hints. Reject only definite failures here.
        if candidate.validation_results.get("explicit_wrong_geography"):
            reasons.append("explicitly_wrong_geography")
        if candidate.validation_results.get("invalid_file"):
            reasons.append("invalid_file")
        return reasons

    def _apply_model(self, candidate: Candidate, request: CityRequest, sample: str) -> None:
        try:
            value = self.model_assistant.enrich_candidate(request, candidate, sample)
        except Exception as exc:
            candidate.metadata["model_error"] = str(exc)
            return
        candidate.metadata["model_assessment"] = value
        if isinstance(value.get("document_type"), str):
            candidate.document_type = value["document_type"][:80]
        if isinstance(value.get("document_suitability"), bool):
            candidate.document_suitability = value["document_suitability"]
        candidate.study_scope = str(value.get("study_scope") or "unknown")
        candidate.geographic_evidence = value.get("geographic_evidence") or []
        candidate.evidence_types = value.get("available_evidence_types") or []
        candidate.evidence_categories = [category for category in request.categories if category.value in (value.get("supported_categories") or [])] or [candidate.category]
        candidate.coordinates_available = value.get("coordinates_available")
        candidate.geometry_available = value.get("geometry_available")
        candidate.depth_information_available = value.get("depth_information_available")
        candidate.evidence_status = value.get("evidence_status") or []
        candidate.achievable_visual_features = value.get("achievable_visual_features") or []
        candidate.overlap_with_existing_sources = value.get("overlap_with_existing_sources") or []
        candidate.limitations = value.get("limitations") or []
        candidate.unresolved_questions = value.get("unresolved_questions") or []
        candidate.assessment_confidence = float(value.get("confidence") or 0)
        if isinstance(value.get("publisher"), str) and value["publisher"].strip():
            candidate.publisher = value["publisher"].strip()
            if any(name.lower() in candidate.publisher.lower() for name in request.preferred_publishers):
                candidate.authority_score = max(candidate.authority_score, 0.9)
        for field in ("geographic_relevance", "scientific_utility"):
            if isinstance(value.get(field), (int, float)):
                setattr(candidate, field, max(getattr(candidate, field), min(1.0, max(0.0, float(value[field])))))
        publication = _parse_date(value.get("publication_date"))
        data_start = _parse_date(value.get("data_period_start"))
        data_end = _parse_date(value.get("data_period_end"))
        excerpts = [str(x)[:220] for x in value.get("date_excerpts", []) if isinstance(x, str)]
        # Model dates are accepted only when it supplies a matching excerpt from the inspected sample.
        normalized_sample = normalize_grounding_text(sample)
        grounded = bool(excerpts) and all(normalize_grounding_text(excerpt) in normalized_sample for excerpt in excerpts)
        if grounded:
            existing = candidate.date_evidence
            candidate.date_evidence = DateEvidence(
                publication_date=publication or existing.publication_date,
                data_period_start=data_start or existing.data_period_start,
                data_period_end=data_end or existing.data_period_end,
                basis="model_grounded_document_text", confidence=max(existing.confidence, 0.8),
                excerpts=list(dict.fromkeys([*existing.excerpts, *excerpts]))[:10],
            )
        contributions: list[EvidenceContribution] = []
        for raw in value.get("evidence_contributions", []):
            if not isinstance(raw, dict):
                continue
            excerpt = str(raw.get("evidence_excerpt") or "")
            contribution_grounded = bool(excerpt) and normalize_grounding_text(excerpt) in normalized_sample
            try:
                contribution = EvidenceContribution.model_validate(raw)
            except Exception:
                continue
            if not contribution_grounded:
                contribution.limitations.append("ungrounded_model_claim")
                contribution.confidence = min(contribution.confidence, 0.25)
            contributions.append(contribution)
        if contributions:
            candidate.evidence_contributions = contributions

    def _acquire_selected(self, request: CityRequest, candidates: list[Candidate], output: Path, resume: bool, usage: BudgetUsage) -> SourceManifest:
        run_id = stable_id("run", request.city, request.state, str(request.as_of_date))
        existing_path = output / "source_manifest.json"
        existing = SourceManifest.model_validate(read_json(existing_path)) if resume and existing_path.exists() else None
        sources = list(existing.sources) if existing else []
        checksums = {source.sha256 for source in sources}
        desired = canonical_capabilities([*request.evidence_gaps, *request.target_capabilities])
        category_defaults = {
            Category.AQUIFER_GROUNDWATER: CanonicalCapability.GROUNDWATER_LEVEL,
            Category.GEOLOGY_LITHOLOGY: CanonicalCapability.BOREHOLE_LITHOLOGY,
            Category.SOIL_LAND: CanonicalCapability.SOIL_HORIZON,
            Category.GROUNDWATER_QUALITY: CanonicalCapability.GROUNDWATER_QUALITY,
            Category.GEOHAZARDS_URBAN_SUBSURFACE: CanonicalCapability.SUBSIDENCE_OBSERVATION,
        }
        desired = desired or {category_defaults[item] for item in request.categories}
        already_met = {item.capability for source in sources for item in source.evidence_contributions if item.freshness_status != "stale"}
        unmet = desired - already_met
        remaining_candidates = [item for item in candidates if item.eligible]
        errors: list[str] = []
        while remaining_candidates and unmet and len(sources) < request.max_selected_source_packages:
            candidate = max(remaining_candidates, key=lambda item: (2.0 * len(self._candidate_capabilities(item) & unmet)) + item.score)
            remaining_candidates.remove(candidate)
            marginal = self._candidate_capabilities(candidate) & unmet
            if not marginal:
                break
            self._record_event(output, "download_started", candidate_id=candidate.candidate_id, marginal_capabilities=sorted(item.value for item in marginal), url=str(candidate.download_url or candidate.landing_url), score=candidate.score)
            LOGGER.info("[download] %s score=%.3f marginal=%s url=%s", candidate.candidate_id, candidate.score,
                        ",".join(sorted(item.value for item in marginal)), candidate.download_url or candidate.landing_url)
            try:
                remaining_bytes = request.budgets.max_download_bytes - usage.downloaded_bytes
                if remaining_bytes <= 0:
                    usage.stopping_reasons.append("download_byte_budget_exhausted")
                    break
                self.acquirer.max_bytes = min(self.settings.max_download_bytes, remaining_bytes)
                acquired = self.acquirer.acquire(candidate, output)
                usage.downloaded_bytes += acquired.size_bytes
                if acquired.sha256 in checksums:
                    errors.append(f"{candidate.candidate_id}: duplicate downloaded document")
                    self._record_event(output, "download_rejected_duplicate", candidate_id=candidate.candidate_id, sha256=acquired.sha256)
                    continue
                candidate.lifecycle_status = "selected"
                checksums.add(acquired.sha256)
                sources.append(acquired)
                unmet -= self._candidate_capabilities(candidate)
                write_json(output / "source_manifest.partial.json", {"run_id": run_id, "sources": [source.model_dump(mode="json") for source in sources]})
                self._record_event(output, "source_selected", candidate_id=candidate.candidate_id, source_id=acquired.source_id, marginal_capabilities=sorted(item.value for item in marginal), sha256=acquired.sha256, local_path=str(acquired.local_path))
                LOGGER.info("[selected] %s source=%s size=%d sha256=%s path=%s", candidate.candidate_id, acquired.source_id,
                            acquired.size_bytes, acquired.sha256[:12], acquired.local_path)
            except Exception as exc:
                errors.append(f"{candidate.candidate_id}: {exc}")
                self._record_event(output, "download_failed", candidate_id=candidate.candidate_id, error=str(exc))
                LOGGER.warning("[download failed] %s: %s", candidate.candidate_id, exc)
        outcomes: list[CategoryOutcome] = []
        for category in request.categories:
            source = next((item for item in sources if item.category == category or category in item.evidence_categories), None)
            considered = sum(1 for item in candidates if item.category == category and item.eligible)
            if source:
                outcomes.append(CategoryOutcome(category=category, status="selected", selected_source_id=source.source_id, candidates_considered=considered))
            else:
                reason = "; ".join(errors) if errors else "No validated source added marginal evidence for this category"
                outcomes.append(CategoryOutcome(category=category, status="fresh_source_unavailable", reason=reason, candidates_considered=considered))
        return SourceManifest(
            run_id=run_id, city=request.city, state=request.state, country=request.country,
            as_of_date=request.as_of_date, sources=sources, coverage=outcomes,
        )
