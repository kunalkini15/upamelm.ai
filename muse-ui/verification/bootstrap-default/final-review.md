# Final review — run `bootstrap-default`

approved: false

## Scope and method

Reviewed only `report.md`, `BASELINE.md`, `WORKFLOW.md`, `AGENTS.md`, and the six retained screenshots `01-landing.png` through `06-import-error.png`, with no other repository files inspected and no checks rerun. Claims below are judged only on whether that allowed evidence truthfully supports them, so test counts, build exits, container runs, code changes, and console silence are treated as unobserved assertions rather than evidence.

## Evidence that supports the report

- `01-landing.png` shows the neutral Mercator world map with scale bar, Home and projection controls, basemap attribution, empty layer, legend, selection, and limitation states, and greyed 3D and Split modes.
- `02-fallback.png` shows the bundled graticule, the remote-basemap-unavailable notice, live controls, and fallback attribution.
- `03-fixture-map.png` shows the synthetic points and paths layers, legend entries, the unknown-capability and skipped-feature limitations, and the dateline path.
- `04-3d-enabled.png` shows the labelled test fixture, enabled 3D and Split modes, vertical columns on a ground grid with axis cues, and `Synthetic mast A` selected in the side panel with an orange marker on a column.
- `05-narrative.png` shows the narrative insight with `syn-a` and `syn-dateline` evidence chips while 3D and Split remain disabled for the flat fixture.
- `06-import-error.png` shows the actionable `muse-scene-package.v1` versus `muse-scene-package.v0` error while map geometry and layers remain present.

## Findings against baseline and completion claims

- The disabled 3D and Split modes in `01-landing.png`, `02-fallback.png`, and `05-narrative.png` show no visible explanation text, so the report claim that unavailable modes carry a reason and the `BASELINE.md` requirement to keep unavailable modes disabled with an explanation are not visually evidenced.
- `04-3d-enabled.png` shows three vertical columns, not the four evidence columns claimed for that screenshot, although the layer counts total four features.
- `04-3d-enabled.png` shows no provenance caption, reset control, vertical-exaggeration control, or clip control, so the report claims that those items are visible and operable in the enabled 3D workspace are not supported by the retained screenshot.
- No retained screenshot shows Split mode, globe projection, compact layout, visible keyboard focus, fit-to-selection after selection on the map, or layer toggling in an after state, so the corresponding `BASELINE.md` browser-verification claims rest only on report assertions.
- A single static `04-3d-enabled.png` cannot evidence orbit, reset, exaggeration, clipping operation, or geometry and material disposal across mount and unmount cycles, and screenshot silence cannot evidence zero uncaught console errors.
- The report records only a container port and a generic host port range with the container PID described as ephemeral, which does not satisfy the `WORKFLOW.md` requirement to record the port and PID for the served application.
- The report states that live registries remain empty while `proposed-registry.json` stages three verified capabilities, so the `WORKFLOW.md` completion condition that live registries match the accepted staged delta after promotion is not yet met and the run cannot be called complete before promotion and post-promotion validation.
- The report applies the evolution capability label `composed` to a bootstrap run with no study-package input, whereas `WORKFLOW.md` defines that classification for evolution runs supplied with a requirement or package.
- Command results, exact dependency versions, test and spec counts, container execution, server termination, grep attestations, registry cross-reference validation, and code-level fixes are asserted in the report but cannot be corroborated from the four documents and six screenshots allowed to this review.

## must_fix

- Correct the `04-3d-enabled.png` description to three visible columns or replace the screenshot with one that truthfully shows four evidence columns.
- Replace or recapture `04-3d-enabled.png` so the claimed provenance caption and reset, exaggeration, and clip controls are visible in the retained frame.
- Add visible disabled-reason text for 3D and Split in the landing, fallback, and flat-fixture states or amend the report to state that the reason is not shown.
- Downgrade every build, test, browser-spec, console-silence, disposal, container, and registry-validation claim in the report to an unobserved assertion until independently retained evidence is supplied.
- Record the concrete served port and PID required by `WORKFLOW.md` or amend the report to explicitly record why the ephemeral container PID cannot be retained.
- Complete the staged-registry promotion and post-promotion validation after acceptance or amend the report to mark the run incomplete pending that finalizer step.
- Remove the evolution-only `composed` classification from this bootstrap report or justify it against the bootstrap-specific language in `WORKFLOW.md`.
- Supply retained evidence for Split mode, globe projection, compact layout, keyboard focus, and coordinated selection or narrow the completion claims to the states actually shown in the six screenshots.

## Residual risks

- Clean-room compliance and the absence of forbidden references rest partly on attestation, as the report itself acknowledges.
- Compact-viewport and keyboard usability remain assertion-based because no compact or focus screenshot was retained.
- Three-dimensional height truthfulness cannot be judged from one oblique screenshot without visible scale, units, or provenance values.
- The prior-valid-scene claim in `06-import-error.png` is only partly checkable because the screenshot is cropped at the top and its framing differs from `03-fixture-map.png`.
- Promotion of the three staged capabilities may change live registry behaviour that has not been browser-verified in its promoted form.
