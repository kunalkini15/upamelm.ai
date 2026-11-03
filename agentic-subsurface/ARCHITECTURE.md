# Architecture

## Design boundary

The pipeline has two independent loops joined by a versioned Evidence Package.

```text
native sources
  -> immutable originals + deterministic derivatives
  -> semantic, multimodal evidence batches
  -> validated Evidence Package                 (Loop 1)
  -> scientific.v1 spatial/UI package
  -> feature narratives + report synthesis      (Loop 2)
```

The model never replaces native geometry, table rows, page images, or source files. It interprets them and returns references to stable artifacts.

## Source layer

`AdapterRegistry` currently supports PDF, KML/KMZ, CSV/TSV, XLSX/XLSM, JSON/GeoJSON, common images, and text/XML/HTML. Each adapter copies the original source, computes a SHA-256 checksum, writes native deterministic derivatives, and emits `SourceBundle` plus generic `SourceLocator` records.

PDF processing stores page text, layout blocks, every high-signal page render, detected tables with bounding boxes and rows, and visual-candidate metadata. KML/KMZ processing recursively preserves Point, LineString, LinearRing, Polygon boundaries and holes, MultiGeometry, and `gx:Track` geometries as GeoJSON, including altitude dimensions, standard placemark metadata, ExtendedData, and SchemaData. Namespace matching is version-independent. The model receives a collection profile and bounded representative sample while the complete geometry collection remains a native artifact. Tabular sources preserve every row and use cell/range or row locators.

Native materialization follows a common `discover -> process_work_unit -> merge` contract. Adapters discover units appropriate to their format (for example pages, sheets, row/record ranges, placemark ranges, frames, or line ranges). The scheduler selects process, thread, or sequential execution using the full discovered workload plus current CPU, memory, and I/O pressure. Chunk counts are calculated from the input itself; they do not encode sample-document page counts. Merge is ordinal and validates deterministic coverage, so sequential and parallel execution produce the same bundle.

Materialization state is local to one immutable document version. `stages/materialization/` contains the selected plan, work-unit manifest, one result per completed unit, isolated failures, resource samples, merge coverage, and a timing/byte summary. This permits unit-level resume and document-isolated reprocessing. Text and delimited-table discovery use bounded streaming passes rather than retaining the whole source in memory.

## Loop 1

`SemanticBatcher` creates lossless source-unit batches. Live batches are recursively split when their effective size or output density exceeds safe limits. Meta's `/responses/input_tokens` endpoint measures every live request before generation. Each batch uses a strict JSON Schema and high reasoning.

Text extraction targets roughly 120K source tokens, enforces a 128K exact request ceiling after instructions and metadata are added, and permits up to 128K output tokens. The old unconditional 45K pre-split is not used. Exact-input overflow, incomplete generation, output exhaustion, or structured-response failure recursively splits only the affected batch using token-balanced boundaries; successful sibling results remain reusable. Stage-specific configuration may create a new evidence version, while checksum-identical deterministic materialization is hardlinked or copied from a prior version so later stages do not repeat Stage 2.

The consolidation validator resolves every evidence locator against an artifact or content unit, removes invalid evidence, reports duplicate IDs, and records coverage. It never destroys the source or batch artifacts.

Every source is stored as an independently versioned document package. Execution scheduling is not part of the semantic version fingerprint: changing `max_workers` resumes the same candidate. Within a document, text leaves, visual-classification groups, and deep-visual groups use a bounded worker pool. The provider keeps atomic worst-case cost reservations for in-flight calls and commits actual usage under a lock, so concurrency cannot exceed the corpus budget. An existing bundle is loaded on resume instead of repeating deterministic PDF materialization.

Loop 1 is an eight-stage state machine. CLI `--start-step` and `--end-step` bounds are inclusive. A stage started in isolation loads its prerequisite artifacts and fails clearly when they are absent; it never silently reruns an earlier stage. Each version stores append-only stage timing records in `stage_telemetry.json`, partial status, batch manifests, and intermediate outputs so adapter and model performance can be compared document by document.

## Loop 2

The spatial synthesis call consumes the validated Evidence Package and deterministic asset manifest. It emits the repository's existing `scientific.v1` contract. Unsupported/non-spatial findings remain observations instead of receiving fabricated coordinates. Native bulk geometry remains a dataset path/reference.

Feature narratives and report synthesis are separate strict-schema calls. The final UI package embeds the report and attaches narratives by feature ID.

## Provider safety

- Model is hard-locked to `muse-spark-1.3-contributor`.
- Base URL is hard-coded to the official Meta endpoint.
- Credentials are loaded from the environment or an existing project `.env`; values are never captured.
- Inline image bytes are redacted from request artifacts.
- The cost ledger uses official Contributor pricing: $0.10/M uncached input, $0.002/M cached input, $0.20/M output.
- A prospective worst-case check stops a call before the configured cost ceiling.
- Retry is limited to 429, 5xx, network, and timeout failures with exponential backoff and jitter.
- Completed batches and synthesis artifacts are resumable.

## Prompt engineering

Prompts are versioned in `prompts.py` and keep stable instructions/schema before volatile batch content to support prompt caching. The extraction contract requires explicit provenance, distinguishes direct/source-interpreted/derived evidence, forbids invented coordinates and bulk-record transcription, and retains unresolved gaps. Schema changes are validated by live smoke tests before corpus execution.

