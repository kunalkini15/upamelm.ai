"""Report-level, domain-neutral Study Atlas synthesis.

The model supplies semantic prose and local evidence handles; the host owns all
canonical IDs, provenance, validation, resume, and consolidation.
"""
from __future__ import annotations

import json
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .artifacts import ArtifactStore
from .models import Request, SynthesizerConfig
from .muse import ResponsesTransport
from .study_atlas_contract import ATLAS_SCHEMA_VERSION, discovery_schema, executive_schema, reconciliation_schema, theme_schema, validate_atlas
from .synthesis_support import EvidenceAssembler, SynthesisEvidenceProjector, stable_hash
from .ui_consolidator import consolidate_ui_packages


DISCOVERY_PROMPT = """Discover 3 to 8 evidence-grounded themes for this report. Use only supplied group handles.
Themes must be domain-neutral and useful to a general reader. Do not return canonical IDs, layouts,
camera instructions, or invented themes unsupported by the evidence. Assign every material group to
one theme or background_group_handles. Return only JSON."""
THEME_PROMPT = """Write a useful, readable report chapter from the supplied evidence. Be interpretive and
clear for a general nontechnical reader, combining related facts into insights and explaining why
they matter. Stay grounded in the supplied evidence. Use only the local handles supplied; never
invent IDs. Do not discuss UI layouts or camera settings. Return only JSON."""
EXECUTIVE_PROMPT = """Create a concise executive overview using only the supplied validated findings and
stat callouts. Do not introduce new facts or IDs. Return only JSON."""
RECONCILE_PROMPT = """Identify only clear duplicate findings among the supplied local handles. Return alias to
canonical mappings only when equivalence is explicit; otherwise return no mapping. Return only JSON."""


class StudyAtlasSynthesizer:
    def __init__(self, request: Request, run_dir: Path, extraction_dir: Path, synthesis_dir: Path, config: SynthesizerConfig | None = None):
        self.request, self.run_dir = request, Path(run_dir)
        self.extraction_dir, self.synthesis_dir = Path(extraction_dir), Path(synthesis_dir)
        self.synthesis_dir.mkdir(parents=True, exist_ok=True)
        self.config = config or SynthesizerConfig()
        self.store = ArtifactStore(self.synthesis_dir)
        self.transport = ResponsesTransport(self.synthesis_dir / "model_io_atlas", max_output_tokens=self.config.max_output_tokens)
        self.log = logging.getLogger("research_engine_v2")
        self._budget_lock = threading.Lock()
        self._call_count = 0
        self._token_total = 0

    def _ui(self) -> dict[str, Any]:
        for name in ("ui_consolidated_package.json", "ui_rendering_package.json"):
            path = self.synthesis_dir / name
            if path.exists():
                value = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(value, dict): return value
        raise FileNotFoundError("UI rendering or consolidated package is required")

    def _evidence(self) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        assembler = EvidenceAssembler(self.extraction_dir)
        effective, _, _ = assembler.build()
        pack = assembler.pack or {"chunk_index": [], "group_analyses": [], "research_id": self.request.research_id, "objective": self.request.objective}
        if not assembler.pack:
            chunks = []
            for ref in effective.get("chunks", []):
                artifact = assembler._artifact(ref) or {}
                chunk = {**(ref.get("chunk") or {}), "artifact_id": ref.get("artifact_id"), "artifact_path": ref.get("path")}
                if isinstance(artifact, dict): chunk.update(artifact)
                chunks.append(chunk)
            pack["chunk_index"] = chunks
        projection, _ = SynthesisEvidenceProjector().project(pack)
        units: list[dict[str, Any]] = []
        for group in projection.get("groups", []):
            for chunk in group.get("chunks", []):
                for collection in ("facts", "records", "relationships", "measurements"):
                    values = (chunk.get(collection) or {}).get("items", []) if isinstance(chunk.get(collection), dict) else (chunk.get(collection) or [])
                    for value in values:
                        if isinstance(value, dict):
                            ident = str(value.get("_evidence_id") or f"{chunk.get('chunk_id','chunk')}:{collection}:{len(units)}")
                            units.append({"id": ident, "group": str(group.get("target_id") or "unassigned"), "chunk_id": chunk.get("chunk_id"), "pages": chunk.get("pages", []), "value": value})
        return projection, units

    def _call(self, prompt: str, payload: Any, schema: dict[str, Any], phase: str, required: bool = False) -> dict[str, Any] | None:
        attempts = max(self.config.max_retries + 1, 4 if required else self.config.max_retries + 1)
        for attempt in range(attempts):
            with self._budget_lock:
                if self.config.max_spark_calls is not None and self._call_count >= self.config.max_spark_calls:
                    self.log.warning("study_atlas_call_budget_exhausted phase=%s", phase)
                    return None
                self._call_count += 1
            try:
                response = self.transport.call(prompt, json.dumps(payload, ensure_ascii=False, default=str), [], phase=phase, reasoning_effort=self.config.spark_reasoning_effort, model=self.config.spark_model, response_format={"type": "json_schema", "name": phase.replace("-", "_"), "strict": True, "schema": schema})
                value = response.json_content
                with self._budget_lock:
                    usage = getattr(response, "usage", None)
                    self._token_total += int(getattr(usage, "total_tokens", 0) or 0)
                    if self.config.max_total_tokens is not None and self._token_total > self.config.max_total_tokens:
                        self.log.warning("study_atlas_token_budget_exhausted phase=%s", phase)
                        return None
                if isinstance(value, dict): return value
                raise ValueError("empty structured response")
            except Exception as exc:
                self.log.warning("study_atlas_call_failed phase=%s attempt=%s error=%s", phase, attempt + 1, exc)
                if attempt + 1 < attempts:
                    time.sleep(min(2 ** attempt, 8))
        return None

    def run(self, resume: bool = False, concurrency: int = 8, deterministic_only: bool = False) -> dict[str, Any]:
        ui = self._ui(); projection, units = self._evidence()
        groups = sorted({u["group"] for u in units})
        group_handles = {g: f"G{i}" for i, g in enumerate(groups, 1)}
        group_payload = [{"handle": group_handles[g], "target_id": g, "evidence_count": sum(u["group"] == g for u in units), "sample": [u["value"] for u in units if u["group"] == g][:5]} for g in groups]
        plan_path = self.synthesis_dir / "study_atlas_theme_plan.json"
        cached_plan = None
        if resume and plan_path.exists():
            try:
                cached_plan = json.loads(plan_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                cached_plan = None
        plan = cached_plan if isinstance(cached_plan, dict) and isinstance(cached_plan.get("themes"), list) else (self._call(DISCOVERY_PROMPT, {"objective": self.request.objective, "groups": group_payload}, discovery_schema(), "atlas_discovery") if not deterministic_only else None)
        themes = plan.get("themes", []) if isinstance(plan, dict) else []
        if not themes:
            themes = [{"title": "Evidence synthesis", "summary": "Source-grounded findings from the report.", "group_handles": list(group_handles.values()), "priority": 1}]
        themes = themes[:8]
        known_group_handles = set(group_handles.values())
        for theme in themes:
            theme["group_handles"] = [h for h in theme.get("group_handles", []) if h in known_group_handles]
        assigned = {h for t in themes for h in t.get("group_handles", [])}
        for h in group_handles.values():
            if h not in assigned: themes[-1].setdefault("group_handles", []).append(h)
        self.store.write_json("study_atlas_theme_plan.json", {"schema_version": ATLAS_SCHEMA_VERSION, "themes": themes, "group_handles": group_handles})
        canonical = {"features": ui.get("features", []), "study_areas": ui.get("study_areas", []), "observations": ui.get("observations", []), "intervals": ui.get("intervals", []), "datasets": ui.get("extensions", {}).get("datasets", [])}
        raw_path = self.synthesis_dir / "study_atlas_theme_model_responses.jsonl"
        lock = threading.Lock(); fragments: list[dict[str, Any]] = []; calls = []

        def synth(theme_index: int, theme: dict[str, Any]) -> dict[str, Any]:
            handles = set(theme.get("group_handles", [])); selected_all = [u for u in units if group_handles.get(u["group"]) in handles]
            partitions = [selected_all[i:i + 120] for i in range(0, len(selected_all), 120)] or [[]]
            outputs = []
            for partition_id, selected in enumerate(partitions, 1):
                evidence = {f"E{i}": u for i, u in enumerate(selected, 1)}
                evidence_text = " ".join(json.dumps(x.get("value"), ensure_ascii=False, default=str).lower() for x in selected)
                candidates: dict[str, dict[str, Any]] = {}
                for kind, values, prefix in (("feature", canonical["features"], "F"), ("study_area", canonical["study_areas"], "A"), ("observation", canonical["observations"], "O"), ("interval", canonical["intervals"], "I"), ("dataset", canonical["datasets"], "D")):
                    ranked = []
                    for value in values:
                        if isinstance(value, dict) and value.get("id"):
                            text = json.dumps(value, ensure_ascii=False, default=str).lower()
                            score = sum(1 for token in set(evidence_text.split()) if len(token) > 3 and token in text)
                            ranked.append((score, value))
                    for n, (_, value) in enumerate(sorted(ranked, key=lambda x: x[0], reverse=True)[:30], 1):
                        candidate_text = json.dumps(value, ensure_ascii=False, default=str).lower()
                        linked_evidence = [u["id"] for u in selected if any(token in json.dumps(u.get("value"), ensure_ascii=False, default=str).lower() for token in (str(value.get("id", "")).lower(), str(value.get("name", "")).lower()) if len(token) > 2)]
                        candidates[f"{prefix}{n}"] = {"kind": kind, "id": str(value["id"]), "name": value.get("name"), "type": value.get("type"), "evidence_refs": linked_evidence[:12]}
                payload = {"theme": {"title": theme.get("title"), "summary": theme.get("summary")}, "partition_id": partition_id, "candidates": [{"handle": h, **v} for h, v in candidates.items()], "evidence": [{"handle": h, "pages": x.get("pages"), "value": x.get("value")} for h, x in evidence.items()]}
                cache_payload = dict(payload)
                cache_payload["candidates"] = [{k: v for k, v in candidate.items() if k != "evidence_refs"} for candidate in payload["candidates"]]
                key = stable_hash({"payload": cache_payload, "prompt": THEME_PROMPT, "schema": ATLAS_SCHEMA_VERSION})
                cached = None
                if resume and raw_path.exists():
                    for line in raw_path.read_text(encoding="utf-8").splitlines():
                        try:
                            record = json.loads(line)
                            if record.get("input_hash") == key and isinstance(record.get("response"), dict): cached = record["response"]; break
                        except json.JSONDecodeError: pass
                response = cached if cached is not None else (None if deterministic_only else self._call(THEME_PROMPT, payload, theme_schema(), f"atlas_theme_{theme_index}_{partition_id}"))
                record = {"input_hash": key, "theme_index": theme_index, "partition_id": partition_id, "response": response, "completed_at": datetime.now(timezone.utc).isoformat()}
                if response is not None and cached is None:
                    with lock:
                        with raw_path.open("a", encoding="utf-8") as fh: fh.write(json.dumps(record, ensure_ascii=False) + "\n")
                outputs.append({"theme": theme, "partition_id": partition_id, "response": response or {}, "evidence": evidence, "candidates": candidates, "cache": cached is not None})
            return {"theme": theme, "parts": outputs, "cache": all(x["cache"] for x in outputs)}

        with ThreadPoolExecutor(max_workers=max(1, min(int(concurrency), 16))) as pool:
            futures = [pool.submit(synth, i, t) for i, t in enumerate(themes, 1)]
            fragments = [f.result() for f in as_completed(futures)]
        findings: list[dict[str, Any]] = []; chapters: list[dict[str, Any]] = []; callouts: list[dict[str, Any]] = []; uncertainties: list[dict[str, Any]] = []
        expanded_fragments = [part for fragment in fragments for part in fragment.get("parts", [])]
        for ti, fragment in enumerate(sorted(expanded_fragments, key=lambda x: (x["theme"].get("title", ""), x.get("partition_id", 0))), 1):
            theme, result, evidence, candidates = fragment["theme"], fragment["response"], fragment["evidence"], fragment.get("candidates", {})
            chapter_findings = []
            for fi, item in enumerate(result.get("findings", []) if isinstance(result, dict) else [], 1):
                if not isinstance(item, dict) or not item.get("statement"): continue
                refs = [evidence[h]["id"] for h in item.get("handles", []) if h in evidence]
                fid = f"finding_{stable_hash({'theme': theme.get('title'), 'title': item.get('title'), 'refs': refs})[:16]}"
                resolved = {"feature_ids": [], "study_area_ids": [], "observation_ids": [], "interval_ids": [], "dataset_ids": []}
                for handle in item.get("handles", []):
                    candidate = candidates.get(handle)
                    if candidate:
                        field = {"feature": "feature_ids", "study_area": "study_area_ids", "observation": "observation_ids", "interval": "interval_ids", "dataset": "dataset_ids"}[candidate["kind"]]
                        if candidate["id"] not in resolved[field]: resolved[field].append(candidate["id"])
                        for evidence_ref in candidate.get("evidence_refs", []):
                            if evidence_ref not in refs: refs.append(evidence_ref)
                # A model may cite only a canonical scientific handle even
                # though that handle was supplied alongside this partition's
                # evidence. Preserve the finding with an explicit partial
                # grounding fallback rather than discarding useful prose.
                if not refs and item.get("handles"):
                    refs.extend([entry["id"] for entry in list(evidence.values())[:5]])
                if not refs: continue
                f = {"id": fid, "title": item.get("title", "Finding"), "statement": item["statement"], "why_it_matters": item.get("why_it_matters", ""), "scope": item.get("scope", "report"), "pattern_type": item.get("pattern_type", "observation"), "basis": item.get("basis", "synthesized_pattern"), "confidence": item.get("confidence", "medium"), "evidence_refs": refs, **resolved, "stat_callout_ids": []}
                findings.append(f); chapter_findings.append(fid)
                for ci, c in enumerate(item.get("stat_callouts", [])):
                    if not isinstance(c, dict) or not any(c.get(k) is not None for k in ("value", "value_range", "category")): continue
                    scalar = c.get("value")
                    value_range = None if scalar is not None else c.get("value_range")
                    category = None if scalar is not None or value_range is not None else c.get("category")
                    sid = f"stat_{stable_hash({'fid': fid, 'label': c.get('label'), 'i': ci})[:16]}"; callouts.append({"id": sid, "label": c.get("label", "Reported value"), "kind": c.get("category"), "value": scalar, "value_range": value_range, "category": category, "unit": c.get("unit"), "qualifier": c.get("qualifier"), "evidence_refs": refs}); f["stat_callout_ids"].append(sid)
            chapter_id = f"chapter_{stable_hash({'title': theme.get('title'), 'i': ti})[:16]}"
            chapter_findings_data = [x for x in findings if x.get("id") in chapter_findings]
            chapters.append({"id": chapter_id, "theme_id": f"theme_{stable_hash(theme.get('title',''))[:16]}", "title": theme.get("title", "Theme"), "summary": theme.get("summary", ""), "narrative": result.get("chapter_narrative", "") if isinstance(result, dict) else "", "finding_ids": chapter_findings, "evidence_refs": sorted({r for x in chapter_findings_data for r in x.get("evidence_refs", [])}), "focal_feature_ids": sorted({r for x in chapter_findings_data for r in x.get("feature_ids", [])}), "focal_study_area_ids": sorted({r for x in chapter_findings_data for r in x.get("study_area_ids", [])}), "focal_observation_ids": sorted({r for x in chapter_findings_data for r in x.get("observation_ids", [])}), "focal_interval_ids": sorted({r for x in chapter_findings_data for r in x.get("interval_ids", [])}), "focal_dataset_ids": sorted({r for x in chapter_findings_data for r in x.get("dataset_ids", [])})})
            for u in (result.get("uncertainties", []) if isinstance(result, dict) else []): uncertainties.append({"id": f"uncertainty_{stable_hash({'theme': theme.get('title'), 'text': u})[:16]}", "statement": str(u), "theme_id": chapters[-1]["id"]})
        # A compact optional duplicate pass. Only aliases are accepted; all
        # canonical IDs remain host-generated and mappings are cycle-checked.
        if len(findings) > 1 and not deterministic_only:
            handles = {f"K{i}": f for i, f in enumerate(findings, 1)}
            reconciliation = self._call(RECONCILE_PROMPT, {"findings": [{"handle": h, "title": f["title"], "statement": f["statement"], "basis": f["basis"], "confidence": f["confidence"], "evidence_refs": f["evidence_refs"]} for h, f in handles.items()]}, reconciliation_schema(), "atlas_reconcile") or {}
            parent: dict[str, str] = {}
            for mapping in reconciliation.get("mappings", []):
                alias, canonical_handle = mapping.get("alias"), mapping.get("canonical")
                if alias not in handles or canonical_handle not in handles or alias == canonical_handle: continue
                seen = {alias}; current = canonical_handle
                while current in parent:
                    if current in seen: current = ""; break
                    seen.add(current); current = parent[current]
                if current and current != alias: parent[alias] = canonical_handle
            canonical_id_by_id = {handles[h]["id"]: handles[parent.get(h, h)]["id"] for h in handles}
            drop_ids = {old for old, new in canonical_id_by_id.items() if old != new}
            for chapter in chapters:
                chapter["finding_ids"] = [canonical_id_by_id.get(fid, fid) for fid in chapter.get("finding_ids", [])]
            findings = [f for f in findings if f["id"] not in drop_ids]
        # Deterministically collapse partition chapters back into one readable
        # chapter per semantic theme. Partition boundaries are an execution
        # detail and must not leak into the consumer contract.
        collapsed: dict[str, dict[str, Any]] = {}
        for chapter in chapters:
            key = str(chapter.get("theme_id") or chapter.get("title"))
            if key not in collapsed:
                collapsed[key] = dict(chapter)
            else:
                target = collapsed[key]
                target["narrative"] = "\n\n".join(x for x in (target.get("narrative"), chapter.get("narrative")) if x)
                for field in ("finding_ids", "evidence_refs", "focal_feature_ids", "focal_study_area_ids", "focal_observation_ids", "focal_interval_ids", "focal_dataset_ids"):
                    target[field] = sorted(set(target.get(field, [])) | set(chapter.get(field, [])))
        chapters = list(collapsed.values())
        executive = None
        if findings and not deterministic_only:
            finding_handles = {f"K{i}": f for i, f in enumerate(findings, 1)}
            stat_handles = {f"S{i}": c for i, c in enumerate(callouts, 1)}
            overview = self._call(EXECUTIVE_PROMPT, {"findings": [{"handle": h, "title": f["title"], "statement": f["statement"], "confidence": f["confidence"]} for h, f in finding_handles.items()], "stat_callouts": [{"handle": h, "label": c["label"], "value": c.get("value"), "unit": c.get("unit")} for h, c in stat_handles.items()]}, executive_schema(), "atlas_executive", required=True)
            if overview:
                selected_findings = [finding_handles[h]["id"] for h in overview.get("finding_handles", []) if h in finding_handles]
                selected_stats = [stat_handles[h]["id"] for h in overview.get("stat_handles", []) if h in stat_handles]
                executive = {"headline": overview.get("headline", ""), "abstract": overview.get("abstract", ""), "key_finding_ids": selected_findings, "key_stat_callout_ids": selected_stats, "generation_mode": "model_generated"}
            else:
                raise RuntimeError("required model-generated executive overview failed; no deterministic narrative fallback was published")
        elif findings and deterministic_only:
            raise RuntimeError("deterministic-only mode cannot publish report findings without a model-generated executive overview")
        else:
            executive = {"headline": (ui.get("report") or {}).get("title", "Study findings"), "abstract": "", "key_finding_ids": [], "key_stat_callout_ids": [], "generation_mode": "unavailable"}
        package = {"schema_version": ATLAS_SCHEMA_VERSION, "report_id": (ui.get("report") or {}).get("id"), "audience": "general_nontechnical", "executive_overview": executive, "themes": [{"id": f"theme_{stable_hash(t.get('title',''))[:16]}", "title": t.get("title", "Theme"), "summary": t.get("summary", ""), "chapter_ids": [c["id"] for c in chapters if c["title"] == t.get("title")], "finding_ids": [f["id"] for f in findings if any(c["id"] in [x["id"] for x in chapters if x["title"] == t.get("title")] and f["id"] in c.get("finding_ids", []) for c in chapters)]} for t in themes], "chapters": chapters, "findings": findings, "stat_callouts": callouts, "uncertainties": uncertainties, "coverage": {"evidence_unit_count": len(units), "material_groups": len(groups), "groups_assigned": len(groups), "partition_count": len(expanded_fragments), "generation_mode": "model_generated" if any(not x["cache"] and x["response"] for x in expanded_fragments) else "deterministic_fallback"}}
        validation = validate_atlas(package, ui, {u["id"] for u in units})
        limited = bool(validation["warnings"] or not findings)
        self.store.write_json("study_atlas_validation_report.json", validation); self.store.write_json("study_atlas_generation_audit.json", {"validation": validation, "calls": self.transport.usage_records, "call_count": self._call_count, "total_tokens": self._token_total, "status": "completed_with_limitations" if limited else "completed"})
        if not validation["valid"]: raise ValueError(f"study atlas failed validation: {validation['issues'][:3]}")
        self.store.write_json("report_synthesis_package.json", package)
        consolidate_ui_packages(self.synthesis_dir)
        return {"status": "completed_with_limitations" if limited else "completed", "path": str(self.synthesis_dir / "report_synthesis_package.json"), "counts": validation["counts"]}
