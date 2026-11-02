from .models import ResearchResult


def write_report(result: ResearchResult, path: str) -> None:
    lines = [
        f"# Research report: {result.research_id}",
        "",
        f"Status: **{result.status}**",
        "",
        "## Executive summary",
        result.summary,
        "",
        "## Research conclusions",
    ]
    for claim in result.conclusions:
        refs = (
            ", ".join(f"{e.document_id} p.{e.page}" for e in claim.evidence)
            or "No grounded source reference"
        )
        lines.append(f"- {claim.text} ({claim.status}; {refs})")
    lines += ["", "## Extracted evidence"]
    for claim in result.key_findings:
        refs = (
            ", ".join(f"{e.document_id} p.{e.page}" for e in claim.evidence)
            or "No grounded source reference"
        )
        lines += [f"- {claim.text} ({claim.status}; {refs})"]
    lines += ["", "## Contradictions"] + (
        [f"- {c.description}" for c in result.contradictions] or ["None recorded."]
    )
    lines += ["", "## Limitations"] + (
        [f"- {x}" for x in result.limitations] or ["None recorded."]
    )
    lines += ["", "## Open questions"] + (
        [f"- {x}" for x in result.unanswered_questions] or ["None recorded."]
    )
    lines += ["", "## Document Coverage & Scope Audit"]
    coverage = result.source_coverage or result.coverage or {}
    if coverage:
        if (
            isinstance(coverage, dict)
            and "document_id" not in coverage
            and all(isinstance(v, dict) for v in coverage.values())
        ):
            items = coverage.items()
        else:
            items = [(coverage.get("document_id", "document"), coverage)]
        for document_id, entry in items:
            lines += [
                f"### {document_id}",
                f"- Total document pages: {entry.get('total_pages', entry.get('pages', 'unknown'))}",
                f"- Candidate pages: {entry.get('candidate_pages', 'not recorded')}",
                f"- AI-extracted pages: {entry.get('processed_pages', 'not recorded')}",
                f"- Skipped/unprocessed pages: {entry.get('skipped_pages', 'none recorded')}",
                f"- Coverage status: {entry.get('status', 'unknown')}",
            ]
    else:
        lines.append("Coverage was not recorded.")
    from pathlib import Path

    Path(path).write_text("\n".join(lines) + "\n", encoding="utf-8")
