from __future__ import annotations

import argparse
import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from .config import Settings, load_env_file
from .models import CityRequest
from .orchestrator import SourceIntelligence
from .util import write_json


def main(argv: list[str] | None = None) -> int:
    load_env_file()
    parser = argparse.ArgumentParser(prog="source-intelligence", description="Find and acquire recent city-study source documents")
    subparsers = parser.add_subparsers(dest="command", required=True)
    run = subparsers.add_parser("run", help="run discovery, qualification, and acquisition")
    run.add_argument("--request", required=True, type=Path)
    run.add_argument("--output", required=True, type=Path)
    run.add_argument("--resume", action="store_true")
    run.add_argument("--stage", choices=("query-planning", "inspect", "full"), default="full",
                     help="stop after query planning, stop after search/inspection, or run the full pipeline")
    validate = subparsers.add_parser("validate-request", help="validate and normalize a city request")
    validate.add_argument("--request", required=True, type=Path)
    args = parser.parse_args(argv)
    request = CityRequest.model_validate_json(args.request.read_text(encoding="utf-8"))
    if args.command == "validate-request":
        print(json.dumps(request.model_dump(mode="json"), indent=2))
        return 0
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "logs").mkdir(parents=True, exist_ok=True)
    log_format = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)
    # pypdf can emit one warning per unsupported embedded font; extraction still
    # succeeds and the repetition obscures pipeline progress.
    logging.getLogger("pypdf._cmap").setLevel(logging.ERROR)
    if not root_logger.handlers:
        console = logging.StreamHandler()
        console.setFormatter(log_format)
        root_logger.addHandler(console)
    file_handler = logging.FileHandler(args.output / "logs" / "source_intelligence.log", encoding="utf-8")
    file_handler.setFormatter(log_format)
    root_logger.addHandler(file_handler)
    settings = Settings.from_env()
    logging.getLogger(__name__).info(
        "Command started: stage=%s city=%s state=%s search_provider=%s model_provider=%s model=%s output=%s",
        args.stage, request.city, request.state, settings.search_provider, settings.model_provider,
        settings.model_name or "none", args.output.resolve(),
    )
    try:
        with SourceIntelligence(settings) as pipeline:
            if args.stage == "query-planning":
                plan = pipeline.plan_queries(request, args.output)
                print(json.dumps({
                    "status": "completed", "stage": "query-planning",
                    "coverage_plan": str((args.output / "coverage_plan.json").resolve()),
                    "run_summary": str((args.output / "run_summary.json").resolve()),
                    "queries": [query.model_dump(mode="json") for query in plan.queries],
                }, indent=2))
                return 0
            if args.stage == "inspect":
                summary = pipeline.run(request, args.output, resume=args.resume, acquire=False)
                print(json.dumps({
                    "status": "completed", "stage": "inspect",
                    "inspection_summary": str((args.output / "inspection_summary.json").resolve()),
                    "run_summary": str((args.output / "run_summary.json").resolve()),
                    "shortlisted": len(summary.shortlisted_candidate_ids),
                    "unresolved_capabilities": [item.value for item in summary.unresolved_capabilities],
                }, indent=2))
                return 0
            manifest = pipeline.run(request, args.output, resume=args.resume)
    except Exception as exc:
        logging.getLogger(__name__).exception("Command failed: %s", exc)
        failure = {
            "status": "failed", "stage": args.stage, "failed_at": datetime.now(timezone.utc).isoformat(),
            "error_type": type(exc).__name__, "error": str(exc),
            "human_log": "logs/source_intelligence.log", "decision_trace": "logs/decision_trace.jsonl",
        }
        write_json(args.output / "run_failure.json", failure)
        raise
    print(json.dumps({
        "status": "completed", "run_id": manifest.run_id, "manifest": str((args.output / "source_manifest.json").resolve()),
        "run_summary": str((args.output / "run_summary.json").resolve()),
        "selected": len(manifest.sources), "coverage": {item.category.value: item.status for item in manifest.coverage},
    }, indent=2))
    return 0 if manifest.sources else 2


if __name__ == "__main__":
    raise SystemExit(main())
