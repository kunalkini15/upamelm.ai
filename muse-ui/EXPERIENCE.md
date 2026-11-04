# Experience Foundation Contract

This contract governs the one-time experience-foundation run. It sits above
`BASELINE.md`: the baseline remains the correctness and architecture contract;
this file establishes the reusable visual and interaction language. The run is
not a redesign for one report and must not inspect or imitate another UI.

## Product thesis

Build a **scientific spatial observatory**, not a generic admin dashboard. The
map or 3D scene is the primary working surface. Interface chrome is quiet,
compact, contextual, and progressively disclosed. The experience should feel
precise, cinematic, and trustworthy without obscuring evidence or inventing
scientific detail.

The experience must support two rhythms:

- **Orient:** understand the study, coverage, major evidence, uncertainty, and
  the recommended first view within seconds.
- **Investigate:** move coherently between map, 3D, section, narrative, report,
  layers, provenance, and a selected feature without losing context.

## Design-language deliverables

The run must research and commit `DESIGN_SYSTEM.md` plus reusable implementation
tokens/components. The document must define:

- semantic color roles for canvas, surfaces, text, borders, focus, selection,
  status, uncertainty, and scientific categorical/sequential data;
- a restrained type scale, UI and data/measurement font stacks, numeric
  treatment, spacing grid, radii, elevation, icon rules, and motion durations;
- light-on-dark spatial-canvas treatment and readable elevated surfaces without
  indiscriminate transparency or decorative gradients;
- component states for buttons, segmented modes, icon controls, tooltips,
  panels, drawers, layer rows, legends, chips, notices, sliders, and empty/error
  states;
- visualization rules for line weight, marker scale, surface opacity, depth
  cues, uncertainty, selection, hover, disabled content, and provenance;
- desktop and compact composition rules.

Use local/system assets only. Do not depend on CDN fonts, proprietary tokens, or
remote design systems. Icons must come from one coherent accessible icon set;
do not use emoji as interface icons. Color may reinforce meaning but cannot be
its only carrier.

## Composition

- Give the active map or 3D scene at least 65% of the desktop viewport.
- Replace permanent instructional copy with concise status, tooltips, contextual
  disclosure, or a help surface. Keep limitations discoverable but not dominant.
- Use a compact top command bar for identity, active package, primary modes, and
  global actions. Avoid browser-default controls.
- Make layers/navigation collapsible and the evidence inspector contextual.
  Empty panels must not reserve large blank regions.
- Preserve spatial context when opening narrative or report content through a
  drawer, split composition, or an equally coherent transition.
- The landing state must show one intentional global view, not repeated world
  copies, duplicated attribution, horizontal overflow, or clipped controls.
- At compact widths, prioritize the scene and primary action; move secondary
  panels into drawers/sheets without hiding access to evidence.

## Spatial and 3D experience

The map and separate Three.js viewport remain coordinated through the shared
scene and interaction models. Research the best truthful representation before
choosing a technique.

- Provide intentional overview and detail camera presets, predictable reset,
  useful transitions, orientation, scale/depth context, and selection focus.
- Show subsurface relationships with appropriate surfaces, intervals, profiles,
  clipping/section tools, transparency, lighting, and depth cues. Do not make
  every object glossy, glowing, or translucent.
- Keep vertical exaggeration explicit and user-controlled. Never imply that
  exaggerated or schematic geometry is measured at that scale.
- Use atmosphere, terrain, shadows, fog, labels, and animation only when they
  improve orientation or hierarchy. Honor `prefers-reduced-motion`.
- Preserve provenance and uncertainty near the evidence they qualify.
- Dispose obsolete Three.js resources and keep interaction responsive through
  repeated mode and package changes.

## Synthetic showcase

Create one deterministic, clearly fictional fixture solely to design and test
the experience. It must never become a package-registry entry or the default
landing dataset. Use generic scientific concepts rather than a real place or
report and include enough coherent evidence to exercise:

- a study boundary and geographic context;
- several boreholes or observations with vertical intervals;
- multiple subsurface horizons/surfaces or an equivalent volumetric relation;
- a water level or other meaningful reference surface;
- a section/transect and at least one uncertainty or limitation;
- linked narrative findings, report content, provenance, and selections.

The fixture may justify reusable schema/capability extensions. Extend the typed
scene model and registry only when the concepts cannot be represented truthfully
through composition. Never add fixture names to production branches.

## Research and decision record

Before implementation, write `verification/<run-id>/research.md` using primary
technical or design sources. Cover geospatial hierarchy, scientific color and
accessibility, map/globe/terrain possibilities, 3D scene/camera/lighting/depth
cues, motion, and responsive spatial interfaces. Translate research into a
small set of explicit decisions; do not collect links without applying them.

## Acceptance views

At `1280x720` and device scale factor `1`, visually inspect and retain no more
than six representative views:

1. quiet global landing/import state;
2. synthetic study map overview;
3. selected evidence with contextual inspector and legend;
4. composed 3D overview with controls and provenance visible;
5. clipped/section or equivalent investigative 3D state;
6. narrative or report state coordinated with spatial selection.

Also exercise a compact viewport and keyboard path in browser assertions. A
successful run has no accidental page scrollbar in the spatial modes, no
overlap or clipping, no default form styling, no console errors, no illegible
text, and no screenshot whose central visualization is visually subordinate to
navigation or instructions.

Visual acceptance is comparative, not ceremonial: the critic must identify the
three weakest aspects of the first implementation even if it otherwise passes,
and the writer must improve or explicitly disposition them before final review.
