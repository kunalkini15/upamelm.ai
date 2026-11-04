# Agentic Subsurface Pipeline

An isolated evidence-first pipeline for heterogeneous technical and geospatial inputs.

It preserves immutable sources and deterministic derivatives, extracts grounded evidence in semantic batches with `muse-spark-1.3-contributor`, synthesizes the existing `scientific.v1` UI contract, creates feature narratives, and creates a report-level synthesis.

```bash
PYTHONPATH=agentic-subsurface/src doc-intelligence/.venv/bin/python -m agentic_subsurface.cli run \
  --input playground/bangalore/sample_docs/input \
  --output playground/bangalore/agentic_output \
  --objective "Build an evidence-grounded Bengaluru subsurface model" \
  --run-id bengaluru-subsurface \
  --live --max-cost-usd 19
```

Omit `--live` for deterministic adapter, artifact, batching, validation and package smoke tests without API calls. Runs are resumable by default.

## Document-isolated Loop 1

Process or resume one document with bounded parallel model calls:

```bash
PYTHONPATH=agentic-subsurface/src doc-intelligence/.venv/bin/python -m agentic_subsurface.cli loop1 \
  --input playground/bangalore/sample_docs/input/bangalore_aquifier.pdf \
  --output playground/bangalore/agentic_loop1_v2 \
  --objective "Build an exhaustive evidence-grounded Bengaluru aquifer package" \
  --corpus-id bengaluru-subsurface \
  --live --max-cost-usd 15 --max-workers 8
```

`--max-workers` accepts 1–32 and defaults to 8. Text-evidence leaves, visual-classification groups, and deep-visual groups run concurrently within their respective stages. The shared cost ledger atomically reserves the worst-case cost of every in-flight call, preventing concurrent calls from oversubscribing the configured ceiling. Resume loads an existing `bundle.json`, so unchanged inputs are not materialized again.

Step 2 also parallelizes deterministic native units: PDF page ranges, spreadsheet sheets, CSV/TSV row ranges, GeoJSON records, KML placemark ranges, image frames, and text line ranges. Adaptive mode is the default; it derives chunk size and worker count from the discovered unit count, CPU topology, available memory, per-unit memory estimate, and runtime resource pressure. There is no document-size or Bengaluru-specific threshold.

```bash
# Default: adaptive scheduling for a document of any supported size.
... -m agentic_subsurface.cli loop1 ... --start-step 1 --end-step 2

# Reproducible/manual benchmark when needed.
... -m agentic_subsurface.cli loop1 ... --start-step 1 --end-step 2 \
  --materialization-mode manual --materialization-workers 8 \
  --materialization-chunk-size 12 --materialization-backend process
```

Optional `--materialization-memory-limit-mb` caps the scheduler's memory budget. Per-unit results, failures, plan, resource samples, merge report, and timing/byte summary are stored under `stages/materialization/`. Completed units are independently resumable; rerunning one changed or failed document does not affect another document version.

### Stage control and profiling

Loop 1 exposes the same generic stages for every supported adapter:

| Step | Stage | Kind |
|---:|---|---|
| 1 | Identify document and resolve version | Direct |
| 2 | Materialize native content, structures and visuals | Direct |
| 3 | Extract text and structured evidence | LLM |
| 4 | Classify every visual | Multimodal LLM |
| 5 | Extract evidence from meaningful visuals | Multimodal LLM |
| 6 | Consolidate evidence and validate provenance | Direct |
| 7 | Validate exhaustive coverage | Direct |
| 8 | Activate the validated document version | Direct |

Run only steps 1–2:

```bash
... -m agentic_subsurface.cli loop1 ... --start-step 1 --end-step 2
```

Later run only visual classification, reusing the stored bundle and text evidence:

```bash
... -m agentic_subsurface.cli loop1 ... --start-step 4 --end-step 4
```

Prerequisite artifacts must already exist when starting after step 1. Every invocation appends timing, status and output counts to the document version's `stage_telemetry.json`. Intermediate artifacts remain under `stages/`, and partial runs write `partial_status.json`. Stage selection does not change the semantic document version.

Stage 3 uses aggressive long-context extraction by default: approximately 120K source-token batches, a 128K exact request ceiling, and a 128K maximum output allowance. Meta's exact input-token counter preflights each complete request. An oversized or incomplete batch is split token-equally and retried recursively (normally around 64K, then 32K) while completed siblings remain resumable. Changing Stage 3 batching or prompt configuration creates a new evidence version, but an identical source checksum reuses the prior immutable Stage 2 materialization through hardlinks where supported instead of parsing the document again.

The provider is hard-locked to `muse-spark-1.3-contributor`. It loads `MODEL_API_KEY` from the environment, then `.env`, `research-engine-v2/.env`, or `doc-intelligence/.env`, without persisting the secret. Official contributor pricing is encoded in the run ledger: $0.10/M uncached input, $0.002/M cached input, and $0.20/M output. The default hard run ceiling is $19.

See [ARCHITECTURE.md](ARCHITECTURE.md) for contracts and failure behavior. A compact, validated Bengaluru result is under [`examples/bengaluru`](examples/bengaluru); the complete generated artifact tree remains under `playground/bangalore/agentic_live` and is intentionally ignored by Git because it contains 726 MB of source-derived files.

## Checkpointed Loop 2

Loop 2 reads `corpus_manifest.json`, then processes every selected active Loop 1
document independently. Each document gets its own version tree and five
independently resumable stages:

| Step | Stage | Kind |
|---:|---|---|
| 1 | Prepare the document: snapshot, integrity audit, evidence projection and native-asset registry | Direct |
| 2 | Synthesize its UI rendering package | LLM |
| 3 | Generate feature narratives | LLM |
| 4 | Generate its study report | LLM |
| 5 | Validate, consolidate and activate the study | Direct |

Stage 2 is deliberately model-led. It sends all prepared evidence through
generic bounded semantic batches, recursively splits any oversized or
output-exhausted batch, checkpoints successful leaf plans, and reconciles them
hierarchically. The model chooses native-asset reuse, generated features,
profiles, structured resources, narrative/report-only retention, or explicit
unsupported status. Host code then validates provenance and materializes the
plan; it does not substitute fixed document-specific rendering rules.

Stage 2 requires `--live`. Its principal audit artifacts are:

```text
stages/rendering/
├── evidence_units.json
├── batch_manifest.json
├── fragments/leaf/
├── fragments/reconciliation/
├── fragment_manifest.json
├── reconciled_rendering_plan.json
├── coverage_audit.json
└── ui_rendering_package.json
```

Every Loop 1 evidence item must receive exactly one model-authored disposition,
and every Loop 1 spatial feature and vertical interval must be represented or
explicitly marked unsupported. Coordinates are accepted only when they exactly
match a cited Loop 1 object/native source or are explicitly present in cited
evidence. Missing coverage, unknown references and ungrounded geometry fail the
stage instead of being silently dropped.

```bash
# Run the complete Loop 2 pipeline. Output defaults to <input>/loop2.
PYTHONPATH=agentic-subsurface/src doc-intelligence/.venv/bin/python -m agentic_subsurface.cli loop2 \
  --input playground/bangalore/agentic_loop1_v2 \
  --live --max-cost-usd 19

# Process one document by repeating its exact ID from corpus_manifest.json.
... -m agentic_subsurface.cli loop2 ... \
  --document-id 'document:bangalore-aquifier-pdf:06f89fdae7'

# Run deterministic document preparation only.
... -m agentic_subsurface.cli loop2 ... --start-step 1 --end-step 1

# Resume with only the scientific synthesis stage.
... -m agentic_subsurface.cli loop2 ... --start-step 2 --end-step 2
```

Without `--document-id`, all active manifest documents are processed one by one;
their evidence is never combined in Loop 2. Starting after step 1 requires the
earlier checkpoints for that same document study version. Changing that
document's Loop 1 version, semantic configuration, prompts, or Loop 2 code
selects a new study version. Telemetry lives under
`loop2/documents/<document-id>/versions/<study-version>/`. Stage 5 writes one
active pointer per document and refreshes `loop2/study_manifest.json`. A future
Loop 3 will combine those active study packages for city-level navigation and
cross-study analysis.

Every Loop 2 stage emits three complementary audit surfaces:

- `run_events.jsonl` is an append-only, fsynced event stream with stage start,
  completion, failure, duration and error details. Follow it while a stage runs
  with `tail -f <version-root>/run_events.jsonl`.
- `stage_telemetry.json` records every attempt, its output summary, duration,
  per-stage token/cost delta, model-call IDs, request/response paths, and a
  SHA-256/size manifest of every stage artifact.
- `stages/<stage-name>/` contains inspectable intermediate artifacts. Live model
  calls are captured under `loop2/model_io/<call-id>/request.json` and
  `response.json`; the shared cost ledger is `loop2/telemetry/cost_ledger.json`.

The CLI result prints `version_root`, `stage_telemetry`, `run_events`,
`artifacts_root`, `model_io_root`, and `cost_ledger`, so no version-path lookup is
needed after a stage-only invocation. Progress is written to stderr, keeping the
final stdout JSON machine-readable.

Stage 1 writes its separate internal checkpoints under `stages/preparation/`,
including `snapshot.json`, `input_integrity_audit.json`,
`synthesis_projection.json`, `projection_audit.json`, and
`native_asset_registry.json`. It also writes `semantic_transport.json`,
`semantic_handle_map.json`, and `semantic_transport_audit.json`. The transport
stores every evidence item and scientific object once, replaces long canonical
identifiers with reversible handles for model calls, and proves exact round-trip
restoration with hashes before Stage 1 can complete. The canonical projection is
never rewritten, ranked, truncated, or semantically merged. Every scientific
`evidence_ref` is classified as valid, explicitly unresolved, or invalid. Valid
references remain eligible for grounding; `:unresolved:` references are retained
in the immutable snapshot and quarantined as `unresolved_evidence_refs` in the
Stage 1 projection; any other dangling reference fails Stage 1. This prevents unresolved
Loop 1 links from silently supporting UI narratives or report findings.

Every Loop 2 LLM stage uses the same aggressive batching policy as Loop 1: it
targets approximately 128K input tokens (with a 10% soft operating band),
performs an exact provider token count before every request, and recursively
splits only a batch that exceeds that band or returns an incomplete response. Stage 1
orders its lossless compact units by source locator. Stage 2 and Stage 4 consume
that representation with a small, explicitly context-only overlap from the preceding
source region; Stage 3 uses compact handles in bounded target contexts. Local and
reconciliation calls use the same approximately 128K operating band. Independent batches run concurrently up to
`--max-workers`; checkpointed fragments are restored to deterministic order
before reconciliation or assembly. Unsupported model evidence references fail validation
instead of being silently removed. All stages use the configured 128K output
allowance rather than small stage-specific caps. Stages 2–4 also write
`progress.jsonl` and stream batch sizes, completions, adaptive splits,
reconciliation levels and validation milestones to stderr.

Stage 3 is deliberately narrower than Stage 2: it generates narratives only for
individually selectable features whose geometry passed deterministic validation.
Layers, profiles, non-geometric concepts and the study-level summary are not separate
feature-narrative responsibilities. If a document has no geometry-bearing features,
Stage 3 writes a valid empty narrative package and performs no model call; Stage 4
still produces the complete document report.

## Verification

```bash
PYTHONPATH=agentic-subsurface/src doc-intelligence/.venv/bin/python -m pytest agentic-subsurface/tests -q
PYTHONPATH=doc-intelligence/src doc-intelligence/.venv/bin/python -m pytest doc-intelligence/tests -q
PYTHONPATH=research-engine-v2:doc-intelligence/src doc-intelligence/.venv/bin/python -m pytest research-engine-v2/tests -q
```
