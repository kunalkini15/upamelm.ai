from __future__ import annotations

import os
from pathlib import Path
from typing import Optional
from dotenv import find_dotenv, load_dotenv

from doc_intelligence.providers.base import BaseModelProvider
from doc_intelligence.providers.mock_provider import MockModelProvider
from doc_intelligence.providers.openai_provider import OpenAICompatibleProvider
from doc_intelligence.providers.gemini_provider import GeminiProvider

_env_path = find_dotenv(usecwd=True)
if _env_path:
    load_dotenv(_env_path)
else:
    for candidate in [Path.cwd() / ".env", Path.cwd() / "doc-intelligence" / ".env"]:
        if candidate.exists():
            load_dotenv(candidate)
            break


class ProviderFactory:
    @staticmethod
    def create(
        provider_type: Optional[str] = None,
        model_name: Optional[str] = None,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
    ) -> BaseModelProvider:
        p_type = (provider_type or os.environ.get("DOC_INTEL_MODEL_PROVIDER", "")).lower()

        # If explicit mock requested
        if p_type == "mock":
            return MockModelProvider()

        # Check for Muse / Meta API / OpenAI keys
        muse_or_meta_key = (
            api_key
            or os.environ.get("MODEL_API_KEY")
            or os.environ.get("MUSE_API_KEY")
            or os.environ.get("OPENAI_API_KEY")
        )

        if p_type in ("muse", "muse_spark", "openai", "openai_compatible", "meta", ""):
            if muse_or_meta_key or p_type in ("muse", "muse_spark", "meta", "openai"):
                return OpenAICompatibleProvider(
                    model=model_name or os.environ.get("MODEL_NAME") or os.environ.get("MUSE_MODEL") or "muse-spark-1.3",
                    api_key=muse_or_meta_key,
                    base_url=base_url or os.environ.get("MODEL_BASE_URL") or os.environ.get("MUSE_BASE_URL") or "https://api.meta.ai/v1",
                )

        if p_type in ("gemini", "google"):
            return GeminiProvider(model=model_name or "gemini-1.5-flash", api_key=api_key)

        if os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"):
            return GeminiProvider(model=model_name or "gemini-1.5-flash", api_key=api_key)

        return MockModelProvider()
