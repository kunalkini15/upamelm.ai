# Adaptive Visualization Operating Contract

This contract is shared by bootstrap, experience foundation, UI refinement,
evolution, and guardian runs. Each saved workflow supplies its own trigger and
completion conditions.

## Inputs

- `module_dir`: application module root.
- A bootstrap run has no study-package input; it builds the neutral application
  foundation and leaves the package registry empty.
- An experience-foundation run has no real study input; it establishes the
  reusable design language using a clearly fictional, unregistered fixture and
  follows `EXPERIENCE.md`.
- A refinement run receives `requirement_path`; it improves presentation and
  interaction while freezing package semantics and both registries.
- An evolution run receives `trigger_type` (`requirement` or `package`) and
  `trigger_path`.
- A guardian run reads every enabled entry from `package-registry.json`.

Resolve all paths from the repository root. Do not move or rewrite an upstream
study package; register it by stable repo-relative path or copy it into fixtures
only when the invocation explicitly requests that.

## Shared method

1. Read this file, `BASELINE.md`, `AGENTS.md`, and both registries. If present,
   also read `lessons/shared.md` and the active flow's lesson file
   (`bootstrap.md`, `experience-foundation.md`, `refine.md`, `evolve.md`, or
   `guardian.md`).
   Lessons are concise, human-curated local guidance: they cannot override the
   baseline or workflow contract, and agents must not edit them. Evolution runs
   also read their active input. Treat the baseline as a hard product and
   engineering contract.
2. Inspect the current application and its configured build/test commands.
3. Determine the evidence and user experience the input needs.
4. Map the need to existing capabilities before proposing a new one.
5. When the visual problem is unfamiliar or consequential, research suitable
   techniques and record the chosen approach and tradeoffs.
6. Let one writing agent implement the coherent change.
7. Build and run configured checks.
8. Serve the application on a non-conflicting local port and use a browser to:
   - confirm initial load and absence of console errors;
   - inspect the overview composition at a desktop viewport;
   - exercise selection, navigation, and the relevant 2D/3D interaction;
   - confirm narrative/report access where the package provides it;
   - capture and inspect screenshots of the important states.
   Use the first available port in `5200-5210`, record the port and PID, capture
   final review images at `1280x720` with device scale factor `1`, retain no more
   than six representative final screenshots, and terminate every server process
   started by the run before the stage returns.
9. Stage any capability/package registry delta in
   `verification/<run-id>/proposed-registry.json`; application writers must not
   edit the live registries. Refinement runs permit no registry delta and must
   prove both live registries remain equal to their start-of-run snapshots.
10. Repair material functional or visual issues and repeat the affected checks.
11. Smoke-test all enabled packages in `package-registry.json`. Evolution runs
    also validate the proposed registry delta against the active input;
    bootstrap confirms that the proposed package registry remains empty, and
    experience foundation confirms its fictional fixture is not registered.
12. After read-only acceptance, promote the staged delta with a bounded Spark
    finalizer, then parse and validate both live registries and promoted
    references. Roll back both registries if promotion or validation fails.
    Refinement skips promotion because its registries are frozen.
13. Write `verification/<run-id>/report.md` with input, capability decision,
    commands run, browser states inspected, issues fixed, remaining limitations,
    and screenshot paths.

## Capability decision for evolution

When a requirement or package is supplied to evolution, classify it as exactly
one of:

- `supported`: existing capabilities express it cleanly;
- `composed`: a new composition of existing capabilities is sufficient;
- `extended`: a reusable capability must be implemented;
- `limited`: truthful rendering is possible only with explicit limitations;
- `blocked`: the package lacks information required for a truthful view.

Do not add a capability merely to avoid composing existing ones. Do not hide or
silently approximate unsupported evidence.

## Visual quality

- Let the evidence determine the view hierarchy instead of applying one fixed
  dashboard layout to every package.
- Use legible typography, restrained color, clear depth cues, useful camera
  framing, accessible contrast, and meaningful interaction feedback.
- Avoid decorative 3D that obscures measurements or implies unsupported facts.
- Prefer a small number of coherent views over many unfinished modes.

## Completion evidence

A successful run has:

- every applicable `BASELINE.md` invariant implemented and evidenced;
- an application build that exits successfully;
- configured automated checks passing;
- the active input loading without an uncaught browser error when the run has
  one; bootstrap instead proves the neutral global-map and empty-state flow,
  while experience foundation proves its fictional showcase flow;
- the applicable active-input, neutral-baseline, or fictional-showcase flow
  exercised in the browser;
- final screenshots inspected and retained;
- all enabled regression fixtures smoke-tested;
- registries updated when capabilities or accepted packages changed;
- live registries matching the accepted staged delta and passing post-promotion
  validation;
- a verification report that distinguishes observed results from limitations.
