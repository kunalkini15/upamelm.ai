# Adaptive Scientific Visualization

This module is built and evolved by Muse Code. It turns document-study packages
into clear interactive spatial and three-dimensional experiences without
hard-coding a particular document, city, or scientific domain.

The application source is intentionally absent until the bootstrap workflow is
run. The committed operating scaffold makes that build reproducible and keeps
later evolution traceable.

## Entry points

- **Bootstrap:** build the neutral global-map application foundation from
  scratch; it takes no study package and leaves the package registry empty.
- **Evolve:** implement a requirement or adapt to a new study package.
- **Guardian:** build, test, and visually inspect every registered fixture.

Muse discovers the saved workflows under `../.agents/workflows/`. Start Muse in
the repository root, trust the workspace, and ask it to run the relevant saved
workflow with the paths required by that workflow.

Examples:

```text
Use a workflow with the saved script
.agents/workflows/adaptive-ui-bootstrap.js.
```

```text
Run the saved adaptive-ui-evolve workflow with module_dir muse-ui,
trigger_type requirement, and trigger_path muse-ui/requests/<request>.md.
```

```text
Run the saved adaptive-ui-evolve workflow with module_dir muse-ui,
trigger_type package, and trigger_path <path-to-study_package.json>.
```

```text
Run the saved adaptive-ui-guardian workflow with module_dir muse-ui.
```

All saved workflows accept either a structured argument object or Muse's
JSON-encoded `host.args` string and normalize it strictly, matching the proven
`muse-source-ingestion/ingest-workflow.js` invocation pattern.

For a short-lived daily demonstration inside an active Muse session:

```text
/loop every day at 9am, run the saved adaptive-ui-guardian workflow with
module_dir muse-ui and allow_fix false; report only meaningful failures or changes
```

For automation that must run while the interactive session is closed, schedule
an equivalent `muse exec` prompt through the host system or CI.

## Durable state

- `capability-registry.json`: reusable visual capabilities the application has.
- `package-registry.json`: regression fixtures that must continue to work.
- `requests/`: human-authored product and visualization requirements.
- `invocations/`: machine-readable inputs from upstream workflows.
- `fixtures/`: stable package fixtures or references to them.
- `verification/`: run reports and screenshots produced by Muse.
- `verification/guardian-incidents.json`: consecutive-failure counters that
  deduplicate the guardian's Wonder incident review across scheduled runs. The
  review is marked used before invocation to prevent duplicate spend after a
  crash; a failed Wonder call remains consumed for that incident and the run
  continues with an explicit Spark-only limitation.

See [WORKFLOW.md](WORKFLOW.md) for the shared operating contract and
[AGENTS.md](AGENTS.md) for permanent architectural rules. Registry field
conventions are documented in [REGISTRIES.md](REGISTRIES.md). The mandatory,
reproducible application foundation is defined in [BASELINE.md](BASELINE.md).

## Run locally (bootstrap-default)

Requirements: Node line `22` (see [.nvmrc](.nvmrc); satisfies
`^20.19.0 || >=22.12.0`), npm. Pinned stack: Vite `7.3.7`, Vitest `5.1.0`,
Playwright `1.64.1`, MapLibre GL JS `5.24.0`, Three.js `0.170.0`, Proj4js `2.22.0` — exact versions in
[package-lock.json](package-lock.json). No global installs, tokens, or CDN
application libraries.

```bash
npm ci
npm run dev      # serves on http://127.0.0.1:5200 (first free port in 5200-5210)
npm run build
npm run test
npm run test:browser
npm run verify   # build + unit + browser
```

Vite `7.3.7` requires Node `^20.19.0 || >=22.12.0`; this run used Node
`v22.22.3`. The default basemap style is the token-free OpenFreeMap
`liberty` style; override with `VITE_MAP_STYLE_URL`.
