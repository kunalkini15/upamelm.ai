# Reproducible Application Baseline

This contract defines the non-negotiable foundation produced by bootstrap and
preserved by every later evolution. Independent Muse runs may differ in visual
composition and implementation detail, but they must produce the same product
capabilities, architectural boundaries, commands, and observable acceptance
states.

## Mandatory stack

- React, TypeScript, and Vite.
- MapLibre GL JS for the global 2D surface map.
- Three.js for a separate coordinated scientific 3D viewport.
- Proj4js for transformations from explicitly declared supported coordinate
  reference systems.
- Vitest or an equivalent Vite-native unit-test runner.
- Playwright for browser flows and retained screenshots.
- npm with a committed `package-lock.json`, plus `.nvmrc` and documented Node
  support compatible with the selected Vite release.

The generated application must not require globally installed packages, private
map tokens, proprietary SDKs, undocumented services, or code from another UI.
Commit exact dependency resolution through the lockfile; do not use CDN script
imports for application libraries.

## Product shell

The default landing experience is a working global map. While a package loads,
show the world extent. When validated spatial bounds exist, frame them without
inventing coordinates. The permanent application modes are:

- `map`: global surface context and spatial layers;
- `3d`: scientific geometry in a local metric frame;
- `split`: coordinated map and 3D inspection;
- `narrative`: evidence-linked insights;
- `report`: structured report navigation.

Keep unavailable modes visible but disabled with an explanation. A responsive
shell must provide package identity/status, mode navigation, layer controls,
legend, selection details, limitations, and access to narrative/report content.
Muse owns the styling, view hierarchy, and evidence-specific composition.

## Global map

- Use MapLibre GL JS directly as the map engine.
- Provide world navigation, zoom, scale, home/reset, projection switching
  between globe and Mercator, and visible data/basemap attribution.
- Use a configurable style URL with a token-free OpenFreeMap style as the
  default. Do not call `tile.openstreetmap.org` directly.
- Bundle a neutral local fallback style with land/water or graticule context so
  study geometry, controls, and attribution remain usable when remote tiles fail.
- Expose layer visibility, legend, feature selection, hover/focus feedback, and
  fit-to-study/fit-to-selection actions.
- Handle antimeridian-crossing bounds and invalid/out-of-range coordinates
  without moving the camera to fabricated locations.

## Scientific 3D

- Keep Three.js rendering separate from MapLibre's WebGL context and coordinate
  it through shared application state.
- Work in a local metric Cartesian frame anchored to a validated study origin.
- Preserve original coordinates, transformed coordinates, units, CRS, vertical
  direction, vertical datum when known, and transformation provenance.
- Provide orbit inspection, reset/home, an orientation cue, useful scale/depth
  context, clipping where supported, and an explicitly labelled vertical
  exaggeration control where scientifically appropriate.
- Never invent elevations, depths, surfaces, thicknesses, topology, materials,
  or relationships. Disable 3D with an explanation when evidence is inadequate.
- Dispose Three.js geometries, materials, textures, controls, and render loops
  when packages or views change.

## Coordinate contract

- The map boundary uses WGS84 longitude/latitude.
- The 3D boundary uses anchored local metric coordinates.
- Transform only from an explicitly declared and supported CRS. Never infer a
  CRS from value ranges, filenames, place names, or apparent location.
- Validate longitude/latitude ranges and geometry structure before rendering.
- Treat horizontal CRS, vertical datum, vertical units, and depth/elevation
  direction as separate facts.
- Keep unsupported, ambiguous, or missing location data in an honest
  `unlocated` state while preserving non-spatial narrative and report access.

## Package boundary

Implement one validated package adapter between raw input and the typed internal
scene model. It must:

- validate the package schema/version before activation;
- map declared capabilities instead of branching on document, study, city,
  filename, publisher, or domain labels;
- support, when present, study metadata, coverage, layers, features,
  observations, intervals, vertical profiles, structured resources, narrative
  targets, reports, evidence references, limitations, and unresolved items;
- preserve unknown fields at the raw boundary without treating them as trusted
  render instructions;
- reject malformed individual geometry without crashing the whole package;
- sanitize all displayed text and never execute package HTML, scripts, URLs, or
  event handlers as code;
- keep the previously active valid package when a replacement fails validation.

Bootstrap starts without a configured package and shows the neutral global-map
foundation. Support an optional configured package after evolution, plus
client-side JSON import through a file picker or drag-and-drop surface. Local
import must use the same adapter, have explicit file/type/size handling, perform
no upload, and show actionable validation errors.

## Unified interaction state

Map, 3D, split, narrative, and report surfaces share one serializable state
contract. The implementation mechanism is agent-selected, but its public shape
must cover at least:

```ts
interface InteractionState {
  activeFeatureId: string | null;
  hoveredFeatureId: string | null;
  activeLayerIds: string[];
  viewMode: "map" | "3d" | "split" | "narrative" | "report";
}
```

Selection from any applicable surface must focus the same evidence everywhere
else without coupling renderers directly to one another.

## Architectural boundaries

Keep independent modules for:

```text
src/
  app/
  package-adapter/
  scene-model/
  capabilities/
  interaction/
  map/
  three/
  narrative/
  report/
```

Renderers consume the typed scene model and interaction state, never raw package
JSON. Capability registration describes reusable semantic or geometric ideas,
not the package that first introduced them.

## Reproducible commands

A fresh clone must support:

```bash
npm ci
npm run dev
npm run build
npm run test
npm run test:browser
npm run verify
```

Document the exact local start command and URL. Provide loading, empty,
unlocated, unsupported, partial-data, basemap-failure, package-validation, and
runtime-error states without blank screens.

## Baseline verification

Unit tests must cover package validation, capability negotiation, coordinate
validation/transformation, bounds, interaction state, and registry integrity.
Browser verification must prove:

- production build and configured tests succeed;
- the global map renders with visible attribution and controls;
- remote-basemap failure leaves a usable fallback map;
- valid study bounds frame correctly and unlocated data does not fabricate a
  location;
- layer toggling, feature selection, and fit/reset behavior work;
- map, 3D, narrative, and report selection are coordinated where supported;
- a meaningful 3D state works when evidence permits, and the unavailable state
  is honest otherwise;
- configured-package and local-file loading use the same validation boundary
  once a package has been accepted through evolution;
- malformed local input preserves the last valid package and explains failure;
- desktop and compact layouts are usable, keyboard focus is visible, essential
  non-canvas controls are keyboard operable, and the console has no uncaught
  application error.

Use deterministic functional assertions for cross-platform gates. Capture and
inspect bounded screenshots for visual quality, but do not require pixel-perfect
identity across operating systems or GPUs.

## Clean-room rule

Do not inspect, import, copy, translate, or derive architecture, source,
components, styling, interaction design, assets, tests, or dependencies from
`ui-v2`. When the explicitly supplied package path happens to be located inside
that directory, only that exact package file may be read, strictly as input data.

