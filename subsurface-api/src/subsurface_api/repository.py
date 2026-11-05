from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from threading import RLock
from typing import Any

from .errors import ApiError, not_found


IDENTIFIER_RE = re.compile(r"^[A-Za-z0-9_-]+$")
PACKAGE_RE = re.compile(r"^study_package(?:_([A-Za-z0-9-]+))?\.json$")


@dataclass(frozen=True)
class CacheEntry:
    signature: tuple[int, int]
    value: Any


class RunRepository:
    """Read-only, filesystem-backed repository for promoted pipeline runs."""

    def __init__(self, root: Path, max_package_bytes: int) -> None:
        self.root = root.resolve()
        self.max_package_bytes = max_package_bytes
        self._cache: dict[Path, CacheEntry] = {}
        self._lock = RLock()

    @staticmethod
    def validate_identifier(value: str, kind: str) -> str:
        if not IDENTIFIER_RE.fullmatch(value):
            raise ApiError(400, f"invalid_{kind}", f"Invalid {kind} identifier '{value}'.")
        return value

    def city_dir(self, city_id: str) -> Path:
        city_id = self.validate_identifier(city_id, "city")
        path = (self.root / city_id).resolve()
        if path.parent != self.root or not (path / "studies").is_dir():
            raise not_found("city", city_id)
        return path

    def study_dir(self, city_id: str, source_id: str) -> Path:
        source_id = self.validate_identifier(source_id, "study")
        studies = (self.city_dir(city_id) / "studies").resolve()
        path = (studies / source_id).resolve()
        if path.parent != studies or not (path / "study_package.json").is_file():
            raise not_found("study", source_id)
        return path

    def city_ids(self) -> list[str]:
        if not self.root.is_dir():
            return []
        return sorted(
            path.name
            for path in self.root.iterdir()
            if not path.name.startswith(".")
            and IDENTIFIER_RE.fullmatch(path.name)
            and (path / "studies").is_dir()
        )

    def source_ids(self, city_id: str) -> list[str]:
        studies = self.city_dir(city_id) / "studies"
        return sorted(
            path.name
            for path in studies.iterdir()
            if not path.name.startswith(".")
            and IDENTIFIER_RE.fullmatch(path.name)
            and (path / "study_package.json").is_file()
        )

    def languages(self, city_id: str, source_id: str) -> list[str]:
        result = {"en"}
        for path in self.study_dir(city_id, source_id).iterdir():
            match = PACKAGE_RE.fullmatch(path.name)
            if path.is_file() and match and match.group(1):
                result.add(match.group(1).lower())
        return ["en", *sorted(result - {"en"})]

    def package_path(self, city_id: str, source_id: str, language: str) -> Path:
        language = language.strip().lower()
        self.validate_identifier(language, "language")
        filename = "study_package.json" if language == "en" else f"study_package_{language}.json"
        study = self.study_dir(city_id, source_id)
        path = (study / filename).resolve()
        if path.parent != study or not path.is_file():
            raise ApiError(
                404,
                "translation_not_found",
                f"Language '{language}' is unavailable for study '{source_id}'.",
            )
        return path

    def asset_path(self, city_id: str, source_id: str, asset_path: str) -> Path:
        """Resolve an existing regular file strictly inside a study directory."""
        study = self.study_dir(city_id, source_id)
        if not asset_path or "\x00" in asset_path:
            raise ApiError(400, "invalid_asset_path", "Asset path must identify a file.")
        requested = Path(asset_path)
        if requested.is_absolute():
            raise ApiError(400, "invalid_asset_path", "Absolute asset paths are not allowed.")
        try:
            path = (study / requested).resolve()
            path.relative_to(study)
        except (OSError, ValueError) as exc:
            raise ApiError(
                400,
                "invalid_asset_path",
                "Asset path must remain inside the selected study directory.",
            ) from exc
        if not path.is_file():
            raise ApiError(404, "asset_not_found", f"Asset '{asset_path}' was not found.")
        return path

    def read_json(self, path: Path, *, package: bool = False) -> Any:
        try:
            stat = path.stat()
        except FileNotFoundError as exc:
            raise ApiError(404, "file_not_found", f"File '{path.name}' was not found.") from exc
        if package and stat.st_size > self.max_package_bytes:
            raise ApiError(413, "package_too_large", f"Package '{path.name}' exceeds the configured size limit.")
        signature = (stat.st_mtime_ns, stat.st_size)
        with self._lock:
            cached = self._cache.get(path)
            if cached and cached.signature == signature:
                return cached.value
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise ApiError(422, "invalid_json", f"File '{path.name}' does not contain valid JSON.") from exc
        with self._lock:
            self._cache[path] = CacheEntry(signature, value)
        return value

    def optional_json(self, path: Path) -> dict[str, Any]:
        if not path.is_file():
            return {}
        value = self.read_json(path)
        return value if isinstance(value, dict) else {}
