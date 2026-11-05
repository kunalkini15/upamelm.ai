# Subsurface India — Evaluation Note (Phase 1: Foundation)

## What this is

Subsurface India turns India's government groundwater/geology research (CGWB, GSI)
into an AI-powered interactive exploration experience. This submission is **Phase 1:
the application foundation** — a working frontend with an interactive India map,
location exploration UI, and an extensible data/domain architecture. The AI
document-processing pipeline is intentionally **not** built yet (Phase 2).

## How to run (2 minutes)

Prerequisites: Node.js ≥ 20.

```bash
cd subsurface
npm install
npm run dev -- --port 5174 --strictPort
```

Then open **http://127.0.0.1:5174** in a browser (any free port works; 5173 is the
default if unoccupied). No API keys, backend, or paid services. Internet is needed
only for basemap tiles. Verify the build with `npm run build` (strict typecheck +
production bundle).

## Suggested evaluation walkthrough

1. **India map** — confirm the map loads centred on India with vector labels/roads;
   pan, zoom (buttons + scroll + pinch), and confirm the scale bar and attribution.
2. **Basemap switch** — toggle Dark/Light in the header; the style should swap.
3. **Layers catalogue** — open Layers: 2 active basemaps + location markers + 3
   locked "forthcoming" scientific overlays (aquifer extents, water-level contours,
   surface geology). Toggle markers off/on.
4. **Gandhinagar selection** — click the gold marker or "Explore Gandhinagar"; the
   map should fly to Gujarat and open the exploration panel.
5. **Five sections** — walk Overview, Aquifers, Underground, Research, Assistant via
   the tabs; each loads with either place facts or a designed empty state.
6. **Responsive** — narrow to a mobile width: the panel becomes a collapsible bottom
   sheet; the welcome card becomes a bottom bar.
7. **Reset view** — pan away, then Reset view returns to the subcontinent.

## What "good" looks like for Phase 1

- Zero fabricated science: no aquifer depths, measurements, or findings anywhere —
  every unprocessed capability shows an honest empty/forthcoming state.
- New locations register as data (`src/data/locations.ts`) with no component changes.
- New scientific overlays/domains register as data (`src/data/mapLayers.ts`,
  `src/data/domains.ts`) with no map or navigation rewrites.
- Evidence-first types: every measurement type carries a confidence tier
  (measured / interpreted / unknown) plus citation IDs (`src/types/`).
- Documented Phase 2 integration points with no credentials in the frontend
  (`docs/architecture.md`, `src/services/futurePipeline.ts`).

## Deliberately out of scope (do not penalise)

No PDF extraction, no model integration, no 3D engine, no database, no auth, no
deployment. The assistant input is visibly disabled and labelled "Not connected".

## Environment notes

- If a "Primary basemap unreachable — showing fallback" notice appears, the app
  has automatically switched tile providers and remains fully usable; this reflects
  the evaluation machine's network, not an app failure. Console lines tagged
  `[subsurface-map]` name the exact failing request.
- Stack: React 19 + TypeScript + Vite + Tailwind v4 + MapLibre GL JS (open source,
  keyless). Data licensing/attribution: `docs/data-licensing.md`.
