from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from typing import Any

from .artifacts import ArtifactStore
from .atlas import inspect_atlas, prepare_atlas, search_atlas
from .models import PlanningResult, PlanningState, Request
from .muse import ResponsesTransport, tool_definitions
from .prompts import SYSTEM_INSTRUCTIONS, planning_input
from .tools import bounded_selectors, resolve_pages


class DIProvider:
    """Small adapter for the existing DI pipeline; V2 does not reimplement DI."""
    provider_name = "muse_spark:di_reconnaissance"

    def __init__(self, transport: ResponsesTransport):
        self.transport = transport
        self.parent_call_id: str | None = None

    def complete(self, prompt, system_instruction=None, json_mode=False, temperature=0.0, reasoning_effort=None):
        response = self.transport.call(system_instruction or "Extract only explicitly supported evidence.", prompt, [], parent_call_id=self.parent_call_id, phase="nested_document_intelligence", timeout=float(os.environ.get("DI_RECON_TIMEOUT_SECONDS", "300")), reasoning_effort=getattr(self, "reasoning_effort", None))
        output = ""
        for item in response.raw.get("output", []):
            for part in item.get("content", []) if item.get("type") == "message" else []:
                if part.get("type") == "output_text":
                    output += part.get("text", "")
        parsed = None
        try:
            parsed = json.loads(output)
        except (TypeError, json.JSONDecodeError):
            pass
        return type("ModelResponse", (), {"content": output, "parsed_json": parsed, "prompt_tokens": response.usage.input_tokens, "completion_tokens": response.usage.output_tokens, "total_tokens": response.usage.total_tokens, "model_name": "muse-spark-1.3-contributor", "raw_response": response.raw})()


class Planner:
    def __init__(self, request: Request, run_dir: Path):
        self.request = request
        self.run_dir = run_dir
        self.store = ArtifactStore(run_dir)
        self.state = PlanningState(research_id=request.research_id)
        self.atlases: dict[str, Any] = {}
        self.source_paths: dict[str, str] = {}
        self.overviews: list[dict[str, Any]] = []
        self.transport = ResponsesTransport(run_dir / "model_io")
        self.log = logging.getLogger("research_engine_v2")
        self.usages: list[dict[str, Any]] = []
        self.current_call_id: str | None = None
        self.last_no_progress_signature: str | None = None
        self.repeated_no_progress = 0
        self.no_progress_threshold = 5

    @classmethod
    def resume(cls, request: Request, run_dir: Path) -> "Planner":
        planner = cls(request, run_dir)
        planner.state = PlanningState.model_validate_json((run_dir / "planning_state.json").read_text(encoding="utf-8"))
        planner.replay = json.loads((run_dir / "replay.json").read_text(encoding="utf-8")) if (run_dir / "replay.json").exists() else []
        prior_usage = json.loads((run_dir / "usage.json").read_text(encoding="utf-8")) if (run_dir / "usage.json").exists() else {}
        planner.transport.usage_records = list(prior_usage.get("calls", []))
        planner.preflight()
        planner.state = PlanningState.model_validate_json((run_dir / "planning_state.json").read_text(encoding="utf-8"))
        return planner

    def preflight(self) -> None:
        self.state.phase = "preflight"
        self.log.info("preflight_start research_id=%s sources=%d", self.request.research_id, len(self.request.sources))
        self.store.write_json("request_snapshot.json", self.request.model_dump(mode="json"))
        sources = []
        source_manifest = []
        for source in self.request.sources:
            document_id, overview, atlas = prepare_atlas(source.path, self.run_dir)
            self.atlases[document_id] = atlas
            self.source_paths[document_id] = str(Path(source.path).expanduser().resolve())
            sources.append({"document_id": document_id, "source_type": source.type, "overview": overview})
            source_manifest.append({"document_id": document_id, "type": source.type, "path": str(Path(source.path).expanduser().resolve()), "sha256": overview.get("file_hash_sha256")})
        self.overviews = sources
        self.store.write_json("source_manifest.json", source_manifest)
        self.store.write_json("planning_state.json", self.state.model_dump(mode="json"))
        self.store.flush_manifest()
        self.log.info("preflight_complete atlases=%d", len(self.atlases))

    def run(self) -> PlanningResult:
        last_observation: dict[str, Any] | None = None
        replay: list[dict[str, Any]] = getattr(self, "replay", [])
        try:
            if not self.atlases:
                self.preflight()
            if self.state.phase == "preflight":
                self.state.phase = "atlas_discovery"
            while self.state.phase not in {"plan_ready", "failed", "stalled", "cancelled"}:
                if self._limit_reached():
                    self.state.phase = "stalled"
                    last_observation = {"status": "error", "message": "optional planning ceiling reached"}
                    break
                mission = {
                    "research_id": self.request.research_id,
                    "objective": self.request.objective,
                    "domain_context": self.request.domain_context,
                    "instructions": self.request.instructions,
                    "desired_outcomes": self.request.desired_outcomes,
                    "context": self.request.context,
                    "sources": [{"document_id": item["document_id"], "type": item["source_type"], "overview": item["overview"]} for item in self.overviews],
                }
                # Full model/tool history remains persisted in model_io, tool_io and replay.json
                # for audit and resume. Normal turns receive only a compact working memory;
                # Muse can retrieve omitted details explicitly through planning tools.
                # Give Muse the complete Atlas once. Later turns retain the
                # full Atlas on disk and through Atlas tools, but avoid
                # replaying the prior reasoning/function-call transcript.
                atlas_context = self.overviews if self.state.calls == 0 else self._compact_atlas_overviews()
                replay_for_call = replay if self.state.calls == 0 else None
                input_text = planning_input(mission, atlas_context, self._compact_state(), self._compact_observation(last_observation))
                self.log.info(
                    "planning_context calls=%d chars=%d mission_chars=%d atlas_chars=%d state_chars=%d observation_chars=%d replay_items=%d",
                    self.state.calls,
                    len(input_text),
                    len(json.dumps(mission, ensure_ascii=False, default=str)),
                    len(json.dumps(atlas_context, ensure_ascii=False, default=str)),
                    len(json.dumps(self._compact_state(), ensure_ascii=False, default=str)),
                    len(json.dumps(self._compact_observation(last_observation), ensure_ascii=False, default=str)),
                    len(replay_for_call or []),
                )
                response = self.transport.call(
                    SYSTEM_INSTRUCTIONS,
                    input_text,
                    self._available_tools(),
                    replay_items=replay_for_call,
                    phase="orchestration",
                    reasoning_effort="medium",
                    prompt_cache_key=f"{self.request.research_id}:planning",
                )
                self.log.info("planning_turn=%d phase=%s", self.state.calls + 1, self.state.phase)
                self.state.calls += 1
                self.state.total_tokens += response.usage.total_tokens
                self.usages.append(response.usage.model_dump())
                self.store.event({"event": "muse_response", "call_id": response.call_id, "phase": self.state.phase, "usage": response.usage.model_dump(), "timestamp": time.time()})
                calls = response.function_calls
                if not calls:
                    last_observation = {"status": "error", "message": "Muse must select a planning tool; no tool call was returned"}
                    self.state.observations.append(last_observation)
                    continue
                call = calls[0]
                deferred_calls = calls[1:]
                self.current_call_id = response.call_id
                last_observation = self._execute(call)
                if deferred_calls:
                    deferred_names = [str(item.get("name") or "unknown") for item in deferred_calls]
                    last_observation = {
                        **last_observation,
                        "additional_tool_calls": deferred_names,
                        "message": (
                            f"Serial planning permits one tool call per turn; additional calls were deferred: "
                            f"{', '.join(deferred_names)}. Re-issue one call at a time if still needed."
                        ),
                    }
                self.state.observations.append(last_observation)
                if not self._register_progress(last_observation, call.get("name", "unknown")):
                    self.state.phase = "stalled"
                    last_observation = {
                        **last_observation,
                        "status": "stalled",
                        "message": "The same non-progressing planning error repeated; stopping to avoid an infinite retry loop.",
                    }
                    self.state.observations[-1] = last_observation
                replay = self._replay_items(response) + [{"type": "function_call_output", "call_id": call.get("call_id", ""), "output": json.dumps(last_observation, ensure_ascii=False, default=str)}]
                self.store.write_json("replay.json", replay)
                self.store.write_json(f"tool_io/{self.state.calls:04d}_{call.get('name', 'unknown')}.json", {"call": call, "result": last_observation})
                self.store.write_json("planning_state.json", self.state.model_dump(mode="json"))
            return self._result()
        except KeyboardInterrupt:
            self.state.phase = "cancelled"
            return self._result()
        except Exception as exc:
            self.state.phase = "failed"
            self.state.observations.append({"status": "error", "message": str(exc)})
            return self._result()

    def _available_tools(self) -> list[dict[str, Any]]:
        # A valid plan is already persisted. Do not let Muse reopen Atlas
        # exploration indefinitely; completion is the only valid next step.
        if self.state.plan_revision:
            return [x for x in tool_definitions() if x["name"] == "complete_planning"]
        allowed = {"inspect_atlas", "search_atlas"}
        if self.state.atlas_observed:
            allowed.update({"read_planning_artifact", "search_planning_memory", "revise_plan"})
            allowed.add("request_reconnaissance")
        if self.state.atlas_observed:
            allowed.add("read_tool_observation")
        return [x for x in tool_definitions() if x["name"] in allowed]

    def _remember_atlas(self, name: str, arguments: dict[str, Any], result: dict[str, Any]) -> None:
        signature = json.dumps({"name": name, "arguments": arguments}, sort_keys=True, ensure_ascii=False)
        self.state.discovery_actions += 1
        self.state.discovery_signatures.append(signature)
        self.state.discovery_signatures = self.state.discovery_signatures[-12:]
        documents = self.state.atlas_digest.setdefault("documents", {})
        document_id = str(result.get("document_id") or arguments.get("document_id") or "unknown")
        document = documents.setdefault(document_id, {"total_pages": result.get("total_pages"), "sections": [], "search_hits": []})
        if result.get("total_pages"):
            document["total_pages"] = result["total_pages"]
        for section in result.get("sections", []) or []:
            compact = {key: section.get(key) for key in ("section_id", "title", "start_page", "end_page", "level") if key in section}
            if compact and compact not in document["sections"]:
                document["sections"].append(compact)
        for hit in result.get("results", []) or []:
            compact = {key: hit.get(key) for key in ("page_number", "printed_page_number", "score", "matched_sections", "matched_keyphrases", "matched_tables", "section_range", "preview_snippet") if key in hit}
            if isinstance(compact.get("preview_snippet"), str):
                compact["preview_snippet"] = compact["preview_snippet"][:500]
            if compact and compact not in document["search_hits"]:
                document["search_hits"].append(compact)
        document["search_hits"] = document["search_hits"][-40:]

    def _execute(self, call: dict[str, Any]) -> dict[str, Any]:
        name = call.get("name", "")
        try:
            args = json.loads(call.get("arguments") or "{}")
            if name in {"inspect_atlas", "search_atlas"}:
                signature = json.dumps({"name": name, "arguments": args}, sort_keys=True, ensure_ascii=False)
                if signature in self.state.discovery_signatures:
                    return {
                        "tool": name,
                        "status": "already_observed",
                        "message": "This identical Atlas request was already completed and retained in the Atlas digest. Refine the query, retrieve the prior observation, request bounded reconnaissance, or revise the plan.",
                        "signature": signature,
                    }
                atlas = self._atlas(args)
                self.state.atlas_observed = True
                self.state.phase = "plan_formation"
                result = inspect_atlas(atlas, args.get("section_id"), args.get("depth")) if name == "inspect_atlas" else search_atlas(atlas, args.get("query", ""), args.get("result_limit", 8), args.get("expand_section", False))
                self._remember_atlas(name, args, result)
                return {"tool": name, "status": "success", "result": result}
            if name == "revise_plan":
                targets, warnings = self._normalize_page_targets(args.get("page_targets"))
                validation_error = self._validate_page_targets(targets)
                if validation_error:
                    return {"tool": name, "status": "retryable_error", "message": validation_error}
                args["page_targets"] = targets
                self.state.planning_warnings.extend(warnings)
                coverage_warning = self._outcome_coverage_warning(targets)
                if coverage_warning:
                    self.state.planning_warnings.append(coverage_warning)
                self.state.phase = "plan_formation"
                self.state.plan_revision += 1
                for attr, key in (("document_understanding", "document_understanding"), ("page_targets", "page_targets"), ("uncertainties", "uncertainties")):
                    if key in args:
                        setattr(self.state, attr, args[key])
                path, version = self.store.version("research_plan", {"revision": self.state.plan_revision, **args})
                self.state.artifact_ids.append("research_plan")
                return {"tool": name, "status": "success", "artifact": str(path), "version": version, "warnings": warnings}
            if name == "read_planning_artifact":
                artifact = self.store.manifest.get("artifacts", {}).get(args.get("artifact_id"))
                if not artifact:
                    return {"tool": name, "status": "empty", "message": "artifact not found"}
                version = args.get("version") or len(artifact["versions"])
                record = artifact["versions"][version - 1]
                content = json.loads((self.run_dir / record["path"]).read_text(encoding="utf-8"))
                return {"tool": name, "status": "success", "artifact": record, "content": content}
            if name == "search_planning_memory":
                query = str(args.get("query", "")).lower()
                hits = []
                for index, item in enumerate(self.state.observations, start=1):
                    if query in json.dumps(item, ensure_ascii=False).lower():
                        hits.append({"step": index, **self._compact_value(item, include_result=False)})
                # Search persisted full results for terms that are intentionally omitted
                # from the compact state, but return only references. Muse can then read
                # the complete payload with read_tool_observation.
                for path in sorted((self.run_dir / "tool_io").glob("*.json")):
                    text = path.read_text(encoding="utf-8")
                    if query and query in text.lower():
                        try:
                            step = int(path.name.split("_", 1)[0])
                        except ValueError:
                            continue
                        if not any(x.get("step") == step for x in hits):
                            hits.append({"step": step, "tool_name": path.stem.split("_", 1)[1], "path": str(path.relative_to(self.run_dir))})
                return {"tool": name, "status": "success", "results": hits[: max(1, int(args.get("limit", 8) or 8))]}
            if name == "read_tool_observation":
                step = int(args.get("step", 0) or 0)
                requested = str(args.get("tool_name", "")).strip()
                matches = sorted((self.run_dir / "tool_io").glob(f"{step:04d}_*.json")) if step > 0 else []
                if requested:
                    matches = [p for p in matches if p.stem.endswith(f"_{requested}")]
                if not matches:
                    return {"tool": name, "status": "empty", "message": "tool observation not found"}
                return {"tool": name, "status": "success", "path": str(matches[0].relative_to(self.run_dir)), "content": json.loads(matches[0].read_text(encoding="utf-8"))}
            if name == "request_reconnaissance":
                if not bounded_selectors(args):
                    return {"tool": name, "status": "retryable_error", "message": "reconnaissance requires pages, sections, or a query selector"}
                atlas = self._atlas(args)
                pages = resolve_pages(atlas, args["selectors"])
                if len(pages) == atlas.total_pages and not args["justification"].strip():
                    return {"tool": name, "status": "retryable_error", "message": "whole-document scope requires an explicit planning justification"}
                result = self._run_di(args, atlas, pages)
                self.state.phase = "plan_formation"
                return {"tool": name, "status": "success", "scope": {"pages": pages}, "result": result}
            if name == "complete_planning":
                if not self.state.plan_revision:
                    return {"tool": name, "status": "retryable_error", "message": "revise_plan is required before completion"}
                validation_error = self._validate_page_targets(self.state.page_targets)
                if validation_error:
                    return {"tool": name, "status": "retryable_error", "message": validation_error}
                if args.get("plan_artifact_id") not in {None, "research_plan"} or args.get("plan_version") not in {None, self.state.plan_revision}:
                    return {"tool": name, "status": "retryable_error", "message": "completion must reference the latest research_plan version"}
                self.state.limitations = args.get("limitations") or self.state.limitations
                self.state.phase = "plan_ready"
                return {"tool": name, "status": "success"}
            return {"tool": name, "status": "retryable_error", "message": "unknown planning tool"}
        except Exception as exc:
            return {"tool": name, "status": "retryable_error", "message": str(exc)}

    def _validate_page_targets(self, targets: Any) -> str | None:
        if not isinstance(targets, list) or not targets:
            return "page_targets must be a non-empty objective-wide page selection"
        seen: set[tuple[str, int]] = set()
        for target in targets:
            if not isinstance(target, dict):
                return "every page target must be an object"
            missing = [key for key in ("document_id", "pages", "reason", "expected_information", "status") if not target.get(key)]
            if missing:
                return f"page target is missing fields: {missing}"
            if target["status"] not in {"required", "conditional"}:
                return "page target status must be required or conditional"
            pages = target["pages"]
            if not isinstance(pages, list) or not all(isinstance(page, int) and page > 0 for page in pages):
                return "page target pages must be positive integer physical PDF pages"
            for page in pages:
                key = (str(target["document_id"]), page)
                if key in seen:
                    return f"duplicate page target: {key[0]} page {key[1]}"
                seen.add(key)
            atlas = self.atlases.get(str(target["document_id"]))
            if atlas and any(page > atlas.total_pages for page in pages):
                return f"page target exceeds document bounds for {target['document_id']}"
        return None

    def _normalize_page_targets(self, targets: Any) -> tuple[list[dict[str, Any]], list[str]]:
        """Keep executable fields stable while tolerating optional annotations."""
        if not isinstance(targets, list):
            return [], []
        core = {"document_id", "pages", "reason", "expected_information", "covered_outcomes", "status"}
        normalized: list[dict[str, Any]] = []
        warnings: list[str] = []
        for index, target in enumerate(targets, 1):
            if not isinstance(target, dict):
                normalized.append(target)
                continue
            extras = sorted(set(target) - core)
            if extras:
                warnings.append(f"page target {index} included non-critical annotations: {', '.join(extras)}")
            normalized.append(dict(target))
        return normalized, warnings

    def _outcome_coverage_warning(self, targets: Any) -> str | None:
        """Report incomplete optional annotations without blocking a valid plan."""
        requested = {str(item).strip() for item in self.request.desired_outcomes if str(item).strip()}
        if not requested:
            return None
        covered = {str(item).strip() for target in targets or [] for item in target.get("covered_outcomes", []) if str(item).strip()}
        if not covered:
            return "No optional covered_outcomes annotations were supplied; assess outcome coverage from target rationale and limitations."
        missing = sorted(requested - covered)
        if missing:
            return "Optional covered_outcomes annotations omit requested outcomes: " + "; ".join(missing)
        return None

    def _register_progress(self, observation: dict[str, Any], tool_name: str) -> bool:
        """Return False when an identical retryable failure repeats too often."""
        status = str(observation.get("status", ""))
        if status not in {"retryable_error", "error", "already_observed"}:
            self.last_no_progress_signature = None
            self.repeated_no_progress = 0
            return True
        signature = json.dumps({"tool": tool_name, "status": status, "message": observation.get("message")}, sort_keys=True, ensure_ascii=False)
        if signature == self.last_no_progress_signature:
            self.repeated_no_progress += 1
        else:
            self.last_no_progress_signature = signature
            self.repeated_no_progress = 1
        return self.repeated_no_progress < self.no_progress_threshold

    def _run_di(self, args: dict[str, Any], document: Any, pages: list[int]) -> dict[str, Any]:
        from doc_intelligence.parsers.registry import ParserRegistry
        from doc_intelligence.pipeline.extractor import IntelligencePipeline
        from doc_intelligence.models.task import TaskSpecification, CoverageScope
        source = self.source_paths[document.document_id]
        parsed = ParserRegistry.get("pymupdf").parse(source)
        parsed = parsed.model_copy(update={"pages": [page for page in parsed.pages if page.page_number in set(pages)]})
        task = TaskSpecification(task_id=f"planning_recon_{self.state.plan_revision + 1}", objective=args.get("planning_question", ""), instructions=args.get("justification", ""), fields=[str(x) for x in args.get("requested_information", [])], coverage_scope=CoverageScope.SAMPLE, max_relevant_pages=max(1, len(pages)), allow_escalation=False)
        provider = DIProvider(self.transport)
        provider.parent_call_id = self.current_call_id
        result = IntelligencePipeline(provider, max_model_calls=max(1, len(pages)), max_tokens_budget=10**9).run(parsed, task=task)
        return result.model_dump(mode="json")

    def _atlas(self, args: dict[str, Any]) -> Any:
        requested = args.get("document_id")
        if requested:
            if requested not in self.atlases:
                raise ValueError(f"unknown document_id: {requested}")
            return self.atlases[requested]
        if len(self.atlases) == 1:
            return next(iter(self.atlases.values()))
        raise ValueError("document_id is required when multiple sources are available")

    def _replay_items(self, response: Any) -> list[dict[str, Any]]:
        return [x for x in response.raw.get("output", []) if x.get("type") in {"reasoning", "function_call", "message"}]

    def _compact_observation(self, observation: dict[str, Any] | None) -> dict[str, Any] | None:
        if not observation:
            return None
        return self._compact_value(observation, include_result=False)

    def _compact_state(self) -> dict[str, Any]:
        state = self.state.model_dump(mode="json")
        first_step = max(1, len(self.state.observations) - 7)
        state["observations"] = [{"step": first_step + offset, **self._compact_value(item, include_result=False)} for offset, item in enumerate(self.state.observations[-8:])]
        state["observation_memory"] = {
            "total_observations": len(self.state.observations),
            "retrieval": "Use read_tool_observation with the step number to read a complete persisted tool result.",
        }
        state["planning_guidance"] = self._planning_guidance()
        return state

    def _compact_atlas_overviews(self) -> list[dict[str, Any]]:
        """Retain all structural/page-candidate signals without request replay."""
        compact: list[dict[str, Any]] = []
        for source in self.overviews:
            # preflight stores a source wrapper; later turns must compact the
            # nested overview rather than the wrapper's absent metadata fields.
            overview = source.get("overview", source)
            compact.append({
                "document_id": source.get("document_id") or overview.get("document_id"),
                "filename": overview.get("filename"),
                "total_pages": overview.get("total_pages"),
                "toc_source": overview.get("toc_source"),
                "toc_pages": overview.get("toc_pages", []),
                "sections": overview.get("sections", []),
                "candidate_windows": overview.get("candidate_windows", []),
                "content_counts": overview.get("content_counts", {}),
            })
        return compact

    def _planning_guidance(self) -> str:
        atlas_observed = getattr(self.state, "atlas_observed", False)
        plan_revision = getattr(self.state, "plan_revision", 0)
        discovery_actions = getattr(self.state, "discovery_actions", 0)
        if atlas_observed and not plan_revision:
            return "Use the retained Atlas digest to select sufficient, non-redundant physical PDF pages relevant to the single objective, with short rationales. Continue discovery only when it can resolve a material uncertainty or improve coverage."
        return "Inspect the Atlas before planning."

    @staticmethod
    def _compact_value(value: Any, include_result: bool = False) -> Any:
        if not isinstance(value, dict):
            return value
        compact = {k: v for k, v in value.items() if include_result or k not in {"result", "content"}}
        result = value.get("result")
        if not include_result and isinstance(result, dict):
            compact["result_summary"] = {"keys": list(result)[:20], "status": result.get("status"), "tool": result.get("tool")}
        return compact

    def _limit_reached(self) -> bool:
        limits = self.request.limits
        total_calls = len(self.transport.usage_records)
        total_tokens = sum(x.get("total_tokens", 0) for x in self.transport.usage_records)
        return bool((limits.max_model_calls and total_calls >= limits.max_model_calls) or (limits.max_total_tokens and total_tokens >= limits.max_total_tokens) or (limits.max_planning_turns and self.state.calls >= limits.max_planning_turns))

    def _result(self) -> PlanningResult:
        status = "completed" if self.state.phase == "plan_ready" else self.state.phase
        records = self.transport.usage_records
        usage = {"orchestration_calls": sum(x.get("phase") == "orchestration" for x in records), "nested_document_intelligence_calls": sum(x.get("phase") == "nested_document_intelligence" for x in records), "total_tokens": sum(x.get("total_tokens", 0) for x in records), "model": self.transport.model}
        usage["calls"] = records
        cost = self._cost()
        result = PlanningResult(research_id=self.request.research_id, status=status, objective=self.request.objective, document_understanding=self.state.document_understanding, page_targets=self.state.page_targets, research_questions=[], target_map=[], proposed_extraction_tasks=[], dependencies=[], uncertainties=self.state.uncertainties, limitations=self.state.limitations, planning_warnings=self.state.planning_warnings, plan_artifact_id="research_plan" if self.state.plan_revision else None, plan_version=self.state.plan_revision or None, usage_summary=usage)
        self.store.write_json("planning_result.json", result.model_dump(mode="json"))
        self.store.write_json("usage.json", usage)
        self.store.write_json("telemetry/cost.json", cost)
        self.store.write_text("planning_report.md", f"# Research Planning\n\nStatus: `{status}`\n\nObjective: {self.request.objective}\n\nPlan revisions: {self.state.plan_revision}\n\nUncertainties: {json.dumps(self.state.uncertainties, ensure_ascii=False, default=str)}\n")
        self.store.flush_manifest()
        return result

    def _cost(self) -> dict[str, Any]:
        rates = {"input_usd_per_million": 0.10, "cached_input_usd_per_million": 0.002, "output_usd_per_million": 0.20}
        records = self.transport.usage_records
        input_tokens = sum(x.get("input_tokens", 0) for x in records)
        cached = sum(x.get("cached_input_tokens", 0) for x in records)
        output = sum(x.get("output_tokens", 0) for x in records)
        total = ((input_tokens - cached) * rates["input_usd_per_million"] + cached * rates["cached_input_usd_per_million"] + output * rates["output_usd_per_million"]) / 1_000_000
        return {"status": "estimated", "model": self.transport.model, "rates": rates, "input_tokens": input_tokens, "cached_input_tokens": cached, "output_tokens": output, "estimated_cost_usd": round(total, 8), "pricing_source": "https://dev.meta.ai/docs/pricing-rate-limits"}
