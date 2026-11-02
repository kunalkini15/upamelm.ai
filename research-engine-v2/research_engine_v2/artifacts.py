from __future__ import annotations

import hashlib
import json
import os
import tempfile
from pathlib import Path
from typing import Any


class ArtifactStore:
    def __init__(self, root: Path):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self.manifest_path = root / "manifest.json"
        self.manifest = {"artifacts": {}, "events": []}
        if self.manifest_path.exists():
            self.manifest = json.loads(self.manifest_path.read_text(encoding="utf-8"))

    def _atomic(self, path: Path, data: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp, path)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)

    def write_json(self, relative: str, value: Any) -> Path:
        path = self.root / relative
        data = json.dumps(value, indent=2, ensure_ascii=False, default=str) + "\n"
        self._atomic(path, data)
        return path

    def write_text(self, relative: str, value: str) -> Path:
        path = self.root / relative
        self._atomic(path, value)
        return path

    def version(self, artifact_id: str, value: Any, kind: str = "json") -> tuple[Path, int]:
        entry = self.manifest["artifacts"].setdefault(artifact_id, {"versions": []})
        version = len(entry["versions"]) + 1
        rel = f"artifacts/{artifact_id}/v{version:04d}.{kind}"
        path = self.write_json(rel, value) if kind == "json" else self.write_text(rel, str(value))
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        entry["versions"].append({"version": version, "path": rel, "sha256": digest})
        self.flush_manifest()
        return path, version

    def event(self, event: dict[str, Any]) -> None:
        self.manifest["events"].append(event)
        event_path = self.root / "telemetry" / "events.ndjson"
        event_path.parent.mkdir(parents=True, exist_ok=True)
        with event_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(event, ensure_ascii=False, default=str) + "\n")
            handle.flush()

    def flush_manifest(self) -> None:
        self.write_json("manifest.json", self.manifest)
