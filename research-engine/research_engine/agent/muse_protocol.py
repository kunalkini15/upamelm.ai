"""Research Engine's native Muse Chat Completions transport and tool registry."""

from __future__ import annotations

import json
import logging
import time
from typing import Any

import httpx

from ..config import META_BASE_URL, META_MODEL


# The registry is the single source of truth for the model-visible tool names
# and their argument surfaces. Handlers remain in ResearchOrchestrator.
TOOL_DEFINITIONS = [
    (
        "list_sources",
        "Refresh the configured document catalog only if availability may have changed. The initial catalog is already provided.",
        {},
    ),
    (
        "inspect_source",
        "Inspect document metadata and Atlas section hierarchy; optionally retrieve a complete section subtree.",
        {"document_id": {"type": "string"}, "section_id": {"type": "string"}},
    ),
    (
        "search_source",
        "Search a document with its Atlas and return ranked pages.",
        {
            "document_id": {"type": "string"},
            "query": {"type": "string"},
            "result_limit": {"type": "integer"},
        },
    ),
    (
        "read_evidence",
        "Read a physical page and its tables.",
        {"document_id": {"type": "string"}, "page": {"type": "integer"}},
    ),
    (
        "extract_information",
        "Ask Document Intelligence to extract evidence from a document. Optional pages, sections, and query target the extraction scope.",
        {
            "document_id": {"type": "string"},
            "task": {"type": "object"},
            "pages": {"type": "array", "items": {"type": "integer"}},
            "sections": {"type": "array", "items": {"type": "string"}},
            "query": {"type": "string"},
        },
    ),
    (
        "read_workspace",
        "Read an existing workspace artifact or page through one of its record lists.",
        {
            "artifact_id": {"type": "string"},
            "version": {"type": "integer"},
            "record_key": {"type": "string"},
            "record_id": {"type": "string"},
            "offset": {"type": "integer"},
            "limit": {"type": "integer"},
        },
    ),
    (
        "search_workspace",
        "Search workspace memory and evidence artifacts.",
        {
            "query": {"type": "string"},
            "limit": {"type": "integer"},
            "offset": {"type": "integer"},
        },
    ),
    (
        "list_workspace",
        "Page through existing workspace artifacts when prior research memory needs discovery. An empty workspace is reported in the initial context; do not list it just to inspect an empty workspace.",
        {"limit": {"type": "integer"}, "offset": {"type": "integer"}},
    ),
    (
        "write_artifact",
        "Create a new version of a flexible research artifact.",
        {
            "artifact_id": {"type": "string"},
            "type": {"type": "string"},
            "format": {"type": "string"},
            "title": {"type": "string"},
            "content": {},
            "evidence": {"type": "array"},
            "metadata": {"type": "object"},
            "relationships": {"type": "array"},
        },
    ),
    (
        "compare_findings",
        "Compare selected evidence records without deciding scientific contradiction.",
        {
            "finding_ids": {"type": "array", "items": {"type": "string"}},
            "artifact_ids": {"type": "array", "items": {"type": "string"}},
            "comparison_dimensions": {"type": "array", "items": {"type": "string"}},
        },
    ),
    (
        "calculate",
        "Calculate a deterministic summary from selected numeric evidence.",
        {
            "finding_ids": {"type": "array", "items": {"type": "string"}},
            "artifact_ids": {"type": "array", "items": {"type": "string"}},
            "operation": {"type": "string"},
            "field": {"type": "string"},
        },
    ),
    (
        "revise_plan",
        "Record a revised research plan or questions.",
        {"plan": {"type": "array"}, "pending_questions": {"type": "array"}},
    ),
    (
        "assess_progress",
        "Record a progress assessment and next-step rationale.",
        {"summary": {"type": "string"}, "pending_questions": {"type": "array"}},
    ),
    (
        "finish_investigation",
        "Finish the investigation and identify final artifact IDs, summary, unanswered questions, and limitations.",
        {
            "summary": {"type": "string"},
            "artifact_ids": {"type": "array", "items": {"type": "string"}},
            "unanswered_questions": {"type": "array", "items": {"type": "string"}},
            "limitations": {"type": "array", "items": {"type": "string"}},
        },
    ),
]

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": name,
            "description": desc,
            "parameters": {
                "type": "object",
                "properties": properties,
                "additionalProperties": True,
            },
        },
    }
    for name, desc, properties in TOOL_DEFINITIONS
]


class MuseProtocolError(RuntimeError):
    pass


class MuseChatTransport:
    """Native function-call transport; also implements DI's simple completion API."""

    def __init__(
        self,
        api_key: str,
        base_url: str = META_BASE_URL,
        model: str = META_MODEL,
        timeout: float = 60,
        max_output_tokens: int | None = None,
        stream: bool = True,
        reasoning_effort: str = "medium",
    ):
        if model != META_MODEL or base_url.rstrip("/") != META_BASE_URL:
            raise ValueError(
                f"Research Engine requires {META_MODEL} at {META_BASE_URL}"
            )
        self.api_key, self.base_url, self.model = api_key, base_url.rstrip("/"), model
        self.timeout, self.max_output_tokens = timeout, max_output_tokens
        self.stream, self.reasoning_effort = stream, reasoning_effort
        self._simple = None

    @property
    def provider_name(self):
        return f"muse_spark:{self.model}"

    @property
    def supports_native_tool_calls(self):
        return True

    def set_max_output_tokens(self, limit: int | None):
        self.max_output_tokens = limit
        if self._simple is not None:
            self._simple.max_output_tokens = limit

    def complete_agent(
        self, messages: list[dict[str, Any]], tools: list[dict[str, Any]] | None = None
    ):
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "reasoning_effort": self.reasoning_effort,
            "stream": self.stream,
        }
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"
        if self.stream:
            payload["stream_options"] = {"include_usage": True}
        if self.max_output_tokens is not None:
            payload["max_completion_tokens"] = self.max_output_tokens
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        started = time.perf_counter()
        attempts = 0
        while True:
            attempts += 1
            try:
                with httpx.Client(timeout=self.timeout) as client:
                    if self.stream:
                        with client.stream(
                            "POST",
                            f"{self.base_url}/chat/completions",
                            headers=headers,
                            json=payload,
                        ) as response:
                            response.raise_for_status()
                            data = self._consume_stream(response)
                    else:
                        response = client.post(
                            f"{self.base_url}/chat/completions",
                            headers=headers,
                            json=payload,
                        )
                        response.raise_for_status()
                        data = response.json()
                break
            except httpx.HTTPStatusError as exc:
                retryable = (
                    exc.response.status_code in {408, 429}
                    or exc.response.status_code >= 500
                )
                if not retryable or attempts >= 3:
                    raise
                logging.getLogger("research_engine").warning(
                    "model_transport_retry attempt=%d status=%d",
                    attempts,
                    exc.response.status_code,
                )
                time.sleep(min(0.5 * attempts, 1.5))
            except (httpx.TimeoutException, httpx.NetworkError) as exc:
                if getattr(exc, "stream_chunks_received", 0) > 0 or attempts >= 3:
                    raise
                logging.getLogger("research_engine").warning(
                    "model_transport_retry attempt=%d error=%s",
                    attempts,
                    type(exc).__name__,
                )
                time.sleep(min(0.5 * attempts, 1.5))
        choice = (data.get("choices") or [{}])[0]
        message = choice.get("message") or {}
        # Preserve exactly the assistant message required by the native replay protocol.
        assistant = {"role": "assistant", **message}
        usage = data.get("usage") or {}
        return {
            "message": assistant,
            "finish_reason": choice.get("finish_reason"),
            "usage": usage,
            "model": data.get("model", self.model),
            "raw": data,
            "duration_seconds": time.perf_counter() - started,
            "transport_attempts": attempts,
        }

    @staticmethod
    def _consume_stream(response):
        content: list[str] = []
        tool_calls: dict[int, dict[str, Any]] = {}
        message_extras: dict[str, Any] = {}
        chunks: list[dict[str, Any]] = []
        usage: dict[str, Any] = {}
        finish_reason = None
        model = None
        import logging

        logger = logging.getLogger("research_engine")
        first_delta = True

        def safe_lines():
            try:
                yield from response.iter_lines()
            except Exception as exc:
                setattr(exc, "stream_chunks_received", len(chunks))
                setattr(exc, "partial_content", "".join(content))
                setattr(exc, "raw_chunks", chunks)
                raise

        for line in safe_lines():
            if not line or not line.startswith("data:"):
                continue
            raw = line[5:].strip()
            if raw == "[DONE]":
                break
            try:
                event = json.loads(raw)
            except json.JSONDecodeError as exc:
                error = MuseProtocolError(
                    f"Muse stream contained malformed JSON: {exc}"
                )
                error.partial_content = "".join(content)
                error.raw_chunks = chunks + [raw]
                error.stream_chunks_received = len(chunks) + 1
                raise error from exc
            chunks.append(event)
            model = event.get("model", model)
            usage.update(event.get("usage") or {})
            for choice in event.get("choices") or []:
                delta = choice.get("delta") or {}
                if isinstance(delta.get("content"), str):
                    content.append(delta["content"])
                    if first_delta and delta["content"]:
                        logger.info(
                            "model_stream first_content_delta chars=%d",
                            len(delta["content"]),
                        )
                        first_delta = False
                for key, value in delta.items():
                    if key in {"content", "tool_calls"}:
                        continue
                    if isinstance(value, str) and isinstance(
                        message_extras.get(key), str
                    ):
                        message_extras[key] += value
                    else:
                        message_extras[key] = value
                for call in delta.get("tool_calls") or []:
                    index = int(call.get("index", 0))
                    current = tool_calls.setdefault(
                        index,
                        {
                            "id": "",
                            "type": "function",
                            "function": {"name": "", "arguments": ""},
                        },
                    )
                    if call.get("id"):
                        current["id"] = call["id"]
                        if first_delta:
                            logger.info(
                                "model_stream first_tool_call_delta index=%d", index
                            )
                            first_delta = False
                    if call.get("type"):
                        current["type"] = call["type"]
                    fn = call.get("function") or {}
                    if fn.get("name"):
                        current["function"]["name"] += fn["name"]
                    if fn.get("arguments"):
                        current["function"]["arguments"] += fn["arguments"]
                if choice.get("finish_reason"):
                    finish_reason = choice["finish_reason"]
        if not finish_reason:
            error = MuseProtocolError(
                "Muse stream ended before a finish_reason; partial output was not executed"
            )
            error.partial_content = "".join(content)
            error.raw_chunks = chunks
            error.stream_chunks_received = len(chunks)
            raise error
        message: dict[str, Any] = {**message_extras, "content": "".join(content)}
        if tool_calls:
            calls = [tool_calls[i] for i in sorted(tool_calls)]
            if any(not c["id"] or not c["function"]["name"] for c in calls):
                error = MuseProtocolError(
                    "Muse stream contained an incomplete tool call"
                )
                error.partial_content = "".join(content)
                error.raw_chunks = chunks
                error.stream_chunks_received = len(chunks)
                raise error
            message["tool_calls"] = calls
        return {
            "choices": [{"message": message, "finish_reason": finish_reason}],
            "usage": usage,
            "model": model,
            "stream_chunks": chunks,
        }

    def complete(
        self,
        prompt,
        system_instruction=None,
        json_mode=False,
        temperature=0.0,
        reasoning_effort=None,
    ):
        # Document Intelligence uses the shared simple completion interface.
        from doc_intelligence.providers.openai_provider import OpenAICompatibleProvider

        if self._simple is None:
            self._simple = OpenAICompatibleProvider(
                model=self.model,
                api_key=self.api_key,
                base_url=self.base_url,
                timeout=self.timeout,
                max_output_tokens=self.max_output_tokens,
                stream=self.stream,
            )
        return self._simple.complete(
            prompt,
            system_instruction,
            json_mode,
            temperature,
            reasoning_effort or self.reasoning_effort,
        )


def build_transport(config, budget):
    return MuseChatTransport(
        config.api_key,
        config.base_url,
        config.model,
        max_output_tokens=budget.max_output_tokens,
        stream=True,
    )
