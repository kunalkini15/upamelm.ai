from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def load_env_file(path: Path | None = None) -> Path | None:
    """Load a small KEY=VALUE .env file without adding a runtime dependency.

    Existing process environment values always win. The default search order is
    the current directory followed by the package project directory.
    """
    candidates = [path] if path else [Path.cwd() / ".env", Path(__file__).resolve().parents[2] / ".env"]
    selected = next((candidate for candidate in candidates if candidate and candidate.is_file()), None)
    if selected is None:
        return None
    for raw_line in selected.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if value and value[0:1] == value[-1:] and value.startswith(("'", '"')):
            value = value[1:-1]
        if key:
            os.environ.setdefault(key, value)
    return selected


def _integer(name: str, default: int) -> int:
    value = int(os.getenv(name, str(default)))
    if value <= 0:
        raise ValueError(f"{name} must be positive")
    return value


@dataclass(frozen=True)
class Settings:
    search_provider: str
    google_api_key: str | None
    google_engine_id: str | None
    firecrawl_api_key: str | None
    firecrawl_base_url: str
    serper_api_key: str | None
    serper_base_url: str
    serper_gl: str
    serper_hl: str
    model_provider: str
    model_api_key: str | None
    model_base_url: str
    model_name: str | None
    model_api_style: str
    timeout_seconds: int
    max_download_bytes: int
    max_search_results: int
    max_candidates_per_category: int
    user_agent: str

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            search_provider=os.getenv("SOURCE_SEARCH_PROVIDER", "mock").lower(),
            google_api_key=os.getenv("GOOGLE_SEARCH_API_KEY"),
            google_engine_id=os.getenv("GOOGLE_SEARCH_ENGINE_ID"),
            firecrawl_api_key=os.getenv("FIRECRAWL_API_KEY"),
            firecrawl_base_url=os.getenv("FIRECRAWL_BASE_URL", "https://api.firecrawl.dev/v1").rstrip("/"),
            serper_api_key=os.getenv("SERPER_API_KEY"),
            serper_base_url=os.getenv("SERPER_BASE_URL", "https://google.serper.dev").rstrip("/"),
            serper_gl=os.getenv("SERPER_GL", "in"),
            serper_hl=os.getenv("SERPER_HL", "en"),
            model_provider=os.getenv("MODEL_PROVIDER", "none").lower(),
            model_api_key=os.getenv("MODEL_API_KEY"),
            model_base_url=os.getenv("MODEL_BASE_URL", "https://api.openai.com/v1").rstrip("/"),
            model_name=os.getenv("MODEL_NAME"),
            model_api_style=os.getenv("MODEL_API_STYLE", "chat_completions").lower(),
            timeout_seconds=_integer("SOURCE_HTTP_TIMEOUT_SECONDS", 30),
            max_download_bytes=_integer("SOURCE_MAX_DOWNLOAD_MB", 100) * 1024 * 1024,
            max_search_results=min(_integer("SOURCE_MAX_SEARCH_RESULTS", 10), 50),
            max_candidates_per_category=min(_integer("SOURCE_MAX_CANDIDATES_PER_CATEGORY", 8), 50),
            user_agent=os.getenv("SOURCE_USER_AGENT", "SubsurfaceSourceIntelligence/0.1 (+research)"),
        )

