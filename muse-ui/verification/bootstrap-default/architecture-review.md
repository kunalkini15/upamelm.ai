# Architecture Review — run `bootstrap-default`

## Verdict

approved: false

The plan is broadly aligned with the baseline and introduces no document-specific view, but it is not yet approved for the builder. The must_fix items below close weakened or uncheckable acceptance states before implementation starts.

## Scope reviewed

- [plan.md](/Users/kunal.kini/Kunal/Projects/meta-gloabl-ai-hackathon-oct/subsurface/muse-ui/verification/bootstrap-default/plan.md)
- [capability-registry.json](/Users/kunal.kini/Kunal/Projects/meta-gloabl-ai-hackathon-oct/subsurface/muse-ui/capability-registry.json)
- [BASELINE.md](/Users/kunal.kini/Kunal/Projects/meta-gloabl-ai-hackathon-oct/subsurface/muse-ui/BASELINE.md)
- [WORKFLOW.md](/Users/kunal.kini/Kunal/Projects/meta-gloabl-ai-hackathon-oct/subsurface/muse-ui/WORKFLOW.md)
- [AGENTS.md](/Users/kunal.kini/Kunal/Projects/meta-gloabl-ai-hackathon-oct/subsurface/muse-ui/AGENTS.md)

No other repository files were read. No application source was created or modified by this review.

## What holds

- Mandatory stack, reproducible commands, and lockfile discipline are mapped to checkable acceptance in plan rows S1–S7.
- Clean-room rule Q1 preserves the baseline prohibition on inspecting, importing, copying, translating, or deriving from `ui-v2`, with the package-data exception correctly marked not applicable at bootstrap.
- Generic boundary K1/A2/A3 forbids document, study, city, filename, publisher, and domain branches, keeps renderers off raw package JSON, and keeps the capability registry empty at bootstrap, consistent with the empty `visual-capabilities.v1` registry reviewed.
- Coordinate contract C1–C5, unlocated honesty, per-feature rejection K3, unknown-field preservation K2, text sanitisation K4, and last-valid-package preservation are all carried without an invented location, geometry, or elevation.
- No document-specific view, label, sample dataset, or regional framing is introduced; the section 6 capability ideas are reusable semantic or geometric concepts only.

## Must fix

- Add clipping to the writer work list and to row D3 acceptance or explicitly record clipping as unsupported with a checkable reason before the builder starts.
- Replace the empty-state-only acceptance in row M4 and the browser gate in row R3 with a generic synthetic fixture exercised through the validated adapter that proves layer toggling, hover, selection, fit-to-study and fit-to-selection, and coordinated focus in the browser.
- Name the accepted package schema version identifier and its rejection behaviour in the plan so the valid, old-version, and unknown-field tests in row K1 have a fixed oracle.
- Specify the WORKFLOW report contract in the writer work list, including recorded port and PID, terminated servers, commands run, browser states inspected, issues fixed, remaining limitations, and screenshot paths.
- Add the staged registry promotion steps to the writer work list, including post-promotion parsing, cross-reference validation, and rollback of both live registries on failure even though the staged delta is empty.
- State which 3D acceptance items are deferred at bootstrap because 3D is disabled and require their browser verification at the first evidence-bearing evolution instead of marking rows D3 and D5 complete from code review alone.

## Residual risks

- Clean-room compliance rests partly on writer and verifier attestation because a grep for `ui-v2` paths cannot prove that no design was derived from it.
- The plan defers the exact Vite release, Node line, and default OpenFreeMap style variant to the writer, so the builder must record those choices and their compatibility evidence in the run report.
- A synthetic verification fixture could be mistaken for shipped sample data unless it stays in test fixtures and never enters the configured package registry or the landing experience.
- The bundled fallback style still needs a stated attribution treatment for its land, water, or graticule content when remote tiles fail.
- Compact-viewport usability is asserted in row P3 but only desktop screenshots are retained, so compact evidence depends on browser test assertions rather than inspected images.
