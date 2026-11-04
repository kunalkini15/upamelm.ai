# Adaptive Visualization Agent Workflows (`.agents`)

The `.agents` directory houses the agentic workflow definitions, orchestration scripts, and skill specifications that drive autonomous development, verification, and refinement of the Subsurface scientific visualization interface.

---

## 🏛 Architecture & Philosophy

The Subsurface adaptive visualization architecture separates code synthesis from visual critique using a dual-role pattern:

1. **Contributor / Author (`Spark`)**: Researches technical specifications, edits source code, runs build and typecheck commands, executes automated unit and browser tests, and repairs issues.
2. **Reviewer / Art Director (`Wonder`)**: Performs bounded, read-only reviews of compact artifacts, architectural directions, rendered screenshot evidence, and design system adherence. Wonder never edits source code directly.

Workflows operate with strict invocation budgets (`MAX_WONDER_CALLS`) and graceful fallback strategies, ensuring unattended CI/CD automation can complete deterministically even if review services experience degraded availability.

---

## 📁 Directory Structure

```
.agents/
├── skills/
│   └── adaptive-visualization/
│       └── SKILL.md                 # Agent skill instructions and invariant guardrails
└── workflows/
    ├── adaptive-ui-bootstrap.js     # Bootstraps the baseline adaptive UI application
    ├── adaptive-ui-experience-foundation.js # Establishes design language and showcase scenes
    ├── adaptive-ui-evolve.js        # Integrates new scientific study packages and requirements
    ├── adaptive-ui-refine.js        # Fine-grained visual refinement with pixel-level critique
    └── adaptive-ui-guardian.js      # Continuous health monitor for build, browser, and registry
```

---

## 🔄 Workflow Catalog

### 1. `adaptive-ui-bootstrap.js`
- **Purpose**: Creates the neutral baseline visualization foundation for a UI module (e.g., `muse-ui`).
- **Arguments**:
  - `module_dir` *(optional, string)*: Target directory (default: `"muse-ui"`).
  - `run_id` *(optional, string)*: Verification run identifier.
- **Protocol**:
  1. Inspects baseline requirements and capability schemas.
  2. Synthesizes application shell, map viewer, 3D viewport, and capability negotiation engine.
  3. Executes Vitest test suites and Playwright headless browser checks.
  4. Conducts an architectural review and final validation check.

### 2. `adaptive-ui-experience-foundation.js`
- **Purpose**: Establishes reusable design tokens, typography, visual hierarchy, spatial interaction models, and deterministic showcase scenarios.
- **Arguments**:
  - `module_dir` *(optional, string)*: Target directory (default: `"muse-ui"`).
  - `run_id` *(optional, string)*: Identifier for the verification run.
- **Protocol**:
  1. Synthesizes design tokens and channel bindings (`src/design/`).
  2. Generates visual showcase packages.
  3. Captures standardized screenshots (`1280x720`) across key views (landing, 2D map, 3D subsurface, narrative dossier).
  4. Conducts design direction and visual acceptance audits.

### 3. `adaptive-ui-evolve.js`
- **Purpose**: Evolves the visualization engine to support new scientific datasets, domain packages, or user capability requests.
- **Arguments**:
  - `module_dir` *(required, string)*: Target directory.
  - `trigger_type` *(required, "requirement" | "package")*: What triggered the evolution.
  - `trigger_path` *(required, string)*: Path to the requirement markdown or study package JSON.
  - `run_id` *(optional, string)*: Run identifier.
- **Protocol**:
  1. Compares incoming package capabilities against the live `capability-registry.json`.
  2. Identifies required visual representations (e.g., boreholes, lithological layers, hydraulic head contours).
  3. Implements or adapts renderers while preserving honest fallback states.
  4. Runs browser verification and captures screenshot evidence before promoting registry updates.

### 4. `adaptive-ui-refine.js`
- **Purpose**: Targeted visual, accessibility, and interaction refinement against specific design criteria.
- **Arguments**:
  - `module_dir` *(optional, string)*: Target directory.
  - `requirement_path` *(required, string)*: Path to requirement specification.
  - `run_id` *(optional, string)*: Run identifier.
- **Protocol**:
  1. Iteratively repairs visual contrast, spatial alignment, camera controls, or narrative readability.
  2. Submits screenshots to visual critique.
  3. Ensures no regressions to baseline test suites or capability contracts.

### 5. `adaptive-ui-guardian.js`
- **Purpose**: Automated regression sentinel that can run on schedules or CI hooks.
- **Arguments**:
  - `module_dir` *(required, string)*: Target directory.
  - `allow_fix` *(optional, boolean)*: Whether Spark is allowed to apply automatic repairs.
- **Protocol**:
  1. Validates schema integrity of capability and package registries.
  2. Runs unit and integration tests.
  3. Launches headless browser to verify canvas hydration and console cleanliness.
  4. Logs health status and incident deduplication into `verification/guardian-incidents.json`.

---

## 🛠 Running Agent Workflows

Workflows are standard JavaScript modules exporting an asynchronous `workflow(host)` function. They are executed by the Muse workflow runner or Antigravity runtime:

```bash
# Example: Running the guardian regression check
node -e '
  import("./.agents/workflows/adaptive-ui-guardian.js")
    .then(m => m.default({
      args: { module_dir: "muse-ui", allow_fix: false },
      log: console.log,
      exec: (cmd, opts) => import("child_process").then(cp => cp.execSync(cmd, { stdio: "inherit", ...opts }))
    }));
'
```

---

## 📐 Invariants & Guardrails

All workflows must abide by the rules codified in `skills/adaptive-visualization/SKILL.md`:
- **Evidence-First**: Never fabricate scientific findings or extrapolate geometries without explicit confidence classifications.
- **Honest Fallbacks**: When a dataset lacks 3D geometries or coordinates, the UI must display clear, explanatory fallback messaging rather than failing or showing empty canvases.
- **Zero Port Collisions**: Development servers must probe ports dynamically in range `5200-5210` and guarantee process cleanup upon completion.
- **Evidence Preservation**: Visual changes must capture timestamped screenshots retained in the run's `verification/` folder.
