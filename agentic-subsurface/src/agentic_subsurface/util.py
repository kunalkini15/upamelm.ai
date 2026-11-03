from __future__ import annotations

import hashlib
import json
import mimetypes
import re
from pathlib import Path
from typing import Any


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def stable_id(prefix: str, *parts: Any) -> str:
    raw = "|".join(str(part) for part in parts)
    slug = re.sub(r"[^a-z0-9]+", "-", raw.lower()).strip("-")[:72]
    short = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:10]
    return f"{prefix}:{slug}:{short}" if slug else f"{prefix}:{short}"


def media_type(path: Path) -> str:
    suffix = path.suffix.lower()
    special = {".kml": "application/vnd.google-earth.kml+xml", ".kmz": "application/vnd.google-earth.kmz", ".geojson": "application/geo+json", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}
    return special.get(suffix) or mimetypes.guess_type(path.name)[0] or "application/octet-stream"


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False, default=str), encoding="utf-8")


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def relative(path: Path, root: Path) -> str:
    return str(path.resolve().relative_to(root.resolve()))

