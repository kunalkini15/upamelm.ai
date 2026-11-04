# Source Intelligence

Standalone discovery and acquisition for current, authoritative city-study documents. This package does not import or modify `agentic-subsurface`, `research-engine-v2`, `doc-intelligence`, or the UI. Its stable output boundary is `source_manifest.json` plus immutable downloaded documents.

## What it does

For each requested category it:

1. asks Meta Muse to refine deterministic city/district and recency-aware searches;
2. searches broad Google results through Serper (with Google Programmable Search and Firecrawl retained as optional adapters);
3. deduplicates URLs and inspects candidates;
4. resolves landing pages to supported downloadable files;
5. extracts publication and underlying data-vintage evidence;
6. rejects unknown or stale data using category-specific hard limits;
7. ranks eligible sources by geography, recency, authority, utility, and date confidence;
8. downloads the highest-ranked unique source with size, redirect, MIME/magic-byte, and checksum controls;
9. emits selected, rejected, coverage, error, and provenance artifacts.

Model assistance is optional. When enabled, Muse plans the final search queries and assesses inspected candidates. Model-returned dates are used only if its evidence excerpts occur in the inspected document sample. Search execution, redirects, downloads, limits, hashes, ranking gates, and file writes remain deterministic.

## Install

```bash
cd source-intelligence
python -m venv .venv
.venv/bin/pip install -e '.[dev]'
```

Create the single environment file and replace its two placeholder keys:

```bash
cp .env.example .env
```

The CLI automatically loads `.env` from the current directory or the `source-intelligence` project directory. Existing exported environment variables take precedence.

The supplied template is ready for Serper search and Meta Muse 1.3 Contributor. Only `SERPER_API_KEY` and `MODEL_API_KEY` are required edits. Serper supplies ordinary Google result metadata; all query planning, relevance reasoning, freshness assessment, and selection remain with Meta Muse and deterministic code. Firecrawl and Google Programmable Search remain optional adapters but are not the default.

## Run

Run only Muse query planning (no Serper calls, inspection, or downloads):

```bash
source-intelligence run \
  --request examples/bengaluru.json \
  --output runs/bengaluru-query-plan \
  --stage query-planning
```

The final proposed search terms are printed and saved in `coverage_plan.json`. The complete Muse request, raw response, and parsed response are saved under `model_io/`.

Run discovery, both bounded search rounds, probing and semantic triage without full document downloads:

```bash
source-intelligence run \
  --request examples/bengaluru.json \
  --output runs/bengaluru-inspect \
  --stage inspect
```

This writes `inspection_summary.json`, including shortlisted candidates, canonical unresolved capabilities, projected marginal-selection order and budget usage. It does not create a source manifest or download documents.

Run the complete pipeline:

```bash
source-intelligence validate-request --request examples/bengaluru.json

source-intelligence run \
  --request examples/bengaluru.json \
  --output runs/bengaluru-2026-11-03 \
  --stage full
```

Resume without repeating completed search/inspection work:

```bash
source-intelligence run --request examples/bengaluru.json --output runs/bengaluru-2026-11-03 --resume
```

The command exits `0` if at least one fresh source was acquired, `2` if none were acquired, and nonzero on invalid configuration or an unrecoverable run error. Missing categories are reported as `fresh_source_unavailable`; stale documents are never silently substituted.

## Request contract

The example uses the five defaults. Callers can override categories, freshness rules, trusted domains, publisher preferences, city and district aliases, local-language names, existing-source summaries, evidence gaps, target capabilities, package limits, and explicit run budgets. Older request files remain valid. District aliases are searched as district-scoped evidence and are not assumed to represent the city footprint.

## Manifest handoff contract

`source_manifest.json` is the only ingestion handoff. A source is emitted only after its downloaded asset passes the available format validator. Each source retains candidate/query provenance, URLs, checksum, size, evidence categories/types, validation results, dates, ingestion targets and selection reason. `budget_usage.json` and the manifest's `budget_usage` describe calls, inspected pages, downloaded bytes and stopping reasons. This module does not invoke downstream processing.

Candidate assessment uses a fixed 13-value capability vocabulary. Freshness is evaluated per grounded contribution: static observations such as measured borehole lithology remain useful with age, while stale groundwater levels, water quality and land-motion observations are excluded. Full acquisition uses greedy marginal utility across the candidate pool rather than selecting independently by category.

## Output

```text
run/
  request.json
  deterministic_coverage_plan.json
  coverage_plan.json
  search_results.json
  candidates.json
  selected_sources.json
  rejected_sources.json
  source_manifest.json
  source_manifest.partial.json
  logs/
    source_intelligence.log
    decision_trace.jsonl
  model_io/call-NNNN-<phase>/
    request.json
    response.json
    parsed.json
    error.json                  # only when a model call fails
  search_io/<query-id>/
    request.json
    response.json
  errors/
  documents/<category>/<sha-prefix>-<filename>
```

`coverage_plan.json` contains the exact final queries generated/refined by Muse. `model_io` preserves every sanitized model request, raw response, and parsed output. `search_io` preserves every Serper request and raw response. `decision_trace.jsonl` provides a chronological, machine-readable explanation of candidate rejection, scoring, downloads, and final selection. Authorization headers and API keys are never written to these artifacts.

Every run prints live stage and item-level progress and writes the same information to `logs/source_intelligence.log`. `logs/decision_trace.jsonl` is the structured event stream. Successful commands produce `run_summary.json` with elapsed time, budget usage, counts, coverage and important artifact paths. An unrecoverable command error produces `run_failure.json` and a full traceback in the human-readable log. Provider keys and authorization headers are excluded from all logs.

`source_manifest.json` is intentionally neutral. A future integration adapter can translate its sources into any downstream request contract.

## Tests

```bash
pytest
```

Tests use fakes and make no external network or model calls.
