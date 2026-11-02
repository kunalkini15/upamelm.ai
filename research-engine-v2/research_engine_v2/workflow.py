"""Stage-oriented workflow control for Research Engine V2.

The workflow owns stage sequencing; individual stage agents own their domain
decisions and tools. Planning, extraction, and synthesis are registered as
independent stages; future stages can be added without changing either agent or the CLI
contract.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Protocol

from .models import ExecutionResult, ExtractorConfig, PlanningResult, Request, SynthesizerConfig
from .extractor import Extractor
from .planner import Planner
from .synthesizer import Synthesizer


class ResearchStage(Protocol):
    def run(self) -> Any: ...


class PlanningStage:
    """Adapter exposing the existing planning agent as a workflow stage."""

    def __init__(self, request: Request, run_dir: Path):
        self.agent = Planner(request, run_dir)

    def run(self) -> PlanningResult:
        return self.agent.run()

    @classmethod
    def resume(cls, request: Request, run_dir: Path) -> "PlanningStage":
        stage = cls.__new__(cls)
        stage.agent = Planner.resume(request, run_dir)
        return stage


class ResearchWorkflow:
    """Top-level lifecycle controller for the research-agent workflow."""

    def __init__(self, request: Request, run_dir: Path):
        self.request = request
        self.run_dir = run_dir

    def run_planning(self) -> PlanningResult:
        return PlanningStage(self.request, self.run_dir).run()

    def run_extraction(self, extraction_dir: Path | None = None, config: ExtractorConfig | None = None) -> Any:
        plan_path = self._latest_plan_path()
        limits = self.request.limits
        effective = config or ExtractorConfig(max_model_calls=limits.max_model_calls, max_total_tokens=limits.max_total_tokens)
        return Extractor(plan_path, extraction_dir or self.run_dir.parent / "extractor", effective).run()

    def run_synthesis(self, extraction_dir: Path | None = None, synthesis_dir: Path | None = None, config: SynthesizerConfig | None = None, resume: bool = False, ui_only: bool = False) -> dict[str, Any]:
        extraction_root = extraction_dir or self.run_dir.parent / "extractor"
        synthesis_root = synthesis_dir or self.run_dir.parent / "synthesizer"
        return Synthesizer(self.request, self.run_dir, extraction_root, synthesis_root, config=config).run(resume=resume, ui_only=ui_only)

    def run_all(self):
        planning = self.run_planning()
        if planning.status not in {"completed", "completed_with_limitations"}:
            return planning
        extraction = self.run_extraction()
        if extraction.status not in {"completed", "completed_with_limitations"}:
            return extraction
        return self.run_synthesis()

    @classmethod
    def resume_planning(cls, request: Request, run_dir: Path) -> PlanningResult:
        return PlanningStage.resume(request, run_dir).run()

    @classmethod
    def resume_extraction(cls, request: Request, run_dir: Path, extraction_dir: Path) -> Any:
        return Extractor(cls(request, run_dir)._latest_plan_path(), extraction_dir).run()

    def _latest_plan_path(self) -> Path:
        manifest = json.loads((self.run_dir / "manifest.json").read_text(encoding="utf-8"))
        versions = manifest.get("artifacts", {}).get("research_plan", {}).get("versions", [])
        if not versions:
            raise ValueError("completed Planner plan artifact is required")
        return self.run_dir / versions[-1]["path"]
