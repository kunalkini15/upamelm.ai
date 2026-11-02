# Research Engine

`research-engine-v2` is the repository's single research-engine implementation. It accepts a
request and source documents, uses Document Intelligence to build/load a
Document Atlas, lets Meta Muse Spark Contributor create a selective
investigation plan, extracts that plan as one bounded objective-wide evidence bundle,
and synthesizes the evidence in a separate stage.

The top-level `ResearchWorkflow` controls stage sequencing. The current
workflow registers planning, extraction, and synthesis stages. The planner owns
document understanding and page selection; the extractor owns bounded Document
Intelligence extraction and evidence artifacts; the synthesizer owns findings
and reporting.

The older `research-engine` package and the stray top-level `research_engine_v2`
package have been retired. Import `research_engine_v2` from this directory or use
the `research-engine-v2` command installed by this package.

To execute an existing completed planning run:

```bash
PYTHONPATH=research-engine-v2:doc-intelligence/src \
python -m research_engine_v2.cli extract --run path/to/output/planner
```

Planner artifacts are stored under `output/planner`, evidence artifacts under
`output/extractor`, and the final report under `output/synthesizer`.

Each new `plan`, `extract`, or `run` invocation replaces the corresponding
stage directory. Resume the current extraction with:

```bash
PYTHONPATH=research-engine-v2:doc-intelligence/src \
python -m research_engine_v2.cli resume \
  --run path/to/output/planner \
  --stage extractor
```

To synthesize a completed evidence run independently:

```bash
PYTHONPATH=research-engine-v2:doc-intelligence/src \
python -m research_engine_v2.cli synthesize --run path/to/output/planner
```

To run all three stages in one new workspace:

```bash
PYTHONPATH=research-engine-v2:doc-intelligence/src \
python -m research_engine_v2.cli run \
  --request path/to/request.json \
  --output path/to/output
```

## Run

From the repository root, with `doc-intelligence/src` available on
`PYTHONPATH`:

```bash
PYTHONPATH=research-engine-v2:doc-intelligence/src \
python -m research_engine_v2.cli plan \
  --request path/to/request.json \
  --output path/to/output
```

The run writes a versioned artifact tree containing the Atlas, planning state,
plan revisions, raw streamed Muse calls, nested Document Intelligence calls,
complete extraction artifacts, the evidence manifest, synthesis output, usage,
cost telemetry, event logs, and the final planning package.

## Working memory

Complete model responses and tool results remain in `model_io/`, `tool_io/`,
and `replay.json` for audit and recovery. They are not replayed into every
planning request. Each Muse turn receives a compact working state and can use
`search_planning_memory` followed by `read_tool_observation` to retrieve an
earlier full tool result when needed. This keeps context growth bounded without
discarding research history or limiting the investigation scope.
