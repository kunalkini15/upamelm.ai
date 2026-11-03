from __future__ import annotations

import argparse
import json
from pathlib import Path

from .loop1 import process_corpus
from .models import DocumentRunRequest, PipelineConfig, RunRequest
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
    run.add_argument("--target-batch-tokens", type=int, default=128_000)
    run.add_argument("--max-batch-tokens", type=int, default=128_000)
    run.add_argument("--max-output-tokens", type=int, default=128_000)
    loop1 = sub.add_parser("loop1", help="process each source as an isolated, versioned Loop 1 document")
    loop1.add_argument("--input", required=True, type=Path, help="file or directory of source files")
    loop1.add_argument("--output", required=True, type=Path, help="corpus root")
    loop1.add_argument("--objective", required=True)
    loop1.add_argument("--corpus-id", default="agentic-subsurface-corpus")
    loop1.add_argument("--live", action="store_true")
    loop1.add_argument("--no-resume", action="store_true")
    loop1.add_argument("--no-activate", action="store_true")
    loop1.add_argument("--max-cost-usd", type=float, default=15.0)
    loop1.add_argument("--target-batch-tokens", type=int, default=128_000)
    loop1.add_argument("--max-batch-tokens", type=int, default=128_000)
    loop1.add_argument("--max-output-tokens", type=int, default=128_000)
    loop1.add_argument("--visual-classification-batch-size", type=int, default=20)
    loop1.add_argument("--visual-extraction-batch-size", type=int, default=10)
    loop1.add_argument("--max-workers", type=int, default=8, help="concurrent model requests (1-32)")
    loop1.add_argument("--materialization-mode", choices=["adaptive", "manual"], default="adaptive")
    loop1.add_argument("--materialization-workers", type=int)
    loop1.add_argument("--materialization-chunk-size", type=int)
    loop1.add_argument("--materialization-memory-limit-mb", type=int)
    loop1.add_argument("--materialization-backend", choices=["auto", "process", "thread", "sequential"], default="auto")
    loop1.add_argument("--start-step", type=int, choices=range(1, 9), default=1)
    loop1.add_argument("--end-step", type=int, choices=range(1, 9), default=8)
    args = parser.parse_args(argv)
    if args.command == "loop1":
        if args.start_step > args.end_step:
            parser.error("--start-step must be less than or equal to --end-step")
        sources = sorted(path for path in args.input.rglob("*") if path.is_file() and not any(part.startswith(".") for part in path.relative_to(args.input).parts)) if args.input.is_dir() else [args.input]
        config = PipelineConfig(live=args.live, max_cost_usd=args.max_cost_usd, target_batch_tokens=args.target_batch_tokens, max_batch_tokens=args.max_batch_tokens, max_output_tokens=args.max_output_tokens, visual_classification_batch_size=args.visual_classification_batch_size, visual_extraction_batch_size=args.visual_extraction_batch_size, max_workers=args.max_workers, materialization_mode=args.materialization_mode, materialization_workers=args.materialization_workers, materialization_chunk_size=args.materialization_chunk_size, materialization_memory_limit_mb=args.materialization_memory_limit_mb, materialization_backend=args.materialization_backend)
        requests = [DocumentRunRequest(corpus_id=args.corpus_id, objective=args.objective, source=source, output_dir=args.output, config=config, activate=not args.no_activate) for source in sources]
        print(json.dumps(process_corpus(requests, resume=not args.no_resume, start_step=args.start_step, end_step=args.end_step), indent=2))
        return 0
    sources = sorted(path for path in args.input.rglob("*") if path.is_file()) if args.input.is_dir() else [args.input]
    config = PipelineConfig(live=args.live, max_cost_usd=args.max_cost_usd, target_batch_tokens=args.target_batch_tokens, max_batch_tokens=args.max_batch_tokens, max_output_tokens=args.max_output_tokens)
    request = RunRequest(run_id=args.run_id, objective=args.objective, sources=sources, output_dir=args.output, config=config)
    result = AgenticSubsurfacePipeline(request).run(resume=not args.no_resume)
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

