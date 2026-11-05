# Architecture

Phase 1 foundation for Subsurface India. This document records the boundaries that
future phases must respect, and the exact points where new capabilities connect.

## Layers

```
┌─────────────────────────────────────────────────────────┐
│ UI  (components/, App.tsx)                              │
│  Renders state. Never fetches, never holds credentials. │
├─────────────────────────────────────────────────────────┤
│ Data access  (services/)                                │
│  Repository interfaces + providers. The ONLY path       │
│  from UI to data — local today, HTTP tomorrow.          │
├─────────────────────────────────────────────────────────┤
│ Domain model  (types/) + registries (data/)             │
│  Shared vocabulary: locations, domains, evidence,       │
│  layers. Imported by UI, services, and (later) pipeline │
├─────────────────────────────────────────────────────────┤
│ AI pipeline  (services/pipeline/ — DOES NOT EXIST YET)  │
│  Server-side only. Ingest → extract → validate →        │
│  publish. Owns all model credentials.                   │
└─────────────────────────────────────────────────────────┘
```

### Hard rules

1. Components import from `services/`, `data/`, and `types/` only for data. No `fetch`
   to model APIs from the frontend, ever.
2. Model credentials must never appear in frontend code, `VITE_*` env vars, or this
   repository. Extraction runs on a server or operator machine.
3. No scientific value renders without its confidence tier and citation path. The
   types make this structural: `DepthMeasurement`, `AquiferSystem`, and friends all
   carry `confidence` + `observationIds`.
4. `measured` / `interpreted` / `unknown` are the only evidence tiers. UI copy must
   never upgrade a tier (e.g. never call an interpretation "confirmed").

## Extension points

### Adding a location (no component changes)

1. Append a `ResearchLocation` to `src/data/locations.ts` with verified WGS84
   coordinates and admin context.
2. Mark its `forthcomingDomains`. The marker, welcome card, availability list, and
   panel all render from the registry.
3. When findings exist, extend the repository to serve its `LocationFindings`.

### Adding a scientific overlay (no map changes)

1. Register a `MapLayerDefinition` in `src/data/mapLayers.ts` (`status: 'forthcoming'`
   until data exists).
2. The Layers catalogue picks it up automatically, grouped by `group` and badged by
   its `domainId`.
3. When tile/GeoJSON endpoints exist, extend `MapView` with a renderer keyed by
   `kind` (`geojson` / `raster` / `vector`) — one generic path, not per-layer code.

### Adding a scientific domain (no navigation changes)

1. Extend `ScientificDomainId` in `src/types/domains.ts` and add a registry entry in
   `src/data/domains.ts` (label, accent, phase).
2. Availability rows, domain badges, and layer grouping follow automatically.
3. Domain-specific observation payloads get a new types module (sibling of
   `hydrogeology.ts`) reusing `Confidence`, `Observation`, and `PageCitation`.

### Swapping in server-backed data (no UI changes)

1. Implement `LocationRepository` against the backend API (e.g.
   `HttpLocationRepository` in `services/`).
2. Replace the exported instance in `src/services/locations.ts`. Components are
   untouched because they depend on the interface.

## Phase 2 integration map

| Need | Connects at | Notes |
| ---- | ----------- | ----- |
| PDF registration & page splitting | `services/pipeline/ingest.ts` (new, server-side) | Records `SourceDocument` + page provenance |
| Muse Spark extraction | `services/pipeline/extract.ts` (new, server-side) | Emits `Observation` + `PageCitation` records |
| Schema & citation checks | `services/pipeline/validate.ts` (new, server-side) | Reject observations with zero citations |
| Evidence storage & API | Backend store + `HttpLocationRepository` | Serves `LocationFindings`, aquifers, units, docs |
| Cross-sections / 3D | `VisualisationAsset` records + a scene renderer | Geometry generated from validated findings only |
| Assistant | Backend chat endpoint over stored observations | UI shell already exists; wire the form to the API |

## Deliberate non-goals for Phase 1

No PDF parsing, no model integration, no 3D engine, no database, no auth, no
deploys. The `dist/` output is a static site; any static host (or `vite preview`)
serves it with zero backend cost.
