from __future__ import annotations

import argparse
import json
from pathlib import Path

from .models import PipelineConfig, RunRequest
from .pipeline import AgenticSubsurfacePipeline


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="agentic-subsurface")
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("run")
    run.add_argument("--input", required=True, type=Path, help="file or directory of source files")
    run.add_argument("--output", required=True, type=Path)
    run.add_argument("--objective", required=True)
    run.add_argument("--run-id", default="agentic-subsurface-run")
    run.add_argument("--live", action="store_true")
    run.add_argument("--no-resume", action="store_true")
    run.add_argument("--max-cost-usd", type=float, default=19.0)
    run.add_argument("--target-batch-tokens", type=int, default=180_000)
    run.add_argument("--max-batch-tokens", type=int, default=250_000)
    args = parser.parse_args(argv)
    sources = sorted(path for path in args.input.rglob("*") if path.is_file()) if args.input.is_dir() else [args.input]
    config = PipelineConfig(live=args.live, max_cost_usd=args.max_cost_usd, target_batch_tokens=args.target_batch_tokens, max_batch_tokens=args.max_batch_tokens)
    request = RunRequest(run_id=args.run_id, objective=args.objective, sources=sources, output_dir=args.output, config=config)
    result = AgenticSubsurfacePipeline(request).run(resume=not args.no_resume)
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

