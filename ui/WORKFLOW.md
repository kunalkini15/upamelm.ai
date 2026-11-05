# UI Verification Workflow

`ui-workflow.js` is an independently invokable Muse workflow that validates the
real UI and backend against a promoted pipeline bundle. It does not modify the
application or generated studies.

## Responsibilities

1. Inventory the orchestrator handoff and promoted city bundle.
2. Run UI unit tests, type checking, and the production build.
3. Start the backend and UI through the Docker validation composition.
4. Run Playwright across every discovered city, study, and language.
5. Exercise Map, 3D, Analysis, charts, resources, downloads, and switching only
   where the selected package advertises those capabilities.
6. Inspect representative screenshots, console output, and failed requests.
7. Classify findings and write JSON and Markdown reports under `output_dir`.
8. Ask the flagship model for one read-only review only when findings exist.
9. Always stop containers and confirm cleanup.

## Invocation

```text
Use a workflow. Run ui/ui-workflow.js with pipeline_dir=runs/bengaluru and output_dir=ui/runs/bengaluru-validation-20261105.
```

Arguments:

```json
{
  "pipeline_dir": "runs/bengaluru",
  "output_dir": "ui/runs/bengaluru-validation",
  "ui_dir": "ui",
  "browser_workers": 2,
  "workhorse_model": "muse-spark-1.3-contributor",
  "reviewer_model": "muse-wonder-1.0"
}
```

Model identifiers are overridable so the global invoker can route MuleSpark 1.3
and Muse 1 using the exact identifiers exposed by its runtime.

## Outputs

```text
<output_dir>/raw_results.json
<output_dir>/playwright-results.json
<output_dir>/browser-console.log
<output_dir>/screenshots/
<output_dir>/ui_validation.json
<output_dir>/ui_validation.md
<output_dir>/review.md              # only when findings trigger review
```

`complete` means the audit and cleanup completed with no material findings.
`complete_with_findings` means the audit completed and returned defects for the
invoker. `partial` means the validation procedure itself could not finish.

