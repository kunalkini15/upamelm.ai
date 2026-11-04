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
| `pipeline_dir` | Root consolidation folder (`ingestion/`, `studies/`, `translations/`, `pipeline_summary.json`) |
| `max_docs` | Top-N ranked docs to study (default 5; raise as needed) |
| `doc_ids` | Explicit id override for `max_docs`, in study order |
| `languages` | Translate targets (codes or names, case-insensitive) |
| `study_fanout` | `sequential` (default, safer) or `parallel` |
| `translate_fanout` | `parallel` (default) or `sequential` |

Run it with one workflow invocation whose `scriptPath` is `pipeline-workflow.js`
and `args.request` points at the file below. All fields are also accepted inline
as `args` without a request file.
