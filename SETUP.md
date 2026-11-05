# Upamelm.ai — Comprehensive Setup & Execution Guide

This guide provides complete, step-by-step instructions to set up, run, test, and understand the entire platform.

You can run the **complete integrated application stack** (API + Frontend) in 3 minutes, run the **end-to-end pipeline orchestrator** (`pipeline-workflow.js`), or run **each module independently** (Ingestion, Document Processing, Translation, Backend API, and Frontend Viewers).

---

## 🏛 System Architecture & Component Ports

```
┌────────────────────────────────────────────────────────────────────────┐
│                        ORCHESTRATION LAYER                             │
│       pipeline-workflow.js  (Top-level deterministic pipeline)         │
└───────┬────────────────────────┬───────────────────────┬───────────────┘
        ▼                        ▼                       ▼
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│ muse-source-     │    │ muse-document-   │    │ muse-translate   │
│ ingestion        │───►│ processing       │───►│ (Multilingual)   │
│ (City Discovery) │    │ (Grounding & V2) │    │ (KN, HI, etc.)   │
└──────────────────┘    └──────────────────┘    └────────┬─────────┘
                                                         │
                                    Promoted into runs/  │
                                                         ▼
┌────────────────────────────────────────────────────────────────────────┐
│                           BACKEND & SERVING                            │
│  runs/                   Directory of promoted city & study packages   │
│  backend          FastAPI service  ──► http://localhost:8010    │
└────────────────────────────────────────┬───────────────────────────────┘
                                         │  /api proxy
                                         ▼
┌────────────────────────────────────────────────────────────────────────┐
│                          PRESENTATION LAYER                            │
│  ui                   Upamelm.ai Explorer ──► http://localhost:5175 │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 📋 System Prerequisites

Ensure the following tools are installed on your machine:

1. **Node.js**: `≥ 22.22.2` (check: `node -v`). This satisfies the committed UI lockfiles and current Vite toolchain.
2. **npm**: `≥ 10.0.0` (check: `npm -v`)
3. **Python**: `≥ 3.10` (check: `python3 --version`)
4. **Browser**: Modern web browser with WebGL2 support (Chrome, Edge, Firefox, or Safari).
5. **AI Workflow Runtime (Optional)**: Meta Muse Agent Runtime is required only if you are executing live LLM-driven research and extraction workflows. All test suites, mock workflows, backend APIs, and frontends run completely offline without model credentials!

---

## 🚀 3-Minute Quickstart (Run Full Application Today)

Experience the complete live exploration platform immediately using the pre-promoted Bengaluru hydrogeological dataset:

### Step 1: Start the Backend API Service

From the repository root:

```bash
./backend/run.sh
```

- Automatically sets up a Python virtual environment (`.venv`) and installs FastAPI and Uvicorn.
- The API will listen at **`http://localhost:8010`**.
- Verify health: `curl http://localhost:8010/api/v1/health`
- Interactive API Docs: `http://localhost:8010/docs`

### Step 2: Start the Frontend Explorer (`ui`)

Open a new terminal window in the repository root:

```bash
cd ui
npm ci
npm run dev
```

- Starts the Vite development server at **`http://localhost:5175`**.
- Vite automatically proxies `/api/*` requests to `http://localhost:8010` (the backend API).

### Step 3: Explore in Browser

Open **`http://localhost:5175`** in your browser:
- **Toggle Viewports**: Use the bottom HUD to switch between **2D Map**, **3D Subsurface**, and **Split View**.
- **Switch Studies**: Use the top header dropdown to switch between studies (e.g. *Bengaluru Groundwater Outlook 2025* and *BMRCL Phase 3 EIA*).
- **Multilingual Support**: Switch between **English**, **Kannada (ಕನ್ನಡ)**, and **Hindi (हिन्दी)** dynamically.
- **Inspect Grounded Evidence**: Click any borehole, well, or transit corridor to inspect depth logs, stratigraphic layers, and page-level source citations.

---

## 🔄 Running the End-to-End Pipeline (`pipeline-workflow.js`)

The top-level `pipeline-workflow.js` orchestrates the complete journey from city discovery to translated, UI-ready study packages:

### Workflow Lifecycle
1. **Plan**: Freezes request configuration and establishes directories.
2. **Ingest**: Runs `muse-source-ingestion` to search and validate city sources.
3. **Promote Ingestion**: Ranks sources and copies top-N documents into `runs/<city>/ingestion/`.
4. **Study Fan-Out**: Runs `muse-document-processing` in parallel across selected documents.
5. **Promote Studies**: Compiles study packages into `runs/<city>/studies/<doc-id>/`.
6. **Translate Fan-Out**: Runs `muse-translate` in parallel across requested languages.
7. **Promote Translations**: Generates multilingual packages (`study_package_<lang>.json`) and finalizes `pipeline_summary.json` and `city.json`.

### Pipeline Configuration (`pipeline-requests/<city>.json`)
Example request:
```json
{
  "ingest_request": "muse-source-ingestion/requests/bengaluru.json",
  "ingest_run": "muse-source-ingestion/runs/bengaluru-pipeline-v1",
  "studies_dir": "muse-document-processing/runs/bengaluru-pipeline-v1",
  "translate_dir": "muse-translate/runs/bengaluru-pipeline-v1",
  "pipeline_dir": "runs/bengaluru",
  "dry_run": false,
  "max_docs": 5,
  "languages": ["Kannada", "Hindi"],
  "study_fanout": "parallel",
  "translate_fanout": "parallel",
  "study_concurrency": 3,
  "translate_concurrency": 3
}
```

### Running Pipeline Checks & Building Runtime
```bash
# 1. Build the standalone bundle for the Muse runtime
node scripts/build-pipeline-workflow-runtime.mjs

# 2. Run the pipeline test suite (validates orchestration, fan-out, and failure isolation)
node tests/pipeline-workflow.test.js
```

### Executing Live in Meta Muse
In an interactive Muse session or via `muse exec`:
```text
Use a workflow with the saved script pipeline-workflow.runtime.js with request="pipeline-requests/bengaluru.json".
```

---

## 🧩 Running Individual Modules Independently

Every module is completely decoupled with its own independent runner, contracts, and test fixtures:

---

### Module 1: Source Ingestion (`muse-source-ingestion/`)

Automates municipal-scale source discovery from government portals (CGWB, NAQUIM, state water boards).

- **Execution**:
  ```text
  Use a workflow. Run muse-source-ingestion/ingest-workflow.js with request="muse-source-ingestion/requests/bengaluru.json" and output_dir="muse-source-ingestion/runs/my-city-run".
  ```
- **Inputs**: `requests/<city>.json` (city aliases, bounding coordinates, evidence priorities).
- **Outputs**:
  - `manifest.json`: Checksummed (SHA-256) list of acquired and validated files.
  - `inventory.json`: Provenance records of reused local files.
  - `lanes/`: Parallel search traces, candidate scores, and downloaded PDFs.
- **Run Unit Tests**:
  ```bash
  node muse-source-ingestion/tests/ingest-workflow.test.js
  ```

---

### Module 2: Document Processing (`muse-document-processing/`)

Extracts scientific measurements, lithological depths, borehole tables, and water quality assays from raw technical PDFs.

- **Execution**:
  ```text
  Run a subsurface study on playground/bangalore_aquifier.pdf with output_dir="muse-document-processing/runs/my-study-run".
  ```
- **Inputs**: Any single technical document (PDF, CSV, spreadsheet, image).
- **Outputs**:
  - `study_package.json`: Canonical `document-study.v2` JSON package.
  - `rendering_package.json`: 3D coordinates, depth intervals, and geological horizons.
  - `evidence_inventory.json`: Page- and cell-level source grounding references.
  - `report.json`: Executive synthesis and risk analysis for lay readers.
- **Run Unit Tests**:
  ```bash
  node muse-document-processing/tests/study-workflow.test.js
  ```

---

### Module 3: Multilingual Translation (`muse-translate/`)

Produces culturally accurate, plain-language translations of study packages while preserving every identifier, coordinate, and citation reference.

- **Execution**:
  ```text
  Use a workflow. Run muse-translate/translate-workflow.js with input="muse-document-processing/runs/my-study-run" and output_dir="muse-translate/runs/my-study-run" and languages=["Kannada", "Hindi"].
  ```
- **Outputs**:
  - `study_package_kn.json`, `study_package_hi.json`: Full localized packages.
  - `narrative_package_<lang>.json`: Localized narrative cards.
  - `report_<lang>.json`: Localized executive summaries.
- **Run Unit Tests**:
  ```bash
  node muse-translate/tests/translate-workflow.test.js
  ```

---

### Module 4: Backend (`backend/`)

Lightweight FastAPI service that indexes and serves promoted packages directly from `runs/`.

- **Start Server**:
  ```bash
  ./backend/run.sh
  ```
- **Environment Variables**:
  - `BACKEND_PORT`: Port number (default: `8010`).
  - `SUBSURFACE_CORS_ORIGINS`: Comma-separated allowed origins (defaults to localhost and 127.0.0.1 on UI port `5175`). The normal `ui` development path uses Vite's same-origin `/api` proxy, so it does not require CORS. Set this variable when calling the API directly from a different browser origin.
  - `SUBSURFACE_RUNS_ROOT`: Promoted run directory (default: `../runs`, resolved from `backend/`).
  - `SUBSURFACE_DEFAULT_CITY`: Default bootstrap city (default: `bengaluru`).
  - `SUBSURFACE_DEFAULT_LANGUAGE`: Default package language (default: `en`).
- **Endpoints**:
  - `GET /api/v1/health`: Service health check.
  - `GET /api/v1/bootstrap`: Returns active city, available studies, languages, and study package.
  - `GET /api/v1/cities`: Discovered cities with geographic centroids.
  - `GET /api/v1/cities/{city_id}/studies`: List of studies for a city.
  - `GET /api/v1/cities/{city_id}/studies/{study_id}?language=kn`: Localized study package.
  - `GET /api/v1/cities/{city_id}/studies/{study_id}/files/{asset_path}`: Serves figures and PDFs.
- **Run Tests**:
  ```bash
  cd backend
  python3 -m venv .venv
  .venv/bin/python -m pip install -e '.[test]'
  .venv/bin/python -m pytest
  ```

---

### Module 5: Upamelm.ai Explorer UI (`ui/`)

Next-generation React 19 + MapLibre GL + React Three Fiber exploration web app.

- **Start Development Server**:
  ```bash
  cd ui
  npm ci
  npm run dev
  ```
- **Direct Study Deep-Links**:
  - Load specific city/study via API:
    `http://localhost:5175/?city=bengaluru&study=SRC-LR-01&language=kn`
  - Load static offline package:
    `http://localhost:5175/?package=/studies/bmrcl-phase3-eia-2025/study_package.json`
- **Verify & Build**:
  ```bash
  cd ui
  npm run verify    # Executes Vitest tests + production build (tsc && vite build)
  npm run preview   # Serves the production build locally
  ```

---

## 🧪 Comprehensive Verification Matrix

Execute this suite to confirm the integrity of the entire repository:

| Target Component | Command | Expected Outcome |
|---|---|---|
| **Pipeline Orchestrator** | `node tests/pipeline-workflow.test.js` | 6 tests passed |
| **Source Ingestion** | `node muse-source-ingestion/tests/ingest-workflow.test.js` | 4 tests passed |
| **Document Processing** | `node muse-document-processing/tests/study-workflow.test.js` | 10 tests passed |
| **Translation Engine** | `node muse-translate/tests/translate-workflow.test.js` | 7 tests passed |
| **Backend** | `cd backend && .venv/bin/python -m pytest` | 7 tests passed |
| **UI Frontend** | `cd ui && npm run verify` | 19 tests passed + clean build |

---

## 🔧 Troubleshooting & FAQs

### Q: Port 8010 or 5175 is already in use
- **For API**: Set a custom port: `BACKEND_PORT=8020 ./backend/run.sh`.
- **For UI**: Port 5175 is strict, so Vite exits if it is occupied. Free that port or explicitly choose another one, for example: `npm run dev -- --port 5176`. Open the exact port you selected.

### Q: Map tiles appear blank
- Map tiles stream over standard HTTPS from CartoCDN / OpenFreeMap. If working behind a corporate firewall or offline, vector basemap fallbacks remain active, and mock geometries render on the neutral coordinate grid.

### Q: pytest is missing or API tests cannot import a dependency
- Install the API test extras inside its virtual environment, then invoke pytest through that interpreter:
  ```bash
  cd backend
  python3 -m venv .venv
  .venv/bin/python -m pip install -e '.[test]'
  .venv/bin/python -m pytest
  ```
