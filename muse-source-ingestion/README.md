# Muse Source Ingestion

Agentic replacement for the `source-intelligence` code pipeline. One run handles
**one city** and produces a validated manifest of subsurface evidence sources
plus a handoff the document-processing workflow consumes.

## How to invoke

Ask Muse Code to use the saved workflow and name the city request:

```text
Use the source-ingestion workflow for muse-source-ingestion/requests/<city>.json.
```

The agent resolves the city, inventories local holdings, searches the public
web for complementary evidence, downloads and validates complete files, and
writes one self-contained run directory under `muse-source-ingestion/runs/`.

There is no fixed code path to maintain. The operating procedure is
[WORKFLOW.md](WORKFLOW.md); the checked-in multi-agent runner is
[ingest-workflow.js](ingest-workflow.js). New cities need only a new file
under `requests/` (see [requests/README.md](requests/README.md)) —
no city-specific code or workflow instructions. Domains, publishers,
administrative terminology, boundaries, and evidence priorities belong in the
request file and are independently resolved for each city.

## Outputs (per run)

```text
muse-source-ingestion/runs/<run-id>/
├── request.json            # frozen copy of the city request
├── inventory.json          # local + reused sources (validated, with provenance)
├── evidence_map.md         # existing coverage and gaps before discovery
├── lanes.json              # strategist lane plan (ids, objectives, needs, exclusions)
├── lanes/<lane>/           # one dir per discovery lane
│   ├── candidates.json     # assessed candidates with reasons
│   ├── excerpts.md         # evidence excerpts with page/section refs
│   ├── validation.json     # per-file validation results
│   ├── trace.jsonl         # search and tool-call trace
│   ├── usage.json          # lane activity telemetry (not a stopping limit)
│   └── downloads/          # complete acquired files (originals)
├── draft/                   # Spark synthesis reviewed before finalization
│   ├── manifest.json
│   ├── comparison.md
│   ├── handoff.md
│   └── run_summary.json
├── review.json              # read-only Wonder strategic review
├── manifest.json           # acquired + reused sources (SourceManifest core)
├── comparison.md           # selection/rejection reasons, dedupe log
├── handoff.md              # per-source pointers for document-processing runs
├── run_summary.json        # activity, stopping rationale, blockers, gaps
└── verification.md         # Spark final checks and unresolved items
```

`manifest.json` keeps the `SourceManifest` / `AcquiredSource` core from
`../source-intelligence/src/source_intelligence/models.py` with documented
added fields (see [contracts.md](contracts.md)). Each manifest entry's
`local_path` is directly the `document` input of a
`muse-document-processing` run. Search scratch and unverified probes live in
the git-ignored `playground/` workspace
(see [playground/README.md](playground/README.md)), never in `runs/`.

The runner routes strategic planning and independent critique to Wonder, while
Spark performs parallel discovery, synthesis, targeted repair, and final
verification. This routing is explicit in `ingest-workflow.js`; changing the
wording of the invocation does not change the model assignment.

## Local lessons

Optional human-curated cues live in the git-ignored
`muse-source-ingestion/lessons/LESSONS.md` file. Lessons are numbered as
sections inside this single file. Every workflow child reads it completely
before acting. Lessons remain subordinate to
the workflow, contracts, request, hard gates, permissions, and observed
evidence; they cannot provide city facts or prove sources exist.

Runs never modify the file automatically. A human adds, edits, or removes its
numbered lessons. Whether the file was loaded is recorded in the run artifacts.

## Ground rules

- One city per run. A second city is a second run from its own request file.
- A publication page, abstract, or table of contents is not an acquisition.
  Only complete, opened, validated files are marked acquired.
- Never invent coordinates, dates, coverage, or measurements. Unknown facts
  stay unknown; local evidence stays labelled local.
- A file held by the current or a previous run under `runs/` is registered
  as `reused_existing` with provenance after validation — never silently
  skipped, never re-downloaded needlessly. Nothing outside `runs/` counts
  as held.
- Stop when material leads are resolved or inaccessible and further search
  refinement yields no stronger or complementary evidence. Activity counts are
  telemetry only. Never claim the collection is exhaustive.
- Treat requested evidence gaps as priorities rather than the entire domain.
  Audit the wider subsurface landscape and choose a coherent set of bounded,
  complementary lanes that maximizes scientific and visual coverage.
- Establish the newest authoritative citywide or closest-available baseline
  before selecting specialist or older sources. Weight freshness strongly for
  changing observations, while retaining older material only when it contributes
  unique primary measurements, geometry, depths, or historical comparison.
