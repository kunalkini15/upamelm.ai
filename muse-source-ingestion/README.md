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
writes one self-contained city run under
`muse-source-ingestion/runs/<city-slug>/`.

There is no fixed code path to maintain. The operating procedure is
[WORKFLOW.md](WORKFLOW.md); the checked-in multi-agent runner is
[ingest-workflow.js](ingest-workflow.js). New cities need only a new file
under `requests/` (see [requests/README.md](requests/README.md)) —
no city-specific code or workflow instructions. Domains, publishers,
administrative terminology, boundaries, and evidence priorities belong in the
request file and are independently resolved for each city.

## Outputs (per run)

```text
muse-source-ingestion/runs/<city-slug>/
├── request.json            # frozen copy of the city request
├── inventory.json          # empty fresh-run inventory; reuse disabled
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
├── manifest.json           # sources acquired by this run (SourceManifest core)
├── comparison.md           # selection/rejection reasons, dedupe log
├── handoff.md              # per-source pointers for document-processing runs
├── run_summary.json        # activity, stopping rationale, blockers, gaps
├── verification.md         # Spark final checks and unresolved items
├── document_ranking.json   # Wonder information-value ordering for top-N use
├── document_ranking.md     # concise human-readable ranking
└── ranked/                 # ordered byte-identical copies: 01__..., 02__...
```

`manifest.json` keeps the `SourceManifest` / `AcquiredSource` core from
`../source-intelligence/src/source_intelligence/models.py` with documented
added fields (see [contracts.md](contracts.md)). Each manifest entry's
`local_path` is directly the `document` input of a
`muse-document-processing` run. Search scratch and unverified probes live in
the git-ignored `playground/` workspace
(see [playground/README.md](playground/README.md)), never in `runs/`.

The runner first uses a bounded Spark fresh-run initialization stage, then routes
strategic lane planning, independent critique, and final information-value
ranking to Wonder. Each Spark research lane is split into bounded candidate
discovery and acquisition/validation calls so neither must search, download,
validate, write every artifact, and submit within one agent loop. Spark also
performs synthesis, targeted repair, and final verification. Ranking uses compact
evidence artifacts and high-signal document sections rather than rereading all
content. This routing is explicit in `ingest-workflow.js`; changing the wording
of the invocation does not change the model assignment.

Canonical downloads retain their original names and manifest paths. Ordered
copies under `ranked/` add a zero-padded rank prefix, allowing a downstream
workflow to select the first five or six documents without changing provenance
or invalidating hashes.

The workflow never lists or inspects previous ingestion runs. `inventory.json`
is deliberately empty and reuse is disabled, so every run begins directly with
live discovery. This prevents earlier runs from consuming the scout's finite
child-turn allowance.

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

- One city per run. Store runs as `runs/<city-slug>/`; the directory name is
  the stable city/run identifier consumed by downstream systems.
- A publication page, abstract, or table of contents is not an acquisition.
  Only complete, opened, validated files are marked acquired.
- Never invent coordinates, dates, coverage, or measurements. Unknown facts
  stay unknown; local evidence stays labelled local.
- Never reuse a prior-run file. A rerun starts fresh and acquires its own
  selected sources through live discovery.
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
- Apply the request's recent-observation window to current dynamic evidence.
  Older dynamic material is historical-only and requires a recent anchor; older
  stable material requires a successor check and unique-evidence justification.
- Remain format-neutral. PDFs are first-class evidence, while every lane also
  searches applicable native tabular, vector, raster, archive, API, and
  companion assets. Select on evidence value and downstream usability, never a
  format quota.
