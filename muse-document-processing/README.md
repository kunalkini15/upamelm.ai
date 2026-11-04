# Muse Document Processing

Agentic replacement for the `agentic-subsurface` code pipeline. One run handles
**one document** and produces the same UI contracts the frontend already reads.

## How to invoke

Ask in chat, naming the document:

```text
Run a subsurface study on playground/bangalore/sample_docs/input/bangalore_aquifier.pdf
```

The agent reads the document natively (PDF, image, KML/KMZ, GeoJSON, CSV,
spreadsheet, text — any single file), reasons about corner cases as they come,
and writes one self-contained run directory under `muse-document-processing/runs/`.

There is no fixed code path to maintain. The operating procedure is
[WORKFLOW.md](WORKFLOW.md); the checked-in multi-agent runner is
[study-workflow.js](study-workflow.js).

## Outputs (per run)

```text
muse-document-processing/runs/<study-id>/
├── evidence_inventory.json   # agent's grounded reading notes (pages/sheets/regions)
├── rendering_package.json    # Output 1: UI-renderable locations, geometry, depth
├── narrative_package.json    # Output 2: non-technical pointers per rendered target
├── report.json               # Output 3: non-technical whole-document analysis
└── study_package.json        # Final: document-study.v2 combining all three
```

`study_package.json` keeps the exact `document-study.v2` shape the UI consumes
today (see [contracts.md](contracts.md) and the live sample at
`../ui-v2/dist/study_package.json`). The other files are the inspectable
intermediates that compose it. Downloads, extraction scratch, and other
intermediate artifacts live in the git-ignored `playground/` workspace
(see [playground/README.md](playground/README.md)), never in `runs/`.

## Ground rules

- Never invent coordinates, depths, geometries, or measurements. Anything
  spatial must trace to an explicit page/region/row/record in the source file.
- Large native geometry (e.g. a 100k-feature KML) stays a file reference;
  it is never copied or approximated into the package.
- Outputs 2 and 3 are written for a lay reader: plain language, acronyms
  expanded, units spelled out, meaning before numbers.
- One document per run. A second document is a second run.
