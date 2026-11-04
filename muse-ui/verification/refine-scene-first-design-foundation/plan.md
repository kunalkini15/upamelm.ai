# Plan — refine-scene-first-design-foundation

Read-only planning stage. No application source was edited; both live
registries are frozen and snapshotted under
`registry-snapshot/` for later equality checks.

## 1. User outcome

On first load the user meets an intentional spatial application: the world
map is the unmistakable primary surface below a compact command bar,
navigation is immediately understandable, and secondary information
(layers, legend, import, limitations, help) stays quiet until summoned.
The interface feels precise, contemporary, and authored — one coherent
component language across map, 3D, split, narrative, report, and inspector
states — instead of a browser-default scaffold beside which the map sits.

A reusable, accessible component foundation (locally owned, shadcn-style
components on Radix behavior primitives, Lucide icons, Tailwind v4 tokens,
Motion only where continuity benefits) lets later Muse runs extend every
surface without recreating controls or visual rules.

## 2. Current defects evidenced in pixels

All three `before/` screenshots were captured from the production build
(`dist` served on port 5207) at 1280×720 dsf 1 (desktop) and 390×700
(compact), and visually inspected.

- **D1 — Permanently open 280 px left rail dominates the empty landing**
  (`before-01-landing.png`). The rail occupies ~22% of the viewport width
  with Layers ("No study layers yet."), Selection ("Nothing selected."),
  Limitations, and a full Import package dropzone. The map reads as
  content beside a scaffold, not the working surface. Requirement:
  remove the rail from the empty landing; expose these functions through
  on-demand controls.
- **D2 — Persistent instructional/empty-state copy competes with the map**
  (`before-01`). The `mode-3d-reason` strip under the command bar, the
  rail's three empty-state sentences, and the footer sentence ("Validated
  local packages only — …") repeat what tooltips/disabled reasons and one
  help surface should carry. Requirement: short status signals, tooltips,
  disabled-reason disclosure, one help surface.
- **D3 — Individually styled chrome, browser-default forms**
  (`before-01`, `before-02-populated.png`). Native file input ("Choose
  File / No file chosen"), native checkboxes, bespoke `.btn`/`.mode` CSS
  do not read as one interaction system. The `Limitations` count, the
  amber `limit-strip` banner plus rail duplication handling, and the
  floating study bar + legend dock + bottom toolbar crowd the populated
  map (`before-02`).
- **D4 — Compact layout covers the scene by default**
  (`before-03-compact.png`). At 390 px the mode bar wraps to two rows,
  the reason strip persists, and the map toolbar renders as a tall
  left-edge strip floating over the map while the map itself appears
  laterally clipped. Requirement: scene first; secondary controls move
  into sheets/drawers that do not cover the visualization by default.
- **D5 — No shared component language for overlays.** Inspector,
  narrative/report drawers, help panel, legend dock, and study bar each
  carry bespoke CSS (`.inspector`, `.drawer`, `.helppanel`,
  `.maplegend-dock`, `.studybar`). The writer must converge them on sheet
  / drawer / inspector / popover / tooltip primitives.

No console page errors were observed during capture (`pageerrors: []`).

## 3. Scope boundaries

### In scope

- Scene-first landing: full-width stage below a compact command bar; rail
  removed from the empty state; layers/legend/import/limitations/help as
  on-demand popovers, sheets, drawers, or panels.
- Component foundation: Tailwind CSS v4 token layer; locally owned
  shadcn-style components in the module; Radix primitives only for used
  compound controls; Lucide React icons; Motion for React only for
  mount/layout/view-continuity transitions; `prefers-reduced-motion`
  preserved via the existing `cameraDuration()` mechanism.
- Variant system for primary/secondary/ghost/destructive/icon controls,
  segmented view navigation, tooltip + disabled-reason disclosure,
  popover/menu, sheet/drawer + inspector, layer/legend row, status badge,
  notice, empty/error state, import trigger + validated file interaction.
- `DESIGN_SYSTEM.md` update: adopted component architecture, token
  mapping (`--canvas/surface/ink/muted/line/focus/accent/selection/
  uncertainty/status`, categorical Okabe–Ito and sequential scales
  unchanged in meaning), variants, icon rules, motion rules, and the
  chrome-vs-renderer boundary.
- All eight required browser states (§7) plus keyboard, focus,
  reduced-motion, import-failure, and basemap-failure paths.

### Out of scope (frozen)

- `capability-registry.json`, `package-registry.json`, the accepted
  package schema, package-adapter semantics, upstream study packages:
  zero changes. Equality with `registry-snapshot/` must hold at the end.
- No new capability, no geometry/renderer-truthfulness change, no Three.js
  framework migration, no scientific-color replacement with generic
  accents, no remote fonts/tokens/CDN/runtime component generator.
- No other application inspected for reference (clean-room rule holds).
- No `demo-`/fixture-specific branches; everything stays generic.

`blocked=false`: no new evidence semantics or registry capability is
required. If the writer finds otherwise, it must stop and return
`blocked=true` with an evolve handoff instead of approximating.

## 4. Applied research decisions

Primary sources only; the writer re-verifies exact versions at install.

- **R1 — Tailwind CSS v4 via the Vite plugin.** Tailwind v4 is a Vite
  plugin (`@tailwindcss/vite`) plus `@import "tailwindcss"` in CSS, with
  design tokens declared in CSS via `@theme`
  ([Using Vite](https://tailwindcss.com/docs/installation/using-vite)).
  Decision: adopt v4 as the token/utility layer and map every existing
  semantic token (`--canvas`, `--surface-raised`, `--ink`, `--focus`,
  `--selection-mark`, categorical/sequential scales) into `@theme` so
  `tokens.ts` remains the asserted source of truth and `tokens.test.ts`
  keeps gating contrast. Keep the existing `styles.css` canvas/renderer
  rules; utilities own chrome only.
- **R2 — shadcn-style means owned code, not a dependency.** shadcn/ui
  components are copy-into-the-repo primitives over Radix behavior plus
  utility classes — no runtime theme package. Decision: vendor only the
  used patterns (button variants, tooltip, popover, sheet/drawer,
  segmented control, slider/switch as needed) into `src/design/` as
  readable, editable components; never a prebuilt theme import.
- **R3 — Radix Primitives for compound behavior.** Dialog, Popover,
  Tooltip, Tabs, Collapsible, Slider primitives supply focus management,
  keyboard interaction, and ARIA wiring the custom CSS lacks
  (cf. current native inputs in D3). Decision: install only the
  primitives the variant set actually uses; wrap them in the local
  variant API so screens never touch Radix directly.
- **R4 — Lucide React single icon family.** Replaces the bespoke inline
  `Icon` path set in `src/design/components.tsx` with one coherent
  stroke set (16 px, `currentColor`), keeping accessible names on every
  icon-only control. No emoji icons.
- **R5 — Motion for React sparingly.** Mount/layout/view-continuity
  transitions only (drawer/sheet mount, inspector mount, mode switch);
  CSS transitions for hover/focus micro-feedback; everything collapses
  under `prefers-reduced-motion` through the existing reduced-motion
  path. No autoplay, parallax, or ambient animation.
- **R6 — MapLibre/Three.js boundary.** The component foundation owns
  surrounding chrome and HTML overlays; renderer internals
  (`MapView.tsx`, `ThreeViewport.tsx`, `localFrame.ts`) and the shared
  interaction store are untouched except for the props/slots new chrome
  needs. No second interaction-state system.

## 5. Smallest coherent implementation strategy

One writer, presentation/interaction only, in this order:

1. **Dependencies.** Install Tailwind v4 (+ `@tailwindcss/vite`, wire
   into `vite.config.ts`), `lucide-react`, used `@radix-ui/*`
   primitives, `motion` — only what the variant set consumes. Confirm
   `npm run build`, React/Vite/TS/Node compat, and lockfile update.
2. **Tokens.** Map `tokens.ts` semantics into Tailwind `@theme`;
   keep hex values identical; keep `tokens.test.ts` green (extend to
   cover mapped utilities if cheap).
3. **Primitives.** Build `src/design/` variants: button (primary,
   secondary, ghost, destructive, icon), segmented modes, tooltip +
   disabled-reason, popover/menu, sheet/drawer, inspector surface,
   layer/legend row, status badge, notice, empty/error, import trigger.
4. **Shell recomposition (`App.tsx` only).** Compact command bar
   (identity, package status when meaningful, primary modes, global
   actions; icons with names where clearer, not icon-everything);
   remove the empty-state rail; move layers/legend/import/limitations/
   help to on-demand surfaces; keep unavailable modes visible with
   reason disclosure that needs no permanent strip; preserve drawer
   behavior that keeps the map mounted.
5. **Overlays.** Re-seat inspector, study summary, legend, 3D toolbar
   caption flow, and help onto the new primitives; fix compact so the
   stage leads and sheets never cover the scene by default.
6. **Docs + checks.** Update `DESIGN_SYSTEM.md` (§architecture, tokens,
   variants, icons, motion, boundaries); run `npm run build`,
   `npm run test`, full `npm run test:browser`; regenerate after/ shots;
   assert both registries byte-equal to `registry-snapshot/`.

## 6. Affected states and regressions

- Empty landing, import surface open/closed + validation failure,
  layers/legend surface open/closed, populated map overview, selected
  feature + inspector, 3D overview, split, narrative/report drawers
  (map stays mounted, selection coordinated), compact layout,
  keyboard-only walk, visible focus, reduced motion, basemap failure
  fallback, unlocated/unsupported honest states, runtime-error boundary.
- Regression nets: existing unit suites (`tokens`, interaction,
  package-adapter, capabilities, local frame/clip); browser specs
  (`landing`, `experience`, `fixture`, `resilience`, `three-d`),
  especially the ≥0.65 stage-fraction, no-horizontal-overflow, console
  silence, and 44 px compact-target gates. Disabled 3D/split must keep
  honest reasons; attribution must stay visible; no spatial-mode page
  scrollbar.

## 7. Acceptance criteria

### Desktop (1280×720, dsf 1)

- Map is the dominant surface below a one-row command bar; no open rail
  on the empty landing; no persistent instructional sentences.
- Import, layers/legend, limitations, help each open on demand and close
  back to a clean scene; disabled modes explain themselves in place.
- Populated map, selected-feature inspector, and 3D/split share one
  component language; spatial context survives selection and mode
  switches; provenance/uncertainty stay beside what they qualify.
- Keyboard: every essential control reachable with a visible focus ring
  and accessible name; import errors actionable; basemap failure leaves
  the usable fallback style; zero uncaught console errors.

### Compact (≤900 px, check 390×700)

- Single column, scene first with a real floor (≥~60vh); rail content
  stacks below; inspector/drawer become bottom sheets; segmented modes
  survive on one row; touch targets ≥44 px; legend behind its toggle;
  no horizontal overflow; no page scrollbar in spatial modes; toolbar
  never floats over the canvas by default.

### Evidence

- Before/after pair at 1280×720 proving map dominance and rail/copy
  removal; per-state after-shots; `DESIGN_SYSTEM.md` records
  architecture, token mapping, variants, icon/motion rules, and
  chrome/renderer boundaries; source shows reused local components, no
  repeated one-off controls; build + unit + browser green; registries
  unchanged; no schema/adapter edits.

## 8. Screenshot plan (writer stage, ≤6 retained + before/after)

Reuse is forbidden for evidence: re-capture everything after the change.

1. `after-01-landing` ↔ `before-01-landing` (the comparison pair).
2. Import surface open on the empty landing.
3. Layers/legend surface open over the map (map not displaced).
4. Populated map with selected feature + contextual inspector.
5. 3D or split state (command bar + overlays not obstructing).
6. Compact layout with sheets closed (plus keyboard/focus spot check;
   reduced-motion, import-failure, and basemap-failure asserted in
   specs, bitmaps only if they reveal something new).

## Appendix — run provenance

- Baseline bitmaps: `before/before-01-landing.png`,
  `before/before-02-populated.png` (synthetic unit-test fixture
  `tests/fixtures/synthetic-package.json` loaded via the real file
  input; 3 features / 2 layers confirmed on screen),
  `before/before-03-compact.png`. Capture: production `dist` served
  with `python3 -m http.server` on port 5207; Playwright Chromium
  headless; zero page errors on the landing capture.
- Registry snapshots: `registry-snapshot/capability-registry.json`,
  `registry-snapshot/package-registry.json` (exact copies).
- Configured Playwright suite could not run on this host
  (`vite preview` binds a host the specs' `127.0.0.1:5210` base URL
  refuses: `ERR_CONNECTION_REFUSED`); per `lessons/shared.md` the
  writer must run the suite once locally and, if the host browser
  path fails, use the repo-pinned Playwright image
  (`mcr.microsoft.com/playwright:v1.64.1-noble`, present on this
  host) against the built app, recording image, port, result, and
  cleanup. Baseline captures here used host Chromium only for
  pixel evidence, never as a substitute for the suite.
