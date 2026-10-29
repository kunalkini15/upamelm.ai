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
        timeout: float = 90.0,
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

    @property
    def provider_name(self) -> str:
        return f"muse_spark:{self.model}"

    def complete(
        self,
        prompt: str,
        system_instruction: Optional[str] = None,
        json_mode: bool = False,
        temperature: float = 0.0,
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
            messages.append({"role": "system", "content": system_instruction})
        messages.append({"role": "user", "content": prompt})

        payload: Dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
        }
        if json_mode:
            payload["response_format"] = {"type": "json_object"}

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
