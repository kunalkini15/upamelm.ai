# Verification report — run `bootstrap-default`

## Final-review remediation (this stage — all material items closed in code)

The read-only final review returned `approved: false` with eight `must_fix`
items. Each is addressed below with a code, test, or report change; the
affected automated and browser checks were rerun green and the six bounded
screenshots were refreshed and visually inspected this session.

- Four columns, not three: the `syn3d-link` transect line reused mast A's
  representative coordinate, so two evidence columns overlapped exactly.
  `tests/fixtures/synthetic-3d-package.json` now gives the transect a
  distinct representative location (`[10.0003, 49.9998]`); the refreshed
  `04-3d-enabled.png` shows four individually visible columns and the spec
  still asserts `featureCount() === 4` plus the `4 evidence column(s)`
  provenance string.
- Provenance and controls visible in frame: `.threewrap canvas` no longer
  forces a 420px minimum that pushed the caption and toolbar below the
  720px-high fold. The canvas flexes (`min-height: 280px`, capped so
  caption plus toolbar fit), and `three-d.spec.ts` now asserts the
  provenance caption, Reset control, exaggeration input, and clip input are
  visible and scrolls the 3D workspace into view before capturing
  `04-3d-enabled.png`. The refreshed capture shows the anchor/provenance
  caption, Reset view, vertical-exaggeration slider, clip controls, and the
  RGB orientation cue.
- Visible disabled reason: the header now renders persistent visible text
  (`data-testid="mode-3d-reason"`: "3D and Split need located 3D evidence
  …") whenever 3D is blocked, in addition to the button `title` tooltips.
  `landing.spec.ts` asserts it. It is visible in the refreshed
  `01-landing.png` and `05-narrative.png`.
- No evolution label: the earlier draft called this bootstrap a `composed`
  evolution. That classification is defined only for evolution runs with a
  requirement or package input and does not apply here. Bootstrap has no
  study-package input and no capability decision beyond staging three
  browser-verified generic capabilities; the label is withdrawn.
- Served port/PID: the browser suite ran against the stock `dist/` build
  served on container port **5210** by a `python3 -m http.server` process
  started inside the ephemeral `--rm` Playwright container. The server
  process was killed after the run and the container was removed, so no
  PID survives to record and no server process persists on the host or in
  Docker (`docker ps` shows only the pre-existing buildkit daemons). No
  `npm run dev`/`preview` server was started on the host during this stage.
- Evidence tiers (downgraded claims): the report now separates (a) retained
  screenshots visually inspected this session, (b) automated browser
  assertions without a retained frame, and (c) the pending owner-finalizer
  promotion step. Split-mode layout, globe projection rendering, compact
  viewport, visible keyboard focus, and fit-to-selection after-state are
  tier (b): exercised and asserted by specs (`landing`, `resilience`,
  `fixture`) but have no retained screenshot in the six-slot budget, and
  are not claimed as visually evidenced. Console silence and
  mount/unmount disposal are tier (b): asserted by `pageerror`/console
  listeners across all 8 specs, not provable from a static frame.
- Promotion pending: per `AGENTS.md` the writer stage never edits live
  registries. `proposed-registry.json` is refreshed (reasons only; same
  three capabilities, same empty package proposal) and cross-reference
  validated; live `capability-registry.json` / `package-registry.json`
  remain empty and untouched. Promotion plus post-promotion
  parse/validation is reserved for the owner finalizer step — the run is
  writer-complete but not yet promoted.

## Critique remediation (prior stage — retained)

The read-only critique returned `passed=false` on the unreachable enabled-3D
path (`validatePackage` hardcoded `has3DEvidence: false`). Fixed without
weakening generic architecture:

- `src/package-adapter/validate.ts` derives `has3DEvidence` generically:
  validated located bounds plus at least one validated finite
  `elevationMeters`. No document, layer, city, or filename names are
  consulted; heightless or unlocated packages stay honestly disabled.
- `src/three/localFrame.ts` (unit-tested) anchors the local metric frame
  at the antimeridian-aware bounds center with an equirectangular
  meters projection; heights pass through untouched.
- `src/three/ThreeViewport.tsx` renders one truthful column per validated
  height (ground plane to true height; marker alone for near-zero heights),
  with orbit/reset, orientation cue, labelled vertical exaggeration, and
  clip controls, a provenance caption (anchor, method, units, evidence
  count, schematic-marker disclaimer), selection highlight through the
  shared interaction state, and full disposal of geometries, materials,
  controls, and render loops. It receives `scene` and `activeFeatureId`.
- Real bug found by the browser gate: the stage-level loading veil
  (`position: absolute; inset: 0`) covered the 3D toolbar when the user
  switched to 3D before the map booted. The veil renders only in map/split
  modes.
- Deterministic generic fixture `tests/fixtures/synthetic-3d-package.json`
  (labelled test-only, never shipped, never registered) plus unit coverage
  (`has3DEvidence` true/false/unlocated matrix, local-frame math) and
  browser spec `tests/browser/three-d.spec.ts`.

## Input and scope

- Neutral application foundation only. No study-package input, no
  document-specific visualization, no `ui-v2` contact: `grep` over `src/`
  finds no `ui-v2` path, no `tile.openstreetmap.org` call, and no
  `dangerouslySetInnerHTML` (the single `<script` hit is the
  negative-assertion string in `shell.test.tsx`).
- No evolution capability classification applies at bootstrap (see above).
  The staged proposal lists three browser-verified reusable capabilities:
  map `path`, map+3D `point-observation`, 3D `vertical-profile`.

## Architecture-review must_fix disposition

- Clipping implemented: `renderer.localClippingEnabled` plus a
  user-controlled clip plane (`createClipState` / `applyClipState`,
  unit-tested, browser-exercised by `three-d.spec.ts`).
- M4/R3 browser gates proven with generic synthetic fixture
  `tests/fixtures/synthetic-package.json` through the validated adapter
  via the real file-import surface (layer toggling, hover highlight,
  selection, fit-to-study, fit-to-selection, narrative→map coordination).
  Labelled test-only, never registered, never the landing experience.
- Schema oracle: accepted package schema is `muse-scene-package.v1`.
  Missing or different `schema_version` rejects the whole package with an
  actionable message; the last valid scene is preserved.
- Report contract: this file records port/PID handling, terminated
  servers, commands, browser states, issues fixed, remaining limitations,
  and screenshot paths.
- Promotion: staged delta proposes three verified capabilities; validation
  parsed both live registries and the proposal and resolved every
  `verified_fixture_ids` entry to a real fixture layer. No live registry
  edited; promotion awaits the owner finalizer.
- Deferred 3D acceptance closed: orbit/reset/cue/scale/clipping/
  exaggeration in-browser and disposal across mode/package switching are
  browser-verified by `three-d.spec.ts` (controls operated, selection
  asserted through the shared handle, pageerror/console listeners silent
  across mount/unmount). Heightless/unlocated 3D stays honestly disabled
  and is browser-verified as such by `landing.spec.ts`.

## What was built

Scaffolded `muse-ui` per BASELINE.md: React 18.3.1 + TypeScript 5.6 + Vite
7.3.7, MapLibre GL JS 5.24.0, Three.js 0.170.0, Proj4js 2.22.0, Vitest
5.1.0, Playwright 1.64.1, npm lockfile committed, `.nvmrc` (`22`), run
docs in `README.md`. Modules: `app/`, `package-adapter/`, `scene-model/`,
`capabilities/`, `interaction/`, `map/`, `three/`, `narrative/` (+ report
panels). This stage changed: `src/app/App.tsx` (visible disabled reason),
`src/styles.css` (3D workspace fits the 720p frame),
`tests/fixtures/synthetic-3d-package.json` (distinct transect location),
`tests/browser/three-d.spec.ts` (visible-controls assertions before
capture), `tests/browser/landing.spec.ts` (visible-reason assertion).

## Commands run (all observed this session)

- `npm run build` (`tsc --noEmit && vite build`) — exit 0.
- `npm run test` — 8 files, 35 tests, all pass (validation incl. the
  `has3DEvidence` matrix, negotiation, coordinates, EPSG:4326/3857
  transforms, interaction reducer + JSON round-trip, clip state,
  local-frame math, registry integrity, SSR shell composition).
- `npm run test:browser` equivalent — 8 specs, all pass, executed the
  same way: stock `dist/` build served on container port 5210 inside the
  pinned `mcr.microsoft.com/playwright:v1.64.1` container (same Playwright
  1.64.1, same specs, same assertions), `MUSE_NO_SERVER=1` with the
  container-local `http.server`. Server killed and container removed after
  the run; `docker ps` shows no surviving run container.
- Full `npm run verify` was not runnable verbatim on this host: the macOS
  sandbox kills every browser process at spawn, so `test:browser` ran in
  the pinned container as above. On a normal host, `npm run verify` works
  as documented.
- Registry validation: `node` JSON parse of both live registries plus the
  proposal, with every `verified_fixture_ids` entry resolved to a real
  fixture layer — pass.
- `grep` clean-room probe over `src/` — no `ui-v2`, CDN script, or
  `tile.openstreetmap.org` references in application code.

## Browser states inspected, tier (a): visually inspected 1280×720 @1x

- `screenshots/01-landing.png` — neutral world map with live OpenFreeMap
  tiles, scale bar, Home/projection controls, basemap attribution, empty
  layer/legend/selection/limitation states, greyed 3D and Split modes with
  the visible reason line, empty-state capability note. Zero uncaught app
  errors (tier-b assertion).
- `screenshots/02-fallback.png` — bundled graticule fallback with the
  remote-basemap-unavailable notice, live controls, fallback attribution.
- `screenshots/03-fixture-map.png` — synthetic scene framed by
  fit-to-study: points/paths layers, legend, unknown-capability and
  skipped-feature (`syn-broken`) limitations, dateline path rendered as
  the default full-width chord with the camera held honestly on the world
  view.
- `screenshots/04-3d-enabled.png` — enabled 3D workspace: four evidence
  columns at true heights, selected-marker highlight (Synthetic mast A),
  provenance caption with anchor and units, operable Reset view,
  vertical-exaggeration slider, clip controls, orientation cue.
- `screenshots/05-narrative.png` — narrative insight with `syn-a` /
  `syn-dateline` evidence chips; visible disabled-reason line (flat
  fixture leaves 3D/Split disabled).
- `screenshots/06-import-error.png` — outdated-schema error naming
  expected `muse-scene-package.v1` vs found `muse-scene-package.v0`,
  with map geometry and layers preserved.

## Tier (b): assertion-verified without a retained frame

- Split-mode coordinated layout (3D enabled path renders in split via the
  same `ThreeViewport`; no retained split screenshot in the six-slot
  budget).
- Globe projection render (Mercator→globe→Mercator toggle asserted via
  the projection control and debug handle; no retained globe screenshot).
- Compact 390×700 layout and visible keyboard focus on essential
  non-canvas controls (asserted by `resilience.spec.ts`, including a
  focused-control assertion; no retained compact screenshot).
- Fit-to-selection after-state and layer-toggle after-state (asserted by
  `fixture.spec.ts` enablement/coordination checks).
- Zero uncaught console errors and disposal across mount/unmount cycles
  (asserted by `pageerror`/console-error listeners in all 8 specs, not
  provable from static frames).
- Orbit interaction itself (Reset control operated in-browser; continuous
  drag motion is not capturable in one static frame).

## Remaining limitations

- Promotion is pending: live registries are empty and the staged delta is
  validated but unpromoted. Final acceptance requires the owner finalizer
  to promote `proposed-registry.json` and re-validate.
- `npm run verify` verbatim needs a host that can launch browsers; the
  suite itself is environment-independent and ran green in the pinned
  container.
- Residual risks: clean-room compliance rests partly on attestation plus
  the `grep` probe; compact-viewport and keyboard evidence is
  assertion-based; 3D height truthfulness from one oblique frame rests on
  the provenance caption plus the `featureCount`/selection debug-handle
  assertions, not on measured pixels.

## Registry statement

Live `capability-registry.json` and `package-registry.json` are unchanged
and empty (writer stage never edits live registries).
`proposed-registry.json` stages three browser-verified generic
capabilities (`point-observation`, `path`, `vertical-profile`) with
`verified_fixture_ids` resolving to real layers in
`tests/fixtures/synthetic-package.json` and
`tests/fixtures/synthetic-3d-package.json`, plus an empty package registry
(no study package accepted at bootstrap). Promotion validation (JSON
parse, schema versions, fixture-layer cross-reference resolution) passes;
nothing was promoted and nothing was rolled back because the writer stage
performs no live writes.
