# Subsurface India — Explore the science beneath the surface

India has decades of valuable geological, groundwater, and environmental research locked in
lengthy government reports. Subsurface India turns that research into an intuitive,
AI-powered, interactive exploration experience — making existing scientific knowledge
accessible without inventing new claims.

> **Phase 1 (this repo state):** application foundation — interactive India map, location
> exploration interface, domain data models, and documented integration points for the
> future AI pipeline. No scientific extraction, no model calls, no fabricated findings.

## Quick start

Prerequisites: **Node.js ≥ 20** and npm.

```bash
npm install
npm run dev
```

Then open **http://127.0.0.1:5174** in a browser.

| Command            | Purpose                                              |
| ------------------ | ---------------------------------------------------- |
| `npm install`      | Install dependencies                                 |
| `npm run dev`      | Start the dev server at http://127.0.0.1:5174        |
| `npm run build`    | Typecheck (`tsc -b`) + production build into `dist/` |
| `npm run preview`  | Serve the production build locally                   |
| `npm run typecheck`| Typecheck only                                       |

No API keys, no backend, no paid services. Map tiles stream from a free keyless
basemap (see [Data licensing](docs/data-licensing.md)); an internet connection is
required for tiles.

## What you can do today

- **Explore the India map** — pan, zoom, switch dark/light basemaps, toggle the
  research-location markers, reset to the subcontinent view.
- **Select Gandhinagar** — click its marker (or the welcome card) to fly in and open
  the exploration panel.
- **Walk the five sections** — Overview, Aquifer intelligence, Underground
  exploration, Research & evidence, AI research assistant — each with honest empty
  states where Phase 2+ capabilities will land.
- **Inspect the layer catalogue** — the Layers button shows active layers plus locked
  forthcoming overlays (aquifer extents, water-level contours, surface geology).
- **Resize to mobile widths** — the panel becomes a collapsible bottom sheet.

## Project structure

```
src/
  types/          Domain model (geo, domains, evidence, hydrogeology,
                  locations, map layers, visualisation assets)
  data/           Registries + Phase 1 seed (domains, map layers, Gandhinagar)
  services/       Data-access layer: repository interfaces + local providers.
                  UI code must obtain data only through here.
  components/     Map shell, header, layer catalogue, location panel,
                  exploration sections, shared UI primitives
  App.tsx         Shell state (selection, basemap, layers) + composition
  main.tsx        Entry point
docs/
  architecture.md   Boundaries, extension points, Phase 2+ integration map
  data-licensing.md Tile/boundary data sources, licences, attribution
```

Key files and responsibilities:

- `src/types/*` — reusable interfaces for regions, locations, domains, layers,
  source documents, observations, page-level citations, aquifers, geological units,
  depth measurements, findings, availability, and future visualisation assets.
- `src/data/locations.ts` — the Gandhinagar seed entry (coordinates + admin context
  only; zero scientific claims).
- `src/data/mapLayers.ts` — basemap presets, marker layer, forthcoming overlays, and
  the default India view. New overlays register here as data.
- `src/services/locations.ts` — `LocationRepository` interface + local provider.
  Phase 2/3 swaps in a server-backed implementation behind the same interface.
- `src/services/futurePipeline.ts` — documented home for the ingestion/extraction
  services (server-side, not built yet).
- `src/components/MapView.tsx` — MapLibre shell driven by the layer registry.

## Architecture decisions

- **React + TypeScript + Vite + Tailwind CSS v4 + MapLibre GL JS**, per the project's
  preferred stack: modern, lightweight, no licence costs, no API keys.
- **Data-driven map**: the map renders what the layer registry declares. Adding a
  scientific overlay is a registry entry, not a map rewrite.
- **Domain registry**: groundwater, geology, soil, minerals, hazards, and seismic are
  declared once in `src/data/domains.ts`; badges, availability lists, and layer groups
  render from it.
- **Evidence-first types**: every measurement type carries a confidence tier
  (`measured` / `interpreted` / `unknown`) and observation IDs; observations carry
  page-level citations. Interpretations can never be rendered as measurements without
  explicitly discarding the tier.
- **Repository boundary**: components never fetch; `services/` mediates. The future
  pipeline plugs in behind the same interfaces.
- **No backend in Phase 1**: a static frontend keeps cost at zero. Extraction and
  storage arrive server-side in Phase 2+ (see `docs/architecture.md`).

## Roadmap

- **Phase 2** — Gandhinagar reconstruction: CGWB report ingestion, Muse Spark
  extraction, validated findings, first cross-sections.
- **Phase 3** — Repeatable pipeline; groundwater coverage across states/districts.
- **Phase 4** — Soil, geology, minerals, hazards, seismic domains.

## Troubleshooting

**The map area is black / shows a fallback notice.** The app shell works offline,
but basemap styles and tiles stream from a CDN. If your network, VPN, or
ad-blocker blocks `basemaps.cartocdn.com`, the map automatically falls through to
OpenFreeMap and then OSM raster tiles, and shows which source is active. If every
source fails you get a retry card — open the browser console (F12) and look for
`[subsurface-map]` lines to see exactly which request failed.

## Scientific integrity

This build presents **no** measurements, aquifer depths, geological boundaries, or
research findings. Empty states mark every unprocessed capability, and the
forthcoming-overlay catalogue is explicitly locked. See `docs/architecture.md` for
the evidence rules that future phases must uphold.
