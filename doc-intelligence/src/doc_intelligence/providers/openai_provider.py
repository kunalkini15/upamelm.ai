from __future__ import annotations

import json
import os
import re
from typing import Any, Dict, Optional
import httpx

from doc_intelligence.providers.base import BaseModelProvider, ModelResponse


class OpenAICompatibleProvider(BaseModelProvider):
    """OpenAI-compatible API provider for Meta Muse Spark, OpenAI, Groq, Ollama, etc."""

    def __init__(
        self,
        model: Optional[str] = None,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        timeout: float = 60.0,
        max_output_tokens: Optional[int] = None,
        stream: bool = False,
    ):
        # Model Priority: explicit -> MODEL_NAME -> MUSE_MODEL -> OPENAI_MODEL -> default "muse-spark-1.3"
        self.model = (
            model
            or os.environ.get("MODEL_NAME")
            or os.environ.get("MUSE_MODEL")
            or os.environ.get("OPENAI_MODEL")
            or "muse-spark-1.3"
        )

        # API Key Priority: explicit -> MODEL_API_KEY -> MUSE_API_KEY -> OPENAI_API_KEY
        self.api_key = (
            api_key
            or os.environ.get("MODEL_API_KEY")
            or os.environ.get("MUSE_API_KEY")
            or os.environ.get("OPENAI_API_KEY")
            or ""
        )

        # Base URL Priority: explicit -> MODEL_BASE_URL -> MUSE_BASE_URL -> OPENAI_BASE_URL -> default "https://api.meta.ai/v1"
        raw_base_url = (
            base_url
            or os.environ.get("MODEL_BASE_URL")
            or os.environ.get("MUSE_BASE_URL")
            or os.environ.get("OPENAI_BASE_URL")
            or "https://api.meta.ai/v1"
        )
        self.base_url = raw_base_url.rstrip("/")
        self.timeout = timeout
        self.max_output_tokens = max_output_tokens
        self.stream = stream

    @property
    def provider_name(self) -> str:
        return f"muse_spark:{self.model}"

    def complete(
        self,
        prompt: str,
        system_instruction: Optional[str] = None,
        json_mode: bool = False,
        temperature: float = 0.0,
        reasoning_effort: Optional[str] = None,
    ) -> ModelResponse:
        if not self.api_key:
            raise ValueError(
                "API key not found. Please set MODEL_API_KEY or MUSE_API_KEY in your .env file "
                "or environment variables."
            )

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        messages = []
        if system_instruction:
            messages.append({"role": "developer", "content": system_instruction})
        messages.append({"role": "user", "content": prompt})

        payload: Dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
        }
        if json_mode:
            payload["response_format"] = {"type": "json_object"}
        if self.max_output_tokens is not None:
            # Meta Contributor counts reasoning and visible output together under
            # max_completion_tokens; max_tokens can exhaust on reasoning alone.
            payload["max_completion_tokens"] = self.max_output_tokens
        if self.stream:
            payload["stream"] = True
            payload["stream_options"] = {"include_usage": True}
        if reasoning_effort:
            payload["reasoning_effort"] = reasoning_effort

        if self.stream:
            return self._complete_stream(payload, headers)

        with httpx.Client(timeout=self.timeout) as client:
            resp = client.post(f"{self.base_url}/chat/completions", headers=headers, json=payload)
            resp.raise_for_status()
            data = resp.json()

        choice = data["choices"][0]["message"]
        content = choice.get("content", "")
        usage = data.get("usage", {})

        parsed = None
        if json_mode:
            try:
                parsed = json.loads(content)
            except Exception:
                # Extract markdown code fence if present
                clean_content = content
                if "```json" in clean_content:
                    clean_content = clean_content.split("```json")[1].split("```")[0].strip()
                elif "```" in clean_content:
                    clean_content = clean_content.split("```")[1].split("```")[0].strip()

                try:
                    parsed = json.loads(clean_content)
                except Exception:
                    match = re.search(r"\{.*\}", clean_content, re.DOTALL)
                    if match:
                        try:
                            parsed = json.loads(match.group(0))
                        except Exception:
                            pass

        return ModelResponse(
            content=content,
            parsed_json=parsed,
            prompt_tokens=usage.get("prompt_tokens", 0),
            completion_tokens=usage.get("completion_tokens", 0),
            total_tokens=usage.get("total_tokens", 0),
            model_name=self.model,
            raw_response=data,
        )

    def _complete_stream(self, payload: Dict[str, Any], headers: Dict[str, str]) -> ModelResponse:
        """Accumulate Meta SSE chunks while retaining raw chunks for diagnostics."""
        parts = []
        chunks = []
        usage: Dict[str, int] = {}
        model_name = self.model
        finish_reason = None
        try:
            with httpx.Client(timeout=self.timeout) as client:
                with client.stream("POST", f"{self.base_url}/chat/completions", headers=headers, json=payload) as resp:
                    resp.raise_for_status()
                    for line in resp.iter_lines():
                        if not line or not line.startswith("data:"):
                            continue
                        raw = line[5:].strip()
                        if raw == "[DONE]":
                            break
                        event = json.loads(raw)
                        chunks.append(event)
                        model_name = event.get("model", model_name)
                        usage.update(event.get("usage") or {})
                        for choice in event.get("choices") or []:
                            delta = choice.get("delta") or {}
                            if delta.get("content"):
                                parts.append(delta["content"])
                            if choice.get("finish_reason"):
                                finish_reason = choice["finish_reason"]
        except Exception as exc:
            setattr(exc, "partial_content", "".join(parts))
            setattr(exc, "raw_chunks", chunks)
            setattr(exc, "finish_reason", finish_reason)
            raise
        content = "".join(parts)
        parsed = self._parse_json_content(content)
        return ModelResponse(content=content, parsed_json=parsed,
                             prompt_tokens=usage.get("prompt_tokens", 0),
                             completion_tokens=usage.get("completion_tokens", 0),
                             total_tokens=usage.get("total_tokens", 0),
                             model_name=model_name,
                             raw_response={"streamed": True, "chunks": chunks, "finish_reason": finish_reason, "complete": finish_reason is not None})

    @staticmethod
    def _parse_json_content(content: str) -> Optional[Dict[str, Any]]:
        """Parse JSON responses that contain a short preamble or markdown fence."""
        if not content:
            return None
        candidates = [content]
        if "```json" in content:
            candidates.append(content.split("```json", 1)[1].split("```", 1)[0].strip())
        elif "```" in content:
            candidates.append(content.split("```", 1)[1].split("```", 1)[0].strip())
        match = re.search(r"\{.*\}", content, re.DOTALL)
        if match:
            candidates.append(match.group(0))
        for candidate in candidates:
            try:
                parsed = json.loads(candidate.strip())
                return parsed if isinstance(parsed, dict) else None
            except (TypeError, ValueError, json.JSONDecodeError):
                continue
        return None
