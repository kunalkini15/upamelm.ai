from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from .artifacts import ArtifactStore
from .models import Request
from .muse import ResponsesTransport
from .synthesis_support import EvidenceAssembler, stable_hash

SPARK = "muse-spark-1.3-contributor"
WONDER = "muse-wonder-1.0"

SYNTHESIS_INSTRUCTIONS = """You are a domain-independent research synthesizer. Produce one source-grounded synthesis for the whole objective. Use only evidence returned by the read-only tools. Distinguish observations, source interpretations, normalized records, calculations, and hypotheses. Preserve conflicts, uncertainty, missing data, and visualization limits. Coordinates and geometry may be used for UI only when explicitly grounded; never invent or interpolate authoritative surfaces. Call write_synthesis exactly once when complete."""


def _tool(name: str, description: str, properties: dict[str, Any], required: list[str]) -> dict[str, Any]:
    return {"type": "function", "name": name, "description": description, "parameters": {"type": "object", "properties": properties, "required": required, "additionalProperties": False}}


def synthesis_tools() -> list[dict[str, Any]]:
    return [
        _tool("search_evidence", "Search normalized evidence by text, class, target, or page.", {"query": {"type": "string"}, "limit": {"type": "integer"}}, ["query"]),
        _tool("read_evidence_items", "Read selected normalized evidence items by stable ID.", {"ids": {"type": "array", "items": {"type": "string"}}}, ["ids"]),
        _tool("read_evidence_artifact", "Read one complete source-grounded artifact by its relative path.", {"path": {"type": "string"}}, ["path"]),
        _tool("inspect_coverage", "Inspect planned targets, missing evidence, limitations, and coordinate validation.", {}, []),
        {"type": "function", "name": "write_synthesis", "description": "Persist the complete structured synthesis.", "strict": True, "parameters": {"type": "object", "properties": {"schema_version": {"type": "string"}, "report_markdown": {"type": "string"}, "summary": {"type": "string"}, "findings": {"type": "array", "items": {"type": "object"}}, "entities": {"type": "array", "items": {"type": "object"}}, "relationships": {"type": "array", "items": {"type": "object"}}, "measurements": {"type": "array", "items": {"type": "object"}}, "spatial_extents": {"type": "array", "items": {"type": "object"}}, "temporal_extents": {"type": "array", "items": {"type": "object"}}, "conflicts": {"type": "array", "items": {"type": "object"}}, "uncertainties": {"type": "array", "items": {"type": "object"}}, "limitations": {"type": "array", "items": {"type": "string"}}, "unresolved_questions": {"type": "array", "items": {"type": "string"}}, "evidence": {"type": "array", "items": {"type": "object"}}, "provenance": {"type": "array", "items": {"type": "object"}}}, "required": ["schema_version", "report_markdown", "summary", "findings", "entities", "relationships", "measurements", "spatial_extents", "temporal_extents", "conflicts", "uncertainties", "limitations", "unresolved_questions", "evidence", "provenance"], "additionalProperties": False}},
    ]


class Synthesizer:
    def __init__(self, request: Request, planning_dir: Path, extraction_dir: Path, synthesis_dir: Path, config: Any | None = None):
        self.request, self.planning_dir, self.extraction_dir, self.synthesis_dir = request, planning_dir, extraction_dir, synthesis_dir
        self.synthesis_dir.mkdir(parents=True, exist_ok=True)
        self.store = ArtifactStore(synthesis_dir)
        self.config = config or type("Cfg", (), {"max_spark_calls": 8, "max_total_tokens": 120000, "max_output_tokens": 12000, "review": False, "reasoning_effort": "medium", "search_limit": 20})()
        self.transport = ResponsesTransport(synthesis_dir / "model_io", max_output_tokens=self.config.max_output_tokens)
        self.log = logging.getLogger("research_engine_v2")

    def run(self) -> dict[str, Any]:
        effective, index, coverage = EvidenceAssembler(self.extraction_dir).build()
        self.store.write_json("effective_evidence_manifest.json", effective)
        self.store.write_json("evidence_index.json", index)
        self.store.write_json("coverage_audit.json", coverage)
        plan = self._load_plan()
        compact = {"objective": self.request.objective, "context": self.request.context, "plan": plan, "coverage": coverage, "evidence_index": {k: v for k, v in index.items() if k != "items"}, "group_summaries": effective.get("group_analyses", [])}
        replay: list[dict[str, Any]] = []
        draft: dict[str, Any] | None = None
        for turn in range(self.config.max_spark_calls):
            response = self.transport.call(SYNTHESIS_INSTRUCTIONS, json.dumps(compact, ensure_ascii=False, default=str), synthesis_tools(), replay_items=replay or None, phase="synthesis", reasoning_effort=self.config.reasoning_effort, prompt_cache_key=f"{self.request.research_id}:synthesis:{stable_hash(plan)}", model=SPARK)
            calls = response.function_calls
            if not calls:
                break
            call = calls[0]
            args = json.loads(call.get("arguments") or "{}")
            if call.get("name") == "write_synthesis":
                draft = args
                break
            observation = self._dispatch(call.get("name", ""), args, index, coverage)
            replay = [x for x in response.raw.get("output", []) if x.get("type") in {"reasoning", "function_call", "message"}] + [{"type": "function_call_output", "call_id": call.get("call_id", ""), "output": json.dumps(observation, ensure_ascii=False, default=str)}]
        if not draft or not str(draft.get("report_markdown", "")).strip():
            raise ValueError("synthesizer did not return a complete write_synthesis artifact")
        self.store.version("synthesis_draft", draft)
        final = self._validate(draft, coverage, index)
        report_path, report_version = self.store.version("research_report", final["report_markdown"], kind="md")
        self.store.version("synthesis_final", final)
        usage = {"model": SPARK, "calls": self.transport.usage_records, "total_tokens": sum(x.get("total_tokens", 0) for x in self.transport.usage_records), "review_enabled": bool(self.config.review)}
        result = {"research_id": self.request.research_id, "status": "completed", "objective": self.request.objective, "report_artifact_id": "research_report", "report_version": report_version, "finding_count": len(final.get("findings", [])), "evidence_count": len(final.get("evidence", [])), "unresolved_questions": final.get("unresolved_questions", []), "limitations": final.get("limitations", []), "coverage": coverage, "usage_summary": usage}
        self.store.write_json("synthesis_result.json", result); self.store.write_json("synthesis_usage.json", usage); self.store.write_json("status.json", result)
        return result

    def _dispatch(self, name: str, args: dict[str, Any], index: dict[str, Any], coverage: dict[str, Any]) -> Any:
        if name == "inspect_coverage": return coverage
        if name == "read_evidence_items": return {"items": [x for x in index["items"] if x["id"] in set(args.get("ids", []))]}
        if name == "search_evidence":
            q = str(args.get("query", "")).lower(); limit = min(int(args.get("limit", 20)), 20)
            return {"items": [x for x in index["items"] if q in json.dumps(x, ensure_ascii=False, default=str).lower()][:limit]}
        if name == "read_evidence_artifact":
            path = (self.extraction_dir / str(args.get("path", ""))).resolve()
            if self.extraction_dir.resolve() not in path.parents: return {"error": "path outside extraction directory"}
            try: return json.loads(path.read_text(encoding="utf-8"))
            except Exception as exc: return {"error": str(exc)}
        return {"error": f"unknown tool: {name}"}

    def _validate(self, draft: dict[str, Any], coverage: dict[str, Any], index: dict[str, Any]) -> dict[str, Any]:
        draft.setdefault("schema_version", "1.0")
        draft.setdefault("limitations", [])
        if coverage.get("missing_target_ids"): draft["limitations"].append(f"No successful group analysis for targets: {', '.join(coverage['missing_target_ids'])}")
        if index.get("invalid_coordinates"): draft["limitations"].append("Some coordinate records were quarantined because their ranges were invalid.")
        return draft

    def _load_plan(self) -> dict[str, Any]:
        path = self.planning_dir / "planning_result.json"
        if not path.exists(): raise ValueError("planning result is required before synthesis")
        result = json.loads(path.read_text(encoding="utf-8")); manifest = json.loads((self.planning_dir / "manifest.json").read_text(encoding="utf-8"))
        versions = manifest["artifacts"][result["plan_artifact_id"]]["versions"]
        return json.loads((self.planning_dir / versions[int(result.get("plan_version") or len(versions)) - 1]["path"]).read_text(encoding="utf-8"))
