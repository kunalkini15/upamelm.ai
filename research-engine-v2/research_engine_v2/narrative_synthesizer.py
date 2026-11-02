"""Evidence-grounded narrative enrichment over a completed UI package."""
from __future__ import annotations

import json
import logging
import re
import threading
import math
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

from .artifacts import ArtifactStore
from .models import Request, SynthesizerConfig
from .muse import ResponsesTransport
from .narrative_contract import NARRATIVE_SCHEMA_VERSION, feature_generation_schema, validate_feature_insight, validate_narrative
from .synthesis_support import EvidenceAssembler, SynthesisEvidenceProjector, stable_hash


FEATURE_INSTRUCTIONS = """You are an expert scientific insight writer for an interactive subsurface
research experience. Produce a clear, useful explanation for a non-technical investor or decision-maker.
Use the supplied evidence as the factual foundation. Combine measurements, geology, trends,
comparisons, regional context and source interpretations into an insight rather than repeating rows.
Explain what makes this feature distinctive, why it matters, and what the user should notice in the
map or 3D view. You may interpret and prioritize freely, but do not invent facts, measurements,
locations, dates, units, relationships, or unsupported regulatory, health, financial-return, or
engineering claims.

The host already knows the feature identity. Do not return feature IDs, insight IDs, dataset IDs,
observation IDs, interval IDs, source IDs, status fields, or any other canonical identifiers.
For each insight, cite the supplied local evidence handles (such as e1 or e2). Use only those handles.
Keep the visible summary to two or three useful sentences and avoid generic disclaimers.

Return only the requested JSON. Good output identifies the strongest signal, combines related facts,
and explains significance. It does not merely define a measurement or copy every supplied value."""


def _tokens(value: Any) -> list[str]:
    return [x for x in re.findall(r"[a-z0-9]+(?:\.[0-9]+)?", str(value).lower()) if len(x) > 1]


class NarrativeSynthesizer:
    MAX_FEATURE_CONTEXT_CHARS = 30000
    def __init__(self, request: Request, run_dir: Path, extraction_dir: Path, synthesis_dir: Path, config: SynthesizerConfig | None = None):
        self.request = request
        self.run_dir = Path(run_dir)
        self.extraction_dir = Path(extraction_dir)
        self.synthesis_dir = Path(synthesis_dir)
        self.synthesis_dir.mkdir(parents=True, exist_ok=True)
        self.config = config or SynthesizerConfig()
        self.store = ArtifactStore(self.synthesis_dir)
        self.transport = ResponsesTransport(self.synthesis_dir / "model_io", max_output_tokens=self.config.max_output_tokens)
        self.log = logging.getLogger("research_engine_v2")

    def run(self, resume: bool = False, concurrency: int = 16, deterministic_only: bool = False, feature_scope: str = "renderable") -> dict[str, Any]:
        ui_path = self.synthesis_dir / "ui_rendering_package.json"
        if not ui_path.exists():
            raise FileNotFoundError(f"completed UI package is required: {ui_path}")
        ui = json.loads(ui_path.read_text(encoding="utf-8"))
        if not isinstance(ui, dict) or ui.get("schema_version") != "1.0":
            raise ValueError("ui_rendering_package.json is not a valid v1 package")
        assembler = EvidenceAssembler(self.extraction_dir)
        effective, _, coverage = assembler.build()
        pack = self._projectable_pack(assembler, effective)
        projection, _ = SynthesisEvidenceProjector().project(pack)
        units = self._build_units(projection, pack)
        index = self._build_index(units)
        self.store.write_json("ui_narrative_retrieval_index.json", {"schema_version": "narrative-retrieval.v1", "unit_count": len(units), "units": [{k: u.get(k) for k in ("id", "class", "chunk_id", "target_id", "document_id", "pages", "artifact_path", "content_hash")} for u in units], "lookups": {k: sorted(v) if isinstance(v, set) else v for k, v in index["lookups"].items()}, "coverage": coverage})
        eligibility = {str(f.get("id")): self._feature_eligibility(f) for f in ui.get("features", []) if isinstance(f, dict) and f.get("id")}
        selected_ids = set(eligibility) if feature_scope == "all" else {fid for fid, item in eligibility.items() if item["eligible"]}
        self.store.write_json("ui_narrative_feature_eligibility.json", {"schema_version": "ui-narrative-eligibility.v1", "feature_scope": feature_scope, "scope": feature_scope, "total_features": len(eligibility), "eligible_features": sum(x["eligible"] for x in eligibility.values()), "selected_features": len(selected_ids), "excluded_features": len(eligibility) - len(selected_ids), "records": [{"feature_id": fid, **item} for fid, item in sorted(eligibility.items())]})
        contexts, audits = self._feature_contexts(ui, units, index, selected_ids)
        self.store.write_json("ui_feature_insight_dossiers.json", contexts)
        features = self._run_feature_synthesis(ui, contexts, audits, resume, concurrency, deterministic_only)
        # Feature synthesis may drop invalid model-created references; persist the
        # final retrieval/audit state after normalization, not only the pre-call state.
        self.store.write_json("ui_feature_retrieval_audit.json", audits)
        submitted_ids = {str(x.get("feature_id")) for x in features if x.get("feature_id")}
        package = {"schema_version": NARRATIVE_SCHEMA_VERSION, "report_id": (ui.get("report") or {}).get("id"), "audience": "investor_non_technical", "feature_insights": features, "coverage": self._coverage(features, audits, eligibility, feature_scope, submitted_ids)}
        validation = validate_narrative(package, ui, set(index["by_id"]), submitted_ids)
        self.store.write_json("ui_narrative_validation_report.json", validation)
        self.store.write_json("ui_narrative_generation_audit.json", {"schema_version": NARRATIVE_SCHEMA_VERSION, "coverage": package["coverage"], "validation": validation, "calls": self.transport.usage_records})
        if not validation["valid"]:
            raise ValueError(f"narrative package failed validation: {validation['issues'][:3]}")
        # A deterministic-only pass is an assembly operation, never a destructive
        # replacement.  If no cached responses were available, preserve the last
        # consumer package rather than publishing an empty package.
        package_path = self.synthesis_dir / "ui_synthesis_package.json"
        if not (deterministic_only and not features and package_path.exists()):
            self.store.write_json("ui_synthesis_package.json", package)
        limited = any(x.get("generation_error") or x.get("status") == "insufficient_evidence" or x.get("unresolved_model_handles") for x in audits.values())
        return {"status": "completed_with_limitations" if (limited or (deterministic_only and not features)) else "completed", "artifact_id": "ui_synthesis_package", "path": str(package_path), "counts": validation["counts"], "warnings": validation["warnings"]}

    @staticmethod
    def _feature_eligibility(feature: dict[str, Any]) -> dict[str, Any]:
        """Determine renderability without report-specific geographic heuristics."""
        warnings: list[str] = []
        geometry = feature.get("geometry") if isinstance(feature.get("geometry"), dict) else None
        point: tuple[float, float] | None = None
        source = None
        geometry_reason = "missing_geometry"
        if geometry and geometry.get("type") != "Point":
            geometry_reason = "unsupported_geometry_type"
        if geometry and geometry.get("type") == "Point":
            coords = geometry.get("coordinates")
            if not isinstance(coords, (list, tuple)) or len(coords) != 2:
                geometry_reason = "incomplete_coordinate_pair"
            elif isinstance(coords, (list, tuple)) and len(coords) == 2:
                try: point = (float(coords[0]), float(coords[1]))
                except (TypeError, ValueError): point = None
                if point and not all(math.isfinite(v) for v in point):
                    geometry_reason = "non_finite_coordinates"
                    point = None
                elif point and not (-180 <= point[0] <= 180 and -90 <= point[1] <= 90):
                    geometry_reason = "coordinates_out_of_range"
                    point = None
                elif point:
                    source = "geometry"
                else:
                    geometry_reason = "non_numeric_coordinates"
        props = feature.get("properties")
        if isinstance(props, list): props = {str(x.get("name")): x.get("value") for x in props if isinstance(x, dict) and x.get("name")}
        props = props if isinstance(props, dict) else {}
        def number(names: tuple[str, ...]) -> float | None:
            for name in names:
                value = props.get(name)
                try:
                    value = float(value)
                    if math.isfinite(value): return value
                except (TypeError, ValueError): pass
            return None
        lat = number(("latitude", "lat", "y_lat", "latitude_reported", "latitude_y_lat")); lon = number(("longitude", "lon", "lng", "long", "x_long", "longitude_reported", "longitude_x_long"))
        lat_present = any(name in props for name in ("latitude", "lat", "y_lat", "latitude_reported", "latitude_y_lat"))
        lon_present = any(name in props for name in ("longitude", "lon", "lng", "long", "x_long", "longitude_reported", "longitude_x_long"))
        prop_pair = lat is not None and lon is not None
        prop_in_bounds = prop_pair and -90 <= lat <= 90 and -180 <= lon <= 180
        prop_point = (lon, lat) if prop_in_bounds else None
        if point is not None and prop_point is not None and (abs(point[0] - prop_point[0]) > 1e-6 or abs(point[1] - prop_point[1]) > 1e-6): warnings.append("geometry_property_coordinate_conflict")
        if point is not None: return {"eligible": True, "reason": "valid_point_geometry", "coordinate_source": source, "coordinates": {"longitude": point[0], "latitude": point[1]}, "warnings": warnings}
        if prop_point is not None: return {"eligible": True, "reason": "explicit_property_coordinates", "coordinate_source": "properties", "coordinates": {"longitude": prop_point[0], "latitude": prop_point[1]}, "warnings": warnings}
        if geometry and prop_point is None and geometry_reason in {"missing_geometry", "unsupported_geometry_type"}:
            reason = geometry_reason
        elif geometry and prop_point is None:
            reason = geometry_reason
        elif not geometry and not lat_present and not lon_present:
            reason = "missing_geometry"
        elif not geometry and prop_pair and not prop_in_bounds:
            reason = "coordinates_out_of_range"
        elif not geometry and ((lat_present and lat is None) or (lon_present and lon is None)):
            reason = "non_numeric_coordinates"
        elif not geometry and (lat is not None or lon is not None):
            reason = "non_numeric_coordinates"
        else:
            reason = "coordinates_out_of_range"
        return {"eligible": False, "reason": reason, "coordinate_source": None, "coordinates": None, "warnings": warnings}

    @staticmethod
    def _projectable_pack(assembler: EvidenceAssembler, effective: dict[str, Any]) -> dict[str, Any]:
        """Normalize both packed and manifest-only extractor layouts for projection."""
        if assembler.pack:
            return assembler.pack
        chunks: list[dict[str, Any]] = []
        for ref in effective.get("chunks", []):
            artifact = assembler._artifact(ref) or {}
            chunk = {**(ref.get("chunk") or {}), "artifact_id": ref.get("artifact_id"), "artifact_path": ref.get("path")}
            if isinstance(artifact, dict):
                chunk.update(artifact)
            chunks.append(chunk)
        return {"chunk_index": chunks, "group_analyses": [], "source_inventories": effective.get("source_inventories", []), "research_id": effective.get("research_id"), "objective": effective.get("objective")}

    @staticmethod
    def _build_units(projection: dict[str, Any], pack: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        units: list[dict[str, Any]] = []
        artifact_paths = {str((x.get("chunk") or x).get("chunk_id")): x.get("artifact_path") or x.get("path") for x in (pack or {}).get("chunk_index", []) if isinstance(x, dict)}
        for group in projection.get("groups", []):
            for chunk in group.get("chunks", []):
                for collection in ("facts", "records", "relationships", "measurements"):
                    value = chunk.get(collection) or []
                    values = value.get("items", []) if isinstance(value, dict) else value
                    defaults = value.get("defaults", {}) if isinstance(value, dict) else {}
                    for item in values:
                        item = {**defaults, **item} if isinstance(item, dict) else {"value": item}
                        ident = str(item.get("_evidence_id") or f"{chunk.get('chunk_id', 'chunk')}:{collection}:{len(units)}")
                        units.append({"id": ident, "class": collection[:-1] if collection.endswith("s") else collection, "chunk_id": chunk.get("chunk_id"), "target_id": chunk.get("target_id"), "document_id": chunk.get("document_id"), "pages": chunk.get("pages", []), "artifact_path": artifact_paths.get(str(chunk.get("chunk_id"))), "value": item, "text": json.dumps(item, ensure_ascii=False, default=str), "content_hash": stable_hash(item)})
        return units

    @staticmethod
    def _build_index(units: list[dict[str, Any]]) -> dict[str, Any]:
        by_id = {u["id"]: u for u in units}
        by_record: dict[str, list[str]] = {}
        for u in units:
            value = u["value"]
            for key in ("record_id", "source_record_id", "fact_id", "table_id", "_evidence_id"):
                if value.get(key): by_record.setdefault(str(value[key]), []).append(u["id"])
        by_chunk: dict[str, list[str]] = {}; by_target: dict[str, list[str]] = {}; by_page: dict[str, list[str]] = {}
        for u in units:
            if u.get("chunk_id"): by_chunk.setdefault(str(u["chunk_id"]), []).append(u["id"])
            if u.get("target_id"): by_target.setdefault(str(u["target_id"]), []).append(u["id"])
            for page in u.get("pages") or []: by_page.setdefault(str(page), []).append(u["id"])
        return {"by_id": by_id, "by_record": by_record, "items": units, "lookups": {"by_record": by_record, "by_chunk": by_chunk, "by_target": by_target, "by_page": by_page}}

    def _feature_contexts(self, ui: dict[str, Any], units: list[dict[str, Any]], index: dict[str, Any], feature_ids: set[str] | None = None) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
        observations = {x.get("id"): x for x in ui.get("observations", []) if isinstance(x, dict)}
        intervals = {x.get("id"): x for x in ui.get("intervals", []) if isinstance(x, dict)}
        datasets = {x.get("id"): x for x in ui.get("extensions", {}).get("datasets", []) if isinstance(x, dict)}
        relationships = ui.get("extensions", {}).get("relationships", [])
        contexts: dict[str, dict[str, Any]] = {}; audits: dict[str, dict[str, Any]] = {}
        for feature in ui.get("features", []):
            fid = str(feature.get("id")); linked_obs = [x for x in observations.values() if x.get("feature_id") == fid]; linked_intervals = [x for x in intervals.values() if x.get("feature_id") == fid]
            if feature_ids is not None and fid not in feature_ids: continue
            linked_rel = [x for x in relationships if x.get("from_id") == fid or x.get("to_id") == fid]
            refs = set(str(x) for x in feature.get("source_refs", []))
            for item in linked_obs + linked_intervals + linked_rel: refs.update(str(x) for x in item.get("source_refs", []))
            direct = []
            resolved_ref_keys: set[str] = set()
            for ref in sorted(refs):
                ids = [ref] if ref in index["by_id"] else index["by_record"].get(ref, [])
                if ids:
                    resolved_ref_keys.add(ref)
                direct.extend(index["by_id"][ident] for ident in ids if ident in index["by_id"])
            dataset_items = []
            dataset_ids = set(str(x) for x in feature.get("dataset_ids", []))
            for did, ds in datasets.items():
                rows = [row for row in ds.get("rows", []) if row.get("feature_id") == fid]
                if did in dataset_ids or ds.get("feature_id") == fid or rows:
                    dataset_ids.add(str(did))
                    dataset_items.append({"id": did, "type": ds.get("type"), "name": ds.get("name"), "study_area_id": ds.get("study_area_id"), "rows": (rows or ds.get("rows", []))[:50]})
                    for row in dataset_items[-1]["rows"]: refs.update(str(x) for x in row.get("source_refs", []))
            direct_ids = {x["id"] for x in direct}
            for ref in sorted(refs):
                ids = [ref] if ref in index["by_id"] else index["by_record"].get(ref, [])
                if ids:
                    resolved_ref_keys.add(ref)
                for ident in ids:
                    if ident in index["by_id"] and ident not in direct_ids:
                        direct.append(index["by_id"][ident]); direct_ids.add(ident)
            query = " ".join(str(x) for x in [feature.get("name"), *(feature.get("aliases") or []), feature.get("type"), feature.get("source_identifier"), feature.get("study_area_id"), *(x.get("type") for x in linked_obs), *(x.get("type") for x in linked_intervals)] if x)
            direct_is_adequate = self._direct_is_adequate(feature, linked_obs, linked_intervals, dataset_items, direct)
            lexical = [] if direct_is_adequate else self._lexical_search(query, units, excluded={x["id"] for x in direct}, limit=8)
            selected = direct + lexical
            derived = self._derived_signals(feature, linked_obs, linked_intervals, dataset_items)
            peers = self._peer_context(feature, linked_obs, observations, ui.get("features", []))
            evidence_units = []
            evidence_handle_map: dict[str, dict[str, Any]] = {}
            for n, u in enumerate(selected, 1):
                handle = f"e{n}"
                evidence_units.append({"handle": handle, **{k: u[k] for k in ("id", "class", "chunk_id", "target_id", "document_id", "pages", "value")}})
                evidence_handle_map[handle] = {"evidence_ref": u["id"], "observation_ids": [], "interval_ids": [], "dataset_ids": []}
            for obs in linked_obs:
                refs = {str(obs.get("id")), *(str(x) for x in obs.get("source_refs", []))}
                for handle, entry in evidence_handle_map.items():
                    if entry["evidence_ref"] in refs:
                        entry["observation_ids"].append(str(obs["id"]))
            for interval in linked_intervals:
                refs = {str(interval.get("id")), *(str(x) for x in interval.get("source_refs", []))}
                for entry in evidence_handle_map.values():
                    if entry["evidence_ref"] in refs:
                        entry["interval_ids"].append(str(interval["id"]))
            for did in dataset_ids:
                ds = datasets.get(did, {})
                refs = {str(did), *(str(x) for x in ds.get("source_refs", []))}
                for entry in evidence_handle_map.values():
                    if entry["evidence_ref"] in refs:
                        entry["dataset_ids"].append(str(did))
            evidence_lookup = {u["id"]: h for h, m in evidence_handle_map.items() for u in selected if u["id"] == m["evidence_ref"]}
            context = {
                "feature": feature, "point_facts": feature.get("properties", {}), "observations": linked_obs,
                "intervals": linked_intervals, "relationships": linked_rel, "datasets": dataset_items,
                "regional_context": evidence_units, "peer_context": peers, "source_interpretations": evidence_units,
                "derived_signals": derived, "evidence_units": evidence_units,
                "allowed_references": {"evidence_handles": [x["handle"] for x in evidence_units]},
                "evidence_handle_map": evidence_handle_map,
            }
            while len(json.dumps(context, ensure_ascii=False, default=str)) > self.MAX_FEATURE_CONTEXT_CHARS and context["evidence_units"]:
                context["evidence_units"].pop()
            while len(json.dumps(context, ensure_ascii=False, default=str)) > self.MAX_FEATURE_CONTEXT_CHARS and context["datasets"]:
                context["datasets"][-1]["rows"] = context["datasets"][-1].get("rows", [])[:-1]
                if not context["datasets"][-1]["rows"]:
                    context["datasets"].pop()
            contexts[fid] = context
            useful_evidence = bool(direct or lexical or linked_obs or linked_intervals or dataset_items or derived)
            audits[fid] = {"feature_id": fid, "direct_ids": [x["id"] for x in direct], "lexical_ids": [x["id"] for x in lexical], "unresolved_refs": sorted(refs - resolved_ref_keys), "direct_adequate": direct_is_adequate, "derived_signal_count": len(derived), "peer_count": len(peers), "context_hash": stable_hash(context), "context_chars": len(json.dumps(context, ensure_ascii=False, default=str)), "status": "adequate" if useful_evidence else "insufficient_evidence"}
        return contexts, audits

    @staticmethod
    def _derived_signals(feature: dict[str, Any], observations: list[dict[str, Any]], intervals: list[dict[str, Any]], datasets: list[dict[str, Any]]) -> list[dict[str, Any]]:
        signals: list[dict[str, Any]] = []
        for obs in observations:
            value = obs.get("value")
            reference = obs.get("reference_value", obs.get("decadal_average", obs.get("average")))
            if reference is None:
                match = re.search(r"(?:decadal\s+avg|average)\s*[:=]?\s*(-?\d+(?:\.\d+)?)", str(obs.get("qualifier", "")), re.I)
                if match:
                    reference = float(match.group(1))
            if isinstance(value, (int, float)) and isinstance(reference, (int, float)):
                signals.append({"type": "difference_from_reference", "observation_id": obs.get("id"), "value": value, "reference_value": reference, "difference": value - reference, "unit": obs.get("unit"), "formula": "value - reference_value"})
        raw_props = feature.get("properties")
        if isinstance(raw_props, list):
            props = {str(x.get("name")): x.get("value") for x in raw_props if isinstance(x, dict) and x.get("name")}
        else:
            props = raw_props if isinstance(raw_props, dict) else {}
        depth = props.get("drilled_depth", props.get("drilled_depth_m", props.get("depth")))
        if isinstance(depth, (int, float)):
            for interval in intervals:
                start, end = interval.get("start", interval.get("top")), interval.get("end", interval.get("bottom"))
                if isinstance(start, (int, float)) and isinstance(end, (int, float)):
                    signals.append({"type": "depth_within_interval", "depth": depth, "interval_id": interval.get("id"), "start": start, "end": end, "result": start <= depth <= end, "unit": interval.get("unit")})
        if intervals:
            logged_end = max((x.get("end", x.get("bottom")) for x in intervals if isinstance(x.get("end", x.get("bottom")), (int, float))), default=None)
            if isinstance(logged_end, (int, float)) and isinstance(depth, (int, float)) and depth > 0:
                signals.append({"type": "logged_depth_coverage", "logged_depth": logged_end, "total_depth": depth, "coverage_fraction": logged_end / depth, "formula": "logged_depth / total_depth"})
        return signals

    @staticmethod
    def _peer_context(feature: dict[str, Any], linked_obs: list[dict[str, Any]], observations: dict[str, dict[str, Any]], features: list[dict[str, Any]]) -> list[dict[str, Any]]:
        types = {x.get("type") for x in linked_obs if x.get("type")}; units = {x.get("unit") for x in linked_obs if x.get("unit")}; area = feature.get("study_area_id")
        feature_areas = {str(x.get("id")): x.get("study_area_id") for x in features if isinstance(x, dict)}
        dates = {str(x.get("date"))[:7] for x in linked_obs if x.get("date")}
        peers = []
        for obs in observations.values():
            if obs in linked_obs or (types and obs.get("type") not in types) or (units and obs.get("unit") not in units): continue
            owner_area = obs.get("study_area_id") or feature_areas.get(str(obs.get("feature_id")))
            if area and owner_area and owner_area != area: continue
            if dates and obs.get("date") and str(obs.get("date"))[:7] not in dates: continue
            peers.append({k: obs.get(k) for k in ("id", "feature_id", "type", "value", "unit", "date", "qualifier") if obs.get(k) is not None})
        return peers[:32]

    @staticmethod
    def _direct_is_adequate(feature: dict[str, Any], observations: list[dict[str, Any]], intervals: list[dict[str, Any]], datasets: list[dict[str, Any]], direct: list[dict[str, Any]]) -> bool:
        if not direct:
            return False
        identity = set(_tokens(feature.get("name"))) | set(_tokens(feature.get("source_identifier"))) | set(_tokens(feature.get("type")))
        identity_hits = sum(bool(identity & set(_tokens(u.get("text", "")))) for u in direct)
        meaningful = bool(observations or intervals or datasets) or any(u.get("class") in {"fact", "record", "measurement", "relationship"} and u.get("value") for u in direct)
        return identity_hits > 0 and meaningful

    @staticmethod
    def _lexical_search(query: str, units: list[dict[str, Any]], excluded: set[str], limit: int) -> list[dict[str, Any]]:
        terms = set(_tokens(query)); scored: list[tuple[int, dict[str, Any]]] = []
        for unit in units:
            if unit["id"] in excluded: continue
            text_terms = set(_tokens(unit["text"])); overlap = terms & text_terms
            if not overlap: continue
            score = sum(1 for term in overlap) + sum(2 for term in overlap if len(term) > 5)
            scored.append((score, unit))
        scored.sort(key=lambda x: (-x[0], x[1]["id"]))
        return [x[1] for x in scored[:limit]]

    @staticmethod
    def _model_context(context: dict[str, Any]) -> dict[str, Any]:
        """Expose facts and call-local handles, never canonical host IDs."""
        def public(value: Any) -> Any:
            if isinstance(value, dict):
                return {k: public(v) for k, v in value.items() if k not in {"id", "feature_id", "study_area_id", "dataset_id", "source_refs", "observation_ids", "interval_ids", "dataset_ids"}}
            if isinstance(value, list):
                return [public(v) for v in value]
            return value
        return {
            "feature": {k: public(v) for k, v in context.get("feature", {}).items() if k not in {"id", "feature_id", "study_area_id", "dataset_ids", "source_refs"}},
            "point_facts": public(context.get("point_facts", {})),
            "observations": public(context.get("observations", [])),
            "intervals": public(context.get("intervals", [])),
            "datasets": public(context.get("datasets", [])),
            "regional_context": public(context.get("regional_context", [])),
            "peer_context": public(context.get("peer_context", [])),
            "derived_signals": public(context.get("derived_signals", [])),
            "evidence": [{"handle": unit.get("handle"), "kind": unit.get("class"), "content": public(unit.get("value"))} for unit in context.get("evidence_units", [])],
            "allowed_evidence_handles": context.get("allowed_references", {}).get("evidence_handles", []),
        }

    @staticmethod
    def _assemble_model_result(result: dict[str, Any], fid: str, context: dict[str, Any], audit: dict[str, Any]) -> dict[str, Any]:
        """Attach host-owned IDs and resolve local evidence handles."""
        mapping = context.get("evidence_handle_map", {})
        top_refs: list[str] = []
        insights: list[dict[str, Any]] = []
        dropped: list[dict[str, Any]] = []
        for position, raw in enumerate(result.get("insights", [])):
            if not isinstance(raw, dict):
                continue
            refs: list[str] = []
            obs: list[str] = []; intervals: list[str] = []; datasets: list[str] = []
            for handle in raw.get("evidence_handles", []):
                entry = mapping.get(handle)
                if not entry:
                    dropped.append({"field": "evidence_handles", "value": handle, "insight_index": position})
                    continue
                ref = entry.get("evidence_ref")
                if ref and ref not in refs: refs.append(ref)
                for field, target in (("observation_ids", obs), ("interval_ids", intervals), ("dataset_ids", datasets)):
                    for value in entry.get(field, []):
                        if value not in target: target.append(value)
            for ref in refs:
                if ref not in top_refs: top_refs.append(ref)
            insight_id = stable_hash({"feature_id": fid, "position": position, "type": raw.get("type"), "title": raw.get("title")})[:16]
            item = {"id": f"ki_{insight_id}", "type": raw.get("type", "context"), "title": raw.get("title", "Evidence-based insight"), "explanation": raw.get("explanation", ""), "observation_ids": obs, "interval_ids": intervals, "dataset_ids": datasets, "evidence_refs": refs}
            item["grounding_status"] = "grounded" if refs and len(dropped) == 0 else ("partially_grounded" if refs else "unresolved")
            if refs:
                insights.append(item)
        if dropped:
            audit.setdefault("unresolved_model_handles", []).extend(dropped)
        output = {"feature_id": fid, "status": result.get("status", "limited"), "insight_type": result.get("insight_type", "combined_signal"), "headline": result.get("headline", context.get("feature", {}).get("name", fid)), "summary": result.get("summary", ""), "why_it_matters": result.get("why_it_matters", ""), "visual_takeaway": result.get("visual_takeaway", ""), "insights": insights, "secondary_context": result.get("secondary_context"), "evidence_refs": top_refs}
        return output

    def _run_feature_synthesis(self, ui: dict[str, Any], contexts: dict[str, dict[str, Any]], audits: dict[str, dict[str, Any]], resume: bool, concurrency: int, deterministic_only: bool = False) -> list[dict[str, Any]]:
        path = self.synthesis_dir / "ui_feature_normalized_fragments.json"
        raw_path = self.synthesis_dir / "ui_feature_model_responses.jsonl"
        # The append-only raw response ledger is authoritative for resume.
        # Legacy normalized fragments are intentionally not used as model cache.
        raw_records = []
        if resume and raw_path.exists():
            for line in raw_path.read_text(encoding="utf-8").splitlines():
                try:
                    record = json.loads(line)
                    if isinstance(record, dict): raw_records.append(record)
                except json.JSONDecodeError:
                    continue
        raw_by_key = {(x.get("input_hash") or x.get("cache_key")): x for x in raw_records if x.get("input_hash") or x.get("cache_key")}
        pending = []
        generated: dict[str, dict[str, Any]] = {}
        checkpoint_lock = threading.Lock()

        def checkpoint() -> None:
            if deterministic_only:
                return
            with checkpoint_lock:
                self.store.write_json(path.name, [{"key": stable_hash({"context": contexts[f], "prompt": FEATURE_INSTRUCTIONS, "schema": NARRATIVE_SCHEMA_VERSION}), "feature_id": f, "result": generated[f]} for f in sorted(generated)])
        for fid, context in contexts.items():
            key = stable_hash({"context": context, "prompt": FEATURE_INSTRUCTIONS, "schema": NARRATIVE_SCHEMA_VERSION})
            raw = raw_by_key.get(key)
            if raw is not None:
                cached_response = raw.get("response")
                if isinstance(cached_response, dict) and all(field in cached_response for field in ("insight_type", "headline", "summary", "why_it_matters", "visual_takeaway", "insights")):
                    assembled = self._assemble_model_result(cached_response, fid, context, audits[fid])
                    audits[fid]["cache_reused"] = True
                    generated[fid] = self._host_status(assembled, context, audits[fid])
                    continue
                audits[fid]["cache_invalid"] = True
                audits[fid]["skip_reason"] = "invalid_cached_response" if deterministic_only else None
                if deterministic_only:
                    continue
            if audits[fid]["status"] == "insufficient_evidence":
                audits[fid]["skip_reason"] = "eligible_but_insufficient_evidence"
                continue
            if raw is not None:
                audits[fid]["cache_reused"] = True
                continue
            if deterministic_only:
                audits[fid]["skip_reason"] = "missing_cached_response"
                continue
            pending.append((fid, key, context))
        if deterministic_only:
            checkpoint()
            return [generated[fid] for fid in sorted(generated)]
        checkpoint()
        def call(item: tuple[str, str, dict[str, Any]]) -> tuple[str, str, dict[str, Any], dict[str, Any] | None, str | None]:
            fid, key, context = item
            error: Exception | None = None
            for _ in range(self.config.max_retries + 1):
                try:
                    model_context = self._model_context(context)
                    response = self.transport.call(FEATURE_INSTRUCTIONS, json.dumps(model_context, ensure_ascii=False, default=str), [], phase=f"ui_narrative_feature_{fid}", reasoning_effort=self.config.spark_reasoning_effort, model=self.config.spark_model, response_format={"type": "json_schema", "name": "ui_feature_response", "strict": True, "schema": feature_generation_schema(context["allowed_references"])})
                    result = response.json_content
                    if isinstance(result, dict):
                        validation_issues = validate_feature_insight(result, context)
                        if validation_issues:
                            audits[fid].setdefault("quality_warnings", []).extend(validation_issues)
                        # The transport/schema gate has already established a
                        # usable JSON response.  Narrative quality or missing
                        # optional grounding is audited, not retried.
                        return fid, key, self._assemble_model_result(result, fid, context, audits[fid]), result, response.call_id
                    raise ValueError("feature synthesis returned no JSON object")
                except Exception as exc:
                    error = exc
            audits[fid]["generation_error"] = str(error)
            return fid, key, {"feature_id": fid, "status": "limited", "insight_type": "insufficient_evidence", "headline": context["feature"].get("name", fid), "summary": "", "why_it_matters": "", "visual_takeaway": "", "insights": [], "secondary_context": "Narrative generation failed for this feature; retry with --resume.", "evidence_refs": []}, None, None
        with ThreadPoolExecutor(max_workers=max(1, min(concurrency, 16))) as pool:
            for future in as_completed([pool.submit(call, item) for item in pending]):
                fid, key, result, raw_result, call_id = future.result()
                audits[fid]["model_called"] = raw_result is not None
                generated[fid] = self._host_status(result, contexts[fid], audits[fid])
                if raw_result is not None:
                    with checkpoint_lock:
                        with raw_path.open("a", encoding="utf-8") as handle:
                            handle.write(json.dumps({"feature_id": fid, "input_hash": key, "cache_key": key, "prompt_version": NARRATIVE_SCHEMA_VERSION, "schema_version": "ui-feature-response.v1", "call_id": call_id, "completed_at": datetime.now(timezone.utc).isoformat(), "response": raw_result}, ensure_ascii=False) + "\n")
                checkpoint()
        checkpoint()
        return [generated[fid] for fid in sorted(generated)]

    @staticmethod
    def _host_status(result: dict[str, Any], context: dict[str, Any], audit: dict[str, Any]) -> dict[str, Any]:
        output = dict(result)
        if audit.get("status") == "insufficient_evidence":
            output["status"] = "insufficient_evidence"
        elif output.get("insights") and (audit.get("derived_signal_count") or audit.get("peer_count") or audit.get("direct_ids") or audit.get("lexical_ids")):
            output["status"] = "complete"
        else:
            output["status"] = "limited"
        return output

    @staticmethod
    def _coverage(features: list[dict[str, Any]], audits: dict[str, dict[str, Any]], eligibility: dict[str, dict[str, Any]] | None = None, scope: str = "renderable", submitted_ids: set[str] | None = None) -> dict[str, Any]:
        counts = {"complete": 0, "limited": 0, "insufficient_evidence": 0}
        for x in features: counts[x.get("status", "limited")] = counts.get(x.get("status", "limited"), 0) + 1
        eligibility = eligibility or {}
        useful = sum(x.get("status") != "insufficient_evidence" for x in audits.values())
        grounded = sum(1 for feature in features for insight in feature.get("insights", []) if insight.get("grounding_status") == "grounded")
        partial = sum(1 for feature in features for insight in feature.get("insights", []) if insight.get("grounding_status") == "partially_grounded")
        unresolved = sum(1 for audit in audits.values() for _ in audit.get("unresolved_model_handles", []))
        return {"total_source_features": len(eligibility) or len(features), "scope": scope, "eligible_renderable_features": sum(x.get("eligible", False) for x in eligibility.values()), "excluded_non_renderable_features": sum(not x.get("eligible", False) for x in eligibility.values()) if scope == "renderable" else 0, "eligible_with_useful_evidence": useful, "eligible_without_useful_evidence": len(audits) - useful, "features_submitted_to_model": sum(bool(x.get("model_called")) for x in audits.values()), "features_reused_from_cache": sum(bool(x.get("cache_reused")) for x in audits.values()), "features_with_narratives": len(features), "grounded_insights": grounded, "partially_grounded_insights": partial, "unresolved_insights": unresolved, **counts, "directly_grounded": sum(bool(x.get("direct_ids")) for x in audits.values()), "lexical_fallback_used": sum(bool(x.get("lexical_ids")) for x in audits.values()), "unresolved_source_aliases": sum(bool(x.get("unresolved_refs")) for x in audits.values()), "skipped_features": sum(bool(x.get("skip_reason")) for x in audits.values())}
