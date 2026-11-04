# Direction review — refine-scene-first-design-foundation

approved: false
reviewer_role: flagship art and interaction director (read-only)
requirement: muse-ui/requirements/scene-first-design-foundation.md
plan_reviewed: muse-ui/verification/refine-scene-first-design-foundation/plan.md
baselines_inspected: before/before-01-landing.png, before/before-02-populated.png, before/before-03-compact.png (all three named in plan appendix)
contracts_consulted: muse-ui/EXPERIENCE.md, muse-ui/DESIGN_SYSTEM.md

## Verdict

Not approved for implementation yet. The plan aims at the right structural
move — removing the persistent rail, quieting persistent copy, and converging
chrome on locally owned primitives — so it is not a restyle-only proposal.
It does not yet guarantee the required experience. Key visual and
interaction decisions that determine success on first load, in 3D/split,
and at compact widths are left as taste language or variant names without
measurable hierarchy, luminance, disclosure, and obstruction rules. A
competent writer following this plan literally could ship a clean generic
shadcn dashboard with the same light chrome, a floating compact toolbar,
and unreadable 3D overlays — and still claim every §7 bullet.

Revise the plan to close the must-fix items below, then re-submit for
direction approval. No scope expansion is requested; every item tightens
the existing requirement.

## What the plan gets right (keep)

- Pixel-grounded defects. D1–D4 match direct inspection: before-01 shows
  the 280 px rail with three empty-state sentences, dashed import box with
  native "Choose File / No file chosen", the `mode-3d-reason` strip, and
  the duplicated footer sentence all competing with the map; before-02
  shows the amber limitation banner duplicating the rail Limitations list
  plus study bar, legend card, and bottom toolbar crowding the populated
  map; before-03 shows the two-row mode bar, persistent reason strip, and
  the tall left-edge toolbar floating over a laterally tight map.
- Correct scope fence. §3 freezes both registries, package schema/adapter
  semantics, geometry, renderer truthfulness, and scientific colour
  meaning; §4 R6 keeps MapLibre/Three.js owning canvases with no second
  interaction-state system. No package-semantics drift found.
- Token continuity intent. §5 step 2 keeps hex values identical and
  `tokens.test.ts` green, consistent with DESIGN_SYSTEM.md §§1–3
  (canvas/surface/ink/focus/selection, Okabe–Ito categoricals, sequential
  scales). R2 correctly treats shadcn as owned code, not a theme import.
- Responsive intent. §7 compact requires scene-first with a ~60vh floor,
  one-row segmented modes, ≥44 px targets, legend behind a toggle, and no
  default floating toolbar — the right correction to before-03.

## must_fix

### MF-1 — Commit the chrome luminance and hierarchy system; ban stock-demo defaults

Requirement "Visual and motion language" demands a restrained dark
spatial-observatory language; DESIGN_SYSTEM.md currently specifies light
text surfaces (`--surface #FFFFFF`, `--surface-raised #F4F7F9`) over the
dark canvas, and the baselines show that light dashboard chrome. The plan
never states which world the new chrome lives in — it only maps existing
tokens into Tailwind `@theme` (§4 R1, §5 step 2). "Precise, contemporary,
authored" (§1) is a vague taste claim with no enforceable content.

Plan amendment required: a token-mapping table (existing semantic token →
`@theme` entry → chrome usage) that states explicitly (a) command-bar,
sheet, popover, and inspector surface values and their contrast pairs,
(b) that no Tailwind default palette, radius, shadow, or type scale leaks
into chrome, and (c) selected/focused treatment that does not rely on
colour alone, per DESIGN_SYSTEM.md §5. State how the dark-observatory
requirement is honoured or consciously reconciled with the measured
light-surface tokens — silence on this point is a stock-component-demo
risk the requirement explicitly forbids.

Verifiable check: DESIGN_SYSTEM.md diff contains the mapping table and
the writer's after-screenshots show one consistent surface system across
landing, inspector, and 3D states.

### MF-2 — Make "map dominant" a number at every desktop state, not a caption

§7 desktop says "dominant surface below a one-row command bar" with no
threshold for the states that matter most. The regression net in §6 cites
a ≥0.65 stage-fraction gate, but §7 does not bind it to the empty
landing, the open import surface, the open spatial-tools surface, or the
selected-feature inspector — exactly the states where a popover or sheet
can silently re-displace the map (the failure in before-02, where four
chrome layers stack over the canvas).

Plan amendment required: per-state stage-fraction and command-bar-height
budgets at 1280×720 dsf 1 — at minimum: empty landing with all secondary
surfaces closed, import open, layers/legend open, inspector open. On-demand
surfaces must overlay or inset without permanently shrinking the stage,
and the plan must say which (overlay vs. inset) for each surface and its
maximum footprint. "Close back to a clean scene" (§7) needs a defined
closed state: no reserved blank region, per EXPERIENCE.md "Empty panels
must not reserve large blank regions."

Verifiable check: each §8 after-shot is measured against its budget;
the before/after pair reports both stage fractions, not only "rail gone."

### MF-3 — Specify disabled-reason disclosure for keyboard and touch, not hover tooltips

The plan removes the permanent `mode-3d-reason` strip (correct — D2) and
replaces it with "tooltip + disabled-reason disclosure" (§5 step 3), but
never says how a disabled mode explains itself to a keyboard or touch
user. Disabled buttons are not focusable by default, and Radix Tooltip
is hover/focus driven; a literal implementation strands exactly the
users the requirement protects ("disabled state and reason must be
understandable without occupying a permanent announcement strip,"
"Keyboard-only navigation, visible focus, disabled-reason disclosure").
DESIGN_SYSTEM.md notes the current reason line exists precisely because
"opacity never carries meaning alone."

Plan amendment required: name the disclosure pattern per input modality
— e.g. focusable disabled control (or wrapper) exposing the reason to
assistive tech, tap/click disclosure on touch, and tooltip as the
pointer-only enhancement — plus where the reason text lives in the
accessibility tree. Add this to the §7 keyboard acceptance bullet as a
pass/fail step: tab to a disabled 3D/Split mode, read its reason, proceed.

Verifiable check: browser spec exercises disabled-mode reason disclosure
by keyboard and by touch emulation, not only hover.

### MF-4 — Give 3D/split an overlay-obstruction and legibility budget

Requirement state 6 and EXPERIENCE.md "Spatial and 3D experience" demand
that new chrome not subordinate the renderer: overview/detail presets,
orientation and depth cues, explicit vertical-exaggeration labelling,
uncertainty/provenance beside the evidence, no indiscriminate gloss,
glow, or transparency. The plan addresses 3D only as "re-seat … 3D
toolbar caption flow" (§5 step 5) and "3D/split share one component
language; spatial context survives" (§7) — unverifiable, and silent on
DESIGN_SYSTEM.md §6 gates (line weight, marker scale, surface opacity
caps, depth rail, clip-datum sheet). Translucent sheet/popover styling
over the canvas is the predictable decorative-3D failure here.

Plan amendment required: (a) overlay budget for 3D/split — which
overlays may float over the canvas, their corners/maximum area, and that
text surfaces over the renderer stay opaque; (b) explicit carry-over of
DESIGN_SYSTEM.md §6 visualization rules as regression gates unaffected
by the chrome migration; (c) one §7 acceptance line confirming
exaggeration labelling, orientation cue, and depth context remain
visible with command bar and overlays present.

Verifiable check: the §8 3D/split after-shot plus a browser assertion
that the exaggeration label and attribution are unobstructed.

### MF-5 — Close the compact composition gaps the baseline exposes

Before-03 fails in specific ways the plan's compact bullets only partly
cover: the mode bar wraps to two rows, the reason strip persists, and
the map toolbar becomes a tall floating strip over the scene. §7 fixes
the first and third in principle but does not state (a) where Layers,
Import, Limitations, and Help triggers live at 390 px in the closed
state — if they collapse into one anonymous menu, discoverability of
limitations (which must not be hidden) is lost; (b) the bottom-sheet
height cap and whether the scene stays visible/interactive above the
sheet; (c) behaviour between 901 px and 1280 px, where a shrunken rail
or half-open sheet could reappear by default.

Plan amendment required: a compact chrome map — closed-state trigger
placement with accessible names, sheet height cap with scene peek,
breakpoint table covering ≤900 px and the 901–1280 px band, and an
explicit "no floating toolbar over canvas by default" rule naming its
replacement (the plan currently asserts this only as an outcome in §7,
while §5 step 5 says sheets "never cover the scene by default" without
the closed-state layout that achieves it).

Verifiable check: 390×700 after-shot with sheets closed shows named,
reachable triggers and an unfloated scene; a mid-width shot or spec
covers the intermediate band.

### MF-6 — Separate UI-motion gating from the camera reduced-motion path

§4 R5 routes all reduced-motion behaviour "through the existing
reduced-motion path," and §3 ties it to `cameraDuration()`. That
mechanism governs Three.js camera cuts (DESIGN_SYSTEM.md §4); it does
not govern Motion mount/layout transitions for sheets, drawers, and the
inspector, which are new in this run. Conflating them risks UI animation
surviving `prefers-reduced-motion` while camera cuts correctly go
instant — or the reverse.

Plan amendment required: state the two gates separately — CSS/Motion
transitions collapse under `prefers-reduced-motion` (media query and/or
Motion's reduced-motion handling) and camera moves resolve through
`cameraDuration()` — and add both to the §7 acceptance evidence. Also
bound Motion to the named mount/layout/mode transitions in R5; "view
continuity" without a list invites ambient animation the requirement
forbids.

Verifiable check: browser run with reduced motion emulated shows
instant sheet/inspector mount and instant camera cut.

### MF-7 — Make acceptance evidence complete and fail-loud

Three evidence weaknesses: (1) §8 allows reduced-motion, import-failure,
and basemap-failure bitmaps "only if they reveal something new," but the
requirement lists basemap failure and import validation failure as
first-class states — a fallback that "leaves the usable fallback style"
(§7) cannot be judged from a spec log alone; retain bitmaps for both.
(2) "Share one component language" and "explain themselves in place"
(§7) have no source-level check; add the requirement's own test —
screens contain no repeated one-off button/panel/tooltip/dialog
implementations — as a grep/inspection step over `src/design/` usage.
(3) The appendix records that the configured Playwright suite could not
run on this host; the plan must require the writer to record the exact
fallback actually used (pinned image, port, result, cleanup per
`lessons/shared.md`) in the run evidence and to treat a skipped suite
as incomplete, not as a pass.

Verifiable check: evidence folder contains the two failure-state
bitmaps, the component-reuse inspection note, and the recorded browser
execution path.

## Risks

- R-A — Generic dashboard convergence. Segmented modes + top bar +
  sheets is the conventional admin layout. Without MF-1/MF-2 the result
  satisfies the letter (rail gone) while reading as a stock component
  demo — the exact outcome the requirement forbids. Highest risk.
- R-B — Disclosure regression. Removing the reason strip and rail copy
  (D2) before the replacement disclosure is proven (MF-3) can ship a
  quieter but less honest interface, hiding genuine limitations the
  requirement says must stay discoverable.
- R-C — Renderer subordination by overlay. New popover/sheet/inspector
  primitives drifting over the Three.js canvas with translucency or
  glow would violate the restrained visual language and §6 legibility
  gates while looking "designed." Mitigated by MF-4.
- R-D — Dual-system drift. Wrapping Radix so "screens never touch Radix
  directly" (§4 R3) is correct, but any screen-level exception creates
  the second interaction-state system R6 forbids; MF-7 item (2) is the
  guard.
- R-E — Fixture leakage. Before-02 depends on the synthetic fixture;
  the plan's generic-only rule (§3) must hold in component variants and
  labels, not only in data branches — no fixture-named branches, per
  requirement "The result must be generic."

## Scope-drift check

Pass. The plan introduces no package schema, adapter, registry,
geometry, or scientific-fact change; it explicitly snapshots both
registries for byte-equality and returns `blocked=true` rather than
approximating if new evidence semantics prove necessary (§3). The
must-fix items above add no scope — they make the already-promised
experience decidable and measurable.

## Conditions for approval

Incorporate MF-1 through MF-7 as explicit plan text (mapping table,
per-state budgets, disclosure pattern, 3D overlay budget, compact
chrome map, split motion gates, completed evidence list). On
re-review, approval requires each must-fix to be checkable from the
plan alone by a writer who has not read this review.
