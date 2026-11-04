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
