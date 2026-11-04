---
name: adaptive-visualization
description: Build or evolve the repository's generic scientific visualization application from a requirement or study package, including capability selection, browser inspection, and regression verification. Use only when explicitly working on the adaptive visualization module or when a saved adaptive-ui workflow invokes it.
---

# Adaptive Visualization Engineering

Read `<module_dir>/BASELINE.md`, `<module_dir>/AGENTS.md`, and
`<module_dir>/WORKFLOW.md` completely before planning or editing. Together they
own the product, architectural, correctness, and verification contract.
When the saved experience-foundation or refinement workflow invokes this skill,
also read `<module_dir>/EXPERIENCE.md` completely; it owns the reusable visual
and interaction language for that run. Refinement must additionally read the
active requirement and preserve its frozen package/registry boundary.

## Working posture

1. Start from the user outcome and evidence, not a favored visualization.
2. Inspect the capability registry before proposing new code.
3. Try reuse, then composition, then a reusable extension.
4. Keep one writer responsible for interconnected application edits.
5. Use bounded read-only agents for research, visual critique, and regression.
6. Invoke the available frontend design guidance before visual creation and the
   applicable Three.js/3D reference skill before material 3D implementation.
7. Verify in a real browser and inspect screenshots and console output.
8. Preserve every baseline invariant; new capabilities extend the application
   rather than replacing its global map, package boundary, interaction model,
   reproducible commands, or honest fallback states.

## Browser discipline

- Start development servers on the first available port in `5200-5210`; never
  assume a framework default port is free.
- Record the selected port and server PID in the run report. Stop every server
  process started by the run before the agent stage returns, including on a
  failed browser check.
- Capture review screenshots at `1280x720` with device scale factor `1`. Add a
  compact viewport only when responsive behavior is material.
- Retain at most six representative final screenshots per run. Inspect each
  retained image; screenshots that were not visually reviewed are not evidence.

## Research

Research when the input introduces an unfamiliar scientific representation,
interaction, geometry, or visual convention. Prefer primary technical sources.
Translate research into a small decision recorded in the verification report;
do not turn the application into a showcase of unrelated techniques.

## Capability discipline

A capability represents a reusable visual idea, such as a point observation,
path, network, vertical profile, volume, surface, cross-section, or time series.
It must not encode the document, place, publisher, or report that introduced it.

Stage registry changes in `verification/<run-id>/proposed-registry.json` while
building. Do not edit the live registries in the writer stage. Promote the
staged delta only after a read-only verifier accepts the implementation, then
parse and validate both live registries and every promoted reference. Preserve
explicit limitations when evidence cannot support a requested view.

## Handoff

Return a concise account of the capability decision, files changed, checks run,
browser states inspected, screenshots retained, and unresolved limitations.
