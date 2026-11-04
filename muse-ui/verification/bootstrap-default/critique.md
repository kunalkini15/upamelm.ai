# Read-only visual and interaction critique — run `bootstrap-default`

Scope: neutral foundation only. No study package, no document-specific
rendering, no `ui-v2` contact (this critic never listed, opened, or imported
anything under `ui-v2`; no application source was edited).

## How it was verified

- `npm run build` — exit 0 (`tsc --noEmit && vite build`).
- `npm test` — 7 files, 31 tests, all pass.
- `npm run test:browser` — 7/7 specs pass. The macOS sandbox kills every
  browser process at spawn on this host (Chromium headless shell, system
  Chrome, and Firefox all die with SIGABRT/SIGTRAP; unsandboxed execution is
  denied), so the suite was executed from the stock `dist/` build inside the
  pinned `mcr.microsoft.com/playwright:v1.64.1` container serving `dist/` over
  HTTP — same Playwright version (1.64.1), same specs, same assertions.
- One supplementary probe spec (kept outside the repo, deleted after the run)
  exercised zoom/Home reset values, globe projection state, keyboard-driven
  focus, narrative/report empty states, and console silence; it passed.
- All six retained screenshots were visually inspected (this session), plus
  two throwaway probe captures (globe, compact focus).

## Item-by-item findings

- Bird's-eye global map: PASS. Landing shows the world extent with live
  OpenFreeMap tiles, visible attribution (`OpenFreeMap © OpenMapTiles Data
  from OpenStreetMap`), scale bar, and zoom/compass controls
  (`screenshots/01-landing.png`).
- World navigation: PASS. Zoom-in control raised zoom above the initial 1.5
  (read from the `__museMap` debug handle); Home reset returned zoom to
  1.5 ± 0.05.
- Projection/reset controls: PASS. Mercator→globe→Mercator toggle works; the
  globe render was visually inspected (intact sphere, labels, attribution);
  the debug handle reports the switched projection honestly.
- Basemap fallback: PASS. With remote hosts blocked, the bundled graticule
  style takes over with the honest notice, fallback attribution, and usable
  controls (`screenshots/02-fallback.png`).
- Empty layer/selection states: PASS. "No study layers yet", "Nothing to
  show yet", "Nothing selected", empty legend, and the limitations ledger are
  all legible on the neutral landing.
- Narrative/report empty states: PASS. Both modes are reachable with the
  honest empty panels; with the synthetic fixture loaded, narrative evidence
  chips coordinate selection into the side panel and map
  (`screenshots/05-narrative.png`, `04-fixture-selection.png`).
- Invalid local-package validation: PASS. An outdated-schema file produces
  an actionable error naming the expected vs. found schema version while the
  last valid scene stays active (`screenshots/06-import-error.png`).
- Fixture-driven map behavior: PASS. Layer toggling, fit-to-study reframe,
  per-feature quarantine of the malformed `syn-broken` point, unknown
  `syn-mystery` capability listed-but-not-rendered, and antimeridian handling
  (world view held, no fabricated camera jump) all behave
  (`screenshots/03-fixture-map.png`). Minor observation, not a defect:
  MapLibre draws the dateline-spanning test line as a full-width horizontal
  chord with a visible break — default renderer behavior for such
  coordinates, camera handling itself is honest.
- Keyboard focus: PASS. A real keyboard Tab lands on the first mode button
  with a clearly visible 3px accent outline (visually confirmed on the
  390×700 compact capture); `:focus-visible` styling is correct. Note: the
  committed compact test asserts focus only by assertion; no compact
  screenshot is retained in this directory.
- Console output: PASS. Zero uncaught application errors across all desktop
  and compact runs (pageerror + console-error listeners, tile/network noise
  excluded).
- Initialized 3D workspace: FAIL — cannot be exercised. `validatePackage`
  hardcodes `has3DEvidence: false`, so no package, valid or otherwise, can
  ever enable the `ThreeViewport` enabled path in this build. Orbit, reset,
  orientation cue, scale/depth context, clipping, and the labelled vertical
  exaggeration control exist in code (plus unit-tested clip state), but there
  is no browser evidence that the enabled workspace initializes, renders, or
  disposes. The run report openly defers this (rows D3/D5) to the first
  evidence-bearing evolution, and the disabled state itself is honest — but
  against the BASELINE invariant ("a meaningful 3D state works when evidence
  permits") the enabled path is currently unreachable by construction, not
  merely unevidenced.

## Non-blocking notes

- `src/package-adapter/validate.ts` contains a dead `void errors;`
  statement; harmless.
- No `tile.openstreetmap.org` calls, CDN scripts, or `dangerouslySetInnerHTML`
  observed in the inspected sources.

## Verdict

`passed=false`. Everything reachable in a package-less bootstrap verifies
cleanly, but the initialized-3D-workspace item cannot be exercised: the
enabled Three.js path is unreachable in this build and has no browser
evidence.
