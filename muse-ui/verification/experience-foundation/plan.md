# Plan — experience-foundation run

Companion to `research.md` (decisions D1–D6). Read-only plan: no
application source or live registry is changed by this run. The writer
stage implements this plan; the acceptance matrix at the end is the
definition of done.

## 1. Product story

**Muse is a scientific spatial observatory.** A visiting scientist lands
on one intentional global view with a clear empty state ("no package,
here is what this tool does, import to begin"). Within seconds of
loading the synthetic showcase they can answer: what study is this, what
are its major pieces of evidence, where is the uncertainty, and what is
the recommended first view. Deeper investigation — map ↔ 3D ↔ section ↔
narrative ↔ report ↔ provenance for any selected feature — never loses
context: selection is global, the camera presets are predictable, and
provenance travels with the evidence.

Two rhythms, one shell:

- **Orient:** landing → study overview → recommended first view
  (a "Start tour" affordance framing study bounds, then the 3D overview).
- **Investigate:** select any evidence → inspector shows identity,
  measurements, uncertainty, provenance, and linked narrative/report →
  jump to its map, 3D, or section context → clip/exaggerate to test the
  subsurface reading.

Demo arc (≈3 minutes): quiet landing → import showcase → framed study
map → select a borehole → 3D overview with provenance → clip to the
reference water level → follow a finding into the narrative → report
section coordinated back to the same selection.

## 2. Synthetic showcase fixture (deterministic, fictional, unregistered)

Name: `Fictional Meridian Basin — design probe` (working id
`synthetic-showcase:*`; ids use a `demo-` prefix that can never collide
with real evidence). A mid-latitude coastal basin rendered in generic
terms only. It must exercise every EXPERIENCE.md showcase bullet:

- study boundary polygon (`demo-basin-boundary`, region layer);
- 6 boreholes with validated depths in meters (`demo-bh-01…06`,
  point-observation + vertical-profile);
- 3 horizons as validated depth surfaces (`demo-horizon-a/b/c`,
  new `subsurface-surface` capability, flat-shaded planes at measured
  depths — schematic dip only where the package declares dip values);
- 1 reference water level plane (`demo-water-level`, new
  `reference-surface` capability, hatched/transparency treatment);
- 1 transect polyline (`demo-transect-1`, path) with a section view;
- 2 findings + 1 limitation linked to features (narrative), 2 report
  sections, provenance entries, and 1 explicit uncertainty interval on
  `demo-horizon-c` ("±4 m below 600 m easting").

Constraints: never added to `package-registry.json`, never the default
landing dataset, labelled test-only, loaded only through the same
client-side import surface as real packages. No real place names,
coordinates chosen to avoid real settlements.

## 3. Information architecture

Top command bar: identity (Muse mark + module name) · active package
title + validation status · five permanent modes (Map / 3D / Split /
Narrative / Report) as a segmented control · overflow (import, help,
reset). Modes never unmount each other's state; unavailable modes stay
visible, disabled, with the existing honest reason line.

Secondary zones: collapsible layers/navigation rail (left, desktop) →
drawer at compact widths; contextual evidence inspector (right overlay,
only when a selection exists — never a blank column); legend docked to
the map corner; limitations as a dismissible strip + full list in the
inspector; narrative/report open as a right drawer or split that keeps
the map mounted behind. Landing keeps one world-extent map, one import
surface, one orientation hint; no repeated world copies, no duplicated
attribution, no clipped controls.

## 4. Design-language decisions (for `DESIGN_SYSTEM.md`)

Tokens (CSS custom properties on `:root`): canvas/surface/text/muted/
border/focus/selection/status(ok|warn|error)/uncertainty roles;
categorical slots `cat-1…8` in Okabe–Ito order; one sequential ramp
`seq` (batlow-like, dark→light) and one diverging pair `div-neg/div-pos`
(vik-like, midpoint paper). Type: system stack only
(`system-ui, -apple-system, "Segoe UI", sans-serif` + tabular numerals
via `font-variant-numeric: tabular-nums`); scale 12/14/16/20/28px;
measurement readouts always unit-suffixed. Spacing 4px grid, radii
4/6/10, elevation 2 levels (drawer, popover) — no decorative gradients,
no transparency on text surfaces. Motion: 120ms micro / 240ms panel /
500ms camera (0 under reduced motion), `ease-out`. Icons: one coherent
inline-SVG set (-Lucide-style strokes), never emoji. Line weight 2px /
4px selected; markers 6px / 9px selected + white stroke; surface opacity
≤0.5; selection pairs color with size+stroke+label; uncertainty pairs
color with hatch/dash+text; disabled content at 55% opacity plus reason
text.

Light-on-dark 3D treatment: `#101418` canvas (already in use), grid
`#33404d`, evidence `#9fd4ff` default / `#ffb340` selected (existing
hues, kept because they pass 3:1 against the canvas at marker sizes),
provenance caption beneath the canvas, orientation cue always present.

## 5. 2D/3D interaction model

Shared state stays the BASELINE `InteractionState` (select/hover/layers/
mode); no new fields. Camera presets per evidence: Overview (frame
study), Detail (frame selection at closer range), Section (clip to
transect or reference plane), plus Reset/Home. Map: `fitBounds` framing,
globe for orientation, Mercator for measurement, selection enlarges +
recolors, hover cursor + highlight, keyboard-operable toolbar. 3D:
orbit/reset preserved; exaggeration slider labelled "schematic — not
measured scale"; clip plane bound to the reference water level and the
transect ("Clip at water level" one-click preset); horizons as
truthful-depth planes; uncertainty shown as a translucent band around
`demo-horizon-c` with the ± text in the inspector. Narrative/report
chips select the same feature id everywhere. Reduced motion: all camera
durations → 0, crossfade/instant instead of travel (D5).

## 6. Schema and capability implications

Scene model: add optional `dipDegrees`/`uncertaintyMeters` on
`SceneGeometry` (nullable, validated finite) and a `referenceKind`
(`"water-level" | null`) on layers — generic, never fixture-named.
Known capabilities gain two entries: `subsurface-surface` (validated
depth surface → `ThreeViewport:layered-plane` + map footprint outline)
and `reference-surface` (validated reference plane →
`ThreeViewport:reference-plane` + legend entry), plus `cross-section`
(transect line → section ribbon in 3D + map highlight) if it cannot be
composed from `path` + `clip`. Package fixture ids use the `demo-`
prefix and resolve to the showcase fixture layers. Writers stage all of
this in `verification/experience-foundation/proposed-registry.json`;
live registries stay untouched until read-only acceptance + promotion,
and the showcase fixture is never registered.

## 7. Performance limits

Map: one GeoJSON source, ≤4 paint layers, `setData` updates only;
raster-free fallback keeps first paint <2s on broadband, usable without
network. 3D: <500 draw calls for the showcase (6 columns + 4 planes +
grid/axes), geometries/materials tracked in the existing `disposables`
pattern, full disposal on package/mode change (existing test asserts
zero retained `__museThree` handle), pixel ratio capped at 2, no per-frame
allocation. Interaction: selection paint <100ms, camera transitions
≤500ms (0 reduced-motion), no layout thrash (canvas flexes, caption +
toolbar fit 720p — the bootstrap fix stands). Bundle: no CDN imports,
no new runtime dependency without an AGENTS.md-level justification;
design tokens are CSS + inline SVG only.

## 8. Acceptance matrix (every EXPERIENCE.md requirement)

| # | EXPERIENCE.md requirement | Check |
|---|---|---|
| 1 | Scientific spatial observatory; map/3D primary | Spatial views ≥65% desktop viewport in all six captures; no capture dominated by chrome |
| 2 | Orient + Investigate rhythms | "Start tour" affordance → framed study in ≤2 actions; any feature selectable from map, 3D, narrative, report with shared highlight |
| 3 | `DESIGN_SYSTEM.md` + reusable tokens/components | Doc exists covering all §4 roles; tokens as CSS props; one icon set; no CDN fonts |
| 4 | Color roles incl. uncertainty + categorical/sequential | Showcase uses cat/seq/div tokens; selection/uncertainty carry non-color channels; contrast spot-checked |
| 5 | Type/scale, spacing, radii, elevation, icon, motion rules | Type scale + tabular numerals; 4px grid; 2 elevation levels; motion tokens incl. reduced-motion 0 |
| 6 | Light-on-dark canvas, readable surfaces, no indiscriminate transparency | 3D canvas + caption legible; text surfaces opaque; surfaces ≤0.5 opacity |
| 7 | Component states (modes, controls, panels, rows, legend, chips, notices, sliders, empty/error) | Each state visible across the six captures + compact pass; disabled modes show reason |
| 8 | Viz rules: line/marker/surface/depth/selection/hover/disabled/provenance | §4 weights implemented; provenance caption in 3D captures |
| 9 | Desktop + compact composition rules | 1280×720 + 390×700 passes; secondary panels in drawers; no page scroll in spatial modes |
| 10 | Compact top bar; no permanent instructional copy | Bar holds identity/package/modes/actions only; help is a surface, not a paragraph |
| 11 | Collapsible layers, contextual inspector, no blank panels | Inspector mounts only with selection; empty layers state is one line |
| 12 | Narrative/report preserve spatial context | Drawer/split keeps map mounted; selection survives mode switches |
| 13 | Landing: one world view, no repeats/overflow/clipping | Landing capture: single extent, one attribution, all controls visible |
| 14 | Coordinated map + separate Three.js view | Selection syncs map↔3D↔narrative↔report via shared state; renderers independent |
| 15 | Overview/detail presets, reset, orientation, scale/depth context, selection focus | All presets operable in-browser; orientation cue + grid + scale visible in 3D capture |
| 16 | Subsurface surfaces/intervals/profiles/clipping/transparency/lighting/depth; no uniform gloss | Horizons + water level + section rendered matte with depth cues; clip preset works |
| 17 | Explicit user-controlled vertical exaggeration; never implies measured scale | Slider labelled schematic; captures show value; reduced scale never hidden |
| 18 | Atmosphere/terrain/shadows/fog/labels/animation only if orienting; honor reduced motion | None added (D3/D4); reduced-motion test asserts 0-duration cameras |
| 19 | Provenance + uncertainty near evidence | Caption + inspector show anchor/method/units/± text in captures |
| 20 | Dispose obsolete 3D resources; responsive across mode/package changes | Disposal + mount/unmount assertions green; repeated switches error-free |
| 21 | Deterministic fictional fixture; all seven evidence bullets; unregistered, non-default | Fixture validates via adapter; browser import exercised; registry stays empty of it |
| 22 | Schema/capability extensions only for unrepresentable concepts; no fixture names in branches | `subsurface-surface`/`reference-surface` justified by composition failure; `grep` shows no `demo-` in `src/` |
| 23 | research.md from primary sources with applied decisions | This run: `research.md` D1–D6, each with source + application |
| 24 | ≤6 views at 1280×720 dsf1: landing, map overview, selected evidence, 3D overview, clipped section, narrative/report + compact/keyboard in assertions | Six retained captures named `xf-01…xf-06`; compact + keyboard covered by specs |
| 25 | No accidental scrollbar, overlap, clipping, default form styling, console errors, illegible text | Asserted per capture + console/pageerror listeners silent |
| 26 | Critic finds three weakest aspects; writer improves or dispositions before final review | Critic report + dispositions recorded in run `report.md` |
| 27 | All baseline invariants preserved (stack, modes, fallback, adapter, states, commands) | `npm run verify` green; baseline matrix from bootstrap re-passes incl. fallback + honest 3D gating |
