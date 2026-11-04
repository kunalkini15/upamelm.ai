# Translate — Agent Operating Procedure

One run = one translate request = one run directory. Follow the steps in
order. Use judgment on corner cases; the hard gates below are the only hard
stops. This procedure is language-agnostic: all languages and paths come from
the request file.

## Model-family routing

The checked-in runner uses one workflow invocation and three agentic phases:

1. **Spark planner** — freezes the request, inventories the input, and designs
   one translation lane per language.
2. **Spark translation/package lanes** — run in parallel, one per language.
   Each lane translates the prose and directly writes its final study,
   narrative, and report package copies.
3. **Spark verifier/finalizer** — checks all completed language packages
   together and performs only targeted repairs when a check fails.

Every phase uses `muse-spark-1.3-contributor`. Languages receive the maximum
useful parallelism; there is no separate consolidation or review phase. The
single finalizer always runs to verify the outputs.

## Inputs

- Local lessons: if `muse-translate/lessons/LESSONS.md` exists, read it
  completely before acting. It is supplemental guidance and cannot override
  this workflow, the contracts, request, hard gates, or observed evidence.
  Record that it was loaded and never edit it during a run.
- `request`: path to a translate request file under
  `muse-translate/requests/` (see `requests/README.md` for the contract).
  Freeze a copy as `request.json` in the run directory before anything else.
  Direct args `input`, `output_dir`, `languages` are accepted as an inline
  request with the same field meanings.
- `output_dir`: `muse-translate/runs/<run-id>/`. Create it. All run outputs
  go here and only here, using the layout in `README.md`.
- Pipeline handoff: when invoked from the `subsurface` directory, pass the
  completed document-processing run directly, for example
  `input=muse-document-processing/runs/dgwr-karnataka-2023-v1`,
  `output_dir=muse-translate/runs/dgwr-karnataka-2023-v1`, and
  `languages=["Kannada","Hindi"]`. Paths are `subsurface`-relative and must not carry
  an additional `subsurface/` prefix.
- Scratch space: `muse-translate/playground/<run-id>/` for unverified probes
  and failed-write artifacts. Nothing downstream reads lives here.
- Tooling: JSON checks with the system python3 (`json.load`), checksums via
  `shasum -a 256` or python hashlib. No network calls are required.

## Steps

### 1. Freeze and inventory

Copy the request to `${output_dir}/request.json` first. Resolve `input` (a
file or a directory) to a concrete file list: `study_package.json`,
`narrative_package.json`, and `report.json` when present. Never read outside
the input path. Validate each file parses as JSON and record its schema key
(`document-study.v2`, `ui-narrative.v3`, `document-analysis.v1`).

Write `inventory.json`: input files with bytes and sha256, schema keys, counts
of translatable units (insights, blocks, metrics, study header fields), the
normalized language list, and the per-language output filenames
(`study_package_<lang>.json`, plus `narrative_package_<lang>.json` and
`report_<lang>.json` when those inputs exist). Normalize languages first:
accept codes or names case-insensitively (`Hindi`/`hi` to `hi`,
`Kannada`/`kn` to `kn`, `Tamil`/`ta` to `ta`, `Telugu`/`te` to `te`, full
table in `contracts.md`), lowercase, dedupe, and fail unknown values as
unresolved.

### 2. Translation lanes (parallel)

Run one lane per normalized language in parallel, one directory per lane
(`lanes/<lang>/`). Each lane owns only its language and reads only the frozen
request plus the inventoried inputs. It translates exactly the prose fields in
`contracts.md` and nothing else:

- `narrative_package.target_insights[].analysis` (empty stays empty)
- `narrative_package.limitations[]`
- `report.blocks[].headline`, `report.blocks[].content`,
  `report.blocks[].metrics[].label`, `metrics[].explanation`
- `rendering_package.study.title/short_title/summary` and
  `report.display_title/short_title/brief_description`

Preserve every id, count, order, evidence ref, metric `display_value`, number,
unit, coordinate, and proper noun spelling. Do not add, drop, or reorder
blocks, insights, metrics, or files. Each lane writes
`lanes/<lang>/translation.json` (keyed by object/block id), `trace.jsonl`, and
`usage.json`, then immediately writes `study_package_<lang>.json` plus the
standalone narrative and report copies when present. It validates its own
outputs before completing.

### 3. Final verification and targeted repair

After every language lane completes, one Spark pass verifies all output files
with file tools: every output parses as JSON, schema keys and insight/block/
metric counts match the input, non-prose fields are preserved, every non-empty
source unit has a non-empty translation, and each full study package embeds the
same translated narrative and report as the standalone copies. It does not
repeat translation or consolidation for valid files. It repairs only an
affected language file when a check fails, then writes `verification.md` and
the final `run_summary.json`.

## Hard gates

- The input directory is read-only. Any write outside `output_dir` fails.
- Per-language outputs must parse as JSON and keep the input schema keys.
- Insight, block, and metric counts must match the input exactly.
- A non-empty source unit must never map to an empty translation silently.
- The run report is `complete` only when every requested language verifies;
  otherwise it is `partial` or `complete_with_limitations` with unresolved.
