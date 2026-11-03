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

## Verification

```bash
PYTHONPATH=agentic-subsurface/src doc-intelligence/.venv/bin/python -m pytest agentic-subsurface/tests -q
PYTHONPATH=doc-intelligence/src doc-intelligence/.venv/bin/python -m pytest doc-intelligence/tests -q
PYTHONPATH=research-engine-v2:doc-intelligence/src doc-intelligence/.venv/bin/python -m pytest research-engine-v2/tests -q
```
