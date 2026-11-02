from __future__ import annotations

import logging
import json
import threading
import time
from pathlib import Path
from doc_intelligence.providers.base import BaseModelProvider


LOGGER_NAME = "research_engine"


def configure_logging(
    log_file: str | Path | None = None, verbose: bool = True
) -> logging.Logger:
    """Configure human-readable console progress and an optional durable log file."""
    logger = logging.getLogger(LOGGER_NAME)
    logger.setLevel(logging.INFO)
    logger.propagate = False
    for handler in list(logger.handlers):
        logger.removeHandler(handler)
        handler.close()

    formatter = logging.Formatter(
        "%(asctime)s %(levelname)s [%(name)s] %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S%z",
    )
    if verbose:
        console = logging.StreamHandler()
        console.setFormatter(formatter)
        logger.addHandler(console)
    if log_file:
        target = Path(log_file)
        target.parent.mkdir(parents=True, exist_ok=True)
        file_handler = logging.FileHandler(target, encoding="utf-8")
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)
    return logger


def get_logger() -> logging.Logger:
    return logging.getLogger(LOGGER_NAME)


class ModelIOCaptureProvider(BaseModelProvider):
    """Persists each prompt and raw response as separate diagnostic artifacts."""

    def __init__(
        self, delegate: BaseModelProvider, capture_dir: str | Path, run_id: str = ""
    ):
        self.delegate = delegate
        self.capture_dir = Path(capture_dir)
        self.capture_dir.mkdir(parents=True, exist_ok=True)
        existing = []
        if run_id:
            for path in self.capture_dir.glob(f"{run_id}_*_prompt.json"):
                try:
                    existing.append(int(path.name.split("_", 2)[1]))
                except (ValueError, IndexError):
                    pass
        self._counter = max(existing, default=0)
        self._lock = threading.Lock()
        self.run_id = run_id

    @property
    def provider_name(self):
        return self.delegate.provider_name

    @property
    def supports_native_tool_calls(self):
        return bool(
            getattr(
                self.delegate,
                "supports_native_tool_calls",
                hasattr(self.delegate, "complete_agent"),
            )
        )

    def set_max_output_tokens(self, limit):
        setter = getattr(self.delegate, "set_max_output_tokens", None)
        if setter:
            setter(limit)

    def complete(
        self,
        prompt,
        system_instruction=None,
        json_mode=False,
        temperature=0.0,
        reasoning_effort=None,
    ):
        with self._lock:
            self._counter += 1
            sequence = self._counter
        phase = (
            "nested_document_intelligence"
            if system_instruction
            and "document intelligence" in system_instruction.lower()
            else "orchestration"
        )
        stem = f"{self.run_id + '_' if self.run_id else ''}{sequence:04d}_{phase}"
        (self.capture_dir / f"{stem}_prompt.json").write_text(
            json.dumps(
                {
                    "sequence": sequence,
                    "phase": phase,
                    "system_instruction": system_instruction,
                    "prompt": prompt,
                    "json_mode": json_mode,
                    "temperature": temperature,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        started = time.perf_counter()
        try:
            response = self.delegate.complete(
                prompt,
                system_instruction=system_instruction,
                json_mode=json_mode,
                temperature=temperature,
                reasoning_effort=reasoning_effort,
            )
        except Exception as exc:
            (self.capture_dir / f"{stem}_response.json").write_text(
                json.dumps(
                    {
                        "sequence": sequence,
                        "phase": phase,
                        "error": str(exc),
                        "duration_seconds": time.perf_counter() - started,
                        "partial_content": getattr(exc, "partial_content", None),
                        "raw_chunks": getattr(exc, "raw_chunks", None),
                        "finish_reason": getattr(exc, "finish_reason", None),
                    },
                    ensure_ascii=False,
                    indent=2,
                    default=str,
                ),
                encoding="utf-8",
            )
            raise
        raw = (
            response.raw_response
            if response.raw_response is not None
            else {"content": response.content, "parsed_json": response.parsed_json}
        )
        (self.capture_dir / f"{stem}_response.json").write_text(
            json.dumps(
                {
                    "sequence": sequence,
                    "phase": phase,
                    "model": response.model_name,
                    "prompt_tokens": response.prompt_tokens,
                    "completion_tokens": response.completion_tokens,
                    "total_tokens": response.total_tokens,
                    "duration_seconds": time.perf_counter() - started,
                    "raw_response": raw,
                },
                ensure_ascii=False,
                indent=2,
                default=str,
            ),
            encoding="utf-8",
        )
        return response

    def complete_agent(self, messages, tools=None):
        if not hasattr(self.delegate, "complete_agent"):
            raise RuntimeError(
                "wrapped provider does not support native Muse tool calls"
            )
        with self._lock:
            self._counter += 1
            sequence = self._counter
        stem = f"{self.run_id + '_' if self.run_id else ''}{sequence:04d}_orchestration"
        (self.capture_dir / f"{stem}_prompt.json").write_text(
            json.dumps(
                {
                    "sequence": sequence,
                    "run_id": self.run_id,
                    "phase": "orchestration",
                    "messages": messages,
                    "tools": tools,
                },
                ensure_ascii=False,
                indent=2,
                default=str,
            ),
            encoding="utf-8",
        )
        started = time.perf_counter()
        try:
            response = self.delegate.complete_agent(messages, tools)
        except Exception as exc:
            (self.capture_dir / f"{stem}_response.json").write_text(
                json.dumps(
                    {
                        "sequence": sequence,
                        "run_id": self.run_id,
                        "phase": "orchestration",
                        "error": str(exc),
                        "duration_seconds": time.perf_counter() - started,
                        "partial_content": getattr(exc, "partial_content", None),
                        "raw_chunks": getattr(exc, "raw_chunks", None),
                    },
                    ensure_ascii=False,
                    indent=2,
                    default=str,
                ),
                encoding="utf-8",
            )
            raise
        (self.capture_dir / f"{stem}_response.json").write_text(
            json.dumps(
                {
                    "sequence": sequence,
                    "run_id": self.run_id,
                    "phase": "orchestration",
                    "model": response.get("model"),
                    "usage": response.get("usage"),
                    "duration_seconds": time.perf_counter() - started,
                    "response": response,
                },
                ensure_ascii=False,
                indent=2,
                default=str,
            ),
            encoding="utf-8",
        )
        return response
