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

To continue a partial run in a new Muse process, invoke the same workflow with
the same complete configuration and `resume=true`:

```text
Use a workflow. Run muse-document-processing/study-workflow.js with
document=<same-source>, output_dir=<same-run-directory>, and resume=true.
```

Resume validates the frozen request, source checksum, output directory,
checkpoint, and fixed artifacts. It continues at the first incomplete stage;
valid extraction lanes and later artifacts are reused individually. The
terminal report identifies the execution as `reused`, `resumed`, or
`regenerated`.

From the `subsurface` directory, a normal launcher invocation is:

```text
Use a workflow. Run muse-document-processing/study-workflow.js with document=muse-source-ingestion/runs/<run>/lanes/<lane>/downloads/<document.pdf> and output_dir=muse-document-processing/runs/<study-id>.
```

After a partial result, invoke the same frozen configuration with resume enabled:

```text
Use a workflow. Run muse-document-processing/study-workflow.js with document=<same-document> and output_dir=muse-document-processing/runs/<same-study-id> and resume=true.
```

Resume is cross-process. The workflow validates `request.json`, source identity
and checksum, output directory, `failure_report.json`, and fixed artifact paths
before doing any work. It resumes at the first incomplete stage and reruns only
missing or invalid extraction lanes. A mismatch returns `partial` without
regenerating the existing run.

## Outputs (per run)

```text
muse-document-processing/runs/<study-id>/
├── evidence_inventory.json   # agent's grounded reading notes (pages/sheets/regions)
├── source_map.json            # complete map of source pages/tables/figures
├── source_cache.json          # reusable text/image/table extraction index
├── source-cache/              # extracted assets reused by downstream agents
├── ocr_plan.json              # value-gated visual OCR decisions and status
├── extraction_plan.json       # parallel extraction plan
├── coverage_audit.json        # every source region accounted for
├── rendering_package.json    # Output 1: UI-renderable locations, geometry, depth
├── renderability_audit.json   # included and deferred UI opportunities
├── authoring_selfcheck.json   # Spark's content, coverage, and schema check
├── finalization_record.json   # integrated Wonder rewrite and dispositions
├── request.json               # immutable canonical arguments and source identity
├── checkpoint.json            # completed phases and durable artifact paths
├── failure_report.json        # structured terminal partial state, when applicable
├── request.json               # frozen launcher configuration and source identity
├── failure_report.json        # terminal partial state and safe retry point
├── narrative_package.json    # Output 2: non-technical pointers per rendered target
├── report.json               # Output 3: non-technical whole-document analysis
├── contract_compilation.json # exact-schema and adapted-output checks
├── grounding_selfcheck.json  # explicit final grounding/UI checks
└── study_package.json        # Final: document-study.v2 combining all three
```

`study_package.json` keeps the exact `document-study.v2` shape the UI consumes
today (see [contracts.md](contracts.md) and the live sample at
`../ui/dist/study_package.json`). The other files are the inspectable
intermediates that compose it. Downloads, extraction scratch, and other
intermediate artifacts live in the git-ignored `playground/` workspace
(see [playground/README.md](playground/README.md)), never in `runs/`.

## Local lessons

Optional human-curated guidance lives in the git-ignored
`muse-document-processing/lessons/LESSONS.md` file. Every workflow child reads
the complete file when it exists. Lessons are subordinate to the workflow,
contracts, hard gates, permissions, and source evidence; they cannot introduce
facts or weaken provenance requirements.

Runs never modify lessons automatically. Humans add or refine numbered lessons
after reviewing real outputs. Each run records whether the file was loaded.

## Token telemetry

The returned workflow report includes `token_usage` on every stage and an
aggregate `token_usage` for the entire run. It captures input, output, total,
cached-input, and reasoning tokens when the Muse runtime exposes them. The
aggregate reports metered and unmetered stage counts and never invents values
for runtime calls that do not expose usage.

## Ground rules

- Extract complete manageable tables when they create valuable UI features;
  hundreds of source rows are acceptable. Truly large datasets remain indexed
  native/structured resources.
- Preserve origin and confidence. Printed coordinates with unclear semantics
  can be rendered as reported reference points; implausible individual outliers
  are quarantined without discarding their whole table.
- Image-only pages pass through a value gate: Spark visually transcribes
  material pages and skips only low-value scans with a concrete reason.
- Stage 1 only maps large annexures and datasets: it indexes table schemas and
  page ranges, while parallel Spark lanes perform row extraction and validation.
- Outputs 2 and 3 are written for a lay reader: plain language, acronyms
  expanded, units spelled out, meaning before numbers.
- One document per run. A second document is a second run.
- Spark performs extraction, initial rendering, and integrated schema-valid
  authoring. Wonder owns visual direction before authoring and one integrated
  finalization afterward; Spark is the fallback for either Wonder pass.
- Completion requires both grounding and evidence/UI coverage. A safe but thin
  package is not successful.
- Rendering and human writing use `ui-output-contracts.json` when first created;
  final success still requires useful content after real UI adaptation, not
  merely valid JSON.
- Source extraction is cached once, lanes are document-specific, Wonder shapes
  the visual experience before Spark writes it, and Wonder then finalizes the
  complete experience coherently.
- Partial failures preserve valid work. Resume trusts validated fixed files and
  checksums—not child-agent references, returned counters, or returned path lists.
