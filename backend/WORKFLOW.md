# Backend Verification Workflow

`backend-workflow.js` is an independently invokable Muse workflow that verifies
the backend against a promoted pipeline bundle. It does not depend on or modify
the global pipeline orchestrator.

## Responsibilities

1. Inventory promoted cities, studies, translations, and assets.
2. Compile/import the backend and generate OpenAPI.
3. Run pytest with bounded `pytest-xdist` workers.
4. Start Uvicorn on an ephemeral loopback port.
5. Probe the full city × study × language matrix and package file references.
6. Test errors, CORS, concurrency, cache refresh, and path security.
7. Always stop the validation server.
8. Write evidence plus JSON and Markdown under `output_dir`.
9. Ask Wonder for one read-only review only when findings exist.

The workflow never repairs code or edits promoted content. A future caller owns
copying returned reports into a root run directory.

## Invocation

Invoke it through Muse using the same prompt form as the ingestion, study, and
translation workflows:

```text
Use a workflow. Run backend/backend-workflow.js with pipeline_dir=runs/bengaluru and output_dir=backend/runs/bengaluru-validation-20261105.
```

Optional concurrency overrides can be appended:

```text
Use a workflow. Run backend/backend-workflow.js with pipeline_dir=runs/bengaluru and output_dir=backend/runs/bengaluru-validation-20261105 and test_workers=4 and probe_concurrency=8.
```

This maps to the following workflow arguments:

```json
{
  "pipeline_dir": "runs/bengaluru",
  "output_dir": "backend/runs/bengaluru-validation",
  "backend_dir": "backend",
  "test_workers": 4,
  "probe_concurrency": 8
}
```

`pipeline_dir` and `output_dir` are required. Worker counts are bounded.

## Outputs

```text
<output_dir>/raw_results.json
<output_dir>/server.log
<output_dir>/backend_validation.json
<output_dir>/backend_validation.md
<output_dir>/wonder_review.md        # only when findings trigger review
```

`complete` means the audit and cleanup completed. A finished audit with real
failures returns `complete_with_findings`; `partial` means the audit itself did
not finish. Clean validation uses one Spark call and no Wonder call.
