"""Deterministic evidence preparation for the V2 synthesizer."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any


def _read(path: Path) -> dict[str, Any] | None:
    try:
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None
    except (OSError, json.JSONDecodeError):
        return None


class EvidenceAssembler:
    """Merge bounded recovery artifacts without letting them hide full-run evidence."""
    def __init__(self, extraction_dir: Path):
        self.root = extraction_dir
        self.manifest = _read(extraction_dir / "manifest.json") or {}
        self.pack = _read(extraction_dir / "evidence_pack.json")

    def _versions(self, artifact_id: str) -> list[dict[str, Any]]:
        return (self.manifest.get("artifacts", {}).get(artifact_id, {}) or {}).get("versions", [])

    def _artifact(self, ref: dict[str, Any]) -> dict[str, Any] | None:
        if self.pack:
            wanted = ref.get("artifact_id")
            packed = next((x for x in (self.pack.get("chunk_index") or self.pack.get("chunk_evidence") or []) if x.get("artifact_id") == wanted), None)
            if packed is not None: return packed
        path = ref.get("path") or ref.get("artifact_path")
        return _read(self.root / path) if path else None

    def build(self) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
        if self.pack:
            return self._build_pack()
        versions = self._versions("evidence_manifest")
        if not versions:
            raise ValueError("completed evidence manifest is required before synthesis")
        manifests = [(v, self._artifact(v)) for v in versions]
        manifests = [(v, m) for v, m in manifests if m]
        base = next((m for _, m in manifests if not (m.get("scope") or {}).get("bounded")), manifests[0][1])
        logical: dict[str, dict[str, Any]] = {}
        for ref in base.get("chunks", []):
            if ref.get("path") and (self.root / ref["path"]).exists():
                logical[ref.get("chunk", {}).get("chunk_id", ref.get("artifact_id", ""))] = ref
        # A bounded recovery replaces its parent logical chunk only when it is successful.
        for _, manifest in manifests:
            if not (manifest.get("scope") or {}).get("bounded"):
                continue
            for ref in manifest.get("chunks", []):
                chunk = ref.get("chunk", {})
                if ref.get("path") and (self.root / ref["path"]).exists():
                    parent = chunk.get("parent_chunk_id")
                    if parent:
                        logical.pop(parent, None)
                    logical[chunk.get("chunk_id", ref.get("artifact_id", ""))] = ref
        chunks = list(logical.values())
        groups: dict[str, dict[str, Any]] = {}
        for _, manifest in manifests:
            for group in manifest.get("group_analyses", []):
                if group.get("status") == "success" and group.get("path") and (self.root / group["path"]).exists():
                    groups[group.get("target_id", group.get("artifact_id", ""))] = group
        logical_ids = {next((r.get("chunk", {}).get("parent_chunk_id") for r in [ref] if r.get("chunk", {}).get("parent_chunk_id")), r.get("chunk", {}).get("chunk_id", r.get("artifact_id", ""))) for r in chunks}
        logical_ids = {((ref.get("chunk") or {}).get("parent_chunk_id") or (ref.get("chunk") or {}).get("chunk_id", ref.get("artifact_id", ""))) for ref in chunks}
        effective = {**base, "artifact_type": "effective_evidence_manifest", "chunks": chunks, "group_analyses": list(groups.values()), "assembly": {"source_versions": [v.get("version") for v, _ in manifests], "physical_artifact_count": len(chunks), "logical_chunk_count": len(logical_ids)}}
        index = self._index(effective)
        coverage = self._coverage(effective, index)
        return effective, index, coverage

    def _build_pack(self) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
        pack = self.pack or {}
        packed_chunks = pack.get("chunk_index") or pack.get("chunk_evidence") or []
        chunks = []
        for item in packed_chunks:
            chunk = item.get("chunk") or {key: item.get(key) for key in ("chunk_id", "target_id", "document_id", "pages", "parent_chunk_id")}
            chunks.append({"chunk": chunk, "artifact_id": item.get("artifact_id"), "version": item.get("artifact_version", pack.get("version")), "path": item.get("artifact_path") or item.get("path"), "packed": True})
        targets = pack.get("planner_targets", [])
        groups = [{"target_id": item.get("target_id") or (item.get("target") or {}).get("target_id"), "artifact_id": item.get("artifact_id"), "version": item.get("artifact_version", pack.get("version")), "status": "success", "analysis": item.get("analysis"), "packed": True} for item in pack.get("group_analyses", [])]
        effective = {"artifact_type": "effective_evidence_manifest", "research_id": pack.get("research_id"), "plan_id": pack.get("plan_id"), "objective": pack.get("objective"), "targets": targets, "chunks": chunks, "group_analyses": groups, "limitations": pack.get("limitations", []), "assembly": {"source": "evidence_pack.json", "pack_version": pack.get("version", pack.get("pack_version")), "physical_artifact_count": len(chunks), "logical_chunk_count": len({(x.get("chunk", {}).get("parent_chunk_id") or x.get("chunk", {}).get("chunk_id")) for x in chunks})}}
        index = self._index(effective)
        coverage = self._coverage(effective, index)
        coverage["source"] = "evidence_pack.json"
        return effective, index, coverage

    def _index(self, manifest: dict[str, Any]) -> dict[str, Any]:
        items: list[dict[str, Any]] = []
        invalid_coordinates: list[dict[str, Any]] = []
        for ref in manifest.get("chunks", []):
            artifact = self._artifact(ref) or {}
            chunk = ref.get("chunk", {})
            for collection in ("facts", "records", "relationships", "measurements", "uncertainties", "limitations"):
                values = artifact.get(collection) or (artifact.get("extraction") or {}).get(collection) or ref.get(collection) or []
                if isinstance(values, dict): values = [values]
                for pos, value in enumerate(values):
                    if not isinstance(value, dict): value = {"value": value}
                    item_id = f"{ref.get('artifact_id', chunk.get('chunk_id', 'chunk'))}:{collection}:{pos}"
                    item = {"id": item_id, "class": collection[:-1] if collection.endswith("s") else collection, "chunk_id": chunk.get("chunk_id"), "target_id": chunk.get("target_id"), "document_id": chunk.get("document_id"), "pages": chunk.get("pages", []), "value": value}
                    item["grounding"] = "grounded" if value.get("evidence") or value.get("source_refs") or value.get("pdf_page_number") else "unverified"
                    coords = value.get("coordinates") or value.get("coordinate")
                    if coords and not self._valid_coords(coords):
                        invalid_coordinates.append({"id": item_id, "value": coords})
                        item["visualization_status"] = "quarantined_invalid_coordinates"
                    items.append(item)
        by_class: dict[str, list[str]] = {}
        for item in items: by_class.setdefault(item["class"], []).append(item["id"])
        return {"schema_version": "1.0", "items": items, "by_class": by_class, "invalid_coordinates": invalid_coordinates, "item_count": len(items)}

    @staticmethod
    def _valid_coords(value: Any) -> bool:
        if isinstance(value, dict):
            lat, lon = value.get("latitude", value.get("lat")), value.get("longitude", value.get("lon"))
            return isinstance(lat, (int, float)) and isinstance(lon, (int, float)) and -90 <= lat <= 90 and -180 <= lon <= 180
        if isinstance(value, (list, tuple)) and len(value) >= 2:
            return all(isinstance(x, (int, float)) for x in value[:2])
        return False

    @staticmethod
    def _coverage(manifest: dict[str, Any], index: dict[str, Any]) -> dict[str, Any]:
        targets = manifest.get("targets", [])
        # Leaf evidence is sufficient coverage. A group analysis is an optional
        # summarization artifact and must not make a target appear missing.
        covered = {((ref.get("chunk") or {}).get("target_id")) for ref in manifest.get("chunks", [])}
        covered.discard(None)
        return {"planned_targets": len(targets), "targets_with_group_analysis": len(covered), "missing_target_ids": [t.get("target_id") for t in targets if t.get("target_id") not in covered], "physical_evidence_artifacts": len(manifest.get("chunks", [])), "logical_chunks": (manifest.get("assembly") or {}).get("logical_chunk_count", len(manifest.get("chunks", []))), "indexed_items": index["item_count"], "invalid_coordinate_count": len(index["invalid_coordinates"]), "limitations": manifest.get("limitations", [])}


def stable_hash(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()[:16]


def build_data_catalog(index: dict[str, Any], source_inventories: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Build the self-contained deterministic evidence catalogue for synthesis.v2."""
    items = []
    by_class: dict[str, list[str]] = {}
    by_target: dict[str, list[str]] = {}
    for raw in index.get("items", []):
        item = {
            "id": raw.get("id"),
            "type": raw.get("class"),
            "target_id": raw.get("target_id"),
            "chunk_id": raw.get("chunk_id"),
            "document_id": raw.get("document_id"),
            "pages": raw.get("pages", []),
            "value": raw.get("value", {}),
            "grounding": raw.get("grounding", "unverified"),
        }
        if raw.get("visualization_status"):
            item["visualization_status"] = raw["visualization_status"]
        items.append(item)
        by_class.setdefault(str(item["type"]), []).append(item["id"])
        by_target.setdefault(str(item.get("target_id") or "unassigned"), []).append(item["id"])
    datasets = [
        {"id": "dataset_all_evidence", "type": "evidence_catalogue", "item_ids": [item["id"] for item in items]},
    ]
    for item_type, ids in sorted(by_class.items()):
        datasets.append({"id": f"dataset_{item_type}", "type": item_type, "item_ids": ids})
    return {
        "schema_version": "data-catalog.v1",
        "items": items,
        "datasets": datasets,
        "sources": source_inventories or [],
        "indexes": {"by_class": by_class, "by_target": by_target},
        "invalid_coordinates": index.get("invalid_coordinates", []),
        "item_count": len(items),
    }


class SynthesisEvidenceProjector:
    """Create a smaller, semantically lossless model payload from the extractor pack."""

    COLLECTIONS = ("facts", "records", "relationships", "measurements")
    CHUNK_CONTEXT = ("chunk_id", "target_id", "document_id", "pages")

    def project(self, pack: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
        chunks = pack.get("chunk_index") or pack.get("chunk_evidence") or []
        analyses = {
            item.get("target_id") or (item.get("target") or {}).get("target_id"): self._clean(item.get("analysis"))
            for item in pack.get("group_analyses", [])
        }
        grouped: dict[str, list[dict[str, Any]]] = {}
        before = self._counts(chunks)
        for original in chunks:
            source = original.get("extraction") or original
            chunk_meta = original.get("chunk") or original
            target_id = chunk_meta.get("target_id") or "unassigned"
            chunk: dict[str, Any] = {
                key: cleaned for key in self.CHUNK_CONTEXT
                if (cleaned := self._clean(chunk_meta.get(key))) not in (None, "", [], {})
            }
            for collection in self.COLLECTIONS:
                values = source.get(collection) or []
                if isinstance(values, dict):
                    values = [values]
                # Keep the deterministic index identity inside the compact
                # projection so branch prompts can cite evidence without
                # receiving the full expanded catalogue.
                identified = []
                for position, value in enumerate(values):
                    if isinstance(value, dict):
                        value = {**value, "_evidence_id": f"{original.get('artifact_id', chunk_meta.get('chunk_id', 'chunk'))}:{collection}:{position}"}
                    else:
                        value = {"value": value, "_evidence_id": f"{original.get('artifact_id', chunk_meta.get('chunk_id', 'chunk'))}:{collection}:{position}"}
                    identified.append(value)
                compact = self._compact_collection(identified)
                if compact:
                    chunk[collection] = compact
            for key in ("coverage", "missing_expected_information", "uncertainties", "limitations"):
                value = self._clean(source.get(key))
                if value not in (None, "", [], {}):
                    chunk[key] = value
            grouped.setdefault(target_id, []).append(chunk)

        groups = []
        for target_id, group_chunks in grouped.items():
            group: dict[str, Any] = {"target_id": target_id, "chunks": group_chunks}
            if analyses.get(target_id) not in (None, "", [], {}):
                group["analysis"] = analyses[target_id]
            groups.append(group)

        projection = self._clean({
            "schema_version": "synthesis-evidence.v1",
            "research_id": pack.get("research_id"),
            "objective": pack.get("objective"),
            "source_inventories": pack.get("source_inventories", []),
            "groups": groups,
            "limitations": pack.get("limitations", []),
            "coverage": pack.get("coverage", {}),
        })
        after = self._projection_counts(projection)
        if before != after:
            raise ValueError(f"synthesis evidence projection changed evidence counts: before={before}, after={after}")
        raw_chars = len(json.dumps(pack, ensure_ascii=False, default=str))
        projected_chars = len(json.dumps(projection, ensure_ascii=False, default=str))
        audit = {
            "schema_version": "synthesis-compaction-audit.v1",
            "lossless_evidence_counts": before,
            "counts_match": True,
            "raw_characters": raw_chars,
            "projected_characters": projected_chars,
            "character_reduction": raw_chars - projected_chars,
            "reduction_percent": round(100 * (raw_chars - projected_chars) / raw_chars, 2) if raw_chars else 0.0,
            "raw_estimated_tokens": max(1, (raw_chars + 2) // 3),
            "projected_estimated_tokens": max(1, (projected_chars + 2) // 3),
            "token_estimation": {"characters_per_token": 3.0, "request_overhead_included": False},
            "policy": {
                "evidence_ranked": False,
                "evidence_truncated": False,
                "evidence_semantically_merged": False,
                "empty_values_removed": True,
                "common_scalar_fields_hoisted": True,
                "extractor_orchestration_metadata_excluded": True,
            },
            "projection_hash": stable_hash(projection),
        }
        return projection, audit

    @classmethod
    def _compact_collection(cls, values: list[Any]) -> dict[str, Any] | list[Any] | None:
        cleaned = [cls._clean(value) for value in values]
        if not cleaned:
            return None
        dictionaries = [value for value in cleaned if isinstance(value, dict)]
        if len(dictionaries) != len(cleaned):
            return cleaned
        common: dict[str, Any] = {}
        shared_keys = set(dictionaries[0])
        for value in dictionaries[1:]:
            shared_keys.intersection_update(value)
        for key in sorted(shared_keys):
            candidate = dictionaries[0][key]
            if isinstance(candidate, (str, int, float, bool)) and all(value.get(key) == candidate for value in dictionaries[1:]):
                common[key] = candidate
        items = [{key: value for key, value in item.items() if key not in common} for item in dictionaries]
        result: dict[str, Any] = {"items": items}
        if common:
            result["defaults"] = common
        return result

    @classmethod
    def _clean(cls, value: Any) -> Any:
        if isinstance(value, dict):
            return {key: cleaned for key, item in value.items() if (cleaned := cls._clean(item)) not in (None, "", [], {})}
        if isinstance(value, list):
            # List positions can carry record identity, so retain every member even
            # when an extractor emitted an empty placeholder object.
            return [cls._clean(item) for item in value]
        return value

    @classmethod
    def _counts(cls, chunks: list[dict[str, Any]]) -> dict[str, int]:
        counts = {key: 0 for key in cls.COLLECTIONS}
        counts.update({"uncertainties": 0, "limitations": 0})
        for original in chunks:
            source = original.get("extraction") or original
            for key in counts:
                value = source.get(key) or []
                counts[key] += len(value) if isinstance(value, list) else int(bool(value))
        return counts

    @classmethod
    def _projection_counts(cls, projection: dict[str, Any]) -> dict[str, int]:
        counts = {key: 0 for key in cls.COLLECTIONS}
        counts.update({"uncertainties": 0, "limitations": 0})
        for group in projection.get("groups", []):
            for chunk in group.get("chunks", []):
                for key in cls.COLLECTIONS:
                    value = chunk.get(key) or {}
                    counts[key] += len(value.get("items", [])) if isinstance(value, dict) else len(value)
                for key in ("uncertainties", "limitations"):
                    value = chunk.get(key) or []
                    counts[key] += len(value) if isinstance(value, list) else int(bool(value))
        return counts
