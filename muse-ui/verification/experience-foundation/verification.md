# Acceptance verification — experience-foundation (read-only verifier)

**Verdict: ACCEPTED.** The run is materially polished, coherent, browser-proven,
and safe to promote. All `BASELINE.md` / `EXPERIENCE.md` gates observed passing;
every critique weakness improved or truthfully dispositioned.

## Commands run (all from `muse-ui/`, this session)

- `npx tsc --noEmit` — clean.
- `npx vitest run` — 10 files, 44/44 pass.
- `npm run build` — clean (chunk-size warning only).
- Container browser suite (`mcr.microsoft.com/playwright:v1.64.1-noble` vs
  `python3 -m http.server 5210 --directory dist`, per `lessons/shared.md`;
  server terminated after the run): **15/15 pass**
  (`experience` 7, `fixture` 3, `landing` 2, `resilience` 2, `three-d` 1),
  zero `pageerror`/console application errors (asserted in `afterEach` of
  every `experience` test; network-tile noise excluded by pattern).
- Three temporary verifier overlap probes (written, run, then deleted —
  no trace left): split-pane toolbar/scale/attribution, fallback
  banner/toolbar, compact toolbar collisions — **3/3 pass**.

## Requirement evidence

- **Six retained views** (`verification/experience-foundation/screenshots/`,
  all 1280x720 PNG, all visually inspected this session): quiet global
  landing with one world view; synthetic map overview; BH-03 selection with
  inspector + single legend; composed 3D overview with provenance and
  orientation cue; clipped section state; narrative/report state with shared
  selection. No accidental page scrollbar (asserted), no overlap/clipping in
  any retained view, stage fraction ≥ 0.65 asserted, no default form styling,
  no console errors, central visualization dominant over chrome.
- **Compact + keyboard:** 390x700 asserted (all five modes reachable,
  no horizontal overflow); Tab-walk reaches an operable control; reduced
  motion keeps `fit-study` operable.
- **Registries:** `package-registry.json` still `{"packages": []}`;
  live `capability-registry.json` still 3 verified entries, untouched;
  `proposed-registry.json` stages exactly 3 generic capabilities
  (`subsurface-surface`, `reference-surface`, `cross-section`), 0 packages,
  each with a `composition_failure` record. `package.json` / lockfile / `.nvmrc`
  unmodified.
- **No fixture-name production branches:** `grep -rn "demo-" src/` returns
  no hits; `demo-*` ids exist only in the unregistered showcase fixture and
  test selectors. Fixture is fictional, open-ocean, client-import only.
- **Report present:** `report.md` distinguishes observed results
  (unit/browser counts, inspected bitmaps, `drawCalls` bounds, stage fraction)
  from limitations (true-scale subtlety, light-only diverging pole,
  decorative grid, unpromoted staged delta).

## Critique weakest-three disposition (verified, not taken on faith)

1. Narrow-canvas collisions → fixed (split-pane vertical toolbar strip,
   top-center fallback chip). Re-probed live in the container browser:
   no rect intersections in split, fallback, or compact states.
2. Selection without spatial focus → `Show on map` action framing the
   selection via the shared map handle (spec-asserted; xf-03 shows BH-03
   framed with study context).
3. Flat/occluded 3D + illegible clip → oblique home preset, plane opacity
   0.42, outlined water plane, explicit `clip-status` line naming datum and
   intersection count, extent-scaled schematic markers. xf-04/xf-05
   reinspected: clip payoff now reads in text and controls.
   Minor items: single legend, stage-first compact stacking, transect
   "overshoot" disposition confirmed against fixture coordinates
   (transect strictly inside boundary; crossings are inner evidence edges).

## Writer fix-up, round 2 — final-review must_fix (all 7 closed)

Commands (all from `muse-ui/`, this session): `npx tsc --noEmit` clean;
`npx vitest run` 10 files, 44/44 pass; `npm run build` clean (chunk-size
warning only); container suite (`mcr.microsoft.com/playwright:v1.64.1-noble`
vs `python3 -m http.server 5210 --directory dist`, server terminated after):
**15/15 pass** (experience 7 incl. compact/keyboard/reduced-motion, fixture 3,
landing 2, resilience 2, three-d 1), zero `pageerror`/console application
errors. Two temporary collision probes (split-pane toolbar/scale/attribution +
3D-legend/studybar/depth, 3D overlay collisions) — **2/2 pass**, written, run,
deleted, no trace left.

1. **Default-component chrome / duplicated attribution / empty rail** → custom
   checkbox (accent box + surface check), custom range track + raised thumb,
   accent file-picker button, raised semibold buttons; footer no longer repeats
   map credit (map attribution control is the single credit); package title
   wraps with full-text tooltip instead of truncating. Landing rail keeps its
   contracted empty states (landing spec) in compact single-line form.
   Re-inspected in xf-01.
2. **Selection spatial focus** → selecting from any surface auto-frames the map
   (shared map handle, reduced-motion aware); `Show on map` remains as an
   explicit reframe. Spec-asserted: xf-03 and xf-06 evaluate `__museMap`
   center inside the study bounds after narrative/report selection, no manual
   step. Re-inspected in xf-03/xf-06.
3. **3D read** → overlay evidence legend naming every horizon/datum/curtain
   with validated depth (data-driven labels, no fixture names in source),
   labelled validated-depth rail (datum / water / horizons / deepest), amber
   clip-datum sheet at the active clip height, orientation cue naming
   +X east / +Y up / −Z north. Clip payoff now reads in-image (xf-05 amber
   sheet + status line), not caption-only. Re-inspected in xf-04/xf-05.
4. **Report continuity** → auto-frame on selection plus the map staying mounted
   behind drawers keeps the framed study and visible selection in xf-06
   (spec asserts framed bounds + visible canvas + active human chip).
   Re-inspected in xf-06.
5. **Limitation boilerplate / truncation / clipping** → single dismissible
   banner (rail lists only the remainder; no sentence twice, spec-asserted);
   full title in wrap + tooltip and study bar; 3D captions wrap with padding.
   Re-inspected in xf-02/xf-04.
6. **Raw `demo-*` ids** → narrative/report chips, selection details, and the
   inspector Feature row render human labels; `grep -rn "demo-" src/`
   returns no hits; testids unchanged. Re-inspected in xf-03/xf-06.
7. **Compact/keyboard evidence** → supplementary `xf-07-compact.png` (390px,
   framed study first, strip toolbar, no horizontal overflow) plus
   human-chip and reduced-motion assertions in the same test.
   Re-inspected xf-07.

## Remaining limitations (accepted as honest, none verdict-blocking)

- True-scale 1× reads almost flat at basin aspect; the labelled schematic
  exaggeration control is the investigation path.
- xf-06 report state shows shared selection correctly but leaves the map at
  world extent; framing is one explicit action away (`Fit study` /
  `Show on map`). Worth considering auto-framing on the demo path, but not
  a contract violation.
- Promotion of the staged registry delta requires the writer→finalizer
  handshake outside this read-only stage; live registries correctly untouched.
