# Muse Design System — Experience Foundation

Reusable visual and interaction language for the scientific spatial
observatory. This document and `src/design/tokens.ts` + `src/styles.css` are
the implementation; the values below are measured, not aspirational. Token
hex values here must match `tokens.ts` exactly — `tokens.test.ts` asserts the
contrast and robustness gates on every run.

## 1. Product roles

| Role | Token | Value | Used for |
|---|---|---|---|
| Canvas (3D + map chrome backdrop) | `--canvas` | `#101418` | Three.js clear color, canvas surfaces |
| Surface | `--surface` | `#FFFFFF` | Text surfaces, toolbar, inspector, drawer |
| Raised surface | `--surface-raised` | `#F4F7F9` | Top bar, side rail, control wells |
| Ink | `--ink` | `#101418` | Body text (18.50:1 on surface) |
| Muted | `--muted` | `#425563` | Secondary text (7.75:1 on surface, 7.20:1 on raised) |
| Line | `--line` | `#8A9BA8` | Borders, dividers (decorative; never the sole carrier) |
| Focus | `--focus` | `#005FCC` | Focus rings, keyboard indicator (5.98:1 vs white; 3.09:1 vs canvas) |
| Accent | `--accent` | `#1D4E75` | Links, active mode, primary actions; white on it 8.75:1 |
| Selection | `--selection` | `#8A4B00` | Selected chips/markers on light surfaces; white on it 6.80:1 |
| Selection mark (canvas) | `--selection-mark` | `#FFB340` | Selected 3D markers (10.37:1 on canvas) |
| Evidence mark (canvas) | `--evidence-mark` | `#9FD4FF` | Default 3D markers (11.75:1 on canvas) |
| OK | `--ok` | `#007A5E` | Success text (5.32:1) |
| Warn | `--warn` on `--warn-bg` | `#8A4B00` on `#FDF3E0` | Limitation strips (6.18:1) |
| Error | `--error` | `#8F1D1D` | Errors (8.89:1) |
| Uncertainty | `--uncertainty` | `#5A3EC0` | Uncertainty text/geometry accents (7.28:1 on surface) |
| Grid (decorative) | `--grid` | `#33404D` | 3D grid/axes (1.75:1 — scale context only, never a carrier) |

Text pairs meet WCAG AA 4.5:1; focus, selection, and canvas markers meet 3:1
at rendered size. Disabled controls render at 55% opacity **plus** a
full-contrast reason line (`mode-3d-reason`, toolbar titles) — opacity never
carries meaning alone.

## 2. Scientific categorical data

Okabe–Ito order, assigned by layer slot (never document identity):

`cat-1 #0072B2` · `cat-2 #E69F00` · `cat-3 #009E73` · `cat-4 #CC79A7` ·
`cat-5 #56B4E9` · `cat-6 #D55E00` · `cat-7 #F0E442` · `cat-8 #999999`

All eight clear 3:1 against the canvas (min `#0072B2` at 3.57:1). Every color
is paired with a non-color channel: legend label + dash pattern (`channels.ts`
`LAYER_DASHES`, eight distinct) and marker shape (`MARKER_SHAPES`, eight
distinct), selection adds size + white stroke. No rainbow gradients. CVD
simulation (Machado 2009, severity 1.0) merges at most three pairs per
deficiency (measured: deutan/protan worst pair `#CC79A7`/`#999999`; tritan
`#0072B2`/`#009E73`) — acceptable only because label + dash + shape always
accompany the color; the unit suite re-checks this bound.

## 3. Sequential / diverging data

- Sequential (depth ramp, light-surface fills): `#0B2135 → #1D4E75 → #2E7CA8 → #88C0E0 → #F2E9C8`.
- Diverging (light surfaces only): `#2166AC → #F7F7F7 → #B2182B`. The negative
  pole `#B2182B` is 2.69:1 on canvas and is therefore never used on dark
  canvas — diverging text/legends render on light surfaces (6.87:1/5.90:1).

## 4. Type, numbers, spacing, elevation, icons, motion

- Font stack: `system-ui, -apple-system, "Segoe UI", sans-serif`; tabular
  numerals everywhere (`font-variant-numeric: tabular-nums` on `body`).
- Scale: 12 (captions/toolbars) / 14 (body) / 16 (section titles) / 20
  (observatory identity). Measurements always carry units (`120 m below
  datum`, `±4 m`, `2.5× schematic`).
- Spacing: 4px grid (`--space-1…4`). Radii 4/6/10. Elevation: two levels —
  inspector/drawer shadow and help popover; no decorative gradients, no
  transparency on text surfaces.
- Icons: one coherent inline-SVG set (`src/design/components.tsx`, Lucide
  strokes, 16px, `currentColor`). Never emoji as interface icons.
- Motion: 120ms micro / 240ms panel / 500ms camera, `ease-out`. Under
  `prefers-reduced-motion`, CSS transitions collapse to 0 and every camera
  call resolves through `cameraDuration()` to an instant cut; selection
  highlight (not travel) carries continuity. No autoplay, parallax, or
  ambient animation.

## 5. Component states

| Component | Default | Hover | Active/selected | Focus-visible | Disabled + reason | Loading | Error |
|---|---|---|---|---|---|---|---|
| Mode segment | surface, ink | raised | accent bg, white ink | 3px focus ring | 55% opacity + `mode-3d-reason` line / title | — | — |
| Toolbar button | surface, 1px line | accent border | raised bg | 3px ring | 55% + `title` reason | — | — |
| Layer row | checkbox + swatch + count | — | checked | ring | basemap locked checked (title explains) | — | — |
| Legend row | swatch/line sample + label + dash + ref tag | — | — | — | — | “World view” line | — |
| Chip | pill, line border | accent border | selection bg, white ink | ring | — | — | — |
| Slider | custom accent track + raised thumb | — | value readout with units | ring | `disabled` + reasoned title (e.g. clip-at-water without reference) | — | — |
| Checkbox | custom 18px accent box + surface check | accent border | checked | ring | 55% + `title` reason | — | — |
| File input | accent-bordered picker button + muted hint | hover shadow | — | ring | — | — | error list under import |
| Inspector | mounts only with selection | — | — | closable, labelled | — | — | — |
| Drawer | right overlay, map mounted behind | — | — | labelled complementary | — | empty-state panel | — |
| Notices | single dismissible warn strip (rail lists only the remainder) | — | — | dismiss button labelled | — | loading veil with status role | `runtime-error` boundary + reset |
| 3D legend | light card, swatch + human label + validated depth | — | — | — | hidden when no planes/sections | — | — |
| Depth rail | dark rail, datum + reference + horizon + deepest rows | — | — | — | hidden only with 3D | — | — |
| Tooltip | `title` on every icon control | — | — | — | reason text in title | — | — |

Empty panels never reserve large blank regions: unselected inspector
unmounts; empty narrative/report render one line; the rail collapses via
`<details>`.

## 6. Visualization rules

- Line weight 2px, 4px selected. Markers 6px, 9px selected + 2px white stroke.
- Surface opacity ≤ 0.5 (horizons 0.5, water 0.25, section 0.35); uncertainty
  band 0.22 wireframe. No emissive, gloss, bloom, fog, or shadows.
- Depth cues: true-height columns, labelled ground grid, RGB axes, orientation
  cue naming +X east / +Y up / −Z north, overlay legend with human labels and
  validated depths, labelled depth rail, amber clip-datum sheet — no terrain
  or DEM (nothing invented).
- Selection pairs color with size + stroke + inspector; uncertainty pairs
  color with wireframe band + `±` text + easting bound; disabled pairs
  opacity with reason text; provenance sits beneath the canvas it qualifies.
- Vertical exaggeration is user-controlled, labelled “schematic — not
  measured scale”, range 1–5×.

## 7. Composition

- Desktop: stage holds ≥65% of the viewport (280px rail + compact 56px bar;
  measured in-browser per acceptance row 1). Map/3D toolbar and legend float
  over canvas corners. Narrative/report open as a right drawer; the map stays
  mounted behind so selection and camera survive mode switches.
- Landing: one world-extent map, one import surface, one orientation hint —
  no repeated world copies, no duplicated attribution, no horizontal
  overflow, no clipped controls.
- Compact (≤900px): single column, scene first; rail stacks below the stage;
  inspector becomes a bottom sheet; drawer becomes a bottom sheet; mode
  segmented control survives; touch targets ≥44px; legend hides behind the
  Legend toggle. No page scrollbar in spatial modes (`height: 100vh`,
  `overflow: hidden` on the shell).

## 8. Component foundation (scene-first run)

Locally owned, shadcn-style: `src/design/ui.tsx` wraps Radix behavior
primitives and Tailwind v4 utilities. Screens compose `Button`,
`ChromeTooltip`, `DisabledReason`, `ChromePopover`, `ChromeDialog`,
`StatusBadge`, `Notice`, `LayerRow`, `EmptyState`, and `MountMotion`;
screens never touch Radix directly (the single exception is the
`Tooltip.Provider` mount in `App.tsx`, which is setup, not a control).
MapLibre and Three.js keep owning their canvases; the foundation owns
surrounding chrome and HTML overlays only — no second interaction-state
system. Installed for this and nothing else: `tailwindcss` +
`@tailwindcss/vite`, `lucide-react`, `motion`,
`@radix-ui/react-{tooltip,popover,dialog}` (exact versions in
`package-lock.json`).

### 8.1 Chrome luminance decision (MF-1)

The dark-observatory reading comes from a dark stage backdrop
(`--canvas` page background) plus one dark chrome element: the 52px
command bar (`--ink` background, white text, 18.5:1). Every text surface
that carries reading content — popovers, dialogs, inspector, drawers,
study bar, legend, depth rail text — stays on the measured light tokens
(`--surface`/`--surface-raised`, ink text ≥7:1) because those pairs
already clear AA and the dark-on-light flips do not. No Tailwind default
palette, radius, shadow, or type scale leaks into chrome: `ui.test.ts`
gates every button variant to theme tokens, and `bg-surface` etc. resolve
only through `@theme`. No gradients, glow, glass, or translucency on
text surfaces; elevation is one shadow level for popovers/dialogs.

### 8.2 Token mapping (semantic → `@theme` → chrome use)

| Semantic token | `@theme` entry | Chrome use (contrast pair) |
|---|---|---|
| `--canvas #101418` | `--color-canvas` | Page/stage backdrop; tooltip bg is `--ink` (white on it 18.5:1) |
| `--surface #FFFFFF` | `--color-surface` | Popover/dialog/inspector/drawer/study-bar/legend surfaces (ink on surface 18.5:1) |
| `--surface-raised #F4F7F9` | `--color-raised` | Dropzone hover, ghost hover, range track (muted on raised 7.2:1) |
| `--ink #101418` | `--color-ink` | Body text; command-bar background (white on ink 18.5:1) |
| `--muted #425563` | `--color-muted` | Secondary text (7.75:1 on surface) |
| `--line #8A9BA8` | `--color-line` | Borders only, never the sole carrier |
| `--focus #005FCC` | `--color-focus` | Focus rings incl. dark bar (3.1:1 vs ink — ring plus label change) |
| `--accent #1D4E75` | `--color-accent` | Active mode fill, primary buttons (white on accent 8.75:1) |
| `--selection #8A4B00` | `--color-selection` | Selected chips on light (white on it 6.8:1) |
| `--ok #007A5E` | `--color-ok` | Ready dot + text |
| `--warn #8A4B00` on `--warn-bg #FDF3E0` | `--color-warn` / `--color-warnbg` | Limitation notices (6.18:1) |
| `--error #8F1D1D` | `--color-error` | Import errors (8.89:1) |
| `--uncertainty #5A3EC0` | `--color-uncertainty` | Uncertainty accents (7.28:1) |
| categorical `--cat-1…8`, sequential `--seq-*` | unchanged CSS vars | Scientific data only — never replaced by component accents |

Selected/focused states never rely on color alone: the active mode adds
bold + underline to the accent fill; disabled controls pair 55% opacity
with a full reason line; selection pairs color with size + stroke +
inspector text; uncertainty pairs color with wireframe + `±` text.

### 8.3 Variants and composition patterns

`buttonClass()` variants: primary (accent fill), secondary (surface,
line border), ghost, destructive (error, fills on hover), icon
(36px, 44px compact). Segmented modes: container + pressed button with
`aria-pressed`. Tooltip: pointer-only enhancement. Popover/dialog:
opaque card/overlay panel. Badge, notice, layer/legend row (swatch or
dash sample + label + reference tag), empty/error one-liners, and the
import trigger (accent label button + `sr-only` file input + filename
readout + `role=alert` error list). Chips (`.chips`/`.chip`) remain the
single shared linked-evidence primitive.

### 8.4 Icons, motion, boundaries

Icons: Lucide React only, 16px, `currentColor`, every icon-only control
carries an accessible name + tooltip; no emoji. Motion: two separate
gates — (1) UI mount/layout transitions (`MountMotion`, 240ms panel /
120ms micro, `MotionConfig reducedMotion="user"` plus the CSS
`prefers-reduced-motion` block) and (2) camera travel through
`cameraDuration()`; neither gate covers the other. No autoplay,
parallax, or ambient animation. Chrome owns command bar, popovers,
dialogs, inspector, drawers, study bar; renderers own canvases,
toolbars directly attached to canvases, legends/depth rails that
qualify evidence, and the shared interaction store.

### 8.5 Per-state stage budgets at 1280×720 dsf 1 (MF-2)

Command bar 52px; stage fraction 0.928 measured in all five desktop
states (closed, import open, spatial open, populated, inspector open —
overlays never shrink the stage, deltas <0.02). 390×700 compact: closed
state ≥0.50 measured; secondary panels become bottom sheets capped at
62% height with the scene peeking above; modes hold one full row;
touch targets ≥44px.

### 8.6 Disabled-reason disclosure (MF-3) and 3D overlay budget (MF-4)

Disabled 3D/Split stay truly disabled inside a focusable wrapper that
carries the reason as `aria-label` plus a persistent `sr-only`
`aria-describedby` node; tooltip is the pointer enhancement, tap focuses
the wrapper on touch. Over the 3D canvas only these may float, all
opaque: study bar (top-left), evidence legend (top-left below it),
depth rail (top-right), inspector (right), canvas toolbars (bottom /
below-caption). Exaggeration labelling, orientation cue, depth context,
and attribution stay visible with all chrome up; DESIGN_SYSTEM §6
visualization gates are unchanged regression gates.
