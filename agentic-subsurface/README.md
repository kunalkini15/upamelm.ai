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

The provider is hard-locked to `muse-spark-1.3-contributor`. It loads `MODEL_API_KEY` from the environment, then `.env`, `research-engine-v2/.env`, or `doc-intelligence/.env`, without persisting the secret. Official contributor pricing is encoded in the run ledger: $0.10/M uncached input, $0.002/M cached input, and $0.20/M output. The default hard run ceiling is $19.

See [ARCHITECTURE.md](ARCHITECTURE.md) for contracts and failure behavior. A compact, validated Bengaluru result is under [`examples/bengaluru`](examples/bengaluru); the complete generated artifact tree remains under `playground/bangalore/agentic_live` and is intentionally ignored by Git because it contains 726 MB of source-derived files.

## Verification

```bash
PYTHONPATH=agentic-subsurface/src doc-intelligence/.venv/bin/python -m pytest agentic-subsurface/tests -q
PYTHONPATH=doc-intelligence/src doc-intelligence/.venv/bin/python -m pytest doc-intelligence/tests -q
PYTHONPATH=research-engine-v2:doc-intelligence/src doc-intelligence/.venv/bin/python -m pytest research-engine-v2/tests -q
```
