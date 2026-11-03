# Bengaluru end-to-end run

Run completed on 3 November 2026 with `muse-spark-1.3-contributor`.

## Inputs

- Bengaluru aquifer report PDF
- Bengaluru Metro Phase 3 report PDF
- Bengaluru Metro Phase 3 environmental impact report PDF
- South India soil-grid PDF
- BWSSB water-supply-lines KML

## Results

| Metric | Result |
|---|---:|
| Sources | 5 |
| Native source units | 1,347 |
| Units covered | 1,347 |
| Raw visual artifacts | 1,312 |
| Visually interpreted artifacts | 87 |
| Deterministically detected PDF tables | 899 |
| Preserved KML features | 97,827 |
| Valid evidence items | 303 |
| Evidence validation errors | 0 |
| Extracted entities | 189 |
| Extracted spatial candidates | 29 |
| Extracted vertical intervals | 19 |
| Extracted relationships | 69 |
| UI features | 14 |
| UI features with source-supported point geometry | 3 |
| UI features with narratives | 14 |
| UI observations | 20 |
| UI vertical intervals | 8 |
| Report themes / chapters / findings | 5 / 8 / 13 |
| Total billed input tokens | 5,224,224 |
| Total billed output tokens | 416,664 |
| Total estimated cost | $0.60441366 |

Loop 1 and Loop 2 validation both pass. Duplicate model-local evidence IDs are retained as warnings and deterministically deduplicated; no invalid evidence locators remain.

## Output locations

The complete local run, including 726 MB of immutable sources, page renders, tables, full KML-derived geometry, model I/O, and checkpoints, is at:

```text
playground/bangalore/agentic_live/
```

Compact committed handoff artifacts are in this directory. `ui_consolidated_package.json` is the primary current-UI input.

## Important fidelity result

Only three UI features received point geometry because only those features had sufficiently supported coordinates in the synthesized evidence. The 97,827-feature BWSSB network remains available as a native deterministic spatial dataset rather than being copied or approximated by the model. This is intentional: unsupported coordinates and illustrative subsurface geometry are not fabricated.

