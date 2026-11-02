from __future__ import annotations
import json
import sys
import uuid
from pathlib import Path
from .models import ResearchRequest, ResearchState
from .agent.orchestrator import ResearchOrchestrator
from .storage import load_state
from .reporting import write_report
from .logging_utils import configure_logging


def main(argv=None):
    args = list(argv or sys.argv[1:])
    if not args or args[0] not in {"run", "resume"}:
        raise SystemExit(
            "usage: research-engine run --request FILE --output DIR | resume --state FILE"
        )
    if args[0] == "run":
        req = ResearchRequest.model_validate_json(
            Path(args[args.index("--request") + 1]).read_text()
        )
        output_root = Path(args[args.index("--output") + 1])
        output_root.mkdir(parents=True, exist_ok=True)
        run_id = uuid.uuid4().hex
        out = output_root / "runs" / run_id
        out.mkdir(parents=True, exist_ok=False)
        log_file = (
            Path(args[args.index("--log-file") + 1])
            if "--log-file" in args
            else out / "research_engine.log"
        )
        configure_logging(log_file)
        print(f"Research Engine starting: {req.research_id}", flush=True)
        print(f"Progress log: {log_file}", flush=True)
        print(f"Run artifacts: {out}", flush=True)
        initial_state = ResearchState(
            research_id=req.research_id,
            objective=req.objective,
            pending_questions=list(req.research_questions),
            request_snapshot=req.model_dump(),
            run_id=run_id,
        )
        result = ResearchOrchestrator(req, state=initial_state).run(
            str(out / "research_state.json")
        )
    else:
        state_path = Path(args[args.index("--state") + 1])
        state = load_state(state_path)
        out = state_path.parent
        log_file = (
            Path(args[args.index("--log-file") + 1])
            if "--log-file" in args
            else out / "research_engine.log"
        )
        configure_logging(log_file)
        print(f"Research Engine resuming: {state.research_id}", flush=True)
        print(f"Progress log: {log_file}", flush=True)
        # Resume the original request, including questions, instructions, and budget.
        snapshot = state.request_snapshot or {}
        sources = snapshot.get("sources") or [
            {"type": "local_document", "path": d["path"]}
            for d in state.source_documents.values()
            if d.get("path")
        ]
        if not sources:
            raise SystemExit("state does not contain resumable source paths")
        req = ResearchRequest.model_validate(
            {
                **snapshot,
                "research_id": state.research_id,
                "objective": state.objective,
                "sources": sources,
            }
        )
        if state.status in {
            "partial",
            "stalled",
            "ceiling_reached",
            "cancelled",
            "running",
            "failed",
        }:
            state.status = "running"
        result = ResearchOrchestrator(req, state=state).run(str(state_path))
    (out / "research_result.json").write_text(
        result.model_dump_json(indent=2), encoding="utf-8"
    )
    (out / "evidence_ledger.json").write_text(
        json.dumps([x.model_dump() for x in result.key_findings], indent=2),
        encoding="utf-8",
    )
    (out / "execution_trace.json").write_text(
        json.dumps([x.model_dump() for x in result.execution_trace], indent=2),
        encoding="utf-8",
    )
    (out / "research_plan.json").write_text(
        json.dumps(result.research_plan, indent=2), encoding="utf-8"
    )
    (out / "usage.json").write_text(
        json.dumps(result.model_usage, indent=2), encoding="utf-8"
    )
    (out / "issues.json").write_text(
        json.dumps(result.issues, indent=2), encoding="utf-8"
    )
    (out / "coverage.json").write_text(
        json.dumps(result.coverage, indent=2), encoding="utf-8"
    )
    (out / "extraction_tasks.json").write_text(
        json.dumps(result.extraction_tasks, indent=2), encoding="utf-8"
    )
    write_report(result, str(out / "research_report.md"))
    if args[0] == "run":
        pointer = Path(args[args.index("--output") + 1]) / "latest_run.json"
        temporary = pointer.with_name(f".{pointer.name}.{uuid.uuid4().hex}.tmp")
        temporary.write_text(
            json.dumps(
                {"run_id": run_id, "path": str(out.resolve()), "status": result.status},
                indent=2,
            ),
            encoding="utf-8",
        )
        temporary.replace(pointer)
    print(result.status)


if __name__ == "__main__":
    main()
