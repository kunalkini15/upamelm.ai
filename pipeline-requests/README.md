# Pipeline requests

One file per end-to-end run. The root [pipeline-workflow.js](../pipeline-workflow.js)
reads the request, freezes it as `<pipeline_dir>/pipeline_request.json`, then runs
ingestion → top-N study fan-out → per-study translation, promoting key files into
`<pipeline_dir>/` between stages.

| Field | Meaning |
|---|---|
| `ingest_request` | City request file for `muse-source-ingestion` |
| `ingest_run` | Ingestion run output dir |
| `studies_dir` | Parent dir; one `<doc-id>/` study run per selected doc |
| `translate_dir` | Parent dir; one `<doc-id>/` translate run per completed study |
| `pipeline_dir` | Root consolidation folder. Each `studies/<doc-id>/` is UI-ready with source-language files plus all `study_package_<lang>.json`, `narrative_package_<lang>.json`, and `report_<lang>.json` variants. `translations/<doc-id>/` mirrors translated artifacts and keeps translation verification metadata. |
| `dry_run` | Reuse compatible completed stage runs while still exercising selection, concurrency, and promotion (default `false`) |
| `max_docs` | Top-N ranked docs to study (default 5; raise as needed) |
| `doc_ids` | Explicit id override for `max_docs`, in study order |
| `languages` | Translate targets (codes or names, case-insensitive) |
| `study_fanout` | `parallel` (default) or `sequential` (forces concurrency 1) |
| `translate_fanout` | `parallel` (default) or `sequential` (forces concurrency 1) |
| `study_concurrency` | Maximum document-processing runs at once (default 3) |
| `translate_concurrency` | Maximum translation runs at once (default 3) |

Build the import-free Muse runtime first with
`node scripts/build-pipeline-workflow-runtime.mjs`. Run one workflow invocation
whose `scriptPath` is `pipeline-workflow.runtime.js`
and `args.request` points at the file below. All fields are also accepted inline
as `args` without a request file.

For an end-to-end reuse validation, set `dry_run: true` and use a fresh
`pipeline_dir`. Each stage first checks its configured exact run directory and
returns the latest compatible completed response without modifying it. Matching
uses the frozen request or source identity/checksum and, for translation, the
normalized language set. Ranking, top-N selection, bounded fan-out, failure
isolation, and promotion into `pipeline_dir` still run normally. A partial,
stale, mismatched, or incomplete cached run is never reused.

Live runs are write-once. Before ingestion, the orchestrator requires
`ingest_run`, `studies_dir`, and `translate_dir` to be absent, all configured
roots to be distinct, and `pipeline_dir` to contain only the frozen
`pipeline_request.json`. After promotion it audits the actual city bundle:
counts and IDs must match completed child workflows, every requested language
must have study/narrative/report packages, every referenced asset must resolve
inside the promoted study, and UI packages must not reference child-run
directories. Any failed gate returns `partial`; do not resume or relaunch until
the reported destination or artifact defect is understood.

## Run live with console logs

From the repository root:

```bash
scripts/run-pipeline-live.sh pipeline-requests/<city>.json
```

The same command also resumes a failed ingestion when the city pipeline folder
contains both `pipeline_request.json` and a valid partial `failure_report.json`
with `safe_retry_point: "ingestion"`, the ingestion checkpoint exists, and no
study or translation destination exists. The launcher passes `resume:true` and
the workflow validates the frozen request and artifacts before continuing.

If a stopped run created only `<pipeline_dir>/pipeline_request.json`, the
launcher treats it as a planner checkpoint and resumes automatically. To
discard and regenerate that checkpoint, pass `--force`:

```bash
scripts/run-pipeline-live.sh --force pipeline-requests/<city>.json
```

`--force` is deliberately limited: it removes only a pipeline directory whose
sole entry is `pipeline_request.json`. It never overwrites ingestion, study,
translation, or promoted city outputs; use fresh run paths for those cases.

The runner validates that every configured destination is absent, rebuilds and
syntax-checks the import-free runtime, runs the orchestrator tests, and invokes
Muse exactly once. It then monitors the same background workflow without
calling or resuming Muse. Console progress includes newly created artifacts and
30-second heartbeats until `bundle_verification.json` is written. Raw launcher
JSONL, console progress, the frozen request, and the exported Muse session are
saved under `pipeline-logs/<city>-<UTC timestamp>/` (gitignored).

The command exits `0` only when the final bundle audit has `valid: true`; `2`
means an invalid completed bundle, and `3` means the monitor timed out without
relaunching the workflow. Override the six-hour monitor ceiling only when
needed, for example:

```bash
PIPELINE_MONITOR_TIMEOUT_MINUTES=480 scripts/run-pipeline-live.sh pipeline-requests/<city>.json
```
