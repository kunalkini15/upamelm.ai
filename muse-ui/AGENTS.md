# Application Rules

These rules apply to every change in this module.

Read and preserve `BASELINE.md`. Its stack, product foundation, architectural
boundaries, correctness rules, commands, and acceptance states are immutable
invariants unless a human explicitly changes that contract.

## Product boundary

- Build a generic scientific and spatial visualization application.
- Never branch on filenames, document IDs, study IDs, cities, report titles, or
  one-off domain labels.
- Treat each input package as data, not as a reason for document-specific code.
- Prefer composing registered capabilities. Add a new capability only when the
  existing vocabulary cannot represent the requirement truthfully and clearly.
- New capabilities must describe a reusable semantic or geometric concept.

## Rendering

- Choose the best presentation for the evidence: map, 3D scene, cross-section,
  profile, network, timeline, table, report, or a coordinated combination.
- Do not force every dataset into 3D. Use 3D where depth, volume, topology,
  occlusion, or spatial relationships materially benefit.
- Do not invent geometry, depth, materials, measurements, or relationships.
- Show missing or uncertain information honestly.
- Keep rendering components independent of the document that first required them.

## Evolution

- Inspect `capability-registry.json` before designing a renderer.
- Research unfamiliar visualization problems when repository knowledge is
  insufficient. Record consequential design decisions in the run report.
- Writers stage capability and package registry changes in the run directory;
  they never edit live registries directly.
- Promote staged registry changes only after read-only browser verification,
  and validate the promoted files and cross-references before completion.
- Register every accepted input package so later changes exercise it as a
  regression fixture.

## Verification

- Use a real browser for meaningful UI changes.
- Inspect rendered pixels, interactions, responsive layout, and browser console;
  taking a screenshot without reviewing it is not verification.
- Exercise the important flow for the active package and smoke-test every
  registered fixture.
- Store each run under `verification/<run-id>/` with `report.md` and final
  screenshots. Keep temporary browser artifacts outside the deliverable.
- Do not claim completion while the build, required tests, or active-package
  browser flow is failing.

## Engineering

- Keep one writing agent responsible for interconnected application changes.
- Use additional agents for bounded research, critique, and verification.
- Preserve a clean separation between package interpretation, the internal scene
  model, capability selection, renderers, and user-facing composition.
- Keep dependencies purposeful and the development command reproducible.
- Never inspect, import, copy, or derive anything from `ui-v2`. If the active
  input package itself is stored there, read only that exact file as data.
