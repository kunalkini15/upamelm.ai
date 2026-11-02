# Subsurface Research Engine

The Research Engine is a domain-independent autonomous Muse harness over `doc-intelligence`. Muse chooses the investigation tools and their order through native Chat Completions function calls. The engine preserves the full assistant/tool-call conversation, returns tool errors for Muse to correct, and stores research memory as versioned workspace artifacts. Document parsing, Atlas navigation, retrieval, extraction, and grounding remain in Document Intelligence.

## Configuration

Real inference is fail-closed to Meta Muse Spark Contributor:

```sh
export MODEL_API_KEY=...
export META_BASE_URL=https://api.meta.ai/v1
export META_MODEL=muse-spark-1.3-contributor
```

Contributor mode may allow submitted content to be used by Meta for model improvement. Only public or approved non-confidential research material should be processed.

## Run

From the repository root, provide any domain and any permitted local documents in a JSON request:

```sh
PYTHONPATH=research-engine:doc-intelligence/src \
  python -m research_engine.cli run \
  --request /path/to/request.json \
  --output /path/to/output
```

Each `run` creates an isolated folder under `OUTPUT/runs/<run-id>/`, with `research_result.json`, `research_report.md`, `evidence_ledger.json`, `research_state.json`, `execution_trace.json`, usage and model request/response captures. `OUTPUT/latest_run.json` points to the latest run. Resume with:

```sh
PYTHONPATH=research-engine:doc-intelligence/src \
  python -m research_engine.cli resume \
  --state /path/to/output/research_state.json
```

Every run also prints progress to the console and writes the same timestamped
events to its run folder's `research_engine.log`. To choose another log path,
pass `--log-file /path/to/run.log` to either `run` or `resume`. Progress logs
include tool decisions, source preparation, extraction boundaries, usage,
durations, errors, and final status. `model_io/` stores exact model prompts and
raw responses for review; those files may contain excerpts from source documents.
Credentials are not written to either log location.

Request-level call, token, output-token, retry, and step ceilings are optional and disabled by default. When a total-token ceiling is supplied, output is capped per call and nested extraction calls are serialized so reported usage can be checked before another starts; provider-side prompt-token accounting can still make one in-flight request exceed the remaining allowance. Usage is recorded; costs are reported as unavailable when the provider does not supply pricing. Large conversations are archived as workspace artifacts and compacted into a Muse memory checkpoint; this does not end the investigation. The harness stops after repeated no-progress turns with a `stalled` status rather than synthesizing a successful finish. Tests use mocked model responses and never call the live API.
