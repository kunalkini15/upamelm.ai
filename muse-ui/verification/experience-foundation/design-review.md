# Design review — experience-foundation

Reviewer: flagship design director (read-only). Scope reviewed: `research.md`,
`plan.md`, `muse-ui/BASELINE.md`, `muse-ui/EXPERIENCE.md`,
`capability-registry.json`, `package-registry.json`. No source reviewed or edited.

## Verdict

**approved: false — direction approved, implementation not yet approved.**

The observatory thesis, map-primary hierarchy (D1), colour science (D2),
reduced-motion rule (D5), and refusal of terrain/gloss/bloom (D3/D4) are the
right foundation and are not generic-dashboard, cosmetic-only, or
document-specific. Approval is withheld until the must-fix items below make
the synthetic evidence truthful and the acceptance matrix objectively
falsifiable in a browser. Resubmit this plan with those items closed; do not
start the writer stage on the current text.

## What already passes

- Map/3D as primary surface with a measured ≥65% desktop canvas rule, contextual
  inspector only on selection, and no blank third column (plan §3, §9 rows 1/11).
- Colour/accessibility intent: Okabe–Ito categorical order, Crameri sequential/
  diverging families, no rainbow, and every colour state paired with size,
  stroke, label, dash/hatch, icon, or text (research §2/D2).
- Truthfulness guards: no invented terrain/DEM, elevations, or gloss; schematic
  dip and vertical exaggeration must be labelled as such (plan §5–§6).
- Registry hygiene: live registries untouched, showcase unregistered and
  non-default, `demo-` ids, and `grep` proof of no `demo-` branches in `src/`
  (plan §2/§6, row 22). Current registries confirm this: three generic
  capabilities only, empty package registry.

## must_fix (concise, blocking)

1. **Pin exact tokens, then prove contrast.** Plan §4 names roles but almost no
   values. Commit the full hex token table (canvas/surface/text/muted/border/
   focus/selection/status/uncertainty, `cat-1…8`, exact `seq` stops, `div`
   midpoint) in `DESIGN_SYSTEM.md` and add automated checks: ≥4.5:1 for text,
   ≥3:1 for focus/selection/markers at rendered size, plus deuteranopia/
   protanopia/tritanopia simulation of the showcase. "Spot-checked" (row 4)
   is not acceptance.
2. **Make the fixture scientifically coherent, not decorative planes.** Specify
   deterministic coordinates/depths in the fixture contract and validate them:
   horizons ordered and non-crossing, borehole intervals intersecting horizons
   consistently, water level at a stated datum, and the ±4 m uncertainty on
   `demo-horizon-c` bounded to the declared easting range — rendered only
   there, labelled with units/datum in the inspector. A flat plane at an
   arbitrary depth is decorative 3D and fails EXPERIENCE truthfulness.
3. **Decide capabilities by composition failure before coding.** For
   `subsurface-surface`, `reference-surface`, and `cross-section` (plan §6),
   record a short composition test against the three registered capabilities
   (`point-observation`, `path`, `vertical-profile`): what composition was
   tried, what truth it lost. Add only the failures, with generic schema
   validation for `dipDegrees`/`uncertaintyMeters`/`referenceKind` (finite,
   unit-bearing, provenance-carrying). No open "if it cannot be composed"
   decisions left to the writer.
4. **Convert the acceptance matrix to measurable browser gates.** For each of
   rows 1–27 state the Playwright assertion or measurement: canvas fraction
   measured from bounding boxes at 1280×720/dsf1, `document` scrollWidth/
   scrollHeight equality in spatial modes, console/`pageerror` silence,
   computed-contrast results, reduced-motion emulation asserting 0-duration
   cameras, draw-call and disposal counts from the renderer handle, and the
   named `xf-01…xf-06` captures plus 390×700 and a keyboard-only path.
   Replace vague ceilings (<500 draw calls for ~10 objects, "<2s on
   broadband") with tight budgets and a named throttling profile.
5. **Complete the component-state spec before implementation.** `DESIGN_SYSTEM.md`
   must give default/hover/active/focus-visible/disabled-with-reason/loading/
   error states for every EXPERIENCE-listed component (segmented modes, icon
   controls, tooltips, drawers, layer rows, legend, chips, notices, sliders,
   empty/error), 44px compact targets, and the focus order across command bar →
   canvas toolbar → inspector. Disabled at 55% opacity must still meet the
   contrast gate in item 1 or carry its reason text at full contrast.
6. **Tighten the research audit trail.** Replace skill/secondary corroboration
   (Three.js colour/disposal, motion) with the primary sources themselves
   (Three.js docs/source for r170 colour management and `dispose()`, WCAG 2.2
   text, MapLibre API for projection/terrain), each with version and the
   decision it changed. Claims resting only on "skill references corroborate"
   do not meet the EXPERIENCE primary-source requirement.
7. **Guard the shell against dashboard drift in the captures.** State a chrome
   budget enforceable in review: command bar + rails may not exceed the
   remaining 35%, no card grids, no permanent instructional paragraphs, and
   "Start tour" is a single user-initiated affordance (no autoplay). Each of
   the six captures is rejected if chrome, not evidence, is the visual subject.

## Risks

- **Schematic geometry read as measurement:** horizon planes, uncertainty band,
  and exaggerated columns can imply surveyed surfaces; mitigated only if
  items 2–3 land with datum/unit/provenance labels at the evidence.
- **Capability proliferation:** three new capabilities for one fixture could
  encode the fixture into the platform, violating the generic-registry rule
  the current registry exemplifies.
- **Synthetic-evidence overclaim:** a labelled fictional basin proves layout
  and interaction only; it must never be cited as scientific validity, and its
  "avoid real settlements" coordinates need a pinned, checkable choice.
- **Accessibility regression by token drift:** unspecified `seq`/`div` ramps
  and 55%-opacity disabled states are the likeliest silent failures; item 1
  automation is the control.
- **Performance theatre:** loose draw-call/first-paint ceilings would pass a
  degraded build; tightened budgets (item 4) are required before writer work.

## Re-review gate

Resubmit `plan.md` (and the `DESIGN_SYSTEM.md` token/state tables) with items
1–7 closed as text and named assertions. On approval, the writer stage is
bounded by plan §7–§8 as amended; final acceptance still requires the critic's
three-weakest-aspects disposition (EXPERIENCE, row 26).
