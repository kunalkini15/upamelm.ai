# Research — experience-foundation run

Scope: design and visualization research only. No application source was
edited and no registry was touched. Sources are primary technical
documentation and peer-reviewed or standards-track design guidance, applied
to the current `muse-ui` implementation (MapLibre GL JS 5.24.0, Three.js
0.170.0, React 18.3.1, Proj4js 2.22.0, Vite 7.3.7, Node 22).

Read with `plan.md` in the same directory. Human-curated guidance in
`muse-ui/lessons/shared.md` was honored: claims below separate inspected
evidence (this repo's source, fetched docs) from design assertions; the
bootstrap lesson that fixtures stay labelled and unregistered is carried
into the showcase design.

## 1. Geospatial hierarchy (map as primary surface)

- **Finding.** Standard cartographic practice orders the reading as
  overview → detail: an intentional initial extent, then layer hierarchy
  (basemap < study geometry < selection highlight), then scale/attribution
  chrome. Bertin's visual variables rank position and size above color for
  quantitative emphasis; color reinforces identity but must never be the
  only carrier.
- **Sources.** MapLibre GL JS examples and style specification
  (`maplibre.org/maplibre-gl-js/docs`); current `MapView.tsx` layer order
  (fill → outline → line → circle) already encodes this stacking.
- **Applied decision D1.** Keep the map the dominant surface (≥65% of
  desktop viewport per `EXPERIENCE.md`), with one intentional overview
  extent per package, selection rendered by size + outline in addition to
  color (the existing `circle-radius`/`line-width` `case` expressions are
  the mechanism), and scale + attribution always visible.

## 2. Scientific color and accessibility

- **Finding.** Perceptually uniform, color-vision-deficiency-safe maps are
  the scientific default: Crameri's families (`batlow` sequential;
  `vik`/`roma` diverging, centered on a meaningful midpoint) and
  ColorBrewer sequential/diverging schemes; the rainbow/jet family is
  discredited (Crameri et al., *Nature Communications* 11:5444, 2020).
  Categorical data use Okabe–Ito in published order
  (`#E69F00, #56B4E9, #009E73, #F0E442, #0072B2, #D55E00, #CC79A7,
  #000000`), distinguishable under deuteranopia, protanopia, and
  tritanopia and largely separable by lightness. WCAG 2.2 requires 4.5:1
  text contrast (AA) and 3:1 for non-text graphics; status/selection must
  pair color with shape, label, or pattern.
- **Sources.** Crameri Scientific Colour Maps v8 (Zenodo
  doi:10.5281/zenodo.8409685); Okabe–Ito (2008) via Wong 2011 *Nature
  Methods*; WCAG 2.2 contrast and non-text-contrast criteria; Hu Lab and
  TopoToolbox guidance corroborating `batlow`/`vik` defaults.
- **Applied decision D2.** Design tokens use a small categorical set drawn
  from Okabe–Ito order for layer identity (≤8 layers), a single sequential
  ramp for ordered evidence (height/depth), and one diverging treatment
  reserved for signed deviation from a reference surface. Every
  color-coded state also carries a non-color channel: selection = larger
  marker + white stroke + label; uncertainty = dashed/hatched treatment +
  text; status = icon + text. Light-on-dark 3D canvas colors are checked
  against 3:1 non-text contrast at the rendered marker size.

## 3. Map engine: globe, projection, terrain, camera, layers

- **Finding.** MapLibre GL JS ≥5 exposes `map.setProjection({type:
  'globe' | 'mercator' | 'vertical-perspective'})` (also declarable in the
  style) and raises terrain via `setTerrain()` from a raster-DEM source,
  with `setSky()` for atmosphere above the horizon. Terrain without a DEM
  source is not possible; every DEM option needs tiles. The existing code
  already toggles globe/Mercator with a `try/catch` honesty guard and
  probes the style URL before use, falling back to a bundled neutral
  graticule style.
- **Sources.** Official MapLibre GL JS docs and globe examples
  (fetched `add-a-simple-custom-layer-on-a-globe`; API classes
  `GlobeControl`, `RasterDEMTileSource`, `MapProjectionEvent`
  corroborate); inspected `MapView.tsx` + `fallbackStyle.ts`.
- **Applied decision D3.** Keep the Mercator/globe toggle as the only
  projection control; do **not** add terrain/sky/atmosphere because they
  require remote DEM tiles, which conflicts with the token-free offline
  baseline. Globe remains the "orientation" preset (world extent on
  landing); Mercator remains the measurement preset. Camera moves use
  `easeTo`/`fitBounds` with duration, forced to 0 under reduced motion
  (see §6). Antimeridian behavior stays as-is: hold the world view rather
  than fabricating a center.

## 4. Three.js scene: color, lighting, camera, depth, disposal

- **Finding.** Since r152 Three.js runs a linear workflow:
  `THREE.ColorManagement` on, working space linear-sRGB,
  `renderer.outputColorSpace = SRGBColorSpace` default; color textures get
  `SRGBColorSpace`, data textures stay linear. One ambient + one
  directional light is the recommended minimum for legible matte depth;
  ACES filmic tone mapping is for HDR scenes and is unnecessary here.
  GPU resources are **not** garbage-collected: geometries, materials,
  textures, controls, and the renderer itself need explicit `dispose()`;
  nothing should allocate inside the frame loop. `OrbitControls.update()`
  per frame plus `requestAnimationFrame` (or `setAnimationLoop`) is the
  standard loop; `localClippingEnabled` + `THREE.Plane` is the supported
  clipping path.
- **Sources.** Three.js color-management reference (Web Coding Center,
  corroborating r152+ behavior); three.js skill references corroborating
  dispose-everything and no-allocation-in-loop rules; inspected
  `ThreeViewport.tsx` (already disposes geometries/materials/controls/
  renderer, uses `localClippingEnabled`, ambient + directional lights).
- **Applied decision D4.** Keep the two-light matte setup; do not add
  gloss, bloom, fog, or shadows (unverifiable depth cues that imply
  unmeasured material). Depth comes from true-height columns, the labelled
  ground grid, axes, and the orientation cue — all already present.
  Surfaces for horizons (plan §5) use flat-shaded, double-sided planes at
  validated depths with opacity ≤0.5 and a wireframe/edge option, never
  emissive or translucent-everything. The existing disposal path is the
  pattern for every new 3D object.

## 5. Motion

- **Finding.** WCAG 2.3.3 (Animation from Interactions, AAA, widely
  adopted as policy) requires motion triggered by interaction to be
  dispensable; vestibular triggers are large translations, scale/zoom
  sweeps, rotation, and parallax. The platform mechanism is
  `prefers-reduced-motion: reduce` via the CSS media query and
  `matchMedia` in JS. Safe substitution keeps the state change and
  replaces the spatial travel with an opacity crossfade or an instant cut.
- **Sources.** WCAG 2.3.3 understanding document; Leaflet PR #10119
  (same treatment for map transitions); motion-accessibility skill
  references corroborating the replace-don't-remove pattern.
- **Applied decision D5.** A single `useReducedMotion()` hook drives both
  layers: CSS transitions/animations collapse under the media query, and
  every camera call (`easeTo`, `fitBounds`, exaggeration tween, section
  transitions) resolves its duration to 0 when reduced motion is set.
  Overview/detail preset jumps become cuts with the selection highlight
  carrying continuity. No autoplay, parallax, or ambient animation is
  introduced.

## 6. Responsive spatial interfaces

- **Finding.** The durable pattern for map-first responsive UI is:
  canvas keeps the viewport; secondary panels become overlays/drawers at
  compact widths; no page-level scroll in spatial modes; touch targets
  ≥44px; essential controls stay keyboard-operable with visible focus.
  Mode switching (top segmented control) survives compaction better than
  side-tab navigation.
- **Sources.** MapLibre examples' toolbar/drawer compositions; inspected
  `styles.css` (single 900px breakpoint, grid → stacked) and `App.tsx`
  (mode buttons already `aria-pressed`, focus-visible ring present).
- **Applied decision D6.** Desktop: ≥65% canvas, collapsible layers panel,
  contextual inspector as overlay/drawer (never a blank-reserving third
  column), narrative/report in a split or drawer that preserves the map
  behind it. Compact (<900px): single column, map first, layers/legend/
  inspector in a bottom sheet or drawer, top command bar condensed to
  identity + mode segmented control + one overflow action. Accidental page
  scroll is a release-blocking defect.
