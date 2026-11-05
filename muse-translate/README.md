# Muse Translate

Agentic translation for study packages. One run handles **one translate
request** and produces per-language copies of the input package without
touching the English originals.

## How to invoke

From the `subsurface` directory, invoke the saved workflow with the completed
document-processing run as `input`, a translate-owned run directory as
`output_dir`, and the requested languages:

```text
Use a workflow. Run muse-translate/translate-workflow.js with input=muse-document-processing/runs/dgwr-karnataka-2023-v1 and output_dir=muse-translate/runs/dgwr-karnataka-2023-v1 and languages=["Kannada","Hindi"].
```

This is the same handoff convention used between source ingestion and document
processing: the completed upstream run becomes the next workflow's input. The
translation workflow reads `study_package.json`, `narrative_package.json`, and
`report.json` when present, never writes into the document-processing run, and
writes all translated artifacts under its own `output_dir`.

For a different completed study, change only the matching run id:

```text
Use a workflow. Run muse-translate/translate-workflow.js with input=muse-document-processing/runs/<study-id> and output_dir=muse-translate/runs/<study-id> and languages=["Kannada","Hindi"].
```

Paths are relative to the `subsurface` directory; do not prefix them with
`subsurface/`. Request files under `requests/` remain available for saved jobs,
but direct workflow arguments are the standard pipeline handoff.

The agent inventories the input, translates and packages every requested
language in parallel, then performs one final verification pass. It writes one
self-contained run directory under `muse-translate/runs/`.

There is no fixed code path to maintain. The operating procedure is
[WORKFLOW.md](WORKFLOW.md); the checked-in multi-agent runner is
[translate-workflow.js](translate-workflow.js). New jobs need only a new file
under `requests/` (see [requests/README.md](requests/README.md)) —
no language-specific code or workflow instructions.

## Outputs (per run)

```text
muse-translate/runs/<run-id>/
├── request.json              # frozen copy of the translate request
├── inventory.json            # input files, schema checks, translation plan
├── lanes/<lang>/             # one dir per language lane
│   ├── translation.json      # translated prose by object/block id
│   ├── trace.jsonl           # lane decisions and fallbacks
│   └── usage.json            # lane activity telemetry (not a stopping limit)
├── study_package_<lang>.json       # per-language full package copies
├── narrative_package_<lang>.json   # per-language narrative copies (when input has them)
├── report_<lang>.json              # per-language report copies (when input has them)
├── verification.md           # Spark final checks and unresolved items
└── run_summary.json          # activity, stopping rationale, blockers, gaps
```

`study_package_<lang>.json` keeps the exact `document-study.v2` shape the UI
consumes today (see [contracts.md](contracts.md)). Only prose fields are
translated; IDs, counts, evidence refs, numbers, and units are preserved.
Scratch and unverified probes live in the git-ignored `playground/` workspace
(see [playground/README.md](playground/README.md)), never in `runs/`.

## Language codes

Pass language names or ISO 639-1 codes: `Kannada` or `kn`, `Hindi` or `hi`,
`Tamil` or `ta`, `Telugu` or `te`, and so on. Names are case-insensitive.
The workflow normalizes every entry to its code (full table in
[contracts.md](contracts.md)) and outputs `study_package_hi.json`, never `hn`.
The standard pipeline invocation above currently requests Kannada and Hindi.

## Resume a partial run

Every incomplete run preserves its valid files and writes
`failure_report.json`. Resume the same output directory with the complete,
unchanged configuration and `resume=true`:

```text
Use a workflow. Run muse-translate/translate-workflow.js with input=muse-document-processing/runs/dgwr-karnataka-2023-v1 and output_dir=muse-translate/runs/dgwr-karnataka-2023-v1 and languages=["Kannada","Hindi"] and resume=true.
```

The launcher audits the frozen request, input identity/checksums, output
directory, requested language set, and fixed artifact paths before writing.
It reports whether work was `generated`, `resumed`, `resumed-with-reuse`, or
returned as a validated `complete_reused`. A mismatched checkpoint remains
terminal `partial`; it never silently starts over in the same run directory.

## Local lessons

Optional human-curated cues live in
`muse-translate/lessons/LESSONS.md`. Every workflow child reads it completely
when it exists. Lessons remain subordinate to the workflow, contracts,
request, hard gates, permissions, and observed evidence; they cannot provide
facts or weaken provenance requirements.

Runs never modify the file automatically. A human adds, edits, or removes its
numbered lessons. Whether the file was loaded is recorded in the run artifacts.

## Ground rules

- One translate request per run. A second job is a second run.
- Never edit the input directory. Translated copies go only under `output_dir`.
- Never invent facts, numbers, or evidence refs. Unknown prose stays explicit.
- Preserve every ID, count, evidence ref, metric value, and unit exactly.
- Translate only the prose fields listed in [contracts.md](contracts.md).
- Stop when every requested language is written and verified, or blockers are
  recorded — activity counts are telemetry only.
