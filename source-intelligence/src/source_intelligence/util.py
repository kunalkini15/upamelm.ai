from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from .models import CanonicalCapability


def stable_id(prefix: str, *parts: str) -> str:
    digest = hashlib.sha256("\x1f".join(parts).encode()).hexdigest()[:16]
    return f"{prefix}_{digest}"


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if hasattr(value, "model_dump"):
        value = value.model_dump(mode="json")
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
    temporary.replace(path)


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def canonical_url(url: str) -> str:
    parts = urlsplit(url)
    path = re.sub(r"/{2,}", "/", parts.path)
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), path, parts.query, ""))


def safe_filename(name: str, fallback: str = "document") -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", name).strip(".-")
    return cleaned[:180] or fallback


def normalize_grounding_text(value: str) -> str:
    value = value.casefold().replace("\u00ad", "").replace("-\r\n", "").replace("-\n", "")
    return " ".join(value.split())


CAPABILITY_TERMS: dict[CanonicalCapability, tuple[str, ...]] = {
    CanonicalCapability.BOREHOLE_LITHOLOGY: ("borehole lithology", "lithological log", "strata profile", "bore log"),
    CanonicalCapability.ROCKHEAD_DEPTH: ("rockhead", "depth to rock", "bedrock depth"),
    CanonicalCapability.SOIL_HORIZON: ("soil horizon", "pedon", "horizon depth"),
    CanonicalCapability.SOIL_MAPPING_UNIT: ("soil mapping unit", "soil map"),
    CanonicalCapability.GROUNDWATER_LEVEL: ("groundwater level", "water level", "water table"),
    CanonicalCapability.GROUNDWATER_QUALITY: ("groundwater quality", "water quality", "hydrochemistry"),
    CanonicalCapability.AQUIFER_BOUNDARY: ("aquifer boundary", "aquifer mapping", "aquifer extent"),
    CanonicalCapability.FRACTURE_ZONE: ("fracture zone", "lineament"),
    CanonicalCapability.GEOTECHNICAL_BORELOG: ("geotechnical borelog", "geotechnical bore log", "soil investigation"),
    CanonicalCapability.UTILITY_ALIGNMENT: ("utility alignment", "utility corridor"),
    CanonicalCapability.UTILITY_INVERT_LEVEL: ("invert level", "longitudinal section"),
    CanonicalCapability.INSAR_VELOCITY: ("insar", "vertical land motion", "velocity map"),
    CanonicalCapability.SUBSIDENCE_OBSERVATION: ("subsidence", "land subsidence"),
}


def canonical_capabilities(values: list[str]) -> set[CanonicalCapability]:
    found: set[CanonicalCapability] = set()
    for raw in values:
        text = normalize_grounding_text(raw).replace("_", " ")
        for capability, terms in CAPABILITY_TERMS.items():
            if capability.value.replace("_", " ") in text or any(term in text for term in terms):
                found.add(capability)
    return found

