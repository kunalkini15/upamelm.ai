from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


MODULE_ROOT = Path(__file__).resolve().parents[2]


def _resolve_path(value: str) -> Path:
    path = Path(value).expanduser()
    if not path.is_absolute():
        path = MODULE_ROOT / path
    return path.resolve()


@dataclass(frozen=True)
class Settings:
    runs_root: Path
    default_city: str | None
    default_language: str
    max_package_bytes: int
    cors_origins: tuple[str, ...]

    @classmethod
    def from_env(cls) -> "Settings":
        origins = tuple(
            item.strip()
            for item in os.getenv(
                "SUBSURFACE_CORS_ORIGINS",
                "http://localhost:5175,http://127.0.0.1:5175,http://localhost:5200,http://127.0.0.1:5200",
            ).split(",")
            if item.strip()
        )
        default_city = os.getenv("SUBSURFACE_DEFAULT_CITY", "bengaluru").strip()
        return cls(
            runs_root=_resolve_path(os.getenv("SUBSURFACE_RUNS_ROOT", "../runs")),
            default_city=default_city or None,
            default_language=os.getenv("SUBSURFACE_DEFAULT_LANGUAGE", "en").strip().lower() or "en",
            max_package_bytes=int(float(os.getenv("SUBSURFACE_MAX_PACKAGE_MB", "25")) * 1024 * 1024),
            cors_origins=origins,
        )
