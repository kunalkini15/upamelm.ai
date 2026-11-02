from __future__ import annotations
import hashlib
import json
import os
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Dict, Optional
from doc_intelligence.providers.base import BaseModelProvider
from doc_intelligence.providers.mock_provider import MockModelProvider
from ..config import MuseConfig, META_MODEL
from ..models import (
    Claim,
    Conflict,
    EvidenceRef,
    ExtractionTask,
    ResearchDecision,
    ResearchRequest,
    ResearchResult,
    ResearchState,
    ToolResult,
    TraceEvent,
)
from ..storage import save_state
from ..tools import ResearchTools
from ..logging_utils import get_logger, ModelIOCaptureProvider
from ..workspace import ResearchWorkspace
from .muse_protocol import TOOLS, build_transport

SYSTEM = """You are an autonomous, domain-independent research agent. Decide what investigation is useful from the mission, sources, and returned evidence. There is no required workflow or artifact format. Use the available tools as needed; Document Intelligence performs document extraction. Use stable document_id values, never local paths. The initial source catalog is already preflighted: do not relist it unless availability may have changed. Do not list an empty workspace; use it when there is prior or newly saved research memory. Inventory and planning calls alone are not research progress. If a call produces no useful new information, change strategy rather than repeat it. Treat tool errors as feedback: correct the call or choose another approach. Preserve uncertainty and source references. Finish only when you judge the mission sufficiently answered or its remaining limitations are stated. Do not claim completion merely because a tool failed or repeated."""


class ResearchOrchestrator:
    def __init__(
        self,
        request: ResearchRequest,
        provider: Optional[BaseModelProvider] = None,
        state: Optional[ResearchState] = None,
    ):
        self.logger = get_logger()
        self.request = request
        self.provider = provider or self._provider()
        self.state = state or ResearchState(
            research_id=request.research_id,
            objective=request.objective,
            pending_questions=list(request.research_questions),
            request_snapshot=request.model_dump(),
        )
        if not self.state.request_snapshot:
            self.state.request_snapshot = request.model_dump()
        if not self.state.source_documents:
            self.state.source_documents = {
                str(i): {"path": s.path, "type": s.type}
                for i, s in enumerate(request.sources)
            }
        self.tools = ResearchTools(
            self.provider,
            [s.path for s in request.sources],
            max_model_calls=request.budget.max_model_calls,
            max_tokens=request.budget.max_total_tokens,
            max_output_tokens=request.budget.max_output_tokens,
        )
        self.workspace: Optional[ResearchWorkspace] = None
        self._state_path = None
        self._native_calls = []
        self._batch_progress = False
        self._run_id = self.state.run_id or uuid.uuid4().hex
        self.state.run_id = self._run_id

    def run(self, state_path=None):
        self._state_path = state_path
        if state_path:
            run_dir = Path(state_path).parent
            self.workspace = ResearchWorkspace(run_dir / "workspace")
            self.state.workspace_path = str(self.workspace.root)
            self.tools.adapter.set_cache_dir(run_dir / "document_cache")
            if not isinstance(self.provider, ModelIOCaptureProvider):
                self.provider = ModelIOCaptureProvider(
                    self.provider, run_dir / "model_io", self._run_id
                )
                self.tools.provider = self.provider
                self.tools.adapter.provider = self.provider
        self.logger.info(
            "run_start research_id=%s objective=%s sources=%d step=%d run_id=%s",
            self.request.research_id,
            self.request.objective[:160],
            len(self.request.sources),
            self.state.step,
            self._run_id,
        )
        # Preflight is deliberately before any model request: missing inputs are
        # surfaced as an actual input failure, with no wasted inference calls.
        source_catalog = self.tools.list_sources()
        unavailable = [s for s in source_catalog if not s.get("available")]
        available = [s for s in source_catalog if s.get("available")]
        if unavailable and not available:
            message = "No configured source file is available: " + ", ".join(
                str(s.get("filename") or s.get("path")) for s in unavailable
            )
            self.state.issues.append(message)
            self.state.status = (
                "failed"
                if not any(s.get("available") for s in source_catalog)
                else "partial"
            )
            self._event("source_preflight", None, message, "error")
            if state_path:
                save_state(self.state, state_path)
            return self._result()
        if unavailable:
            message = "Some configured source files are unavailable: " + ", ".join(
                str(s.get("filename") or s.get("path")) for s in unavailable
            )
            self.state.issues.append(message)
            self.logger.warning("source_preflight_warning %s", message)
        self.logger.info(
            "budget max_calls=%s max_tokens=%s max_steps=%s",
            self.request.budget.max_model_calls,
            self.request.budget.max_total_tokens,
            self.request.budget.max_agent_steps,
        )
        if state_path and self.state.step == 0:
            save_state(self.state, state_path)
        if (
            self.state.status == "running"
            and self.state.finish_requested
            and not self.state.pending_tool_calls
        ):
            self.state.status = (
                "completed_with_limitations"
                if self.state.pending_questions or self.state.stated_limitations
                else "completed"
            )
        try:
            while self.state.status == "running" and (
                self.request.budget.max_agent_steps is None
                or self.state.step < self.request.budget.max_agent_steps
            ):
                if self._budget_exhausted():
                    self.state.status = "ceiling_reached"
                    self._event(
                        "budget_exhausted",
                        None,
                        "Optional request-level model budget reached",
                        "skipped",
                    )
                    break
                self.state.step += 1
                started = time.perf_counter()
                if self.state.pending_tool_calls and self._native_enabled():
                    self._native_calls = list(self.state.pending_tool_calls)
                    decision = ResearchDecision(
                        action="assess_progress",
                        reason="Resuming checkpointed Muse tool calls",
                    )
                else:
                    decision = self._decide()
                if self.state.status != "running":
                    if state_path:
                        save_state(self.state, state_path)
                    break
                if self._native_enabled() and not self._native_calls:
                    self.state.no_progress_turns += 1
                    if self.state.no_progress_turns == 3:
                        self.state.conversation.append(
                            {
                                "role": "user",
                                "content": "The last three turns produced no new research state. Review the mission and tool results, then make a concrete research move or finish with explicit limitations.",
                            }
                        )
                    if self.state.no_progress_turns >= 6:
                        self.state.status = "stalled"
                        self.state.issues.append(
                            "Stopped after six consecutive turns without a tool call or new research state."
                        )
                        self._event("stalled", None, self.state.issues[-1], "skipped")
                        break
                    if state_path:
                        save_state(self.state, state_path)
                    continue
                if self._native_calls:
                    if state_path:
                        save_state(self.state, state_path)
                    self._run_native_batch(self._native_calls, started)
                    if self.state.no_progress_turns == 3:
                        self.state.conversation.append(
                            {
                                "role": "user",
                                "content": "The last three tool-call turns did not produce new research state. Review the returned results and errors, then change strategy, correct arguments, or finish with explicit limitations.",
                            }
                        )
                    if state_path:
                        save_state(self.state, state_path)
                    if self.state.status in {"completed", "completed_with_limitations"}:
                        break
                    if self.state.no_progress_turns >= 6:
                        self.state.status = "stalled"
                        self.state.issues.append(
                            "Stopped after six consecutive model turns without new research state; resume after reviewing the conversation and tool results."
                        )
                        self._event("stalled", None, self.state.issues[-1], "skipped")
                        break
                    continue
                action = decision.action
                self.logger.info(
                    "decision step=%d action=%s reason=%s pending_questions=%d",
                    self.state.step,
                    action,
                    decision.reason[:200],
                    len(self.state.pending_questions),
                )
                if action in {"complete_investigation", "finish_investigation"}:
                    self.state.summary = (
                        decision.arguments.get("summary", "") or decision.reason
                    )
                    self.state.final_artifact_ids = [
                        str(x) for x in decision.arguments.get("artifact_ids", []) if x
                    ]
                    self.state.pending_questions = [
                        str(x)
                        for x in decision.arguments.get("unanswered_questions", [])
                        if x
                    ]
                    self.state.stated_limitations = [
                        str(x) for x in decision.arguments.get("limitations", []) if x
                    ]
                    missing = [
                        aid
                        for aid in self.state.final_artifact_ids
                        if not self.workspace or not self.workspace.get(aid)
                    ]
                    if action == "finish_investigation" and not missing:
                        self.state.status = (
                            "completed_with_limitations"
                            if self.state.pending_questions
                            or self.state.stated_limitations
                            else "completed"
                        )
                        event_status = "success"
                    else:
                        self.state.status = "partial"
                        if missing:
                            self.state.issues.append(
                                f"Selected final artifacts do not exist: {missing}"
                            )
                        else:
                            self.state.issues.append(
                                "Legacy complete_investigation is not accepted as a Muse completion signal"
                            )
                        event_status = "skipped"
                    self._event(
                        action,
                        action,
                        decision.reason or "Completion assessed",
                        event_status,
                        time.perf_counter() - started,
                    )
                    break
                try:
                    result = self._invoke(action, decision.arguments)
                    self._absorb(action, result, decision.arguments)
                    envelope = self._envelope(action, result)
                    self.state.last_tool_result = envelope
                    self._update_legacy_progress(action, decision.arguments, result)
                    self._event(
                        action,
                        action,
                        decision.reason or "Selected from current evidence",
                        "success",
                        time.perf_counter() - started,
                        decision.arguments,
                    )
                    self.logger.info(
                        "tool_complete step=%d tool=%s findings=%d evidence=%d issues=%d duration=%.2fs",
                        self.state.step,
                        action,
                        len(self.state.findings),
                        len(self.state.evidence),
                        len(self.state.issues),
                        time.perf_counter() - started,
                    )
                except Exception as exc:
                    issue = f"{action}: {exc}"
                    self.state.issues.append(issue)
                    self.state.last_tool_result = ToolResult(
                        status="retryable_error", summary=issue, issues=[issue]
                    )
                    self.state.recent_observations.append(
                        {
                            "type": "tool_error",
                            "action": action,
                            "error": str(exc),
                            "recovery": "Correct the tool arguments/schema and retry or select another tool.",
                        }
                    )
                    self._event(
                        action,
                        action,
                        str(exc),
                        "error",
                        time.perf_counter() - started,
                        decision.arguments,
                    )
                    self.state.consecutive_failures += 1
                    if (
                        self.request.budget.max_retries_per_issue is not None
                        and len(self.state.issues)
                        > self.request.budget.max_retries_per_issue
                    ):
                        self.state.status = "partial"
                    self.logger.exception(
                        "tool_error step=%d tool=%s", self.state.step, action
                    )
                if state_path:
                    save_state(self.state, state_path)
            if self.state.status == "running":
                self.state.status = (
                    "ceiling_reached"
                    if self.request.budget.max_agent_steps is not None
                    and self.state.step >= self.request.budget.max_agent_steps
                    else "partial"
                )
        except KeyboardInterrupt:
            self.state.status = "cancelled"
            self.state.issues.append("Run cancelled by user.")
            self._event("cancelled", None, "Run cancelled by user", "skipped")
        except Exception as exc:
            self.state.status = "failed" if not self.state.findings else "partial"
            self.state.issues.append(str(exc))
            self._event("orchestrator_failure", None, str(exc), "error")
        if state_path:
            save_state(self.state, state_path)
        self.logger.info(
            "run_end research_id=%s status=%s steps=%d findings=%d evidence=%d calls=%d tokens=%d issues=%d",
            self.request.research_id,
            self.state.status,
            self.state.step,
            len(self.state.findings),
            len(self.state.evidence),
            self.state.model_usage["calls"],
            self.state.model_usage["total_tokens"],
            len(self.state.issues),
        )
        return self._result()

    def _decide(self):
        if self._native_enabled():
            return self._decide_native()
        context = {
            "mission": self.request.objective,
            "domain_context": self.request.domain_context,
            "instructions": self.request.instructions,
            "desired_outcomes": self.request.desired_outcomes,
            "questions": self.state.pending_questions,
            "plan": self.state.plan,
            "sources": self.tools.list_sources(),
            "workspace": self.workspace.digest() if self.workspace else [],
            "workspace_memory": self.workspace.search_summaries(
                self.request.objective, 8
            )
            if self.workspace
            else [],
            "findings": [f.model_dump() for f in self.state.findings[-20:]],
            "evidence": [e.model_dump() for e in self.state.evidence[-30:]],
            "conflicts": [c.model_dump() for c in self.state.conflicts],
            "completed": self.state.completed_tasks[-20:],
            "recent_observations": self.state.recent_observations[-8:],
            "last_tool_result": self.state.last_tool_result.model_dump()
            if self.state.last_tool_result
            else None,
            "issues": self.state.issues[-10:],
        }
        self.logger.info(
            "model_request phase=orchestration step=%d model_expected=%s",
            self.state.step,
            META_MODEL,
        )
        self._apply_output_token_limit()
        started = time.perf_counter()
        resp = self.provider.complete(
            json.dumps(context, ensure_ascii=False),
            system_instruction=SYSTEM,
            json_mode=True,
            reasoning_effort="medium",
        )
        self._usage(resp)
        self.logger.info(
            "model_response phase=orchestration step=%d model=%s prompt_tokens=%d completion_tokens=%d total_tokens=%d duration=%.2fs parsed_json=%s",
            self.state.step,
            resp.model_name,
            resp.prompt_tokens,
            resp.completion_tokens,
            resp.total_tokens,
            time.perf_counter() - started,
            bool(resp.parsed_json),
        )
        raw = resp.parsed_json or {}
        # Muse may place routing metadata beside, rather than inside, the
        # arguments object. Normalize only the small set of routing fields;
        # unrelated additive metadata is ignored by ResearchDecision.
        if isinstance(raw, dict):
            raw_args = dict(raw.get("arguments") or raw.get("params") or {})
            if "document_id" not in raw_args and raw.get("source_id"):
                raw_args["document_id"] = raw["source_id"]
            for key in (
                "document_id",
                "source_id",
                "page",
                "query",
                "result_limit",
                "task",
                "finding_ids",
                "operation",
                "field",
                "comparison_dimensions",
                "artifact",
                "artifact_id",
                "artifact_ids",
                "version",
                "limit",
                "summary",
                "unanswered_questions",
            ):
                if key not in raw_args and key in raw:
                    raw_args["document_id" if key == "source_id" else key] = raw[key]
            raw["arguments"] = raw_args
        # Keep this boundary intentionally small: only the action registry is
        # deterministic. Optional fields are normalized instead of rejected.
        allowed = {
            "list_sources",
            "inspect_source",
            "search_source",
            "read_evidence",
            "extract_information",
            "compare_findings",
            "calculate",
            "workspace_list",
            "workspace_search",
            "workspace_get",
            "workspace_upsert",
            "synthesize_findings",
            "revise_plan",
            "assess_progress",
            "complete_investigation",
            "finish_investigation",
        }
        action = (
            (raw.get("action") or raw.get("tool") or "assess_progress")
            if isinstance(raw, dict)
            else "assess_progress"
        )
        if action not in allowed:
            self.state.issues.append(f"unsupported Muse action: {action}")
            action = "assess_progress"
        reason = raw.get("reason", "") if isinstance(raw, dict) else ""
        plan = raw.get("plan", []) if isinstance(raw, dict) else []
        pending = raw.get("pending_questions", []) if isinstance(raw, dict) else []
        decision = ResearchDecision(
            action=action,
            arguments=raw_args if isinstance(raw, dict) else {},
            reason=str(reason or ""),
            plan=plan if isinstance(plan, list) else [str(plan)],
            pending_questions=pending if isinstance(pending, list) else [str(pending)],
        )
        if "plan" in raw:
            self.state.plan = decision.plan
        if "pending_questions" in raw:
            self.state.pending_questions = decision.pending_questions
        return decision

    def _native_enabled(self):
        return bool(
            getattr(
                self.provider,
                "supports_native_tool_calls",
                hasattr(self.provider, "complete_agent"),
            )
        )

    def _decide_native(self):
        if not self.state.conversation:
            self.state.conversation = [
                {"role": "developer", "content": SYSTEM},
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "mission": self.request.objective,
                            "domain_context": self.request.domain_context,
                            "instructions": self.request.instructions,
                            "desired_outcomes": self.request.desired_outcomes,
                            "research_questions": self.request.research_questions,
                            "sources": self.tools.list_sources(),
                            "workspace": {
                                "artifacts": self.workspace.digest()
                                if self.workspace
                                else [],
                                "note": "Search or read prior artifacts when useful; no artifacts means there is nothing to list.",
                            },
                        },
                        ensure_ascii=False,
                    ),
                },
            ]
        self._maybe_compact_conversation()
        if self._budget_exhausted():
            self.state.status = "ceiling_reached"
            self._event(
                "budget_exhausted",
                None,
                "Optional request-level model budget reached during context compaction",
                "skipped",
            )
            return ResearchDecision(
                action="assess_progress",
                reason="Execution ceiling reached during context compaction",
            )
        self.logger.info(
            "model_request phase=orchestration step=%d model_expected=%s run_id=%s",
            self.state.step,
            META_MODEL,
            self._run_id,
        )
        self._apply_output_token_limit()
        response = self.provider.complete_agent(self.state.conversation, TOOLS)
        message = response["message"]
        if response.get("model") and response["model"] != META_MODEL:
            raise ValueError(
                f"Research Engine requires {META_MODEL}; provider returned {response['model']!r}"
            )
        usage = response.get("usage") or {}
        self._record_native_usage(usage, response.get("model", META_MODEL))
        self._native_calls = message.get("tool_calls") or []
        if any(not call.get("id") for call in self._native_calls) or len(
            {call.get("id") for call in self._native_calls}
        ) != len(self._native_calls):
            issue = "Muse returned missing or duplicate tool-call IDs; no tool was executed."
            self.state.issues.append(issue)
            self.state.conversation.append(
                {
                    "role": "user",
                    "content": issue + " Continue with a valid registered tool call.",
                }
            )
            self._native_calls = []
            return ResearchDecision(action="assess_progress", reason=issue)
        finish_reason = response.get("finish_reason")
        invalid_finish = (
            bool(self._native_calls) and finish_reason != "tool_calls"
        ) or finish_reason == "length"
        if invalid_finish:
            issue = f"Muse returned an incomplete response (finish_reason={finish_reason!r}); unfinished tool calls were not executed."
            self.state.issues.append(issue)
            self.state.conversation.append(
                {"role": "user", "content": issue + " Retry with complete tool calls."}
            )
            self._native_calls = []
            return ResearchDecision(action="assess_progress", reason=issue)
        self.state.conversation.append(message)
        self.state.pending_tool_calls = list(self._native_calls)
        content = message.get("content") or ""
        if content:
            self.state.recent_observations.append(
                {"type": "assistant_progress", "text": content}
            )
        self.logger.info(
            "model_response phase=orchestration step=%d model=%s finish_reason=%s tool_calls=%d duration=%.2fs",
            self.state.step,
            response.get("model", META_MODEL),
            response.get("finish_reason"),
            len(self._native_calls),
            response.get("duration_seconds", 0),
        )
        if not self._native_calls:
            # Text without a call is a progress observation; ask Muse to continue
            # with the registered tools, preserving the transcript.
            self.state.conversation.append(
                {
                    "role": "user",
                    "content": "Your last response did not call a research tool or finish the investigation. Continue the investigation using an available tool, or call finish_investigation if you judge it complete.",
                }
            )
            self._native_calls = []
            return ResearchDecision(
                action="assess_progress",
                reason="Muse returned progress text without a tool call",
            )
        return ResearchDecision(
            action="assess_progress", reason="Muse issued native tool calls"
        )

    def _maybe_compact_conversation(self):
        if not self.workspace or not self.state.conversation:
            return
        try:
            threshold = int(
                os.environ.get("RESEARCH_ENGINE_CONTEXT_COMPACTION_CHARS", "1400000")
            )
        except ValueError:
            self.logger.warning(
                "invalid RESEARCH_ENGINE_CONTEXT_COMPACTION_CHARS; using default"
            )
            threshold = 1400000
        if threshold <= 0:
            return
        if (
            len(json.dumps(self.state.conversation, ensure_ascii=False, default=str))
            <= threshold
        ):
            return
        assistants = [
            i
            for i, message in enumerate(self.state.conversation[2:], start=2)
            if message.get("role") == "assistant"
        ]
        if len(assistants) < 3:
            return
        keep_from = assistants[-4] if len(assistants) >= 4 else assistants[-2]
        if keep_from <= 2:
            return
        archived = self.state.conversation[2:keep_from]
        archive_id = f"transcript_{self._run_id}_{self.state.compaction_count + 1}"
        self.workspace.upsert(
            {
                "artifact_id": archive_id,
                "type": "conversation_archive",
                "format": "json",
                "title": f"Conversation archive {self.state.compaction_count + 1}",
                "content": {"messages": archived},
                "metadata": {"run_id": self._run_id, "message_count": len(archived)},
            }
        )
        prompt = {
            "mission": self.request.objective,
            "questions": self.state.pending_questions,
            "plan": self.state.plan,
            "workspace_artifacts": self.workspace.digest(),
            "earlier_conversation": archived,
            "instruction": "Create a compact factual memory for continuing this investigation. Preserve useful findings and their artifact/source/page IDs, decisions already made, unresolved questions, errors and recoveries. Do not add claims or hide uncertainty. This is a memory checkpoint, not a final answer.",
        }
        self.logger.info(
            "context_compaction_start run_id=%s archived_messages=%d archive_artifact=%s",
            self._run_id,
            len(archived),
            archive_id,
        )
        self._apply_output_token_limit()
        response = self.provider.complete_agent(
            [
                {
                    "role": "developer",
                    "content": "Summarize research state faithfully and compactly. Do not expose hidden reasoning.",
                },
                {
                    "role": "user",
                    "content": json.dumps(prompt, ensure_ascii=False, default=str),
                },
            ],
            None,
        )
        model = response.get("model", META_MODEL)
        if model != META_MODEL:
            raise ValueError(
                f"Research Engine requires {META_MODEL}; provider returned {model!r}"
            )
        self._record_native_usage(response.get("usage") or {}, model)
        message = response.get("message") or {}
        summary = message.get("content")
        if (
            not isinstance(summary, str)
            or not summary.strip()
            or response.get("finish_reason") == "length"
        ):
            self.state.issues.append(
                "Context compaction returned no complete memory checkpoint; the original conversation was retained."
            )
            self.logger.warning("context_compaction_failed run_id=%s", self._run_id)
            return
        initial = self.state.conversation[:2]
        recent = self.state.conversation[keep_from:]
        self.state.conversation = (
            initial
            + [
                {
                    "role": "user",
                    "content": f"Earlier conversation has been compacted into this memory checkpoint. Full transcript: workspace artifact {archive_id}.\n\n{summary}",
                }
            ]
            + recent
        )
        self.state.compaction_count += 1
        self.state.recent_observations.append(
            {
                "type": "context_compaction",
                "artifact_id": archive_id,
                "archived_messages": len(archived),
                "retained_messages": len(recent),
            }
        )
        self.logger.info(
            "context_compaction_complete run_id=%s retained_messages=%d",
            self._run_id,
            len(self.state.conversation),
        )
        if self._state_path:
            save_state(self.state, self._state_path)

    def _run_native_batch(self, calls, started):
        self._native_calls = []
        finished = False
        futures = {}
        executor = None
        read_tools = {
            "inspect_source",
            "search_source",
            "read_evidence",
            "list_workspace",
            "search_workspace",
            "read_workspace",
        }
        # Calls in the same model response are independent unless a write or
        # extraction is present. In a read-only batch, overlap network-free
        # Atlas/workspace reads and still return results in the model's order.
        if calls and all(
            (call.get("function") or {}).get("name") in read_tools for call in calls
        ):
            executor = ThreadPoolExecutor(
                max_workers=min(len(calls), 8), thread_name_prefix="research-read"
            )
            for call in calls:
                call_id = call.get("id")
                fn = call.get("function") or {}
                name = fn.get("name", "")
                try:
                    args = (
                        json.loads(fn.get("arguments", "{}"))
                        if isinstance(fn.get("arguments", "{}"), str)
                        else fn.get("arguments", {})
                    )
                    if isinstance(args, dict):
                        nested = args.get("arguments") or args.get("params")
                        if isinstance(nested, dict):
                            args = {**args, **nested}
                        if not args.get("document_id") and args.get("source_id"):
                            args["document_id"] = args["source_id"]
                        futures[call_id] = executor.submit(
                            self._invoke_native, name, args
                        )
                except Exception:
                    # The regular path below formats the error against the
                    # correct native tool-call ID for Muse to repair.
                    pass
        for call in calls:
            call_id = call.get("id") or f"missing-{uuid.uuid4().hex}"
            fn = call.get("function") or {}
            name = fn.get("name", "")
            raw_args = fn.get("arguments", "{}")
            self.logger.info("tool_call_start call_id=%s tool=%s", call_id, name)
            try:
                args = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
                if not isinstance(args, dict):
                    raise ValueError("tool arguments must be a JSON object")
                nested_args = args.get("arguments") or args.get("params")
                if isinstance(nested_args, dict):
                    args = {**args, **nested_args}
                if not args.get("document_id") and args.get("source_id"):
                    args["document_id"] = args["source_id"]
                args = self._normalize_source_selectors(args)
                if name == "extract_information" and not isinstance(
                    args.get("task"), dict
                ):
                    args["task"] = {
                        k: v
                        for k, v in args.items()
                        if k
                        not in {
                            "document_id",
                            "pages",
                            "page_numbers",
                            "page",
                            "sections",
                            "section_ids",
                            "query",
                        }
                    }
                if name == "extract_information":
                    task = args["task"]
                    task.setdefault("objective", self.request.objective)
                    task.setdefault(
                        "question_ids", list(self.request.research_questions)
                    )
                    task.setdefault("fields", [])
                    task.setdefault("instructions", self.request.instructions)
                    if not task.get("task_id"):
                        stable = {k: v for k, v in task.items() if k != "task_id"}
                        stable.update(
                            {
                                k: args.get(k)
                                for k in ("document_id", "pages", "sections", "query")
                                if args.get(k)
                            }
                        )
                        digest = hashlib.sha256(
                            json.dumps(stable, sort_keys=True, default=str).encode()
                        ).hexdigest()[:16]
                        task["task_id"] = f"extract_{digest}"
                args["_harness_tool_call_id"] = call_id
                result = (
                    futures[call_id].result()
                    if call_id in futures
                    else self._invoke_native(name, args, call_id)
                )
                self._absorb(name, result, args)
                outcome_payload = result
                outcome_args = args
                if name == "extract_information" and isinstance(result, dict):
                    outcome_payload = {
                        k: result.get(k)
                        for k in (
                            "document_id",
                            "status",
                            "findings",
                            "coverage",
                            "review_queue",
                        )
                    }
                    outcome_args = {
                        **args,
                        "task": {
                            k: v
                            for k, v in args.get("task", {}).items()
                            if k != "task_id"
                        },
                    }
                if name == "write_artifact" and isinstance(result, dict):
                    outcome_payload = {
                        k: v
                        for k, v in result.items()
                        if k not in {"version", "updated_at"}
                    }
                if name == "finish_investigation":
                    self.state.summary = str(args.get("summary") or self.state.summary)
                    self.state.final_artifact_ids = [
                        str(x) for x in args.get("artifact_ids", []) if x
                    ]
                    self.state.pending_questions = [
                        str(x) for x in args.get("unanswered_questions", []) if x
                    ]
                    self.state.stated_limitations = [
                        str(x) for x in args.get("limitations", []) if x
                    ]
                    missing = [
                        aid
                        for aid in self.state.final_artifact_ids
                        if not self.workspace or not self.workspace.get(aid)
                    ]
                    if missing:
                        result = {
                            "status": "error",
                            "error": "Unknown final artifact IDs",
                            "unknown_artifact_ids": missing,
                        }
                        self.state.issues.append(
                            f"Muse selected unknown final artifacts: {missing}"
                        )
                    else:
                        self.state.finish_requested = True
                        finished = True
                fingerprint_value = self._progress_fingerprint_value(
                    name, outcome_args, outcome_payload
                )
                outcome_fingerprint = hashlib.sha256(
                    json.dumps(fingerprint_value, sort_keys=True, default=str).encode()
                ).hexdigest()
                semantic_error = isinstance(result, dict) and result.get("status") in {
                    "error",
                    "not_found",
                    "failed",
                    "skipped",
                }
                if (
                    outcome_fingerprint not in self.state.tool_outcomes
                    and self._is_research_progress(name, result)
                    and not semantic_error
                ):
                    self._batch_progress = True
                    self.state.tool_outcomes[outcome_fingerprint] = True
                self.state.last_tool_fingerprint = outcome_fingerprint
                if len(self.state.tool_outcomes) > 2000:
                    self.state.tool_outcomes = dict(
                        list(self.state.tool_outcomes.items())[-1000:]
                    )
                if semantic_error:
                    self.state.consecutive_failures += 1
                else:
                    self.state.consecutive_failures = 0
                self._event(
                    name,
                    name,
                    "Muse native tool call",
                    "error" if semantic_error else "success",
                    time.perf_counter() - started,
                    args,
                )
                result_for_model = {
                    "status": "error" if semantic_error else "success",
                    "result": self._tool_observation(name, result, args),
                }
                self.logger.info("tool_call_complete call_id=%s tool=%s", call_id, name)
            except Exception as exc:
                self.state.consecutive_failures += 1
                message = str(exc)
                signature = hashlib.sha256(
                    json.dumps(
                        [name, raw_args, message], sort_keys=True, default=str
                    ).encode()
                ).hexdigest()
                self.state.tool_error_counts[signature] = (
                    self.state.tool_error_counts.get(signature, 0) + 1
                )
                exhausted = (
                    self.request.budget.max_retries_per_issue is not None
                    and self.state.tool_error_counts[signature]
                    > self.request.budget.max_retries_per_issue
                )
                result_for_model = {
                    "status": "error",
                    "tool": name,
                    "arguments": raw_args,
                    "error": message,
                    "retryable": not exhausted,
                    "expected_arguments": self._expected_arguments(name),
                }
                if "document_id" in message:
                    result_for_model["available_document_ids"] = [
                        s.get("document_id")
                        for s in self.tools.list_sources()
                        if s.get("document_id")
                    ]
                self.state.issues.append(f"{name or 'unknown tool'}: {message}")
                if exhausted:
                    self.state.status = "partial"
                    result_for_model["stop_reason"] = "configured_retry_ceiling_reached"
                    self.state.issues.append(
                        f"Stopped retrying the same failing tool call after {self.request.budget.max_retries_per_issue} retries"
                    )
                self._event(
                    name or "invalid_tool",
                    name or None,
                    message,
                    "error",
                    time.perf_counter() - started,
                    {"raw_arguments": raw_args},
                )
                self.logger.exception(
                    "tool_call_error call_id=%s tool=%s", call_id, name
                )
            # A one-to-one result is mandatory even for invalid arguments/names.
            self.state.conversation.append(
                {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "content": json.dumps(
                        result_for_model, ensure_ascii=False, default=str
                    ),
                }
            )
            self.state.pending_tool_calls = [
                pending
                for pending in self.state.pending_tool_calls
                if pending.get("id") != call_id
            ]
            if self._state_path:
                save_state(self.state, self._state_path)
            if (
                self.workspace
                and name == "write_artifact"
                and result_for_model.get("status") == "success"
            ):
                self.state.workspace_revision += 1
            if finished:
                # Any other calls in the same response still get results, so the
                # transcript remains valid before termination.
                continue
        self.state.no_progress_turns = (
            self.state.no_progress_turns + 1 if not self._batch_progress else 0
        )
        self._batch_progress = False
        if executor:
            executor.shutdown(wait=True)
        if (
            finished
            and self.state.finish_requested
            and not self.state.pending_tool_calls
        ):
            self.state.status = (
                "completed_with_limitations"
                if self.state.pending_questions or self.state.stated_limitations
                else "completed"
            )
        return finished

    @staticmethod
    def _is_research_progress(name, result):
        """Inventory/plan churn is not progress; useful observations and writes are."""
        if name in {"list_sources", "list_workspace", "assess_progress", "revise_plan"}:
            return False
        if isinstance(result, dict) and result.get("status") in {
            "error",
            "not_found",
            "skipped",
        }:
            return False
        if name == "search_source":
            return bool(result)
        if name == "read_evidence":
            return bool(
                isinstance(result, dict)
                and (result.get("text") or result.get("tables"))
            )
        if name == "extract_information":
            if not isinstance(result, dict):
                return bool(result)
            coverage = result.get("coverage") or {}
            return bool(result.get("findings") or coverage.get("processed_pages"))
        if name in {"search_workspace", "read_workspace"}:
            return bool(result)
        if name == "write_artifact":
            return bool(result)
        if name == "inspect_source":
            return bool(
                isinstance(result, dict)
                and (result.get("document_id") or result.get("atlas"))
            )
        return bool(result)

    @staticmethod
    def _without_harness_metadata(value):
        if isinstance(value, dict):
            return {
                key: ResearchOrchestrator._without_harness_metadata(item)
                for key, item in value.items()
                if not str(key).startswith("_harness_")
            }
        if isinstance(value, list):
            return [
                ResearchOrchestrator._without_harness_metadata(item) for item in value
            ]
        return value

    @staticmethod
    def _progress_fingerprint_value(name, args, result):
        value = ResearchOrchestrator._without_harness_metadata([name, args, result])
        if name != "extract_information":
            return value

        def remove_generated_ids(item, parent_key=None):
            if isinstance(item, dict):
                return {
                    key: remove_generated_ids(child, key)
                    for key, child in item.items()
                    if key not in {"finding_id", "task_id"}
                    and not (key == "notes" and parent_key == "coverage")
                }
            if isinstance(item, list):
                return [remove_generated_ids(child, parent_key) for child in item]
            return item

        # Extraction IDs and coverage prose are task-specific bookkeeping; the
        # evidence values, citations, status, and requested scope determine
        # whether a repeat produced any new research information.
        return remove_generated_ids(value)

    @property
    def _batch_progress(self):
        return self.__batch_progress

    @_batch_progress.setter
    def _batch_progress(self, value):
        self.__batch_progress = value

    def _invoke_native(self, name, args, call_id=None):
        mapping = {
            "list_sources": "list_sources",
            "inspect_source": "inspect_source",
            "search_source": "search_source",
            "read_evidence": "read_evidence",
            "extract_information": "extract_information",
            "compare_findings": "compare_findings",
            "calculate": "calculate",
            "revise_plan": "revise_plan",
            "assess_progress": "assess_progress",
            "finish_investigation": "finish_investigation",
            "list_workspace": "workspace_list",
            "search_workspace": "workspace_search",
            "read_workspace": "workspace_get",
            "write_artifact": "workspace_upsert",
        }
        if name not in mapping:
            raise ValueError(
                f"Unknown tool {name!r}; choose one of the registered tools"
            )
        translated = dict(args)
        translated.pop("_harness_tool_call_id", None)
        if name == "extract_information" and "task" not in translated:
            translated["task"] = {
                k: v
                for k, v in args.items()
                if k not in {"document_id", "pages", "sections", "query"}
            }
        if name in {
            "read_workspace",
            "search_workspace",
            "list_workspace",
            "write_artifact",
        }:
            translated["artifact"] = (
                args if name == "write_artifact" else args.get("artifact")
            )
        if name == "write_artifact":
            payload = {k: v for k, v in args.items() if k != "_harness_tool_call_id"}
            aid = str(payload.get("artifact_id") or "")
            if self.workspace and aid:
                prior = self.workspace.get(aid)
                if (
                    prior
                    and (prior.get("metadata") or {}).get("_harness_tool_call_id")
                    == f"{self._run_id}:{call_id}"
                ):
                    return prior
            metadata = dict(payload.get("metadata") or {})
            metadata["_harness_tool_call_id"] = f"{self._run_id}:{call_id}"
            payload["metadata"] = metadata
            translated["artifact"] = payload
        if name == "extract_information" and self.workspace:
            task = args.get("task") or {}
            aid = self._evidence_artifact_id(
                task.get("task_id", "extraction"), args.get("document_id")
            )
            prior = self.workspace.get(aid)
            if (
                prior
                and (prior.get("metadata") or {}).get("_harness_tool_call_id")
                == f"{self._run_id}:{call_id}"
            ):
                content = prior.get("content") or {}
                metadata = prior.get("metadata") or {}
                return {
                    "document_id": metadata.get("document_id"),
                    "findings": content.get("findings", []),
                    "review_queue": content.get("review_queue", []),
                    "coverage": content.get("coverage", {}),
                    "trace": content.get("trace", []),
                    "model_calls": metadata.get("model_calls", 0),
                    "tokens": metadata.get("tokens", 0),
                    "status": "resumed_persisted_result",
                    "_harness_persisted": True,
                }
        return self._invoke(mapping[name], translated)

    def _tool_observation(self, name, result, args):
        if name == "extract_information" and isinstance(result, dict):
            task = args.get("task") or {}
            task_id = str(task.get("task_id") or "extraction")
            artifact_id = self._evidence_artifact_id(task_id, result.get("document_id"))
            artifact = self.workspace.get(artifact_id) if self.workspace else None
            coverage = result.get("coverage") or {}
            findings = result.get("findings") or []
            return {
                "status": result.get("status"),
                "document_id": result.get("document_id"),
                "artifact_id": artifact_id if artifact else None,
                "artifact_version": artifact.get("version") if artifact else None,
                "finding_count": len(findings),
                "coverage": coverage,
                "review_queue_count": len(result.get("review_queue", [])),
                "finding_preview": self._compact_preview(findings[:3]),
                "additional_findings": max(0, len(findings) - 3),
                "next_step": "Use search_workspace/read_workspace to inspect stored evidence records.",
            }
        if name == "read_evidence" and isinstance(result, dict):
            page_text = str(result.get("text", ""))
            return {
                **{k: v for k, v in result.items() if k != "text"},
                "text_preview": page_text[:1500],
                "text_length": len(page_text),
            }
        if name == "search_workspace" and isinstance(result, dict):
            return result
        return result

    @staticmethod
    def _compact_preview(value, depth=0):
        """Keep useful evidence visible in context without embedding full artifacts."""
        if isinstance(value, dict):
            if depth >= 6:
                return {
                    "preview": "Nested evidence is available in the workspace artifact."
                }
            items = list(value.items())
            compact = {
                str(key): ResearchOrchestrator._compact_preview(item, depth + 1)
                for key, item in items[:20]
                if key != "bbox"
            }
            if len(items) > 20:
                compact["_omitted_fields"] = len(items) - 20
            return compact
        if isinstance(value, list):
            return [
                ResearchOrchestrator._compact_preview(item, depth + 1)
                for item in value[:3]
            ]
        if isinstance(value, str) and len(value) > 500:
            return value[:500] + "…"
        if value is None or isinstance(value, (str, int, float, bool)):
            return value
        if hasattr(value, "model_dump"):
            return ResearchOrchestrator._compact_preview(value.model_dump(), depth)
        return str(value)[:500]

    @staticmethod
    def _evidence_artifact_id(task_id, document_id=None):
        clean = "".join(
            ch if ch.isalnum() or ch in "._-" else "_" for ch in str(task_id)
        ).strip("._-")
        clean = clean[:96] or "extraction"
        if clean != str(task_id) or len(str(task_id)) > 96:
            clean = f"{clean}_{hashlib.sha256(str(task_id).encode()).hexdigest()[:12]}"
        source_suffix = (
            f"_{hashlib.sha256(str(document_id).encode()).hexdigest()[:10]}"
            if document_id
            else ""
        )
        return f"evidence_{clean}{source_suffix}"

    @staticmethod
    def _expected_arguments(name):
        for tool in TOOLS:
            fn = tool["function"]
            if fn["name"] == name:
                return fn["parameters"]
        return {"available_tools": [x["function"]["name"] for x in TOOLS]}

    def _record_native_usage(self, usage, model):
        prompt = int(usage.get("prompt_tokens", 0) or 0)
        completion = int(usage.get("completion_tokens", 0) or 0)
        total = int(usage.get("total_tokens", prompt + completion) or 0)
        self.state.model_usage["calls"] += 1
        self.state.model_usage["input_tokens"] += prompt
        self.state.model_usage["output_tokens"] += completion
        self.state.model_usage["total_tokens"] += total
        self.state.model_usage["models"] = sorted(
            set(self.state.model_usage.get("models", []) + [model])
        )
        self.state.model_usage.setdefault("request_details", []).append(
            {"model": model, "usage": usage}
        )
        self.logger.info(
            "usage calls=%d input_tokens=%d output_tokens=%d total_tokens=%d",
            self.state.model_usage["calls"],
            self.state.model_usage["input_tokens"],
            self.state.model_usage["output_tokens"],
            self.state.model_usage["total_tokens"],
        )

    def _update_legacy_progress(self, action, args, result):
        signature = json.dumps([action, args], sort_keys=True, default=str)
        fingerprint = hashlib.sha256(
            json.dumps(result, sort_keys=True, default=str).encode()
        ).hexdigest()
        previous = getattr(self, "_legacy_last_result", None)
        self.state.no_progress_turns = (
            self.state.no_progress_turns + 1
            if previous == (signature, fingerprint, self.state.workspace_revision)
            else 0
        )
        self._legacy_last_result = (
            signature,
            fingerprint,
            self.state.workspace_revision,
        )

    def _invoke(self, action, args):
        args = self._normalize_source_selectors(
            {k: v for k, v in args.items() if k != "_signature"}
        )
        if action == "list_sources":
            return self.tools.list_sources()
        if action in {
            "inspect_source",
            "search_source",
            "read_evidence",
            "extract_information",
        }:
            doc_id = self._document_id(args)
            if action == "inspect_source":
                return self.tools.inspect_source(doc_id, args.get("section_id"))
            if action == "search_source":
                return self.tools.search_source(
                    doc_id,
                    args.get("query", self.request.objective),
                    int(args.get("result_limit", 8)),
                )
            if action == "read_evidence":
                return self.tools.read_evidence(doc_id, int(args.get("page", 1)))
            task_data = dict(args.get("task") or {})
            task_data.setdefault("objective", self.request.objective)
            task_data.setdefault("question_ids", list(self.request.research_questions))
            task_data.setdefault("fields", [])
            task_data.setdefault("instructions", self.request.instructions)
            task_data.setdefault("coverage_scope", "sample")
            if not task_data.get("task_id"):
                stable = {k: v for k, v in task_data.items() if k != "task_id"}
                stable["document_id"] = doc_id
                task_data["task_id"] = (
                    f"extract_{hashlib.sha256(json.dumps(stable, sort_keys=True, default=str).encode()).hexdigest()[:16]}"
                )
            # Keep the outer contract permissive. Muse sometimes returns a
            # structured scope description; DI only needs the semantic scope
            # and the original task remains preserved in extraction_tasks.
            if isinstance(task_data.get("coverage_scope"), dict):
                scope_data = task_data["coverage_scope"]
                scope_text = " ".join(str(v) for v in scope_data.values())
                task_data["coverage_scope"] = (
                    "all"
                    if any(
                        x in scope_text.lower()
                        for x in ("full", "entire", "complete", "all")
                    )
                    else "sample"
                )
            task = ExtractionTask.model_validate(task_data)
            self.state.extraction_tasks.append(task.model_dump())
            self.logger.info(
                "extraction_task task_id=%s document_id=%s fields=%d coverage=%s max_pages=%s",
                task.task_id,
                doc_id,
                len(task.fields),
                task.coverage_scope,
                task.max_relevant_pages,
            )
            selectors = {
                key: args[key]
                for key in ("pages", "sections", "query")
                if args.get(key)
            }
            return self.tools.extract_information(
                doc_id,
                task.model_dump(),
                self._remaining_calls(),
                self._remaining_tokens(),
                selectors,
            )
        if action == "compare_findings":
            return self.tools.compare_evidence(
                args.get("finding_ids", []),
                self._evidence_records(args.get("artifact_ids")),
                args.get("comparison_dimensions"),
            )
        if action.startswith("workspace_"):
            if not self.workspace:
                raise RuntimeError("workspace is not initialized")
            if action == "workspace_list":
                return {
                    "artifacts": self.workspace.digest(
                        int(args.get("offset", 0)), int(args.get("limit", 50))
                    )
                }
            if action == "workspace_search":
                return {
                    "artifacts": self.workspace.search_summaries(
                        str(args.get("query", self.request.objective)),
                        int(args.get("limit", 10)),
                        int(args.get("offset", 0)),
                    )
                }
            if action == "workspace_get":
                return self.workspace.read_page(
                    str(args.get("artifact_id")),
                    args.get("version"),
                    args.get("record_key"),
                    args.get("record_id"),
                    int(args.get("offset", 0)),
                    int(args.get("limit", 20)),
                ) or {"status": "not_found"}
            artifact = self._annotate_artifact_references(
                dict(args.get("artifact") or {})
            )
            return self.workspace.upsert(artifact, args.get("artifact_id"))
        if action == "finish_investigation":
            self.state.final_artifact_ids = [
                str(x) for x in args.get("artifact_ids", []) if x
            ]
            self.state.summary = str(args.get("summary", ""))
            self.state.pending_questions = [
                str(x) for x in args.get("unanswered_questions", []) if x
            ]
            self.state.stated_limitations = [
                str(x) for x in args.get("limitations", []) if x
            ]
            return {"status": "finished", "artifact_ids": self.state.final_artifact_ids}
        if action == "synthesize_findings":
            context = {
                "objective": self.request.objective,
                "questions": self.state.pending_questions,
                "findings": [f.model_dump() for f in self.state.findings[-120:]],
                "workspace_memory": self.workspace.search_summaries(
                    self.request.objective, 12
                )
                if self.workspace
                else [],
                "existing_conclusions": [
                    c.model_dump() for c in self.state.conclusions[-30:]
                ],
                "conflicts": [c.model_dump() for c in self.state.conflicts],
                "calculations": self.state.calculations,
                "coverage": self.state.coverage,
            }
            instruction = "Return JSON with summary, conclusions, unanswered_questions, and gaps. Each conclusion must contain text, status (grounded or interpretation), and evidence_ids containing finding_id values. Consolidate duplicates, preserve distinct observations, explain relationships only when supported, and state uncertainty. Never invent facts or citations."
            resp = self.provider.complete(
                json.dumps(context, ensure_ascii=False),
                system_instruction=instruction,
                json_mode=True,
                reasoning_effort="medium",
            )
            self._usage(resp)
            return resp.parsed_json or {}
        if action == "calculate":
            ids = set(args.get("finding_ids", []))
            operation = args.get("operation", "mean")
            values = []
            selected_ids = []
            records = self._evidence_records(args.get("artifact_ids"))
            seen = set()
            for claim in records:
                claim_id = claim.get("claim_id", claim.get("finding_id"))
                if claim_id in seen:
                    continue
                seen.add(claim_id)
                if ids and claim_id not in ids:
                    continue
                field_name = args.get("field")
                value = (
                    claim.get("value", claim.get("fields"))
                    if isinstance(claim, dict)
                    else claim.value
                )
                if field_name and isinstance(value, dict):
                    value = value.get(field_name)
                if isinstance(value, dict):
                    value = value.get("value")
                if isinstance(value, (int, float)) and not isinstance(value, bool):
                    values.append(float(value))
                    selected_ids.append(claim_id)
            result = self.tools.deterministic_analysis(values, operation)
            result.update({"finding_ids": selected_ids, "field": args.get("field")})
            self.state.calculations.append(result)
            return result
        if action == "revise_plan":
            if isinstance(args.get("plan"), list):
                self.state.plan = [str(x) for x in args["plan"]]
            if isinstance(args.get("pending_questions"), list):
                self.state.pending_questions = [
                    str(x) for x in args["pending_questions"]
                ]
            return {
                "accepted": True,
                "plan": self.state.plan,
                "pending_questions": self.state.pending_questions,
            }
        if action == "assess_progress":
            return {"accepted": True, "arguments": args}
        raise ValueError(f"unsupported tool action: {action}")

    def _document_id(self, args: Dict[str, Any]) -> str:
        """Resolve a document without failing on harmless envelope omissions."""
        if args.get("document_id"):
            candidate = str(args["document_id"])
            if candidate in self.tools.adapter.docs:
                return candidate
            try:
                resolved = str(Path(candidate).resolve())
                for permitted in self.tools.adapter.permitted:
                    if resolved == permitted:
                        return self.tools.adapter._load(permitted).metadata.document_id
            except (OSError, ValueError):
                pass
            return candidate
        sources = self.tools.list_sources()
        available = [
            source.get("document_id") for source in sources if source.get("document_id")
        ]
        if len(available) == 1:
            self.logger.info(
                "document_id_inferred document_id=%s reason=single_available_source",
                available[0],
            )
            return available[0]
        if not available:
            raise ValueError("no available source document can satisfy this tool call")
        raise ValueError(
            f"document_id is required; available document IDs: {available}"
        )

    @staticmethod
    def _normalize_source_selectors(args):
        normalized = dict(args)
        if not normalized.get("pages"):
            page_numbers = normalized.get("page_numbers")
            if page_numbers is not None:
                normalized["pages"] = (
                    page_numbers if isinstance(page_numbers, list) else [page_numbers]
                )
            elif normalized.get("page") is not None:
                normalized["pages"] = [normalized["page"]]
        if not normalized.get("sections") and normalized.get("section_ids") is not None:
            section_ids = normalized["section_ids"]
            normalized["sections"] = (
                section_ids if isinstance(section_ids, list) else [section_ids]
            )
        return normalized

    def _evidence_records(self, artifact_ids=None):
        selected = set(str(x) for x in (artifact_ids or []))
        records = []
        seen = set()
        if selected and not self.workspace:
            raise ValueError("workspace artifacts are unavailable in this run")
        if self.workspace:
            manifest = {entry["artifact_id"] for entry in self.workspace.list()}
            missing = selected - manifest
            if missing:
                raise ValueError(f"unknown workspace artifact IDs: {sorted(missing)}")
            entries = [
                entry
                for entry in self.workspace.list()
                if (not selected or entry["artifact_id"] in selected)
            ]
            for entry in entries:
                artifact = self.workspace.get(entry["artifact_id"])
                content = (artifact or {}).get("content")
                raw_records = (
                    content.get("findings", content.get("records", []))
                    if isinstance(content, dict)
                    else []
                )
                if not isinstance(raw_records, list):
                    continue
                for raw in raw_records:
                    if not isinstance(raw, dict):
                        continue
                    fid = raw.get("finding_id", raw.get("claim_id", raw.get("id")))
                    if fid in seen:
                        continue
                    seen.add(fid)
                    records.append(
                        {**raw, "claim_id": fid, "_artifact_id": entry["artifact_id"]}
                    )
        if not selected:
            for claim in self.state.findings:
                if claim.claim_id in seen:
                    continue
                seen.add(claim.claim_id)
                records.append(claim.model_dump())
        return records

    def _annotate_artifact_references(self, artifact):
        """Warn on unverifiable references without constraining flexible content."""
        warnings = []
        source_map = {
            str(source.get("document_id")): source
            for source in self.tools.list_sources()
            if source.get("document_id")
        }
        for ref in (
            artifact.get("evidence", [])
            if isinstance(artifact.get("evidence"), list)
            else []
        ):
            if not isinstance(ref, dict):
                continue
            document_id = ref.get("document_id")
            if document_id:
                source = source_map.get(str(document_id))
                if not source:
                    warnings.append(f"unknown source document: {document_id}")
                elif ref.get("page") is not None:
                    try:
                        page = int(ref["page"])
                        if page < 1 or page > int(source.get("pages", 0)):
                            warnings.append(
                                f"page reference outside source: {document_id} p.{ref['page']}"
                            )
                    except (TypeError, ValueError):
                        warnings.append(
                            f"invalid page reference: {document_id} p.{ref['page']}"
                        )
            artifact_id = ref.get("artifact_id")
            if artifact_id:
                try:
                    target = (
                        self.workspace.get(str(artifact_id), ref.get("version"))
                        if self.workspace
                        else None
                    )
                except (TypeError, ValueError):
                    target = None
                if target is None:
                    warnings.append(
                        f"unknown workspace artifact reference: {artifact_id}"
                        + (
                            f"@{ref['version']}"
                            if ref.get("version") is not None
                            else ""
                        )
                    )
        if warnings:
            metadata = dict(artifact.get("metadata") or {})
            existing = metadata.get("reference_warnings", [])
            if not isinstance(existing, list):
                existing = [str(existing)]
            metadata["reference_warnings"] = sorted(set(existing + warnings))
            artifact["metadata"] = metadata
        return artifact

    def _absorb(self, action, result, args):
        if action == "list_sources":
            for i, source in enumerate(result):
                existing = self.state.source_documents.setdefault(str(i), {})
                existing.update(
                    {
                        k: v
                        for k, v in source.items()
                        if k != "path" or "path" not in existing
                    }
                )
        if action == "extract_information" and isinstance(result, dict):
            nested_calls = int(result.get("model_calls", 0))
            nested_trace = result.get("trace", [])
            nested_input = sum(
                int(item.get("prompt_tokens", 0) or 0) for item in nested_trace
            )
            nested_output = sum(
                int(item.get("completion_tokens", 0) or 0) for item in nested_trace
            )
            nested_tokens = int(result.get("tokens", 0) or nested_input + nested_output)
            self.state.model_usage["calls"] += nested_calls
            self.state.model_usage["nested_calls"] = (
                self.state.model_usage.get("nested_calls", 0) + nested_calls
            )
            self.state.model_usage["nested_tokens"] = (
                self.state.model_usage.get("nested_tokens", 0) + nested_tokens
            )
            self.state.model_usage["input_tokens"] += nested_input
            self.state.model_usage["output_tokens"] += nested_output
            self.state.model_usage["total_tokens"] += nested_tokens
            nested_details = []
            for item in nested_trace:
                action = str(item.get("action", ""))
                is_model_attempt = bool(item.get("model_name")) or any(
                    marker in action.lower()
                    for marker in ("model call", "extract records", "repair")
                )
                if not is_model_attempt:
                    continue
                prompt_tokens = int(item.get("prompt_tokens", 0) or 0)
                completion_tokens = int(item.get("completion_tokens", 0) or 0)
                nested_details.append(
                    {
                        "model": item.get("model_name") or META_MODEL,
                        "phase": "document_intelligence",
                        "stage": item.get("stage"),
                        "action": action,
                        "usage": {
                            "prompt_tokens": prompt_tokens,
                            "completion_tokens": completion_tokens,
                            "total_tokens": prompt_tokens + completion_tokens,
                        },
                        "success": item.get("success"),
                        "error": item.get("error_message"),
                    }
                )
            while len(nested_details) < nested_calls:
                nested_details.append(
                    {
                        "model": META_MODEL,
                        "phase": "document_intelligence",
                        "usage": {
                            "prompt_tokens": None,
                            "completion_tokens": None,
                            "total_tokens": None,
                        },
                        "usage_status": "not_returned_for_attempt",
                    }
                )
            self.state.model_usage.setdefault("request_details", []).extend(
                nested_details[:nested_calls]
            )
            known_models = {
                detail["model"]
                for detail in nested_details[:nested_calls]
                if detail.get("model")
            }
            self.state.model_usage["models"] = sorted(
                set(self.state.model_usage.get("models", [])) | known_models
            )
            self._merge_coverage(
                result.get("document_id", ""), result.get("coverage", {})
            )
            self.state.evidence_version += 1
            task_id = str(args.get("task", {}).get("task_id", "extraction"))
            document_id = str(result.get("document_id", "unknown_document"))
            # DI-local finding IDs restart for each extraction. Qualify them at
            # the harness boundary so workspace comparisons never collapse
            # unrelated records from distinct documents/tasks.
            qualified_findings = []
            for raw_finding in result.get("findings", []):
                if not isinstance(raw_finding, dict):
                    continue
                finding = dict(raw_finding)
                source_finding_id = str(
                    finding.get("source_finding_id")
                    or finding.get("finding_id")
                    or f"finding_{len(qualified_findings) + 1}"
                )
                qualifier = f"{document_id}:{task_id}:"
                if not source_finding_id.startswith(qualifier):
                    finding["source_finding_id"] = source_finding_id
                    finding["finding_id"] = qualifier + source_finding_id
                qualified_findings.append(finding)
            result["findings"] = qualified_findings
            if self.workspace:
                artifact_id = self._evidence_artifact_id(
                    task_id, result.get("document_id")
                )
                evidence_refs = []
                seen_refs = set()
                reference_warnings = []
                source_map = {
                    s.get("document_id"): s
                    for s in self.tools.list_sources()
                    if s.get("document_id")
                }
                for finding in result.get("findings", []):
                    for field in (finding.get("fields") or {}).values():
                        if not isinstance(field, dict):
                            continue
                        ev = field.get("evidence") or {}
                        page = ev.get("pdf_page_number") or ev.get("page_number")
                        if not page:
                            continue
                        ref = {
                            "finding_id": finding.get("finding_id"),
                            "document_id": result.get("document_id"),
                            "page": page,
                            "printed_page_number": ev.get("printed_page_number"),
                            "table_id": ev.get("table_id"),
                            "section": ev.get("section_title"),
                            "snippet": ev.get("source_text", ""),
                        }
                        ref_key = (
                            ref["document_id"],
                            int(page),
                            ref["table_id"],
                            ref["finding_id"],
                        )
                        if ref_key in seen_refs:
                            continue
                        seen_refs.add(ref_key)
                        evidence_refs.append(ref)
                        source = source_map.get(ref["document_id"])
                        if not source:
                            reference_warnings.append(
                                f"unknown source document: {ref['document_id']}"
                            )
                        else:
                            try:
                                if int(page) < 1 or int(page) > int(
                                    source.get("pages", 0)
                                ):
                                    reference_warnings.append(
                                        f"page reference outside source: {ref['document_id']} p.{page}"
                                    )
                            except (TypeError, ValueError):
                                reference_warnings.append(
                                    f"invalid page reference: {ref['document_id']} p.{page}"
                                )
                metadata = {
                    "document_id": result.get("document_id"),
                    "model_calls": result.get("model_calls", 0),
                    "tokens": result.get("tokens", 0),
                }
                if args.get("_harness_tool_call_id"):
                    metadata["_harness_tool_call_id"] = (
                        f"{self._run_id}:{args['_harness_tool_call_id']}"
                    )
                if reference_warnings:
                    metadata["reference_warnings"] = sorted(set(reference_warnings))
                existing = self.workspace.get(artifact_id)
                if result.get("_harness_persisted") and existing:
                    artifact = existing
                else:
                    artifact = self.workspace.upsert(
                        {
                            "artifact_id": artifact_id,
                            "type": "evidence",
                            "format": "json",
                            "title": f"Evidence extraction: {task_id}",
                            "content": {
                                "findings": result.get("findings", []),
                                "review_queue": result.get("review_queue", []),
                                "coverage": result.get("coverage", {}),
                                "trace": result.get("trace", []),
                            },
                            "evidence": evidence_refs,
                            "metadata": metadata,
                        }
                    )
                self.state.recent_observations.append(
                    {
                        "action": action,
                        "artifact_id": artifact["artifact_id"],
                        "version": artifact["version"],
                        "summary": f"Stored {len(result.get('findings', []))} extracted findings in workspace",
                    }
                )
                if result.get("findings"):
                    self.state.completed_tasks.append(task_id)
                # Keep normalized claims available to calculations/comparisons;
                # the full extraction remains in the workspace artifact.
            for raw in result.get("findings", []):
                fid = raw.get("finding_id", f"finding_{len(self.state.findings) + 1}")
                evidence = []
                statuses = []
                for field in raw.get("fields", {}).values():
                    statuses.append(str(field.get("status", "extracted")))
                    ev = field.get("evidence") or {}
                    page = ev.get("pdf_page_number") or ev.get("page_number")
                    if page:
                        evidence.append(
                            EvidenceRef(
                                finding_id=fid,
                                document_id=result.get("document_id", ""),
                                page=page,
                                table_id=ev.get("table_id"),
                                section=ev.get("section_title"),
                                snippet=ev.get("source_text", ""),
                            )
                        )
                unique_evidence = []
                seen_evidence = set()
                for ref in evidence:
                    source_key = (
                        ref.document_id,
                        ref.page,
                        ref.table_id,
                        ref.section,
                        ref.snippet,
                    )
                    if source_key not in seen_evidence:
                        seen_evidence.add(source_key)
                        unique_evidence.append(ref)
                evidence = unique_evidence
                status = (
                    "grounded"
                    if statuses
                    and all(s in {"grounded", "human_verified"} for s in statuses)
                    else (
                        "needs_review"
                        if any(s in {"ambiguous", "needs_review"} for s in statuses)
                        else "extracted"
                    )
                )
                claim = Claim(
                    claim_id=fid,
                    text=json.dumps(
                        {k: v.get("value") for k, v in raw.get("fields", {}).items()},
                        ensure_ascii=False,
                    ),
                    value=raw.get("fields"),
                    status=status,
                    evidence=evidence,
                    notes=raw.get("review_reason"),
                )
                duplicate = next(
                    (
                        existing
                        for existing in self.state.findings
                        if existing.text == claim.text
                        and existing.status == claim.status
                    ),
                    None,
                )
                if duplicate:
                    known = {
                        (e.document_id, e.page, e.table_id, e.section, e.snippet)
                        for e in duplicate.evidence
                    }
                    duplicate.evidence.extend(
                        e
                        for e in evidence
                        if (e.document_id, e.page, e.table_id, e.section, e.snippet)
                        not in known
                    )
                else:
                    self.state.findings.append(claim)
                self.state.evidence.extend(evidence)
            if not result.get("findings"):
                self.state.issues.append(
                    "Document Intelligence returned no findings for extraction task"
                )
        if action == "compare_findings":
            for c in result.get("conflicts", []):
                self.state.conflicts.append(
                    Conflict(
                        conflict_id=f"conflict_{len(self.state.conflicts) + 1}",
                        description=json.dumps(c, sort_keys=True),
                        claim_ids=result.get("finding_ids", []),
                    )
                )
        if action == "synthesize_findings" and isinstance(result, dict):
            self.state.summary = str(result.get("summary") or self.state.summary)
            self.state.pending_questions = [
                str(x) for x in result.get("unanswered_questions", []) if x
            ]
            for raw in result.get("conclusions", []):
                if not isinstance(raw, dict) or not raw.get("text"):
                    continue
                ids = set(raw.get("evidence_ids", []))
                refs = [
                    e
                    for f in self.state.findings
                    if f.claim_id in ids
                    for e in f.evidence
                ]
                status = str(raw.get("status", "interpretation"))
                status = (
                    status
                    if status in {"grounded", "interpretation", "unresolved"}
                    else "interpretation"
                )
                self.state.conclusions.append(
                    Claim(
                        claim_id=f"conclusion_{len(self.state.conclusions) + 1}",
                        text=str(raw["text"]),
                        status=status,
                        evidence=refs,
                        notes=str(raw.get("notes")) if raw.get("notes") else None,
                    )
                )
            self.state.issues.extend(str(x) for x in result.get("gaps", []) if x)

    def _completion_status(self, args):
        adequate = (
            bool(self.state.conclusions)
            and not self.state.conflicts
            and not self.state.pending_questions
        )
        return "completed" if adequate else "partial"

    def _merge_coverage(self, document_id: str, incoming: Dict[str, Any]) -> None:
        """Accumulate candidate, processed, and skipped pages across tasks."""
        if not document_id:
            return
        current = self.state.coverage.setdefault(document_id, {})
        for key in ("candidate_pages", "processed_pages"):
            current[key] = sorted(
                {
                    int(v)
                    for v in list(current.get(key, [])) + list(incoming.get(key, []))
                }
            )
        skipped = dict(current.get("skipped_pages", {}))
        skipped.update(incoming.get("skipped_pages", {}))
        current["skipped_pages"] = skipped
        for key in ("total_pages", "scope_requested"):
            if key in incoming:
                current[key] = incoming[key]
        current["candidate_sections"] = sorted(
            set(current.get("candidate_sections", []))
            | set(incoming.get("candidate_sections", []))
        )
        current["status"] = (
            "complete"
            if incoming.get("status") == "complete" and not skipped
            else "partial"
        )

    def _envelope(self, action, result):
        return ToolResult(
            status="success" if result else "empty",
            summary=f"{action} completed",
            payload=result,
            evidence_ids=[e.finding_id or "" for e in self.state.evidence[-10:]],
        )

    def _usage(self, resp):
        if (
            resp.model_name
            and resp.model_name != "mock-model-v1"
            and resp.model_name != META_MODEL
        ):
            raise ValueError(
                f"Research Engine requires {META_MODEL}; provider returned {resp.model_name!r}"
            )
        self.state.model_usage["calls"] += 1
        self.state.model_usage["input_tokens"] += resp.prompt_tokens
        self.state.model_usage["output_tokens"] += resp.completion_tokens
        self.state.model_usage["total_tokens"] += resp.total_tokens
        self.state.model_usage["models"] = sorted(
            set(self.state.model_usage.get("models", []) + [resp.model_name])
        )
        self.logger.info(
            "usage calls=%d input_tokens=%d output_tokens=%d total_tokens=%d",
            self.state.model_usage["calls"],
            self.state.model_usage["input_tokens"],
            self.state.model_usage["output_tokens"],
            self.state.model_usage["total_tokens"],
        )

    def _remaining_calls(self):
        return (
            max(
                0, self.request.budget.max_model_calls - self.state.model_usage["calls"]
            )
            if self.request.budget.max_model_calls is not None
            else None
        )

    def _remaining_tokens(self):
        return (
            max(
                0,
                self.request.budget.max_total_tokens
                - self.state.model_usage["total_tokens"],
            )
            if self.request.budget.max_total_tokens is not None
            else None
        )

    def _budget_exhausted(self):
        return (
            self.request.budget.max_model_calls is not None
            and self.state.model_usage["calls"] >= self.request.budget.max_model_calls
        ) or (
            self.request.budget.max_total_tokens is not None
            and self.state.model_usage["total_tokens"]
            >= self.request.budget.max_total_tokens
        )

    def _apply_output_token_limit(self):
        configured = self.request.budget.max_output_tokens
        if self.request.budget.max_total_tokens is not None:
            remaining = max(
                0,
                self.request.budget.max_total_tokens
                - self.state.model_usage["total_tokens"],
            )
            configured = remaining if configured is None else min(configured, remaining)
        setter = getattr(self.provider, "set_max_output_tokens", None)
        if configured is not None and setter:
            setter(configured)

    def _event(
        self, action, tool, reason, status="success", latency=0.0, arguments=None
    ):
        self.state.trace.append(
            TraceEvent(
                sequence=len(self.state.trace) + 1,
                action=action,
                tool=tool,
                arguments=arguments or {},
                reason=reason,
                result_status=status,
                latency_seconds=round(latency, 4),
            )
        )

    def _provider(self):
        cfg = MuseConfig.from_env()
        cfg.validate()
        return build_transport(cfg, self.request.budget)

    def _result(self):
        defaults = {
            "completed": "Evidence-backed investigation completed.",
            "completed_with_limitations": "Investigation completed with stated limitations.",
            "stalled": "Investigation stalled before Muse declared completion.",
            "ceiling_reached": "Investigation stopped at an explicitly configured execution ceiling.",
            "cancelled": "Investigation was cancelled before completion.",
            "failed": "Investigation failed before completion.",
            "partial": "Investigation stopped with partial results.",
        }
        default_summary = defaults.get(self.state.status, "No findings were produced.")
        return ResearchResult(
            research_id=self.request.research_id,
            status=self.state.status,
            objective=self.request.objective,
            summary=self.state.summary or default_summary,
            key_findings=self.state.findings,
            conclusions=self.state.conclusions,
            evidence=self.state.evidence,
            contradictions=self.state.conflicts,
            limitations=self.state.issues + self.state.stated_limitations,
            unanswered_questions=self.state.pending_questions,
            source_coverage=self.state.coverage,
            model_usage=self.state.model_usage,
            execution_trace=self.state.trace,
            research_plan=self.state.plan,
            issues=self.state.issues,
            coverage=self.state.coverage,
            calculations=self.state.calculations,
            extraction_tasks=self.state.extraction_tasks,
            workspace_path=self.state.workspace_path,
            final_artifact_ids=self.state.final_artifact_ids,
        )


def mock_orchestrator(request, response_sequence):
    iterator = iter(response_sequence)
    provider = MockModelProvider(custom_handler=lambda _: next(iterator))
    return ResearchOrchestrator(request, provider)
