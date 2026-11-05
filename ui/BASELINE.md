# UI Validation Baseline

The Upamelm.ai UI is a generic evidence explorer over backend-served
`document-study.v2` packages. A validation run must preserve and verify these
invariants.

## Product invariants

1. The city atlas is populated from the backend catalog.
2. City, study, and language selection use semantic URL parameters.
3. Study packages enter the application only through `PackageIngestion`.
4. Map, 3D, and analysis navigation are shown only when supported by evidence.
5. Optional or empty package fields do not produce invented fallback content.
6. Language changes preserve the current supported view.
7. Spatial selections, report analysis, charts, tables, downloads, evidence
   references, and assets remain traceable to the selected package.
8. Proposed, approximate, derived, and observed evidence remain distinguishable.
9. Missing capabilities produce honest absence or fallback states, never an
   empty or misleading visualization.
10. Backend, package, translation, asset, and UI defects are classified by
    likely owner rather than collapsed into a generic rendering failure.

## Verification invariants

- `npm test` and `npm run build` pass.
- The browser console has no unexplained application errors.
- No same-origin API or referenced asset request fails unexpectedly.
- Every discovered city, study, and language combination reaches a stable UI.
- At least one representative state for each available top-level capability is
  visually inspected at 1280x720 with device scale factor 1.
- Browser services and Docker resources are cleaned up before return.

