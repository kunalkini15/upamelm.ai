# Scene-first design foundation

## User outcome

On first load, the user should encounter an intentional spatial application:
the world map is the unmistakable primary surface, navigation is immediately
understandable, and secondary information stays quiet until it is relevant.
The interface should feel precise, contemporary, and visually authored rather
than like a browser-default scaffold or a conventional administration
dashboard.

Establish a reusable, accessible component foundation that later Muse runs can
extend consistently across map, 3D, split, narrative, report, and evidence
inspection experiences without recreating controls or visual rules each time.

## Current problem

The current landing state is functional but visually dominated by persistent
empty-state copy, a permanently open left rail, verbose status messaging, and
control chrome. Several controls still feel individually styled rather than
members of one coherent interaction system. The map consequently reads as
content placed beside an application scaffold instead of the application's
working surface.

The module also relies mainly on custom React components and CSS. That makes
visual consistency, accessible compound interactions, and efficient future
agent-authored extension harder than necessary.

## Required experience

### Scene-first landing

- Make the map occupy nearly all useful space below a compact command bar. The
  active spatial canvas must dominate the initial visual hierarchy.
- Remove the permanently open left navigation/utility rail from the empty
  landing state. Layers, legend, package import, limitations, help, and other
  secondary functions must remain available through concise contextual
  controls, popovers, sheets, drawers, or panels that open on demand.
- Replace persistent instructional sentences and redundant empty-state text
  with short status signals, useful disabled-state explanations, tooltips, and
  one discoverable help surface. Do not hide genuine limitations.
- Keep the top command bar compact. It should contain only product identity,
  package status when meaningful, primary view modes, and genuinely global
  actions. Use icons with accessible names where a familiar symbol is clearer
  than text; do not make every action icon-only.
- Unavailable modes may remain visible, but their disabled state and reason
  must be understandable without occupying a permanent announcement strip.
- Avoid large blank panels, duplicated controls, browser-default form styling,
  repeated world copies, accidental page scrolling, and visually heavy borders.

### Reusable component foundation

Adopt the following composable design foundation for application chrome:

- Tailwind CSS v4 as the styling and token utility layer;
- locally owned shadcn/ui-style components rather than a remote runtime theme;
- Radix Primitives for accessible behavior in compound controls such as
  dialogs, popovers, tooltips, tabs, sheets, menus, sliders, and collapsibles;
- Lucide React as the single interface icon family;
- Motion for React only for meaningful state, panel, selection, and mode
  transitions that materially improve continuity.

Install only the packages and primitives actually used by this requirement.
Components must live in the module and remain directly readable and editable by
future Muse runs. Do not import a prebuilt visual theme, add CDN assets, or make
the application look like a stock component-library demonstration.

Integrate the new foundation with the existing semantic scientific tokens and
`DESIGN_SYSTEM.md`. Preserve or deliberately migrate the existing meanings for
canvas, surfaces, text, focus, selection, uncertainty, status, and scientific
data channels; do not replace scientific visualization colors with generic
component accent colors. Establish reusable variants and composition patterns
for at least:

- primary, secondary, ghost, destructive, and icon controls;
- segmented view navigation;
- tooltip and disabled-reason disclosure;
- popover or compact menu;
- sheet/drawer and contextual inspector surface;
- layer/legend row, status badge, notice, and empty/error state;
- package-import trigger and validated local-file interaction.

MapLibre and Three.js remain responsible for their visualization canvases.
The component foundation owns surrounding chrome and HTML overlays; it must not
replace renderer logic or create a second interaction-state system.

### Visual and motion language

- Use a restrained dark spatial-observatory language with strong foreground
  contrast and calm elevated surfaces. Avoid indiscriminate glow, glass effects,
  gradients, transparency, and neon decoration.
- Preserve clear hierarchy between global navigation, spatial tools,
  contextual evidence, and supporting status. Selected and focused states must
  be unmistakable without relying on color alone.
- Use one coherent spacing, radius, elevation, typography, and icon scale.
- Prefer CSS transitions for simple feedback. Use Motion only where mounting,
  layout change, or view continuity benefits from it, and honor
  `prefers-reduced-motion`.
- The result must be generic: no component, label, branch, or theme decision may
  depend on a particular report, location, document, or fictional fixture.

## Important states

Muse must inspect these states in a real browser:

1. Desktop global landing with no package loaded and all secondary surfaces
   closed.
2. Desktop landing with the package-import surface open.
3. Desktop landing with layers/legend or the equivalent spatial-tools surface
   open, proving that it does not permanently displace the map.
4. A fixture-backed map overview with available modes and populated controls.
5. A selected feature with its contextual inspector open and spatial context
   preserved.
6. A meaningful 3D or split state to confirm the new command bar and overlays
   do not subordinate or obstruct the renderer.
7. Compact layout with secondary controls moved into accessible sheets or
   drawers.
8. Keyboard-only navigation, visible focus, disabled-reason disclosure,
   reduced-motion behavior, import validation failure, and basemap failure.

## Constraints

- Preserve every invariant in `BASELINE.md` and `EXPERIENCE.md`.
- Do not inspect or derive implementation from another application.
- Do not change package schemas, adapter semantics, capability registration,
  either live registry, scientific facts, geometry, or renderer truthfulness.
- Do not introduce remote fonts, private tokens, proprietary UI services, CDN
  libraries, or a dependency on a component generator at runtime.
- Keep MapLibre attribution visible and all essential controls keyboard
  operable with accessible names.
- The application must remain usable when the remote basemap fails and when no
  package is loaded.
- Do not refactor direct Three.js rendering into a different renderer framework
  merely to satisfy this visual requirement.
- Keep dependencies purposeful, tree-shakable where applicable, locked in
  `package-lock.json`, and compatible with the repository's supported React,
  Vite, TypeScript, and Node versions.

## Completion evidence

- A before/after comparison at `1280x720` shows that the initial map is the
  dominant surface and that persistent nonessential text and the open left rail
  no longer compete with it.
- The empty landing, opened import surface, opened spatial-tools surface,
  populated map, selected-feature inspector, and 3D/split state are each
  visibly coherent and use the same component language.
- The compact viewport provides access to the same essential functions without
  covering the entire active visualization by default.
- `DESIGN_SYSTEM.md` records the adopted component architecture, token mapping,
  variants, icon rules, motion rules, and boundaries between application chrome
  and visualization renderers.
- Source inspection demonstrates locally owned reusable components based on the
  agreed foundation; application screens do not contain repeated one-off
  button, panel, tooltip, or dialog implementations.
- Browser verification demonstrates keyboard operation, visible focus,
  accessible names, reduced motion, actionable import errors, honest disabled
  states, basemap fallback, no accidental spatial-mode page scrollbar, no
  obstructed attribution, and no uncaught console errors.
- Standard build, unit, and browser checks pass, both registries remain
  unchanged, and no package/schema semantics are modified.
