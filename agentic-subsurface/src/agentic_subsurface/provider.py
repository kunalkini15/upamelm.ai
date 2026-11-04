from __future__ import annotations

import json
import os
import random
import re
import sys
import time
import threading
import uuid
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv

from .models import MODEL, PipelineConfig
from .util import write_json


class BudgetExceeded(RuntimeError): pass
class IncompleteResponse(RuntimeError):
    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(f"Meta response incomplete: {reason}")


class MuseClient:
    BASE_URL = "https://api.meta.ai/v1"
    INPUT_PER_M = 0.10
    CACHED_INPUT_PER_M = 0.002
    OUTPUT_PER_M = 0.20

    def __init__(self, run_root: Path, config: PipelineConfig, env_path: Path | None = None, *, shared_ledger_path: Path | None = None):
        candidates = [env_path, Path.cwd() / ".env", Path.cwd() / "research-engine-v2" / ".env", Path.cwd() / "doc-intelligence" / ".env"]
        selected = next((path for path in candidates if path and path.exists()), None)
        if selected: load_dotenv(selected, override=False)
        self.api_key = os.environ.get("MODEL_API_KEY", "")
        self.config = config
        if config.model != MODEL: raise ValueError(f"only {MODEL} is permitted")
        self.root = run_root / "model_io"
        self.root.mkdir(parents=True, exist_ok=True)
        self.ledger_path = shared_ledger_path or run_root / "telemetry" / "cost_ledger.json"
        self.ledger = {"model": MODEL, "budget_usd": config.max_cost_usd, "calls": [], "totals": {"input_tokens": 0, "cached_input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0}}
        if self.ledger_path.exists(): self.ledger = json.loads(self.ledger_path.read_text(encoding="utf-8"))
        self._ledger_lock = threading.RLock()
        self._reservations: dict[str, float] = {}

    def _estimated_cost(self, input_tokens: int, output_tokens: int, cached_tokens: int = 0) -> float:
        uncached = max(0, input_tokens - cached_tokens)
        return uncached / 1_000_000 * self.INPUT_PER_M + cached_tokens / 1_000_000 * self.CACHED_INPUT_PER_M + output_tokens / 1_000_000 * self.OUTPUT_PER_M

    def _guard(self, prospective_input: int, prospective_output: int) -> None:
        with self._ledger_lock:
            committed = float(self.ledger["totals"]["cost_usd"])
            reserved = sum(self._reservations.values())
            worst = self._estimated_cost(prospective_input, prospective_output)
            if committed + reserved + worst > self.config.max_cost_usd:
                raise BudgetExceeded(f"prospective call would exceed budget: ${committed + reserved + worst:.4f} > ${self.config.max_cost_usd:.2f}")

    def _reserve(self, input_tokens: int, output_tokens: int) -> str:
        reservation_id = uuid.uuid4().hex
        with self._ledger_lock:
            self._guard(input_tokens, output_tokens)
            self._reservations[reservation_id] = self._estimated_cost(input_tokens, output_tokens)
        return reservation_id

    def _release(self, reservation_id: str) -> None:
        with self._ledger_lock:
            self._reservations.pop(reservation_id, None)

    def _commit(self, reservation_id: str, record: dict[str, Any]) -> None:
        with self._ledger_lock:
            self._reservations.pop(reservation_id, None)
            self.ledger["calls"].append(record)
            totals = self.ledger["totals"]
            for key in ("input_tokens", "cached_input_tokens", "output_tokens"):
                totals[key] += record[key]
            totals["cost_usd"] = round(float(totals["cost_usd"]) + record["cost_usd"], 8)
            write_json(self.ledger_path, self.ledger)

    def latest_call_for_phase(self, phase: str) -> dict[str, Any] | None:
        with self._ledger_lock:
            return next((dict(record) for record in reversed(self.ledger["calls"]) if record.get("phase") == phase), None)

    def count_tokens(self, instructions: str, input_content: Any, schema: dict[str, Any] | None = None) -> int:
        # Meta's documented counter accepts the request input itself. Count the
        # stable instructions as a leading text part so the result remains a
        # safe whole-request measurement without passing generation settings.
        if isinstance(input_content, str):
            countable_input: Any = instructions + "\n\n" + input_content
        elif isinstance(input_content, list):
            countable_input = json.loads(json.dumps(input_content, ensure_ascii=False, default=str))
            if countable_input and isinstance(countable_input[0], dict):
                content = countable_input[0].setdefault("content", [])
                content.insert(0, {"type": "input_text", "text": instructions})
        else:
            countable_input = instructions + "\n\n" + json.dumps(input_content, ensure_ascii=False, default=str)
        payload: dict[str, Any] = {"model": MODEL, "input": countable_input}
        if not self.api_key: raise ValueError("MODEL_API_KEY is required for live token counting")
        last_error: Exception | None = None
        for attempt in range(4):
            try:
                response = httpx.post(f"{self.BASE_URL}/responses/input_tokens", headers={"Authorization": f"Bearer {self.api_key}"}, json=payload, timeout=120)
                response.raise_for_status()
                body = response.json()
                return int(body.get("input_tokens") or body.get("total_tokens") or 0)
            except (httpx.TimeoutException, httpx.NetworkError, httpx.HTTPStatusError) as exc:
                last_error = exc
                status = exc.response.status_code if isinstance(exc, httpx.HTTPStatusError) else None
                if status and status not in {429, 500, 502, 503, 504}:
                    raise
                if attempt < 3:
                    time.sleep(min(20, (2 ** attempt) + random.random()))

        # Token counting is a preflight optimization, not the model operation
        # itself. Do not discard an extraction batch when that auxiliary Meta
        # endpoint is temporarily unavailable. This deliberately overestimates
        # text and images so the normal budget guard remains conservative.
        estimated = self._estimate_input_tokens(instructions, input_content, schema)
        print(
            f"[provider] Meta token counter unavailable after 4 attempts; "
            f"using conservative local estimate={estimated:,} tokens | "
            f"{type(last_error).__name__}: {last_error}",
            file=sys.stderr,
            flush=True,
        )
        return estimated

    @staticmethod
    def _estimate_input_tokens(instructions: str, input_content: Any, schema: dict[str, Any] | None = None) -> int:
        text_characters = len(instructions) + len(json.dumps(schema or {}, ensure_ascii=False, default=str))
        image_count = 0

        def visit(value: Any) -> None:
            nonlocal text_characters, image_count
            if isinstance(value, dict):
                image_url = value.get("image_url")
                if isinstance(image_url, str) and image_url.startswith("data:image"):
                    image_count += 1
                    for key, child in value.items():
                        if key != "image_url":
                            visit(child)
                    return
                for child in value.values():
                    visit(child)
            elif isinstance(value, list):
                for child in value:
                    visit(child)
            elif isinstance(value, str):
                text_characters += len(value)
            elif value is not None:
                text_characters += len(str(value))

        visit(input_content)
        # Three characters/token and 3K tokens/image are intentionally above
        # the observed Muse usage for these document batches.
        return max(1, (text_characters + 2) // 3 + image_count * 3_000)

    def complete(self, *, phase: str, instructions: str, input_content: Any, schema: dict[str, Any], max_output_tokens: int | None = None, reasoning_effort: str | None = None, cache_key: str | None = None, counted_input_tokens: int | None = None) -> dict[str, Any]:
        if not self.config.live: raise RuntimeError("live provider call attempted while live=false")
        output_limit = max_output_tokens or self.config.max_output_tokens
        input_tokens = counted_input_tokens if counted_input_tokens is not None else self.count_tokens(instructions, input_content, schema)
        reservation_id = self._reserve(input_tokens, output_limit)
        call_id = f"call-{uuid.uuid4().hex}"
        call_dir = self.root / call_id
        call_dir.mkdir(parents=True)
        schema_name = re.sub(r"[^a-zA-Z0-9_.-]+", "_", phase)[:48]
        payload: dict[str, Any] = {"model": MODEL, "instructions": instructions, "input": input_content, "reasoning": {"effort": reasoning_effort or self.config.reasoning_effort}, "max_output_tokens": output_limit, "store": False, "text": {"format": {"type": "json_schema", "name": schema_name, "strict": True, "schema": schema}}}
        if cache_key: payload["prompt_cache_key"] = cache_key
        captured = json.loads(json.dumps(payload, ensure_ascii=False, default=str))
        for message in captured.get("input", []) if isinstance(captured.get("input"), list) else []:
            for part in message.get("content", []) if isinstance(message, dict) else []:
                if isinstance(part, dict) and str(part.get("image_url", "")).startswith("data:"): part["image_url"] = "<inline-image-redacted>"
        write_json(call_dir / "request.json", {"phase": phase, "counted_input_tokens": input_tokens, "payload": captured})
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        last_error: Exception | None = None
        try:
          for attempt in range(4):
            try:
                response = httpx.post(f"{self.BASE_URL}/responses", headers=headers, json=payload, timeout=600)
                if response.status_code in {429, 500, 502, 503, 504}:
                    raise httpx.HTTPStatusError("retryable Meta response", request=response.request, response=response)
                if response.is_error:
                    body = response.text[:12000]
                    write_json(call_dir / "error.json", {"status": response.status_code, "body": body})
                    raise httpx.HTTPStatusError(f"Meta API {response.status_code}: {body[:2000]}", request=response.request, response=response)
                raw = response.json()
                break
            except (httpx.TimeoutException, httpx.NetworkError, httpx.HTTPStatusError) as exc:
                last_error = exc
                status = exc.response.status_code if isinstance(exc, httpx.HTTPStatusError) else None
                if status and status not in {429, 500, 502, 503, 504}: raise
                if attempt == 3: raise
                time.sleep(min(20, (2 ** attempt) + random.random()))
          else: raise last_error or RuntimeError("provider call failed")
        except BaseException:
            self._release(reservation_id)
            raise
        write_json(call_dir / "response.json", raw)
        usage = raw.get("usage") or {}
        actual_input = int(usage.get("input_tokens") or input_tokens)
        cached = int((usage.get("input_tokens_details") or {}).get("cached_tokens") or 0)
        output = int(usage.get("output_tokens") or 0)
        cost = self._estimated_cost(actual_input, output, cached)
        record = {"call_id": call_id, "phase": phase, "model": MODEL, "input_tokens": actual_input, "cached_input_tokens": cached, "output_tokens": output, "cost_usd": cost}
        self._commit(reservation_id, record)
        if raw.get("status") == "incomplete":
            reason = (raw.get("incomplete_details") or {}).get("reason", "unknown")
            raise IncompleteResponse(reason)
        for item in reversed(raw.get("output", [])):
            if item.get("type") != "message": continue
            for content in reversed(item.get("content", [])):
                text = content.get("text") or content.get("value")
                if text: return json.loads(text)
        raise RuntimeError("structured response contained no output text")
