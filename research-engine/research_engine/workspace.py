from __future__ import annotations

import json
import os
import re
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class ResearchWorkspace:
    """Transparent, versioned file-backed research memory for one run."""

    _id_pattern = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")

    def __init__(self, root: str | Path):
        self.root = Path(root).resolve()
        self.artifacts = self.root / "artifacts"
        self.manifest_path = self.root / "manifest.json"
        self._lock = threading.RLock()
        self.artifacts.mkdir(parents=True, exist_ok=True)
        if not self.manifest_path.exists():
            self._write_manifest({"version": 1, "artifacts": {}, "updated_at": _now()})
        else:
            self._manifest()  # fail visibly on corruption rather than hiding it

    def _validate_id(self, artifact_id: str) -> str:
        aid = str(artifact_id)
        if aid in {".", ".."} or not self._id_pattern.fullmatch(aid):
            raise ValueError(
                "artifact_id must use 1-128 letters, digits, dots, underscores or hyphens"
            )
        target = (self.artifacts / aid).resolve()
        if not target.is_relative_to(self.artifacts.resolve()):
            raise ValueError("artifact path escapes the workspace")
        return aid

    def _manifest(self) -> Dict[str, Any]:
        try:
            value = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ValueError(
                f"workspace manifest is unreadable or corrupt: {self.manifest_path}"
            ) from exc
        if not isinstance(value, dict) or not isinstance(value.get("artifacts"), dict):
            raise ValueError("workspace manifest has an invalid structure")
        for aid, entry in value["artifacts"].items():
            self._validate_id(aid)
            if not isinstance(entry, dict) or not isinstance(
                entry.get("latest_version"), int
            ):
                raise ValueError(
                    f"workspace manifest entry is invalid for artifact {aid!r}"
                )
        return value

    def _atomic_json(self, path: Path, value: Any, exclusive: bool = False) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
        try:
            with temp.open("x", encoding="utf-8") as stream:
                json.dump(value, stream, indent=2, ensure_ascii=False, default=str)
                stream.flush()
                os.fsync(stream.fileno())
            if exclusive:
                try:
                    os.link(temp, path)
                except FileExistsError:
                    raise FileExistsError(f"artifact version already exists: {path}")
                temp.unlink()
            else:
                os.replace(temp, path)
        finally:
            try:
                temp.unlink()
            except FileNotFoundError:
                pass

    def _write_manifest(self, value: Dict[str, Any]) -> None:
        self._atomic_json(self.manifest_path, value)

    def list(self) -> List[Dict[str, Any]]:
        return list(self._manifest()["artifacts"].values())

    def get(
        self, artifact_id: str, version: Optional[int] = None
    ) -> Optional[Dict[str, Any]]:
        aid = self._validate_id(artifact_id)
        entry = self._manifest()["artifacts"].get(aid)
        if not entry:
            return None
        selected = version if version is not None else entry.get("latest_version", 1)
        if not isinstance(selected, int) or selected < 1:
            raise ValueError("artifact version must be a positive integer")
        path = (self.artifacts / aid / f"v{selected:04d}.json").resolve()
        if not path.is_relative_to(self.artifacts.resolve()):
            raise ValueError("artifact version path escapes the workspace")
        if not path.is_file():
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ValueError(f"artifact file is unreadable or corrupt: {path}") from exc

    def search(
        self, query: str, limit: int = 10, offset: int = 0
    ) -> List[Dict[str, Any]]:
        terms = [x.lower() for x in re.findall(r"[\w-]+", query) if len(x) > 1]
        scored = []
        for entry in self.list():
            artifact = self.get(entry["artifact_id"])
            text = json.dumps(
                artifact or entry, ensure_ascii=False, default=str
            ).lower()
            score = sum(text.count(term) for term in terms)
            if score:
                scored.append((score, artifact))
        scored.sort(key=lambda item: item[0], reverse=True)
        start = max(0, int(offset))
        return [item for _, item in scored[start : start + max(1, int(limit))]]

    def search_summaries(
        self, query: str, limit: int = 10, offset: int = 0
    ) -> List[Dict[str, Any]]:
        return [
            {
                k: item.get(k)
                for k in (
                    "artifact_id",
                    "version",
                    "type",
                    "format",
                    "title",
                    "evidence",
                    "metadata",
                    "relationships",
                )
            }
            | {"content_preview": self._preview(item.get("content", ""), query)}
            for item in self.search(query, limit, offset)
        ]

    def read_page(
        self,
        artifact_id: str,
        version: Optional[int] = None,
        record_key: Optional[str] = None,
        record_id: Optional[str] = None,
        offset: int = 0,
        limit: int = 20,
    ) -> Optional[Dict[str, Any]]:
        artifact = self.get(artifact_id, version)
        if artifact is None:
            return None
        content = artifact.get("content")
        if record_key:
            records = content.get(record_key) if isinstance(content, dict) else None
            if not isinstance(records, list):
                raise ValueError(f"artifact content has no record list {record_key!r}")
            if record_id is not None:
                matches = [
                    record
                    for record in records
                    if isinstance(record, dict)
                    and str(
                        record.get(
                            "finding_id", record.get("record_id", record.get("id", ""))
                        )
                    )
                    == str(record_id)
                ]
                return {
                    "artifact_id": artifact_id,
                    "version": artifact["version"],
                    "record_key": record_key,
                    "records": matches,
                    "total": len(matches),
                }
            start = max(0, int(offset))
            size = max(1, int(limit))
            return {
                "artifact_id": artifact_id,
                "version": artifact["version"],
                "record_key": record_key,
                "records": records[start : start + size],
                "offset": start,
                "total": len(records),
            }
        # Extraction artifacts commonly have findings; return their first page
        # and retain every other flexible content field in a small overview.
        if isinstance(content, dict):
            record_lists = [
                key for key, value in content.items() if isinstance(value, list)
            ]
            if record_lists:
                key = "findings" if "findings" in record_lists else record_lists[0]
                return {
                    "artifact_id": artifact_id,
                    "version": artifact["version"],
                    "title": artifact.get("title"),
                    "record_key": key,
                    "records": content[key][:20],
                    "offset": 0,
                    "total": len(content[key]),
                    "other_content": {k: v for k, v in content.items() if k != key},
                }
        return artifact

    @staticmethod
    def _preview(content: Any, query: str, width: int = 1200) -> str:
        text = (
            content
            if isinstance(content, str)
            else json.dumps(content, ensure_ascii=False, default=str)
        )
        terms = [x.lower() for x in re.findall(r"[\w-]+", query) if len(x) > 1]
        lowered = text.lower()
        positions = [lowered.find(term) for term in terms if lowered.find(term) >= 0]
        start = max(0, (min(positions) if positions else 0) - width // 4)
        return text[start : start + width]

    def upsert(
        self, artifact: Dict[str, Any], artifact_id: Optional[str] = None
    ) -> Dict[str, Any]:
        with self._lock:
            manifest = self._manifest()
            aid = self._validate_id(
                artifact.get("artifact_id")
                or artifact_id
                or f"artifact_{len(manifest['artifacts']) + 1}"
            )
            existing = manifest["artifacts"].get(aid, {})
            previous = self.get(aid) if existing else {}
            version = int(existing.get("latest_version", 0)) + 1
            # Revision payloads are patches: omitted content and metadata survive.
            envelope = {
                **(previous or {}),
                **artifact,
                "artifact_id": aid,
                "version": version,
                "type": artifact.get("type", (previous or {}).get("type", "custom")),
                "format": artifact.get(
                    "format", (previous or {}).get("format", "json")
                ),
                "title": artifact.get("title", (previous or {}).get("title", aid)),
                "content": artifact.get("content", (previous or {}).get("content", {})),
                "evidence": artifact.get(
                    "evidence", (previous or {}).get("evidence", [])
                ),
                "metadata": {
                    **((previous or {}).get("metadata", {}) or {}),
                    **(artifact.get("metadata", {}) or {}),
                },
                "relationships": artifact.get(
                    "relationships", (previous or {}).get("relationships", [])
                ),
                "created_at": (previous or {}).get("created_at", _now()),
                "updated_at": _now(),
            }
            self._validate_known_artifact_relationships(envelope, manifest)
            path = self.artifacts / aid / f"v{version:04d}.json"
            self._atomic_json(path, envelope, exclusive=True)
            manifest["artifacts"][aid] = {
                "artifact_id": aid,
                "latest_version": version,
                "type": envelope["type"],
                "format": envelope["format"],
                "title": envelope["title"],
                "updated_at": envelope["updated_at"],
            }
            manifest["updated_at"] = _now()
            self._write_manifest(manifest)
            return envelope

    @staticmethod
    def _validate_known_artifact_relationships(artifact, manifest):
        refs = artifact.get("relationships") or []
        if not isinstance(refs, list):
            metadata = artifact.setdefault("metadata", {})
            metadata["reference_warnings"] = [
                *metadata.get("reference_warnings", []),
                "relationships are not a list; references were not checked",
            ]
            return
        # Unknown targets are retained as warnings in metadata, not rejected:
        # references may point to source documents outside this workspace.
        missing = []
        for ref in refs:
            if not isinstance(ref, dict) or not ref.get("artifact_id"):
                continue
            target = manifest["artifacts"].get(str(ref["artifact_id"]))
            if not target:
                missing.append(f"unknown artifact reference: {ref['artifact_id']}")
                continue
            version = ref.get("version")
            if version is not None and (
                not isinstance(version, int)
                or version < 1
                or version > target["latest_version"]
            ):
                missing.append(
                    f"unknown artifact version: {ref['artifact_id']}@{version}"
                )
        if missing:
            metadata = artifact.setdefault("metadata", {})
            existing = metadata.get("reference_warnings", [])
            if not isinstance(existing, list):
                existing = [str(existing)]
            metadata["reference_warnings"] = sorted(set(existing + missing))

    def digest(self, offset: int = 0, limit: int = 50) -> List[Dict[str, Any]]:
        entries = self.list()
        start = max(0, int(offset))
        size = max(1, int(limit))
        return [
            {
                k: entry.get(k)
                for k in ("artifact_id", "latest_version", "type", "format", "title")
            }
            for entry in entries[start : start + size]
        ]
