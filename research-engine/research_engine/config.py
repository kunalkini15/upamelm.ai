from __future__ import annotations
import os
from dataclasses import dataclass
from pathlib import Path
from dotenv import load_dotenv

META_BASE_URL = "https://api.meta.ai/v1"
META_MODEL = "muse-spark-1.3-contributor"


@dataclass(frozen=True)
class MuseConfig:
    api_key: str
    base_url: str = META_BASE_URL
    model: str = META_MODEL

    @classmethod
    def from_env(cls) -> "MuseConfig":
        # Load only the Research Engine's own environment file; caller-provided
        # environment variables remain authoritative.
        load_dotenv(Path(__file__).parents[2] / ".env", override=False)
        return cls(
            os.environ.get("MODEL_API_KEY", ""),
            os.environ.get("META_BASE_URL", META_BASE_URL),
            os.environ.get("META_MODEL", META_MODEL),
        )

    def validate(self, allow_mock: bool = False) -> None:
        if allow_mock and self.model == "mock":
            return
        if self.model != META_MODEL:
            raise ValueError(
                f"Research Engine requires {META_MODEL}; refusing model {self.model!r}"
            )
        if self.base_url.rstrip("/") != META_BASE_URL:
            raise ValueError(
                "Research Engine only permits the Meta API endpoint https://api.meta.ai/v1"
            )
        if not self.api_key:
            raise ValueError("MODEL_API_KEY is required for a real Muse run")
