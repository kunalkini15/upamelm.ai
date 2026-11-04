# UI V2 Generic Rendering Contract

UI V2 is a capability-negotiated scientific evidence viewer. It supports both the legacy Research Engine package and the Agentic Flow `document-study.v2` / `study-rendering.v2` family. The adapter preserves grounded package content and enables a view only when its required structured evidence exists.

## Ingestion

`PackageIngestion.parse(raw, { sourceBaseUrl })` detects the package family and produces one `ScientificUIModel`. The model is the only contract consumed by presentation components. New package variants should be normalized in an adapter instead of branching throughout React components.

The normalized model preserves:

- Point, multipoint, line, multiline, polygon, and multipolygon geometry.
- Located and unlocated features.
- Observations, intervals, vertical profiles, datasets, native assets, timelines, report synthesis, evidence references, quality semantics, and package extensions.
- Source paths relative to `sourceBaseUrl`.

The UI must not create coordinates, intervals, thresholds, pairings, units, or evidence links that are absent from the package.

## Capability negotiation

`CapabilityNegotiation.ts` derives available capabilities from normalized content. `EvidenceWorkspace.tsx` uses the result to enable or disable workspaces. Unsupported views remain visible with an explanatory disabled state when appropriate.

Primary compositions are selected from the evidence mix:

- `map-first`
- `vertical-first`
- `corridor-first`
- `figure-first`
- `dashboard-first`
- `report-first`

## Renderer extension points

Quantitative modules are registered in `RendererRegistry.ts`. A renderer declares a semantic matcher and is selected deterministically. Current families are line/time series, range, grouped and stacked bars, shares, histograms, scatter plots, thresholds, waterfalls, and KPI cards.

To add a renderer:

1. Add a narrowly scoped matcher to `quantitativeRendererRegistry`.
2. Add the visual implementation to `GenericChart.tsx`.
3. Add a fixture series and a registry assertion to `generic-rendering.test.ts`.
4. Preserve the generic narrative/statistical fallback when prerequisites are incomplete.

Unknown package extensions are rendered by `ExtensionBrowser` as inspected metadata and JSON. A `rendererHint` is advisory; it must never execute package-supplied code.

## Assets and deployment

Browser-accessible relative or remote paths are previewed directly. Local filesystem paths are intentionally not exposed in the browser.

For a portable deployment package, run:

```bash
npm run materialize:package -- path/to/study_package.json path/to/output
```

The materializer copies referenced resources/assets, rewrites their paths, and writes a deployable package. It does not alter scientific content.

## Shared selection

Feature IDs are the cross-view selection key. Map objects, report findings, charts, resource rows, figures, profiles, and corridors may call `onSelectFeature(id)`. Views with unresolved or non-spatial references remain inspectable without inventing a map target.

## Verification

Run:

```bash
npm run verify
```

This runs the generic adaptation tests followed by the production TypeScript/Vite build. The public `capability-envelope-fixture.json` deliberately exercises every major evidence family and safe fallback.

## Capability-envelope acceptance matrix

| Requirement | Implementation |
| --- | --- |
| Common geometry | Generic GeoJSON map sources and layer filtering |
| Structured/file-backed resources | `ResourceBrowser` with inline and fetched CSV/JSON rows |
| Quantitative visualizations | Semantic renderer registry and `GenericChart` |
| Native figures/assets | `AssetBrowser`, legends, hotspots, zoom, source links |
| Cross-view selection | Canonical feature-ID callbacks |
| Time/status/confidence | Timeline and quality workspaces |
| Profiles and sections | Single-profile inspector and shared-scale comparison |
| Corridors and chainage | Grounded line viewer with geodesic derived distance |
| Raster overlays | Bounded image sources on the map |
| Adaptive composition | Capability-driven primary layout and workspace tabs |
| Comparison | Compatible series, profile comparison, report comparisons |
| Unknown extensions | Safe metadata/JSON fallback and advisory renderer hints |
