# Subsurface UI V2 — Adaptive Scientific Evidence Explorer

Subsurface UI V2 is the next-generation interactive exploration interface for geological, hydrogeological, and environmental research. It renders multi-source scientific study packages produced by the automated ingestion and document-processing pipeline, enabling intuitive visualization across 2D geographic maps, 3D subsurface spatial scenes, and synthesized executive dossiers.

---

## 🌟 Key Capabilities

- **Seamless Dual-Engine Exploration**:
  - **2D Geospatial Map**: MapLibre GL integration supporting vector and raster overlays, lithological contours, boreholes, water-level observation points, and transit corridors.
  - **3D Subsurface Explorer**: React Three Fiber (`@react-three/fiber` & `@react-three/drei`) spatial environment rendering 3D stratigraphic layers, vertical borehole logs, aquifer profiles, and depth-registered observation cones.
- **Capability-Negotiated Rendering**:
  - Dynamically evaluates package evidence (geometries, vertical profiles, time series, raster overlays, narrative reports).
  - Adapts layout automatically into `map-first`, `vertical-first`, `corridor-first`, `figure-first`, `dashboard-first`, or `report-first` layouts.
  - Employs honest empty/fallback states when specific dimensional data (e.g. 3D coordinates or depth intervals) is absent.
- **Executive Dossier & Scientific Grounding**:
  - Pulls structured narratives, key findings, and statistical indicators directly from source-backed extraction records.
  - Retains page-level citations, publisher provenance, and confidence tiers (`measured`, `interpreted`, `reported`).
- **Interactive Study Catalog**:
  - Seamlessly switch between official studies, such as the *Bengaluru Groundwater Outlook 2025* and *BMRCL Phase 3 Metro Environmental Impact Assessment (EIA)*.

---

## 🚀 Setup & Execution Guide

### 1. Prerequisites
- **Node.js**: `≥ 20.0.0` (check with `node -v`)
- **npm**: `≥ 10.0.0` (check with `npm -v`)
- **Modern Web Browser**: Chrome, Edge, Firefox, or Safari with WebGL2 support.
- **Network / API Keys**: **No API keys or backend servers required.** Basemap tiles stream over standard HTTPS; local mock geometries and packages load offline.

### 2. Installation

Navigate to the `ui-v2` directory and install dependencies:

```bash
cd ui-v2
npm install
```

### 3. Running Development Server

To launch the local interactive development server with hot-module reloading (HMR):

```bash
npm run dev
```

Once started, open your browser at:
👉 **`http://localhost:5173`** (or the port indicated in your terminal)

### 4. Exploring Studies via URL Parameters

You can switch studies directly using the dropdown in the top header, or by specifying the `?package=` query parameter in your browser URL:

- **BMRCL Phase 3 EIA (Metro Alignment & Boreholes)**:
  `http://localhost:5173/?package=/studies/bmrcl-phase3-eia-2025/study_package.json`
- **Bengaluru Groundwater Outlook 2025 (Aquifer Depths & Yields)**:
  `http://localhost:5173/?package=/studies/groundwater-outlook-bengaluru-2025/study_package.json`
- **Capability Envelope Fixture (Benchmark & All Visual Primitives)**:
  `http://localhost:5173/?package=/capability-envelope-fixture.json`

### 5. Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Starts the local Vite development server with HMR. |
| `npm test` | Executes the Vitest unit and integration test suite. |
| `npm run build` | Runs TypeScript compilation (`tsc`) and bundles optimized production assets into `dist/`. |
| `npm run verify` | Runs tests and executes a production build to verify regression-free code. |
| `npm run preview` | Locally serves the production build from `dist/` (e.g. `http://localhost:4173`). |
| `npm run materialize:package` | Materializes external figures and assets for static packaging. |

---

## 🏗 Architecture & Codebase Map

```
ui-v2/
├── src/
│   ├── core/                          # Core data loaders, adapters, and registries
│   │   ├── PackageIngestion.ts        # Parses and normalizes incoming study packages
│   │   ├── UniversalPackageLoader.ts  # Fetches and indexes studies from the catalog
│   │   ├── ScientificPackageLoader.ts # Translates legacy and v2 schemas to UI models
│   │   ├── AgenticStudyAdapter.ts     # Normalizes agent-generated document packages
│   │   ├── CapabilityNegotiation.ts   # Detects visual capabilities from package contents
│   │   ├── RendererRegistry.ts        # Semantic matchers for quantitative charts
│   │   └── ReportAnalysis.ts          # Summarizes findings and quality metrics
│   ├── types/
│   │   ├── scientific.ts              # Canonical domain interfaces for scientific entities
│   │   └── schema.ts                  # Raw package format schema definitions
│   ├── components/
│   │   ├── map/                       # MapLibre 2D GIS visualization components
│   │   │   ├── SeamlessMap.tsx        # Responsive map canvas with layer toggles
│   │   │   └── LayerControl.tsx       # Layer visibility and opacity controller
│   │   ├── scene/                     # Three.js 3D Subsurface visualization
│   │   │   └── SubsurfaceExplorer.tsx # Stratigraphic layers, boreholes, and depth grids
│   │   ├── hud/                       # Floating Heads-Up Display controls
│   │   │   ├── FloatingHUD.tsx        # Viewport toggles (2D, 3D, Split, Dossier)
│   │   │   ├── ScientificHeader.tsx   # Title, location metadata, and study status
│   │   │   └── StudySwitcher.tsx      # Multi-study switcher dropdown
│   │   ├── report/                    # Executive narrative and scientific dossier
│   │   │   └── ExecutiveDossierDrawer.tsx # Slide-out dossier with citations
│   │   ├── evidence/                  # Evidence workspace, chart drawers, table views
│   │   └── inspector/                 # Detailed entity inspection drawers
│   ├── App.tsx                        # Root layout and state coordination
│   └── main.tsx                       # React DOM entry point
├── public/
│   ├── study-catalog.json             # Manifest of available studies
│   └── studies/                       # Bundled static study packages
├── scripts/
│   └── materialize-package-assets.mjs # Standalone asset packager CLI
├── GENERIC_RENDERING.md               # Detailed generic rendering engine contract
└── vite.config.ts
```

---

## 📦 Packaging & Deploying Datasets

To package an agentic study bundle with all its referenced external figures, PDFs, and assets for offline or static hosting:

```bash
npm run materialize:package -- <path/to/study_package.json> <output/directory>
```

This ensures assets are relativized and copied without altering scientific content or confidence annotations.

---

## 🛡 Scientific Integrity Guarantees

- **No Hallucinated Geometries**: If a feature lacks spatial coordinates, it is rendered in tabular/narrative views with an explicit unlocated badge.
- **Traceable Provenance**: Every observation maintains pointers to its source document, table, figure, or annexure.
- **Honest Confidence Tiers**: Visualizations differentiate measured field data from modeled interpretations.
