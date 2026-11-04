# Run report — experience-foundation

## Input and scope

Writer-stage implementation of `plan.md` (decisions D1–D6 from `research.md`)
under the blocking constraints of `design-review.md` (items 1–7). Sole
application writer; no other application inspected for reference. Fictional
showcase only; no live registry edited.

## Capability decision

**Extended** — three generic capabilities staged (never document-specific):

- `subsurface-surface`: validated polygon footprint at a validated depth.
- `reference-surface`: validated `referenceKind: "water-level"` plane + clip preset.
- `cross-section`: validated transect line extruded to its declared base depth.

Composition-failure record (design-review item 3): `point-observation`
renders points, not areal extents; `vertical-profile` renders columns at
point locations; `path` renders map lines with no vertical reading. No
composition of the three can express a bounded depth surface, a datum plane
with a clip preset, or a section curtain without inventing interpolation or
continuity. The extension keys on geometry kind + validated
`elevationMeters`/`dipDegrees`/`uncertaintyMeters` + capability/layer role
only; `grep -rn "demo-" src/` returns zero hits.

## Schema changes (generic, unit-bearing, provenance-carrying)

`SceneGeometry` gains `uncertaintyMeters` (≥0 finite) and `dipDegrees`
([0,90] finite); `SceneFeature` gains `uncertaintyEastingMinMeters`;
`SceneLayer` gains `referenceKind: "water-level" | null`. Non-finite or
out-of-range vertical values quarantine the feature, never the package
(`extensions.test.ts`). Points reject dip. The adapter records one
deterministic transform-provenance entry (`sourceCrs → targetFrame`);
`referenceWaterElevation()` resolves the clip preset generically.

## Showcase fixture

`showcase-package.json` (deterministic, unregistered, non-default, client
import only): open-ocean coordinates near 48°S 38°W (chosen to avoid real
settlements, labelled fictional); boundary polygon; 6 boreholes (−95…−300 m);
horizons at −80/−160/−260 m ordered and non-crossing, every borehole depth
consistent with the horizons it penetrates; water level at −15 m; transect
with −260 m section base; ±4 m on horizon C bounded east of 600 m local
easting (rendered only there); dip schematic-only; 2 findings + 1 limitation
+ 2 report sections. Validates cleanly: 12 features, bounds set,
`has3DEvidence` true.

## Research decisions applied (design-review items 2, 6)

Primary sources with versions (no skill-citation hand-waving): MapLibre GL JS
5.x API (`setProjection`, data-driven `match` paint, controls); Three.js r170
docs/source (`WebGLRenderer`, `ShapeGeometry` winding, `localClippingEnabled`,
per-object `dispose()`); WCAG 2.2 (1.4.3/1.4.11 contrast, 2.3.3 motion);
Okabe–Ito via Crameri et al. color guidance; Machado et al. (2009) CVD
matrices for the simulation check only. Terrain/gloss/bloom refused; dip
never becomes geometry; exaggeration defaults to truthful 1×.

## Design-review items closed

1. Exact hex tokens in `DESIGN_SYSTEM.md` + `tokens.ts`; unit gates:
   text ≥4.5:1 (7 pairs), focus/markers/cats ≥3:1 (min cat `#0072B2` 3.57:1),
   CVD bound (≤3 confusable pairs/deficiency; label+dash+shape channels
   asserted distinct). Measured values in §1–§3 of the doc.
2. Fixture contract above; horizons ordered/non-crossing, borehole/horizon
   consistency machine-checked; uncertainty easting-bound rendered only in
   bound; datum+units in the inspector.
3. Composition-failure record above + in `proposed-registry.json`.
4. Measurable gates in `experience.spec.ts`: stage fraction ≥0.65 by bounding
   box; `scrollWidth ≤ innerWidth` in spatial + compact modes; console +
   `pageerror` silence every test; contrast from computed values; reduced
   motion asserted via `cameraDuration` unit tests + emulated run;
   `drawCalls` in (0, 500) from the renderer handle; `xf-01…xf-06` at
   1280×720 dsf1 + 390×700 compact + Tab-walk keyboard path.
5. `DESIGN_SYSTEM.md` §5 states table; 44px compact targets; disabled states
   pair 55% opacity with full-contrast reason lines; focus order
   command bar → canvas toolbar → inspector.
6. Audit trail rewritten to primary sources (above).
7. Chrome budget enforced by the ≥0.65 stage assertion and per-capture
   inspection; tour is single user-initiated affordance, no autoplay.

## Commands run (all from `muse-ui/`)

- `npx tsc --noEmit` — clean.
- `npx vitest run` — 10 files, 44 tests pass.
- `npm run build` — clean (chunk-size warning only).
- `npx playwright test` (full suite) — initially failed locally: macOS
  terminates the bundled Chromium at launch (`SIGTRAP`,
  `MachPortRendezvousServer` permission denied). Per `lessons/shared.md`,
  ran once locally then switched to the repo-pinned image
  `mcr.microsoft.com/playwright:v1.64.1-noble` against the built app:
  **15/15 pass**, `failedTests: []`.
- Server detail: `npm run preview` blocks the container hostname
  (vite `preview.allowedHosts` 403 for `host.docker.internal`, no CLI
  override), so the container suite ran against `python3 -m http.server
  5210 --directory dist` serving byte-identical build output. No config was
  changed for this. Port 5210 held for the whole run; the server was
  terminated before handoff (no surviving processes).

## Browser states inspected (all retained, all visually reviewed)

`verification/experience-foundation/screenshots/`, 1280×720 dsf1:

- `xf-01-landing.png` — quiet global landing, one world view.
- `xf-02-map-overview.png` — framed study, tour → "Open 3D overview".
- `xf-03-selected.png` — BH-03 selected; inspector (300 m below datum,
  ±2 m, EPSG:4326 provenance, linked findings) + legend, no overlaps.
- `xf-04-3d-overview.png` — 6 columns + 4 planes + 1 section, matte,
  provenance caption, orientation cue; uncertainty band reads as hatching.
- `xf-05-section-clipped.png` — clip-at-water-level (−15 m) checked,
  exaggeration 2× labelled schematic.
- `xf-06-narrative.png` — report drawer over a still-mounted map, shared
  selection (`demo-bh-03` active in report + side panel).

Compact 390×700 + keyboard Tab-walk + emulated reduced motion asserted in
the suite (no retained bitmap: six-image budget).

## Critic — three weakest aspects (dispositioned)

1. Floating chrome overlapped canvas controls (toolbar/scale,
   legend/nav, inspector/nav, toolbar/provenance). **Fixed**: scale → bottom
   right, legend docks left below the study card, inspector clears the nav
   stack, 3D toolbar flows under the provenance caption. Re-ran green and
   re-inspected every capture.
2. True-scale 1× default reads almost flat at basin aspect (37 km × 300 m).
   **Accepted as honest**: inventing relief is forbidden; the labelled
   exaggeration control is the investigation path. Recorded as a limitation.
3. `reference` tag wrapped mid-word in the narrow legend. **Fixed** with
   `white-space: nowrap`; suite re-run, captures regenerated and reinspected.

## Evidence tiers

- Observed: 44 unit tests; 15/15 container browser tests; six inspected
  bitmaps; `drawCalls` in (0,500) from `__museThree`; stage fraction ≥0.65
  measured; zero `demo-` hits in `src/`; package registry still
  `{"packages":[]}`; capability registry still 3 live entries.
- Not claimed: GPU-identical pixels across hosts (functional assertions
  only); scientific validity of the fixture (explicitly fictional).

## Defects fixed during the run

Duplicate `legend-row-*` testids (rail copy vs dock); ShapeGeometry Z-mirror
(negated local Z before rotation); plane deselect stranding highlight
(original colors restored); 3D fallback for legacy lines (preserves the
verified 4-column `synthetic-3d` contract); non-finite elevations now
quarantine the feature.

## Critique response (writer fix-up, verification id experience-foundation)

Every material defect was fixed; all three weakest aspects were improved. No
new capability was needed: every fix composes existing selection, framing,
and clipping behavior, so `proposed-registry.json` is unchanged (3 staged
capabilities, 0 packages; live registries untouched and still passing
post-change validation by inspection of `git diff`).

1. **Split-mode toolbar collisions (material).** The canvas toolbar shared
   the bottom row with the MapLibre scale pill and the auto-expanded
   attribution pill in narrow panes. Fixed: in split panes the toolbar is a
   left-edge vertical strip lifted one row (`bottom: 40px`), so it never
   shares the bottom row (`styles.css`, `.splitpane .maptoolbar`). Verified
   by rect-intersection probes in the container browser: toolbar-vs-scale
   and toolbar-vs-attribution both non-overlapping; before the fix both
   overlapped. Probe captures were written to the untracked `test-results/`
   scratch directory, visually inspected, then deleted; the six retained
   views are `xf-01…xf-06`.
2. **Fallback banner vs toolbar (material).** The fallback notice sat behind
   the bottom toolbar. Fixed: it now docks as a top-center chip
   (`.mapwrap > .notice.basemap-chip`). Probe: banner/toolbar rects no
   longer intersect; the resilience suite still asserts the notice text and
   fallback style name.
3. **Selection without spatial focus (weakest 1).** The inspector now offers
   an explicit `Show on map` action (`btn-show-on-map`) that frames the
   selected feature through the shared map handle (new `fitSelection` on
   `__museMap`; point selections ease to a contextual zoom 8 instead of
   diving to max zoom, which `fitBounds` would do for zero-area bounds).
   `xf-03` clicks it: BH-03 centers with study context visible instead of
   the previous world-extent backdrop.
4. **Flat, occluded 3D overview + illegible clip (weakest 2).** Applied all
   three suggested moves: lower oblique home preset, subsurface-plane
   opacity 0.5 → 0.42, outlined water-level plane, and an explicit clip
   status line (`clip-status`: "showing at or below −15 m · 6 of 6
   column(s) cross the plane"). Additionally fixed the actual occlusion
   root cause: marker/column radii were capped at 8 m, sub-pixel on a
   44 km basin; radii now scale with the evidence extent (still schematic
   per the provenance caption) so the six columns read as markers against
   the planes. `xf-04`/`xf-05` re-inspected.
5. **Legend shown twice (minor).** Removed the rail legend section; the map
   legend dock is now the single legend (specs assert `legend-row-*` on the
   dock). No information lost: layer toggles remain in the rail.
6. **Compact stacking (minor).** The stage now leads (`order: -1`) with a
   62vh floor, so the primary scene is above secondary panels; the study
   summary becomes a top chip and the toolbar uses the split-pane strip, so
   the previously observed toolbar/scale/attribution collisions at 390 px
   probe clean (both pairs non-overlapping, no horizontal overflow).
7. **Transect overshoot (minor, not reproduced — evidence-based
   disposition).** Fixture coordinates place the transect strictly inside
   the boundary (transect lon −38.25…−37.75 vs boundary −38.3…−37.7; lat
   −48.12…−47.88 vs −48.18…−47.82), and magnified pixels of `xf-02` show
   the rendered line terminating inside the boundary fill. What it does
   cross — inner horizon/water edges — is the science (the transect spans
   the horizons), not a bug. No change made.

Checks for this fix-up: `npx tsc --noEmit` clean; `npx vitest run`
10 files / 44 pass; `npm run build` clean (chunk-size warning only);
container suite (`mcr.microsoft.com/playwright:v1.64.1-noble` against
`python3 -m http.server 5210 --directory dist`) **18/18 pass** (15
deliverable specs incl. new `btn-show-on-map` and `clip-status`
assertions, plus 3 temporary box-metric probes, since removed); zero
`pageerror`/console application errors; six screenshots regenerated and
visually reinspected; split/fallback/compact probe captures visually
inspected (probes and their captures removed afterwards, none retained).

## Remaining limitations

- True-scale depth is subtle at basin aspect; investigation relies on the
  schematic exaggeration control (labelled). The overlay depth rail and
  evidence legend now carry the depth read at 1×; 95–300 m columns remain
  thin slivers against a 44 km basin until exaggerated — that is the honest
  geometry, not a rendering gap.
- Diverging negative pole is light-surface-only by token rule (2.69:1 on
  canvas, never used there).
- Grid lines are decorative scale context (1.75:1) and never carry meaning.
- Staged registry delta (`proposed-registry.json`) is **not promoted**:
  promotion requires the read-only verifier + finalizer handshake, which is
  outside the writer stage. The package registry is unchanged per contract;
  no new capability was needed — every round-2 fix composes existing
  selection, framing, and clipping behavior.

## Critique response, round 2 (writer fix-up, verification id experience-foundation)

Closed every `final-review.md` must_fix (1–7) with no new capability, so
`proposed-registry.json` is unchanged (3 staged capabilities, 0 packages;
live registries untouched). Source changes: `src/styles.css` (custom
checkbox/range/file-picker/button treatment, 3D legend + depth-rail
overlays, dismissible-strip and wrap rules, split-mode study-bar cap,
compact footer wrap); `src/app/App.tsx` (dismissible single limitation
banner, rail lists remainder only, human labels in selection details,
wrapped package title with tooltip, footer without map-credit duplication,
`featureLabelOf` passed to panels); `src/map/MapView.tsx` (selection
auto-frames the map by default through the shared handle, reduced-motion
aware); `src/three/ThreeViewport.tsx` (data-driven 3D evidence legend +
validated-depth rail, amber clip-datum sheet riding the clip state,
+X east / +Y up / −Z north orientation cue); `src/narrative/panels.tsx`
(chips render human labels via `labelOf`); `src/design` untouched in
tokens; `DESIGN_SYSTEM.md` §5/§6 updated to match. Specs: xf-03/xf-06
assert framed study bounds after narrative/report selection; fixture spec
asserts single-banner + remainder-rail composition; compact test retains
`xf-07-compact.png`, asserts human chips, keyboard reachability, and
reduced-motion operability. `grep -rn "demo-" src/` returns no hits.

Checks for this fix-up: `npx tsc --noEmit` clean; `npx vitest run`
10 files / 44 pass; `npm run build` clean (chunk-size warning only);
container suite (`mcr.microsoft.com/playwright:v1.64.1-noble` against
`python3 -m http.server 5210 --directory dist`) **15/15 pass**; two
temporary box-metric probes (split-pane collisions, 3D overlay collisions)
**2/2 pass**, removed afterwards; seven screenshots regenerated and
visually reinspected (`xf-01…xf-06` at 1280×720 dsf1 plus supplementary
390px `xf-07-compact.png`).

Browser states inspected (all retained, all visually reviewed):

`verification/experience-foundation/screenshots/`, plus previous six:

- `xf-01-landing.png` — quiet global landing, one world view, single map
  attribution, styled import control, custom checkboxes.
- `xf-02-map-overview.png` — framed study, single legend, dismissible
  banner + remainder rail (no repeated sentence).
- `xf-03-selected.png` — BH-03 auto-framed large with study context,
  human inspector + linked-evidence chips.
- `xf-04-3d-overview.png` — labelled legend + depth rail beside the
  composed 3D overview, provenance and orientation cue readable.
- `xf-05-section-clipped.png` — amber clip-datum sheet visible in-image
  with the clip-status line at 2× schematic.
- `xf-06-narrative.png` — report drawer over the framed study map, shared
  human selection active in both surfaces.
- `xf-07-compact.png` (supplementary 390px) — framed study first, strip
  toolbar, no horizontal overflow, footer wrapped.
