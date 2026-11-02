from __future__ import annotations

import argparse
import json
import logging
import shutil
import sys
from pathlib import Path

from .models import ExtractorConfig, Request, SynthesizerConfig
from .workflow import ResearchWorkflow


def configure_logging(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("research_engine_v2")
    logger.setLevel(logging.INFO)
    logger.handlers.clear()
    formatter = logging.Formatter("%(asctime)s %(levelname)s [research_engine_v2] %(message)s", datefmt="%Y-%m-%dT%H:%M:%S%z")
    console = logging.StreamHandler()
    console.setFormatter(formatter)
    file_handler = logging.FileHandler(path, encoding="utf-8")
    file_handler.setFormatter(formatter)
    logger.addHandler(console)
    logger.addHandler(file_handler)


def extractor_dir_for(planning_dir: Path) -> Path:
    """Map the fixed planner stage directory to its sibling extractor directory."""
    return planning_dir.parent / "extractor"


def planner_dir_for(output: Path) -> Path:
    return output / "planner"


def reset_stage_dir(path: Path) -> None:
    """Replace one stage's output directory while leaving its parent untouched."""
    if path.exists():
        shutil.rmtree(path)
    path.mkdir(parents=True, exist_ok=False)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="research-engine-v2")
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("plan")
    run.add_argument("--request", required=True, type=Path)
    run.add_argument("--output", required=True, type=Path)
    execute = sub.add_parser("extract")
    execute.add_argument("--run", type=Path)
    execute.add_argument("--plan", type=Path)
    execute.add_argument("--output", type=Path)
    execute.add_argument("--max-calls", type=int)
    execute.add_argument("--max-total-tokens", type=int)
    execute.add_argument("--max-output-tokens", type=int)
    execute.add_argument("--max-concurrency", type=int, default=3)
    execute.add_argument("--reasoning-effort", choices=["low", "medium", "high"], default="low")
    execute.add_argument("--resume", action="store_true", help="reuse completed extractor artifacts and retry only incomplete work")
    execute.add_argument("--target-id", help="run only the Planner target with this ID")
    execute.add_argument("--chunk-id", help="run only the resolved chunk with this ID")
    execute.add_argument("--max-chunks", type=int, help="run at most this many resolved chunks")
    package = sub.add_parser("package", help="assemble existing Extractor artifacts without model calls")
    package.add_argument("--output", required=True, type=Path, help="Extractor artifact directory")
    package.add_argument("--manifest", type=Path, help="versioned evidence manifest to use as metadata")
    reconcile = sub.add_parser("reconcile", help="rebuild deterministic Extractor outputs without model calls")
    reconcile.add_argument("--output", required=True, type=Path, help="Extractor artifact directory")
    reconcile.add_argument("--manifest", type=Path, help="versioned evidence manifest to use as metadata")
    audit = sub.add_parser("audit", help="inspect a generated evidence pack without model calls")
    audit.add_argument("--pack", required=True, type=Path)
    synthesize = sub.add_parser("synthesize")
    synthesize.add_argument("--run", required=True, type=Path)
    synthesize.add_argument("--extraction-dir", type=Path, help="use a specific Extractor artifact directory")
    synthesize.add_argument("--synthesis-dir", type=Path, help="write synthesis artifacts to this directory")
    synthesize.add_argument("--max-calls", type=int, help="optional Spark call limit")
    synthesize.add_argument("--max-total-tokens", type=int, help="optional total-token limit")
    synthesize.add_argument("--max-output-tokens", type=int, help="optional per-call output-token limit")
    synthesize.add_argument("--ui-concurrency", type=int, help="parallel UI fragment calls (default: 4)")
    synthesize.add_argument("--review", action="store_true", help="enable the optional review pass")
    synthesize.add_argument("--resume", action="store_true", help="reuse completed synthesis branch artifacts and run only incomplete/finalization work")
    synthesize.add_argument("--ui-only", action="store_true", help="synthesize the v1 scientific UI package directly from Extractor evidence")
    narrative = sub.add_parser("synthesize-ui-narrative", aliases=["synthesize-narrative"], help="generate grounded UI feature narratives from an existing UI package")
    narrative.add_argument("--run", required=True, type=Path)
    narrative.add_argument("--extraction-dir", required=True, type=Path)
    narrative.add_argument("--synthesis-dir", required=True, type=Path)
    narrative.add_argument("--concurrency", type=int, default=16)
    narrative.add_argument("--max-calls", type=int)
    narrative.add_argument("--max-total-tokens", type=int)
    narrative.add_argument("--max-output-tokens", type=int)
    narrative.add_argument("--resume", action="store_true")
    narrative.add_argument("--deterministic-only", action="store_true", help="assemble from cached feature fragments without model calls")
    narrative.add_argument("--feature-scope", choices=["renderable", "all"], default="renderable", help="narrate renderable spatial features, or all features")
    consolidate = sub.add_parser("consolidate-ui", help="merge the scientific UI package and feature narratives without model calls")
    consolidate.add_argument("--synthesis-dir", required=True, type=Path)
    consolidate.add_argument("--output", type=Path)
    all_run = sub.add_parser("run")
    all_run.add_argument("--request", required=True, type=Path)
    all_run.add_argument("--output", required=True, type=Path)
    all_run.add_argument("--enable-review", action="store_true")
    all_run.add_argument("--synthesis-max-calls", type=int, default=8)
    all_run.add_argument("--synthesis-max-total-tokens", type=int, default=120000)
    resume = sub.add_parser("resume")
    resume.add_argument("--run", required=True, type=Path)
    resume.add_argument("--stage", choices=["planning", "extractor", "synthesizer"], default="planning")
    args = parser.parse_args(argv)
    if args.command in {"package", "reconcile"}:
        from .evidence_pack import build_evidence_pack
        pack = build_evidence_pack(args.output, args.manifest)
        print(pack["path"], flush=True)
        return 0
    if args.command == "audit":
        from .evidence_pack import audit_evidence_pack
        print(json.dumps(audit_evidence_pack(args.pack), indent=2), flush=True)
        return 0
    if args.command == "consolidate-ui":
        from .ui_consolidator import consolidate_ui_packages
        result = consolidate_ui_packages(args.synthesis_dir, args.output)
        print(result["path"], flush=True)
        return 0
    extractor_config = ExtractorConfig(
        max_model_calls=getattr(args, "max_calls", None),
        max_total_tokens=getattr(args, "max_total_tokens", None),
        max_output_tokens=getattr(args, "max_output_tokens", None),
        max_concurrency=getattr(args, "max_concurrency", 3),
        reasoning_effort=getattr(args, "reasoning_effort", "low"),
        target_id=getattr(args, "target_id", None),
        chunk_id=getattr(args, "chunk_id", None),
        max_chunks=getattr(args, "max_chunks", None),
    )
    if extractor_config.max_output_tokens is None:
        extractor_config.max_output_tokens = 5000
    if args.command == "resume":
        run_dir = args.run
        request = Request.model_validate_json((run_dir / "request_snapshot.json").read_text(encoding="utf-8"))
        if args.stage == "planning":
            configure_logging(run_dir / "logs" / "research_engine_v2.log")
            result = ResearchWorkflow.resume_planning(request, run_dir)
        else:
            extraction_root = extractor_dir_for(run_dir)
            if args.stage == "extractor":
                configure_logging(extraction_root / "logs" / "research_engine_v2.log")
                result = ResearchWorkflow.resume_extraction(request, run_dir, extraction_root)
            else:
                synthesis_root = run_dir.parent / "synthesizer"
                configure_logging(synthesis_root / "logs" / "research_engine_v2.log")
                result = ResearchWorkflow(request, run_dir).run_synthesis(synthesis_dir=synthesis_root)
        status = result.get("status") if isinstance(result, dict) else result.status
        print(status, flush=True)
        return 0 if status in {"completed", "completed_with_limitations"} else 1
    if args.command == "extract":
        if args.plan:
            from .extractor import Extractor
            extraction_root = args.output or args.plan.parent / "extractor"
            if not args.resume:
                reset_stage_dir(extraction_root)
            elif not extraction_root.exists():
                raise SystemExit(f"cannot resume: extractor output does not exist: {extraction_root}")
            configure_logging(extraction_root / "logs" / "research_engine_v2.log")
            result = Extractor(args.plan, extraction_root, extractor_config).run()
            print(result.status, flush=True)
            return 0 if result.status in {"completed", "completed_with_limitations"} else 1
        if not args.run:
            raise SystemExit("extract requires either --plan FILE --output DIR or --run PLANNER_DIR")
        run_dir = args.run
        request = Request.model_validate_json((run_dir / "request_snapshot.json").read_text(encoding="utf-8"))
        extraction_root = extractor_dir_for(run_dir)
        if not args.resume:
            reset_stage_dir(extraction_root)
        elif not extraction_root.exists():
            raise SystemExit(f"cannot resume: extractor output does not exist: {extraction_root}")
        configure_logging(extraction_root / "logs" / "research_engine_v2.log")
        result = ResearchWorkflow(request, run_dir).run_extraction(config=extractor_config)
        (extraction_root / "status.json").write_text(json.dumps(result.model_dump(mode="json"), indent=2), encoding="utf-8")
        print(result.status, flush=True)
        return 0 if result.status in {"completed", "completed_with_limitations"} else 1
    if args.command == "synthesize":
        run_dir = args.run
        request = Request.model_validate_json((run_dir / "request_snapshot.json").read_text(encoding="utf-8"))
        synthesis_root = args.synthesis_dir or run_dir.parent / "synthesizer"
        if not synthesis_root.exists(): synthesis_root.mkdir(parents=True)
        configure_logging(synthesis_root / "logs" / "research_engine_v2.log")
        result = ResearchWorkflow(request, run_dir).run_synthesis(extraction_dir=args.extraction_dir, synthesis_dir=synthesis_root, config=SynthesizerConfig(max_spark_calls=args.max_calls, max_total_tokens=args.max_total_tokens, max_output_tokens=args.max_output_tokens, ui_max_concurrency=args.ui_concurrency or 4, enable_review=args.review), resume=args.resume, ui_only=args.ui_only)
        print(result["status"], flush=True)
        return 0 if result["status"] in {"completed", "completed_with_limitations"} else 1
    if args.command in {"synthesize-ui-narrative", "synthesize-narrative"}:
        from .narrative_synthesizer import NarrativeSynthesizer
        run_dir = args.run
        request = Request.model_validate_json((run_dir / "request_snapshot.json").read_text(encoding="utf-8"))
        synthesis_root = args.synthesis_dir
        synthesis_root.mkdir(parents=True, exist_ok=True)
        configure_logging(synthesis_root / "logs" / "research_engine_v2.log")
        config = SynthesizerConfig(max_spark_calls=args.max_calls, max_total_tokens=args.max_total_tokens, max_output_tokens=args.max_output_tokens, ui_max_concurrency=max(1, min(args.concurrency, 16)))
        result = NarrativeSynthesizer(request, run_dir, args.extraction_dir, synthesis_root, config=config).run(resume=args.resume, concurrency=args.concurrency, deterministic_only=args.deterministic_only, feature_scope=args.feature_scope)
        if result["status"] in {"completed", "completed_with_limitations"}:
            from .ui_consolidator import consolidate_ui_packages
            consolidate_ui_packages(synthesis_root)
        print(result["status"], flush=True)
        return 0
    request = Request.model_validate_json(args.request.read_text(encoding="utf-8"))
    run_dir = planner_dir_for(args.output)
    reset_stage_dir(run_dir)
    configure_logging(run_dir / "logs" / "research_engine_v2.log")
    label = "run" if args.command == "run" else "planning run"
    print(f"Research Engine V2 {label}: {request.research_id}", flush=True)
    print(f"Run artifacts: {run_dir}", flush=True)
    workflow = ResearchWorkflow(request, run_dir)
    if args.command == "run":
        planning = workflow.run_planning()
        if planning.status == "completed":
            extraction_root = extractor_dir_for(run_dir)
            reset_stage_dir(extraction_root)
            configure_logging(extraction_root / "logs" / "research_engine_v2.log")
            result = workflow.run_extraction(config=extractor_config)
            if result.status == "completed":
                synthesis_root = run_dir.parent / "synthesizer"
                reset_stage_dir(synthesis_root)
                configure_logging(synthesis_root / "logs" / "research_engine_v2.log")
                result = workflow.run_synthesis(synthesis_dir=synthesis_root, config=SynthesizerConfig(enable_review=args.enable_review, max_spark_calls=args.synthesis_max_calls, max_total_tokens=args.synthesis_max_total_tokens))
        else:
            result = planning
    else:
        result = workflow.run_planning()
    if args.command == "run" and isinstance(result, dict):
        synthesis_root = run_dir.parent / "synthesizer"
        (synthesis_root / "status.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    elif args.command == "run" and result.__class__.__name__ == "ExecutionResult":
        extraction_root = extractor_dir_for(run_dir)
        extraction_root.mkdir(parents=True, exist_ok=True)
        (extraction_root / "status.json").write_text(json.dumps(result.model_dump(mode="json"), indent=2), encoding="utf-8")
    else:
        (run_dir / "status.json").write_text(json.dumps(result.model_dump(mode="json"), indent=2), encoding="utf-8")
    status = result.get("status") if isinstance(result, dict) else result.status
    print(status, flush=True)
    return 0 if status == "completed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
