# Final review — experience-foundation (flagship visual review)

**approved: false — REJECTED**

Read-only review of `verification.md`, `EXPERIENCE.md`, `DESIGN_SYSTEM.md`, and
the six retained 1280×720 screenshots (`xf-01`…`xf-06`), all visually inspected.
Judged on the rendered result, not implementation ambition.

## Verdict

The run still reads as a scaffold / generic GIS admin dashboard with
default-component chrome, not a scientific spatial observatory. The 3D is
decorative and unclear, selection and report states lose spatial focus, and
several acceptance claims in `verification.md` are contradicted in-frame.
Browser/unit pass counts do not cure visual rejection criteria.

## Evidence against the claims

- **Default-component UI (contradicts "no default form styling").**
  `xf-01` shows the native `Choose File / No file chosen` input; all views show
  native checkboxes and range sliders (`xf-04`/`xf-05` clip controls), plain
  1px-border buttons, and a stock left-rail + top-segment + floating-card
  layout. Nothing in the chrome distinguishes this from a component-library
  scaffold.
- **Landing (`xf-01`).** One world view, but a mostly empty white rail reserves
  large blank regions (`Layers`, `Selection`, `Limitations`), and attribution
  is duplicated: map pill plus the `Map data: OpenFreeMap…` footer line —
  against the contract's "no duplicated attribution."
- **Map overview / selection (`xf-02`, `xf-03`).** The study renders as nested
  translucent rectangles and dots on a flat periwinkle void — fixture geometry,
  not spatial evidence; no geographic context survives. Worse, `xf-03`
  (BH-03 selected) zooms *out*: the study shrinks to a small central rectangle
  in an empty field, so selection has no spatial focus. This contradicts the
  claim that `xf-03` shows "BH-03 framed with study context." The inspector
  itself (depth, ±2 m, provenance, `Show on map`, linked evidence) is the one
  strong element.
- **3D (`xf-04`, `xf-05`) — decorative/unclear.** At 1.0× and even 2.0× the
  horizons collapse into one flat translucent green slab; borehole columns,
  horizons, water level, and transect are not individually legible, horizons
  carry no labels, and the only depth text is "grid 10 units." `xf-05` is
  visually near-identical to `xf-04`: the clip payoff exists only in the
  `clip-status` caption, not in the image. One unexplained tall green spike
  dominates. Provenance text under the canvas is clipped at the left edge.
- **Report state (`xf-06`) — broken state continuity.** Report mode shows a
  world-extent map (Americas/Africa) where BH-03 is invisible; the selected
  chip sits in the drawer with no spatial counterpart. The verifier itself
  concedes the map stays at world extent. Raw fixture ids (`demo-bh-03`,
  `demo-horizon-c`) leak into the user-facing chips.
- **Hierarchy / typography / chrome weight.** Flat 12–14px system type, no
  display hierarchy; the package title truncates in every header
  ("Fictional Meridian Basin — desi…"); the identical limitation banner is
  repeated in the banner and again under `Limitations` in every view, so
  boilerplate competes with evidence; bottom-left limitation text is cut off
  in the 3D views.
- **Unsupported by retained evidence.** No compact (390px) view, keyboard
  path, split view, or reduced-motion state is among the six retained
  screenshots, so compact behaviour and mode continuity beyond the six frames
  cannot be visually accepted — assertions in `verification.md` are not
  rendered evidence.

## must_fix

1. Restyle all native controls (file input, checkboxes, sliders, buttons) to
   the design system; remove duplicated attribution in `xf-01`; stop empty
   rail sections reserving blank space.
2. Make selection spatially focus by default: `xf-03`-equivalent framing must
   keep the selected borehole large, marked, and in study context without a
   manual `Show on map` step.
3. Rebuild the 3D read: separate and label horizons/water/transect, give
   borehole columns legible depth against a labelled depth/scale axis, add
   decipherable orientation, and make clipping produce an unmistakable
   before/after visual difference at the retained exaggeration.
4. Fix report/narrative continuity: opening Report must preserve the framed
   study extent and visible selection; never fall back to world extent.
5. Demote repeated limitation boilerplate to one concise, dismissible surface;
   stop header truncation; un-clip provenance and limitation text in 3D.
6. Replace raw `demo-*` ids in user-facing chips/labels with human names.
7. Retain visual evidence for compact and keyboard/reduced-motion states (or
   narrow the claims) before resubmission.

## risks

- The fixture's rectangle-only geometry may be incapable of ever reading as
  real spatial evidence; a richer (still fictional) geometry may be required,
  not just restyling.
- True-scale flatness (conceded in `verification.md`) plus the no-fog/no-shadow
  depth-cue policy leaves 3D depth resting on grid/axes alone — currently
  insufficient at basin aspect.
- Promoting on test counts alone would lock a generic dashboard language in as
  the reusable foundation for later packages.
