# Critique — experience-foundation (fresh read-only review)

## Method

Acted as a fresh product, cartographic, and 3D-interaction critic. Read
`BASELINE.md`, `EXPERIENCE.md`, `AGENTS.md`, `WORKFLOW.md`, and
`lessons/shared.md` completely; loaded the project `adaptive-visualization`
skill; did not inspect any other application. Verified the writer-stage build
in a real browser: production `dist/` (rebuilt clean: `tsc` + `vite`) served
over HTTP and driven with the repository-pinned Playwright image
`mcr.microsoft.com/playwright:v1.64.1-noble` (local macOS browsers are killed
at launch, per `lessons/shared.md`). Viewport `1280x720` dsf `1`, plus a
`390x700` compact pass. Every retained writer screenshot (`xf-01`–`xf-06`)
was visually inspected, plus fresh captures of split, compact, and
basemap-fallback states.

## Functional results (all observed in the container browser)

- `experience.spec.ts` 7/7, `landing.spec.ts` 2/2, `resilience.spec.ts` 2/2:
  pass with zero `pageerror`/console application errors in every test.
- Temporary critic probes (removed after the run): malformed JSON import
  preserves the last valid package (`Fictional Meridian Basin` stays active);
  projection mercator→globe→mercator works; split mounts map + 3D together;
  three full mode cycles keep `drawCalls` in (0, 500); compact has no
  horizontal overflow; `btn-home` receives visible keyboard focus; reduced
  motion keeps `fit-study` operable. All passed.
- Unit suite: 10 files, 44/44 pass. Build: clean (chunk-size warning only).
- Remote-basemap block (`tiles.openfreemap.org` aborted): bundled neutral
  fallback takes over, controls and attribution stay usable.

## Verdict: FAILED (passed = false)

Two material visual defects, both instances of controls colliding at the
`1280x720` acceptance viewport (EXPERIENCE.md requires "no overlap or
clipping"):

1. **Split mode map pane:** the bottom canvas toolbar collides with the
   scale pill and the attribution line — the `Legend` button is partly
   covered by the `2000 km` pill and attribution text runs through the
   toolbar row (`/tmp/critic/c-split.png`, evidence outside the deliverable).
   The pane is too narrow for the full-width toolbar composition.
2. **Fallback notice vs toolbar:** the "bundled neutral fallback" banner
   sits behind the same bottom toolbar, so part of its text is hidden behind
   the buttons (`/tmp/critic/c-fallback.png`).

Both are real overlaps a demonstrator would hit, not probe artifacts: the
toolbar composition assumes full-stage width and breaks in any narrowed
canvas (split pane, banner-docked map).

## Minor defects and weaknesses (not verdict-driving)

- **Selection does not move the camera.** In `xf-03` and `xf-06` the
  inspector/report correctly show the selected evidence (BH-03, Horizon C),
  but the map stays at world extent with no selected marker visible. Shared
  selection state is correct; spatial focus is missing.
- **Legend is shown twice at once** in map mode: the floating legend card
  over the canvas duplicates the rail legend section below Layers.
- **Transect overshoot** in `xf-02`: the diagonal transect line exits the
  study-boundary rectangle at both ends. If the endpoints are inside the
  boundary, the rendering should clip at the footprint.
- **Clip/exaggeration illegible:** `xf-04` vs `xf-05` are nearly identical;
  neither the water-level clip nor the 2× exaggeration reads in the still,
  and the six borehole columns are occluded under the opaque planes from the
  default camera preset.
- **Compact stacking:** at `390x700` all secondary panels stack above the
  canvas, pushing the primary scene below the fold instead of moving into
  drawers/sheets as the compact composition rule requires. No horizontal
  overflow, but the scene is not prioritized.

## Three weakest aspects + concrete improvements

1. **Narrow-canvas control collisions (split toolbar, fallback banner).**
   Improvement: give the canvas toolbar a narrow-pane variant — allow
   horizontal wrap into two rows or collapse trailing actions into an
   overflow menu below ~600 px pane width; move scale + attribution into a
   dedicated non-overlapping corner dock; render the fallback banner as a
   top-overlay chip instead of a bottom strip sharing the toolbar row.
2. **Selection without spatial focus (map-to-narrative continuity).**
   Improvement: when a selection arrives from narrative/report (or any
   surface) and its geometry is outside the current map frustum, ease the
   camera to the selection (instant jump under `prefers-reduced-motion`) —
   or, more conservatively, show an inline "Show on map" action in the
   inspector that performs the same framing.
3. **Flat, occluded 3D overview with an illegible clip state.**
   Improvement: ship a more oblique default camera preset so columns read
   against the planes; render borehole markers depth-test-relaxed or lift
   plane opacity slightly where columns penetrate; add an explicit clip
   indicator — outline the water-level plane and add a status line such as
   "clipped above −15 m · 2 of 6 columns intersect the plane" — so the
   investigative action has a visible payoff.

## Evidence tiers

- Observed: container suite results above; six inspected writer bitmaps;
  three inspected critic captures (split/compact/fallback, in `/tmp/critic`,
  not retained in the deliverable); 44 unit tests; clean rebuild.
- Not claimed: GPU-identical pixels across hosts; scientific validity of the
  explicitly fictional fixture.
