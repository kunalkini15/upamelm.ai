# Critique — refine-scene-first-design-foundation (read-only visual + interaction critic)

verdict: **FAILED — one material defect** (`passed=false`). Do not promote this
run on the current `dist`/source without dispositioning M-1 below.

- Requirement: `muse-ui/requirements/scene-first-design-foundation.md`
  (scene-first landing + reusable component foundation).
- Scope respected by this critic: read-only. No source, registry, or
  screenshot file was edited; no evolve handoff is needed (no new evidence
  semantics or registry capability is required — M-1 is a presentation/rendering
  defect inside frozen boundaries).
- This critique re-captures every state fresh; retained writer screenshots are
  referenced only as comparison baselines, not as evidence.

## Method and evidence tiers

- Engine: repo-pinned Playwright image `mcr.microsoft.com/playwright:v1.64.1-noble`
  (per `lessons/shared.md`; host has no browsers), `dist/` served on
  `127.0.0.1:5210` via `python3 -m http.server`, viewport `1280x720` dsf `1`
  plus `390x700`, fixture `verification/experience-foundation/showcase-package.json`
  loaded through the real file input. All container processes were `--rm`;
  nothing persists.
- Tier 1 (visually inspected pixels): 14 fresh screenshots in this run
  (`critic-01`…`critic-14`, kept outside the deliverable as scratch), the six
  retained `screenshots/after-*` shots, both `diagnostics/` bitmaps, and all
  three `before/` bitmaps.
- Tier 2 (automated assertions I ran): per-state stage fraction / bar height /
  overflow, disabled-reason keyboard disclosure label, focus-ring computed
  style, trigger visibility + 44px touch target at compact, `elementFromPoint`
  stacking at the defect location, canvas rects, zero `pageerror` / app
  `console.error` across four independent browser sessions.
- Tier 3 (not claimed): writer's `report.md` command log (build/unit/browser
  green) is recorded intent, not re-verified here beyond the read-only browser
  pass; real-GPU rendering of M-1 is unverified (see caveat).

## Before/after comparison (requirement completion evidence)

- `before-01` → `after-01` (and my fresh `critic-01`): the 280px rail, the
  `mode-3d-reason` strip, rail empty-state sentences, and footer sentence are
  gone; measured stage fraction `0.928` at a 52px bar with zero overflow. The
  map is unambiguously the dominant surface. The core requirement is met.
- Import (`after-02` = my fresh capture byte-similar), spatial popover
  (`after-03`), inspector (`after-04` ≈ my `critic-09`), 3D (`after-05` ≈ my
  `critic-11`), compact (`after-06`) all share one component language:
  opaque cards, Lucide icons, tabular numerals, consistent radii/elevation.
- No regression in honest states: import-failure keeps the last valid package
  with an actionable schema error; basemap-failure shows the graticule +
  notice with usable controls and attribution.
- Keyboard: Tab from `mode-map` reaches `mode-3d-reason-disclosure` with
  `aria-label="Needs located 3D evidence — …"`; Home shows a visible
  `3px solid rgb(0,95,204)` outline (pixels confirmed). Reduced-motion
  fit-study cuts instantly with no error. Registries byte-equal to
  `registry-snapshot/` (re-checked). Narrative/report drawers keep the map
  mounted with coordinated selection chips.

## M-1 (material): compact viewport + open inspector blacks out the top ~40% of the map canvas

- Observed (deterministic, 5/5 runs): at `390x700` with the evidence inspector
  open, the map canvas paints solid black across its full width over roughly
  the top third (`critic-13`, `iso-B`, `iso-D`, `heal-A`, `ord-compact-select-in-place`
  — identical band geometry every time, still present after a 5s settle).
- `elementFromPoint(195,250)` returns the `maplibregl-canvas` itself (rect
  `390x588` at `y=112`); i.e. the canvas paints black, not an overlay.
- Controlled elimination, all in the same container/GPU path:
  compact + world view, no inspector → clean (`iso-A`, live tiles);
  compact + fitted study at zoom ~9.5, no inspector → clean (`ctl-*`,
  toolbar and attribution fully usable);
  compact + inspector (selection framed, zoom 8–9.5) → black band,
  whether selected before or after the resize, via narrative chips or
  cross-mode travel. Inspector presence is the trigger; zoom, resize order,
  and split history are ruled out.
- Why material: this is a required acceptance state (requirement state 7 +
  compact acceptance: inspector becomes a bottom sheet, scene stays first, no
  blank panels). The writer's `after-06` never covers compact+inspector, and no
  spec exercises it — the state is untested and visibly broken.
- Caveat for the writer: all pixels are SwiftShader software-GL in the pinned
  container (the same renderer that produced the retained after-shots). Confirm
  on real hardware; if hardware is clean, gate this state in `scene-first.spec.ts`
  (compact + inspector open) so the divergence is caught either way. Suspect
  area, not diagnosis: map resize/repaint interplay with the overlaying
  inspector card at ≤900px (`MapView` resize handling vs `.inspector-card`
  bottom-sheet rules in `styles.css`).
- Companion (weak, not material): at compact the open inspector sheet covers
  the map toolbar — a `btn-fit-study` click is intercepted by the inspector
  card (`...subtree intercepts pointer events`). Users must close the sheet to
  reach Fit/Home/Legend. Standard sheet behavior, but it compounds M-1: in the
  broken state the recovery tools are one extra tap away.

## Three weakest remaining aspects (improvements required even were M-1 clean)

- W-1 — Inspector follows selection into 3D/split and occludes evidence chrome.
  `critic-11`: the map inspector card covers the right "Depths (validated m)"
  rail (`Horizon B (depth 160 m)` row half-hidden); `critic-12`/`iso-C`: it
  overlaps the 3D-evidence legend card. Depth facts survive (duplicated in the
  left legend), but the flagship state looks unmanaged. Improvement: when
  entering `3d`/`split` with an active selection, collapse the inspector to a
  dismissible selection chip (or dock it to the free corner) instead of
  floating it over the depth rail.
- W-2 — Split mode invents a second toolbar language. The map toolbar that is
  a horizontal bottom row everywhere else stacks into a tall vertical column of
  full-width buttons in the split pane (`critic-12`, `iso-C`), and the studybar
  wraps to two lines. Improvement: keep the horizontal toolbar row with
  horizontal scroll or icon compaction in narrow panes so split uses the same
  toolbar component arrangement as every other mode.
- W-3 — Loading veil has no bounded wait. `App.tsx` shows `Loading world…` as a
  full-stage `z-index: 20` veil until `mapBooted`; `MapView` fetches the remote
  style with no timeout/AbortController, and the fallback only triggers on
  fetch *failure* or tile errors ≥400 — a hanging style fetch blocks the whole
  stage indefinitely (my first container run caught the veil + an unpainted
  map mid-hang). Improvement: bound the style fetch (≈8–10s), then fall back
  to the bundled style + notice exactly as the failure path does.

## Explicit non-findings (checked, clean)

- Stage dominance `0.928` desktop in closed / import-open / spatial-open /
  populated / inspector-open states (deltas < 0.02 — overlays, not
  displacement); bar 52px; `scrollW == innerW` everywhere; compact fraction
  `0.84` with all four secondary triggers reachable and 44×44px targets.
- Zero uncaught `pageerror` / app `console.error` in all four fresh sessions.
- Exaggeration label (`1.0× schematic — not measured scale`), orientation cue,
  depth rail, provenance/uncertainty adjacency, attribution, and honest
  disabled-3D/Split reasons all visible with chrome up.
