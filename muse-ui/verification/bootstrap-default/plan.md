# Bootstrap Plan — run `bootstrap-default`

Scope: neutral application foundation only. No study package input, no
document-specific visualization, no inspection of `ui-v2`. This plan is the
read-only architecture for the writer stage. It creates no application source
and weakens no baseline invariant.

Module: `muse-ui`. Contracts read in full: `BASELINE.md`, `AGENTS.md`,
`WORKFLOW.md`, `REGISTRIES.md`, `README.md`, `capability-registry.json`
(empty, schema `visual-capabilities.v1`), `package-registry.json` (empty,
schema `visual-package-registry.v1`), `invocations/` + `requests/` scaffolds,
`.gitignore` (ignores `node_modules/`, `dist/`, `.vite/`, `.playwright-mcp/`,
`coverage/`, logs). No application source, `package.json`, or `.nvmrc` exists
yet — the writer creates them.

Primary sources consulted: MapLibre GL JS docs (globe projection landed in
v5.0.0 via `projection: { type: 'globe' }`; style without projection defaults
to Mercator); OpenFreeMap keyless styles
(`https://tiles.openfreemap.org/styles/liberty`, plus `bright`/`positron`
variants); Vite Node-support policy (Vite 7.x requires Node
`^20.19.0 || >=22.12.0`; Vite 8 requires Node `20.19+`/`22.12+`; pin the exact
Vite release and document a compatible Node line in `.nvmrc`).

## 1. Baseline invariant map

Each row: invariant → implementation boundary (which module owns it) →
checkable acceptance the verifier can observe.

### Mandatory stack

| # | Invariant | Boundary | Acceptance |
|---|-----------|----------|------------|
| S1 | React + TypeScript + Vite, npm + committed `package-lock.json`, `.nvmrc` + documented Node support matching the selected Vite release | Repo root of `muse-ui` (writer scaffolds `package.json`, `tsconfig`, `vite.config`, `.nvmrc`, lockfile) | `npm ci` succeeds from fresh clone; `node --version` matches `.nvmrc`/docs; no globally installed packages required |
| S2 | MapLibre GL JS used directly as the map engine (no wrapper SDK) | `src/map/` | `package.json` depends on `maplibre-gl` (bundled npm dep, no CDN script tag); map renders in browser |
| S3 | Three.js in a separate coordinated 3D viewport, never sharing MapLibre's WebGL context | `src/three/` + `src/interaction/` | Two independent canvases/contexts; 3D state derives only from scene model + interaction state |
| S4 | Proj4js for transforms from explicitly declared supported CRSs only | `src/scene-model/` or `src/package-adapter/` transform step | Declared supported-CRS list in code; transform path exists only for listed CRSs; anything else stays unlocated |
| S5 | Vitest (or Vite-native runner) + Playwright | Config + `src/**/*.test.*`, browser specs | `npm run test`, `npm run test:browser`, `npm run verify` all exit 0 |
| S6 | No global installs, private tokens, proprietary SDKs, undocumented services, code from another UI, or CDN application-library imports | Whole tree + build config | Fresh-clone build works offline except remote tiles; `grep` shows no CDN `<script>` for app libs, no token strings, no `ui-v2` imports |
| S7 | Reproducible commands `npm ci`, `dev`, `build`, `test`, `test:browser`, `verify` with documented start command + URL | `package.json` scripts + README/docs | Each command runs; docs state exact `dev` port/URL |

### Product shell

| # | Invariant | Boundary | Acceptance |
|---|-----------|----------|------------|
| P1 | Default landing is a working global map; world extent shown while loading; validated bounds framed only when present, never invented | `src/app/` shell + `src/map/` camera | Cold start shows world; no camera jump before bounds exist |
| P2 | Permanent modes `map`, `3d`, `split`, `narrative`, `report`; unavailable modes visible but disabled with explanation | `src/app/` mode nav | All five modes visible; `3d`/`split` (no 3D evidence at bootstrap) disabled with reason text |
| P3 | Responsive shell: package identity/status, mode nav, layer controls, legend, selection details, limitations, narrative/report access | `src/app/` layout | Desktop 1280×720 and one compact viewport both usable; every element present with empty-state copy at bootstrap |

### Global map

| # | Invariant | Boundary | Acceptance |
|---|-----------|----------|------------|
| M1 | World navigation, zoom, scale, home/reset, globe↔Mercator projection switch, visible data/basemap attribution | `src/map/` | Each control operable in browser; attribution visible on both projections |
| M2 | Configurable style URL, default token-free OpenFreeMap style; never call `tile.openstreetmap.org` directly | `src/map/` style config | Default style URL is OpenFreeMap; no direct OSM-tile requests in network log |
| M3 | Bundled neutral local fallback style (land/water or graticule) keeps geometry, controls, attribution usable when remote tiles fail | `src/map/` fallback style asset | Block remote tiles → fallback renders with controls + attribution intact |
| M4 | Layer visibility, legend, feature selection, hover/focus, fit-to-study / fit-to-selection | `src/map/` + `src/interaction/` | Toggling, hover highlight, selection, fit/reset all work against empty state without errors |
| M5 | Antimeridian-crossing and invalid/out-of-range coordinates handled without fabricating camera positions | `src/scene-model/` bounds validation | Synthetic antimeridian/invalid bounds unit tests pass; map never flies to invented location |

### Scientific 3D

| # | Invariant | Boundary | Acceptance |
|---|-----------|----------|------------|
| D1 | Three.js separate context, coordinated via shared state; local metric Cartesian frame anchored to validated study origin | `src/three/` | No shared GL context; 3D origin requires validated anchor or 3D stays disabled |
| D2 | Preserve original + transformed coordinates, units, CRS, vertical direction/datum, provenance | `src/scene-model/` | Empty-state model carries provenance fields; nothing renders without them |
| D3 | Orbit, reset/home, orientation cue, scale/depth context, clipping where supported, labelled vertical-exaggeration where appropriate | `src/three/` | Controls present when 3D enabled; at bootstrap the disabled-3D explanation names the missing evidence |
| D4 | Never invent elevations/depths/surfaces/thicknesses/topology/materials/relationships; disable 3D with explanation when evidence inadequate | `src/three/` gating | Bootstrap shows honest unavailable-3D state; no synthetic geometry |
| D5 | Dispose geometries, materials, textures, controls, render loops on package/view change | `src/three/` lifecycle | Review lifecycle code; no console errors or leaks on mode/package switch |

### Coordinate contract

| # | Invariant | Boundary | Acceptance |
|---|-----------|----------|------------|
| C1 | Map boundary WGS84 lon/lat; 3D boundary anchored local metric | `src/scene-model/` types | Types enforce the two frames; no mixing |
| C2 | Transform only from explicitly declared supported CRS; never infer from ranges, filenames, place names | `src/package-adapter/` | Tests feed undeclared CRS → rejected/unlocated; declared CRS → transformed with recorded provenance |
| C3 | Validate lon/lat ranges + geometry structure before rendering | `src/package-adapter/` validation | Malformed geometry rejected per-feature without crashing package |
| C4 | Horizontal CRS, vertical datum, units, depth/elevation direction are separate facts | `src/scene-model/` | Schema holds them as independent nullable fields |
| C5 | Unsupported/ambiguous/missing location → honest `unlocated` state; narrative/report stay accessible | `src/app/` + `src/narrative/` + `src/report/` | Unlocated banner + narrative/report reachable; map stays at world view |

### Package boundary

| # | Invariant | Boundary | Acceptance |
|---|-----------|----------|------------|
| K1 | One validated adapter: schema/version check before activation; capability mapping (never document/study/city/filename/publisher/domain branches); supports metadata, coverage, layers, features, observations, intervals, vertical profiles, structured resources, narrative targets, reports, evidence refs, limitations, unresolved items when present | `src/package-adapter/` → typed `src/scene-model/` | Unit tests cover valid/old-version/unknown-field/per-feature-bad-geometry cases; no document-label branches in code |
| K2 | Unknown fields preserved raw, never trusted as render instructions | `src/package-adapter/` | Round-trip test: unknown fields retained, zero effect on render |
| K3 | Reject malformed geometry per-feature; keep last valid package on replacement failure | `src/package-adapter/` + `src/app/` store | Bad feature skipped with limitation entry; failed import leaves prior scene intact |
| K4 | Sanitize displayed text; never execute package HTML/scripts/URLs/handlers | Render boundary | XSS-probe package renders as inert text; no `dangerouslySetInnerHTML` on package strings (or sanitized equivalent) |
| K5 | Bootstrap ships with NO configured package; empty package registry; optional configured package + client-side JSON import (picker + drag-drop) via the same adapter, with file/type/size handling, no upload, actionable errors | `src/app/` import surface | Registry stays empty; import of malformed file shows actionable error and preserves prior state; no network upload |

### Unified interaction state

| # | Invariant | Boundary | Acceptance |
|---|-----------|----------|------------|
| I1 | Serializable contract covering at minimum `activeFeatureId`, `hoveredFeatureId`, `activeLayerIds`, `viewMode` (`map`\|`3d`\|`split`\|`narrative`\|`report`) | `src/interaction/` | Exact interface present; serializable (JSON round-trip test) |
| I2 | Selection from any surface focuses same evidence everywhere; renderers never coupled directly | `src/interaction/` store | Map/narrative/report selection tests drive one store; map and three subscribe independently |

### Architectural boundaries

| # | Invariant | Boundary | Acceptance |
|---|-----------|----------|------------|
| A1 | Independent modules `app/`, `package-adapter/`, `scene-model/`, `capabilities/`, `interaction/`, `map/`, `three/`, `narrative/`, `report/` | `src/` tree | Directory layout matches; import graph points inward to scene-model/interaction, never at raw JSON from renderers |
| A2 | Renderers consume typed scene model + interaction state, never raw package JSON | Module imports | Static check/grep: no raw-package imports in `map/`, `three/`, `narrative/`, `report/`, `capabilities/` |
| A3 | Capability registration describes reusable semantic/geometric ideas, not introducing packages | `capability-registry.json` + `src/capabilities/` | Bootstrap registry remains empty (no verified renderers yet); no document-named entries ever |

### Reproducible commands + states

| # | Invariant | Boundary | Acceptance |
|---|-----------|----------|------------|
| R1 | Fresh-clone commands per S7; loading, empty, unlocated, unsupported, partial-data, basemap-failure, package-validation, runtime-error states — no blank screens | `src/app/` state surfaces | Each state reachable in browser or test with legible copy; no state renders blank |
| R2 | Unit tests cover validation, capability negotiation, coordinate validation/transform, bounds, interaction state, registry integrity | Test suite | Named suites exist and pass |
| R3 | Browser gates per `BASELINE.md` verification list (build+tests green; map+attribution+controls; fallback; bounds framing; toggling/selection/fit-reset; cross-surface coordination; honest 3D; import boundary; malformed-input preservation; responsive + keyboard + clean console) | Playwright specs + screenshots | Specs assert each; ≤6 retained screenshots at 1280×720 @1x, each inspected |

### Clean-room rule

| # | Invariant | Boundary | Acceptance |
|---|-----------|----------|------------|
| Q1 | No inspection/import/copy/translate/derive from `ui-v2` (only the exact supplied package file, as data, when it lives there — n/a at bootstrap) | Whole run | Writer/verifier attest; no `ui-v2` paths in imports, diffs, or reports |

## 2. Neutral bird's-eye global-map landing

Composition (writer owns final styling): full-viewport MapLibre canvas at world
extent (zoom ~1–2, centered to show the whole earth per projection default);
top bar with app identity + "No package loaded" status; mode nav with the five
modes (`map` active; `3d`/`split` disabled with "needs located 3D evidence";
`narrative`/`report` enabled but showing their empty states); side or overlay
panel with layer control (basemap entry only), legend placeholder, selection
details ("Nothing selected"), limitations ("No study evidence yet"), import
entry point; persistent attribution + scale control. No sample pins, no demo
datasets, no regional framing — the map must read as "the whole world, nothing
loaded yet." Loading: world extent + skeleton/progress copy. Projection switch
globe↔Mercator preserves world framing.

## 3. Empty / unlocated states

- `empty` (bootstrap default): identity + "no package" status, disabled 3D with
  reason, empty layers/legend/selection/narrative/report panels with
  next-step copy toward import. Map interactive at world view.
- `loading`: world extent + progress, controls inert but visible.
- `unlocated`: banner naming the missing/unsupported location facts;
  narrative/report remain fully navigable; map holds world view, never
  fabricates a focus.
- `unsupported` / `partial-data`: per-feature skip + limitations ledger entries;
  rest of scene renders.
- `basemap-failure`: automatic neutral fallback style (bundled land/water or
  graticule), controls + attribution live, notice naming the failure.
- `package-validation`: actionable file/type/size/schema errors at the import
  surface; last valid package (none at bootstrap → still empty, not broken)
  preserved.
- `runtime-error`: error boundary content with recovery (reset view / clear
  package), never a blank screen.

## 4. Package-import boundary

Single file: `src/package-adapter/` exposes `validatePackage(raw) →
typed SceneModel | ValidationError[]`. Both the (future) configured-package
path and the client-side import (file picker + drag-drop, JSON only, explicit
size cap, no upload) call this same function. Contract: version check first;
declared-capability mapping; per-feature geometry quarantine; unknown-field
passthrough at raw boundary; text sanitization at render; failure keeps the
previous scene. Bootstrap delivers the adapter + empty-state UI and proves the
rejection paths with malformed fixtures; it registers no package and leaves
`package-registry.json` empty (`proposed-registry.json` for this run likewise
proposes zero packages).

## 5. Coordinated application shell

`src/app/` composes `map/`, `three/`, `narrative/`, `report/` around one
`src/interaction/` store implementing `InteractionState` exactly. Flow:
any surface dispatches selection/hover/layer/mode intents → store updates →
subscribed surfaces re-derive focus (map `fit-to-selection`, 3D focus,
narrative/report scroll-to-evidence). No renderer-to-renderer imports. Mode
switching mounts/unmounts the Three.js loop with disposal. Keyboard: all
non-canvas controls focusable with visible focus; canvas actions have control
equivalents (fit/reset buttons). Shell also owns the state surfaces from
section 3 and the import dropzone.

## 6. Extension points (no document design)

- `src/capabilities/`: registry + renderer interfaces for reusable ideas
  (point observation, path, network, vertical profile, volume, surface,
  cross-section, time series). Bootstrap adds none — it ships the interface +
  negotiation stub returning "no evidence" so evolution can compose/extend.
- `src/scene-model/`: typed scene + capability-negotiation input; new evidence
  kinds extend the type, never branch renderers on document labels.
- `src/package-adapter/`: supported-CRS list + schema version gate; new CRSs
  or package versions extend the allowlist with provenance.
- `src/narrative/` + `src/report/`: evidence-link renderers driven by
  narrative targets/evidence refs, generic at bootstrap.
- Registries: evolution stages deltas in
  `verification/<run-id>/proposed-registry.json`; promotion only after
  read-only browser acceptance with pre/post validation and rollback.

## 7. Writer work list (bounded)

1. Scaffold Vite + React + TS + Vitest + Playwright + MapLibre + Three +
   proj4js; `.nvmrc`; scripts (`dev`, `build`, `test`, `test:browser`,
   `verify`); committed lockfile; no CDN app libs.
2. Implement `scene-model` types, `interaction` store, `package-adapter`
   validator, `capabilities` interface + empty negotiation.
3. Build `app` shell + `map` (remote style + bundled fallback + all controls)
   + honest disabled-3D + empty narrative/report + import surface + every
   state in section 3.
4. Build `three` viewport shell (separate context, orbit/reset/cue/scale/
   exaggeration-label/disposal) gated to disabled until evidence exists.
5. Unit tests per R2; Playwright specs per R3; docs (start command + URL).
6. Browser verification per `WORKFLOW.md` §8 on ports 5200–5210, 1280×720 @1x,
   ≤6 inspected screenshots, servers stopped; report at
   `verification/bootstrap-default/report.md`; staged
   `proposed-registry.json` (empty packages); registries stay empty until
   promotion validates.

## 8. Explicit non-goals

No study-package support beyond the generic adapter; no capability entries; no
document/city/domain-specific views, labels, or branches; no `ui-v2` contact;
no new dependencies beyond the baseline stack without a recorded decision.

— Architect (read-only). No source created or modified by this plan.
