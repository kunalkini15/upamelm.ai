# UI Verification Contracts

## Input contract

Required workflow arguments:

- `pipeline_dir`: promoted city directory containing `studies/` and the pipeline
  summary. Its parent is mounted as the backend runs root.
- `output_dir`: workflow-owned directory for evidence and reports.

Optional arguments:

- `ui_dir`, default `ui`
- `browser_workers`, integer bounded to 1–4
- `workhorse_model`, runtime model identifier
- `reviewer_model`, runtime model identifier
- `backend_report`, prior backend-validation JSON for cross-checking

## Safety boundary

The validator may write only beneath `output_dir`. Docker build caches and
anonymous container filesystems are disposable execution infrastructure. UI,
backend, promoted runs, translations, and assets are read-only inputs.

## Required coverage

- UI unit tests, TypeScript compilation, and production build
- Backend readiness and bootstrap contract
- Every discovered city, study, and language combination
- Semantic URL persistence and browser reload
- Study and language switching
- Active-view preservation during language switching
- Map rendering and feature interaction when spatial evidence exists
- 3D entry, stable canvas, and exit when 3D evidence exists
- Report analysis, charts, structured resources, and source downloads when present
- Loading, malformed, unavailable-selection, and backend-offline states
- Console errors, page errors, failed first-party requests, overflow, and clipping
- Desktop viewport at 1280x720; compact viewport when layout behavior is material
- Container and process cleanup

## Finding shape

```json
{
  "id": "UI-001",
  "severity": "error",
  "category": "view_state_failure",
  "city": "bengaluru",
  "study": "SRC-LR-01",
  "language": "kn",
  "view": "analysis",
  "expected": "Analysis remains active after language switching",
  "actual": "3D Profiles became active",
  "evidence": ["screenshots/UI-001.png", "browser-console.log:42"],
  "likely_owner": "ui",
  "recommended_action": "Preserve active view across package replacement."
}
```

Allowed categories: `build_failure`, `unit_test_failure`, `backend_unavailable`,
`bootstrap_contract_failure`, `catalog_mismatch`, `package_ingestion_failure`,
`translation_failure`, `asset_failure`, `navigation_failure`,
`view_state_failure`, `map_failure`, `three_d_failure`, `analysis_failure`,
`chart_failure`, `resource_failure`, `download_failure`, `console_error`,
`accessibility_failure`, `responsive_failure`, `visual_failure`,
`performance_warning`, `environment_failure`.

Allowed owners: `ui`, `backend`, `promotion`, `document-processing`,
`translation`, `environment`, `unknown`.

