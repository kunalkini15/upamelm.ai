from __future__ import annotations

import json
import os
import time
import uuid
from pathlib import Path
from typing import Any
import httpx
import logging
import threading

from .models import CallUsage

MODEL = "muse-spark-1.3-contributor"
BASE_URL = "https://api.meta.ai/v1"
ALLOWED_MODELS = {MODEL, "muse-spark-1.3", "muse-wonder-1.0"}


def tool_definitions() -> list[dict[str, Any]]:
    def fn(name: str, description: str, properties: dict[str, Any], required: list[str] | None = None) -> dict[str, Any]:
        parameters = {"type": "object", "properties": properties, "additionalProperties": True}
        if required:
            parameters["required"] = required
        tool = {"type": "function", "name": name, "description": description, "parameters": parameters}
        return tool
    selectors = {"type": "object", "properties": {"document_id": {"type": "string"}, "pages": {"type": "array", "items": {"type": "integer"}}, "sections": {"type": "array", "items": {"type": "string"}}, "query": {"type": "string"}, "tables": {"type": "array", "items": {"type": "string"}}}}
    page_target = {"type": "object", "properties": {"document_id": {"type": "string"}, "pages": {"type": "array", "items": {"type": "integer"}}, "reason": {"type": "string"}, "expected_information": {"type": "string"}, "covered_outcomes": {"type": "array", "items": {"type": "string"}}, "evidence_requirements": {"type": "array", "items": {"type": "string"}}, "required_modalities": {"type": "array", "items": {"type": "string"}}, "downstream_uses": {"type": "array", "items": {"type": "string"}}, "completion_criteria": {"type": "array", "items": {"type": "string"}}, "structural_hints": {"type": "array", "items": {"type": "string"}}, "status": {"type": "string", "enum": ["required", "conditional"]}}, "required": ["document_id", "pages", "reason", "expected_information", "status"], "additionalProperties": True}
    return [
        fn("inspect_atlas", "Inspect document metadata and a bounded Atlas section subtree. Use this before reconnaissance.", {"document_id": {"type": "string"}, "section_id": {"type": "string"}, "depth": {"type": "integer"}}),
        fn("search_atlas", "Search Atlas for sections/pages relevant to a planning question.", {"document_id": {"type": "string"}, "query": {"type": "string"}, "result_limit": {"type": "integer"}, "expand_section": {"type": "boolean"}}),
        fn("request_reconnaissance", "Ask Document Intelligence for focused planning reconnaissance. Must include bounded selectors and a justification.", {"document_id": {"type": "string"}, "planning_question": {"type": "string"}, "justification": {"type": "string"}, "expected_plan_effect": {"type": "string"}, "selectors": {"type": "object"}, "requested_information": {"type": "array"}}),
        fn("read_planning_artifact", "Read a prior planning artifact or version.", {"artifact_id": {"type": "string"}, "version": {"type": "integer"}}),
        fn("search_planning_memory", "Search prior planning observations and artifacts.", {"query": {"type": "string"}, "limit": {"type": "integer"}}),
        fn("read_tool_observation", "Read the complete persisted result of an earlier planning tool call when the compact context is insufficient.", {"step": {"type": "integer"}, "tool_name": {"type": "string"}}),
        fn("revise_plan", "Persist the single objective-wide Atlas page-selection plan. Select physical PDF pages supported by Atlas evidence as materially contributing to the objective; do not select a whole section solely by title. Deduplicate pages, use required for directly supported evidence and conditional for uncertain or supporting evidence, map targets to requested outcomes when useful, and briefly explain why each target is needed. Do not create research questions, extraction tasks, fields, or domain-specific schemas.", {"document_understanding": {"type": "object"}, "page_targets": {"type": "array", "items": page_target}, "uncertainties": {"type": "array"}, "notes": {"type": "string"}}, ["document_understanding", "page_targets", "uncertainties", "notes"]),
        fn("complete_planning", "Complete planning only when the latest plan is actionable and uncertainties are explicit.", {"plan_artifact_id": {"type": "string"}, "plan_version": {"type": "integer"}, "limitations": {"type": "array"}}),
    ]


def synthesis_tool_definitions() -> list[dict[str, Any]]:
    return [{"type": "function", "name": "write_synthesis", "description": "Write the whole-objective evidence-grounded research synthesis.", "strict": True, "parameters": {"type": "object", "properties": {"content": {"type": "string"}, "findings": {"type": "array", "items": {"type": "string"}}, "evidence": {"type": "array", "items": {"type": "string"}}, "unresolved_questions": {"type": "array", "items": {"type": "string"}}, "limitations": {"type": "array", "items": {"type": "string"}}}, "required": ["content", "findings", "evidence", "unresolved_questions", "limitations"], "additionalProperties": False}}]


class MuseResponse:
    def __init__(self, call_id: str, raw: dict[str, Any], usage: CallUsage, events: list[dict[str, Any]]):
        self.call_id, self.raw, self.usage, self.events = call_id, raw, usage, events

    @property
    def function_calls(self) -> list[dict[str, Any]]:
        return [x for x in self.raw.get("output", []) if x.get("type") == "function_call"]

    @property
    def json_content(self) -> Any | None:
        """Return the JSON structured-output content from a Responses result."""
        for item in reversed(self.raw.get("output", [])):
            if item.get("type") != "message":
                continue
            for content in reversed(item.get("content", [])):
                if content.get("type") in {"output_text", "text"}:
                    value = content.get("text") or content.get("value")
                    if value is not None:
                        return json.loads(value)
        return None


class ResponsesTransport:
    def __init__(self, capture_root: Path, api_key: str | None = None, timeout: float | None = None, max_output_tokens: int | None = None):
        self.api_key = api_key or os.environ.get("MODEL_API_KEY", "")
        self.base_url = os.environ.get("META_BASE_URL", BASE_URL).rstrip("/")
        self.model = os.environ.get("META_MODEL", MODEL)
        self.timeout = timeout or float(os.environ.get("MUSE_TIMEOUT_SECONDS", "180"))
        self.max_output_tokens = max_output_tokens
        if self.model not in ALLOWED_MODELS or self.base_url != BASE_URL:
            raise ValueError(f"V2 requires an allowed Muse model at {BASE_URL}")
        self.capture_root = capture_root
        self.capture_root.mkdir(parents=True, exist_ok=True)
        self.previous_response_id: str | None = None
        self.usage_records: list[dict[str, Any]] = []
        self._usage_lock = threading.Lock()

    def call(self, instructions: str, input_text: str, tools: list[dict[str, Any]], replay_items: list[dict[str, Any]] | None = None, parent_call_id: str | None = None, phase: str = "orchestration", timeout: float | None = None, reasoning_effort: str | None = None, parallel_tool_calls: bool = False, prompt_cache_key: str | None = None, response_format: dict[str, Any] | None = None, input_content: list[dict[str, Any]] | None = None, max_output_tokens: int | None = None, model: str | None = None) -> MuseResponse:
        if not self.api_key:
            raise ValueError("MODEL_API_KEY is required")
        call_id = f"call_{uuid.uuid4().hex}"
        call_dir = self.capture_root / call_id
        call_dir.mkdir(parents=True, exist_ok=False)
        selected_model = model or self.model
        if selected_model not in ALLOWED_MODELS:
            raise ValueError(f"unsupported Muse model: {selected_model}")
        payload: dict[str, Any] = {"model": selected_model, "instructions": instructions, "input": input_text, "tools": tools, "tool_choice": "auto", "parallel_tool_calls": parallel_tool_calls, "reasoning": {"effort": reasoning_effort or os.environ.get("MUSE_REASONING_EFFORT", "high")}, "store": False, "stream": True, "include": ["reasoning.encrypted_content"]}
        if prompt_cache_key:
            payload["prompt_cache_key"] = prompt_cache_key
        if response_format:
            payload["text"] = {"format": response_format}
        if max_output_tokens is not None or self.max_output_tokens is not None:
            payload["max_output_tokens"] = max_output_tokens or self.max_output_tokens
        if input_content:
            payload["input"] = [{"role": "user", "content": input_content}]
        if replay_items:
            payload["input"] = replay_items + [{"role": "user", "content": [{"type": "input_text", "text": input_text}]}]
        captured_payload = json.loads(json.dumps(payload, ensure_ascii=False, default=str))
        for message in captured_payload.get("input", []) if isinstance(captured_payload.get("input"), list) else []:
            for content in message.get("content", []) if isinstance(message, dict) else []:
                if isinstance(content, dict) and content.get("type") == "input_image" and isinstance(content.get("image_url"), str) and content["image_url"].startswith("data:"):
                    content["image_url"] = {"redacted": True, "mime_type": content["image_url"].split(";", 1)[0].removeprefix("data:"), "note": "inline image bytes omitted from request artifact"}
        request_record = {"call_id": call_id, "parent_call_id": parent_call_id, "phase": phase, "model": selected_model, "endpoint": f"{self.base_url}/responses", "payload": captured_payload}
        (call_dir / "request.json").write_text(json.dumps(request_record, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
        events: list[dict[str, Any]] = []
        started = time.perf_counter()
        request_timeout = timeout or self.timeout
        wall_timeout = float(os.environ.get("MUSE_WALL_TIMEOUT_SECONDS", request_timeout))
        deadline = started + wall_timeout
        try:
            headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
            with httpx.Client(timeout=request_timeout) as client, client.stream("POST", f"{self.base_url}/responses", headers=headers, json=payload) as response:
                if response.is_error:
                    body = response.read().decode("utf-8", errors="replace")[:10000]
                    error = httpx.HTTPStatusError(f"Client error {response.status_code} for {response.request.url}", request=response.request, response=response)
                    error._research_response_body = body
                    raise error
                with (call_dir / "stream.ndjson").open("w", encoding="utf-8") as stream_file:
                    for line in response.iter_lines():
                        # httpx's read timeout is reset by keepalives. Enforce a
                        # separate wall-clock deadline so a stream that emits
                        # keepalives but never completes cannot hang forever.
                        if time.perf_counter() >= deadline:
                            raise TimeoutError(f"Muse response exceeded wall-clock timeout of {wall_timeout:.1f}s")
                        if not line or not line.startswith("data:"):
                            continue
                        raw = line[5:].strip()
                        if raw == "[DONE]":
                            continue
                        event = json.loads(raw)
                        events.append(event)
                        stream_file.write(json.dumps(event, ensure_ascii=False) + "\n")
                        stream_file.flush()
            raw = self._final_response(events)
        except Exception as exc:
            error = {"call_id": call_id, "error": str(exc), "duration_seconds": time.perf_counter() - started, "events": events}
            partial_arguments = "".join(event.get("delta", "") for event in events if event.get("type") == "response.function_call_arguments.delta")
            if partial_arguments:
                (call_dir / "partial_output.json").write_text(json.dumps({"call_id": call_id, "argument_chars": len(partial_arguments), "arguments": partial_arguments}, ensure_ascii=False), encoding="utf-8")
                exc._research_partial_arguments = partial_arguments
                exc._research_partial_function = next((event.get("item", {}).get("name") for event in reversed(events) if event.get("type") == "response.output_item.done" and event.get("item", {}).get("type") == "function_call"), None)
                exc._research_call_dir = str(call_dir)
            if isinstance(exc, httpx.HTTPStatusError):
                error["http_status"] = exc.response.status_code
                try:
                    error["response_body"] = getattr(exc, "_research_response_body", exc.response.text[:10000])
                except Exception as body_exc:
                    error["response_body_error"] = str(body_exc)
            (call_dir / "error.json").write_text(json.dumps(error, indent=2, default=str), encoding="utf-8")
            raise
        usage_raw = raw.get("usage") or {}
        details = usage_raw.get("input_tokens_details") or {}
        usage = CallUsage(input_tokens=int(usage_raw.get("input_tokens", 0) or 0), cached_input_tokens=int(details.get("cached_tokens", 0) or 0), output_tokens=int(usage_raw.get("output_tokens", 0) or 0), total_tokens=int(usage_raw.get("total_tokens", 0) or 0))
        image_count = sum(1 for message in payload.get("input", []) if isinstance(message, dict) for content in message.get("content", []) if isinstance(content, dict) and content.get("type") == "input_image") if isinstance(payload.get("input"), list) else 0
        with self._usage_lock:
            self.usage_records.append({"call_id": call_id, "phase": phase, "model": selected_model, "input_chars": len(json.dumps(payload.get("input"), ensure_ascii=False, default=str)), "image_count": image_count, "visual_request": image_count > 0, "duration_seconds": round(time.perf_counter() - started, 4), **usage.model_dump()})
        logging.getLogger("research_engine_v2").info("model_response call_id=%s phase=%s model=%s input_tokens=%d output_tokens=%d total_tokens=%d input_chars=%d", call_id, phase, self.model, usage.input_tokens, usage.output_tokens, usage.total_tokens, len(json.dumps(payload.get("input"), ensure_ascii=False, default=str)))
        (call_dir / "response.json").write_text(json.dumps({"call_id": call_id, "duration_seconds": time.perf_counter() - started, "response": raw}, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
        (call_dir / "usage.json").write_text(usage.model_dump_json(indent=2), encoding="utf-8")
        return MuseResponse(call_id, raw, usage, events)

    @staticmethod
    def _final_response(events: list[dict[str, Any]]) -> dict[str, Any]:
        completed = next((e.get("response") for e in reversed(events) if e.get("type") == "response.completed"), None)
        if completed:
            return completed
        failed = next((e.get("response") for e in reversed(events) if e.get("type") == "response.failed"), None)
        if failed:
            raise RuntimeError(json.dumps(failed))
        incomplete = next((e.get("response") for e in reversed(events) if e.get("type") == "response.incomplete"), None)
        if incomplete:
            reason = (incomplete.get("incomplete_details") or {}).get("reason", "unknown")
            raise RuntimeError(f"Muse response incomplete: {reason}")
        raise RuntimeError("Responses stream ended without response.completed")
