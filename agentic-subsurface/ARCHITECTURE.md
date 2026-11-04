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

Loop 2 is a five-stage, document-isolated state machine. It resolves active inputs
only through the Loop 1 `corpus_manifest.json`, then creates one study per Loop 1
document. Its first deterministic preparation stage snapshots and hashes that
package, audits evidence references, and builds the count-audited evidence
projection and native-asset registry. It derives a lossless semantic transport
that stores each canonical object once and uses reversible call-local handles;
an exact round-trip hash gate prevents evidence loss. The remaining stages generate a UI rendering package,
generates independently checkpointed feature narratives, synthesizes the
document-level report, and deterministically consolidates and validates the
study. Large native datasets remain references and are never expanded into
model prompts.

Rendering uses an LLM-authored semantic plan followed by deterministic
validation and materialization. Stage 2 projects every evidence item, linked
scientific object and native-asset descriptor into bounded semantic batches.
Oversized or output-exhausted batches split recursively; successful leaf
fragments are checkpointed and reconciled hierarchically. The model decides
whether evidence becomes a reused native layer, generated feature, profile,
structured resource, narrative/report-only evidence, or an unsupported item.
The host does not make those semantic decisions. It validates all identifiers,
asset references, evidence dispositions and coordinate provenance, materializes
truthful file-backed resources, and rejects incomplete coverage. Every Loop 1
evidence item, spatial feature and interval must be accounted for; report-only,
native-layer-only and vertical-only studies remain valid outcomes.

Each study fingerprint includes its one Loop 1 version and package hash, Loop 2
code and prompt versions, and semantic configuration. Operational settings do
not alter that semantic version. Adding a new document therefore runs Loops 1
and 2 only for that document. Existing active study packages remain immutable.
A user-supplied objective or guidance is intentionally absent: each semantic
stage has a fixed product contract, while factual study context is derived from
the Loop 1 package's source identity, summary, evidence counts and asset types.
A future Loop 3 consumes the Loop 2 study manifest for cross-study/city-level
synthesis. A selected Loop 2 stage range loads prerequisites and never silently
executes an earlier stage.

All Loop 2 model phases share one long-context execution contract: approximately
128K target input batches with a 10% soft operating band, exact token preflight, adaptive recursive split on input overflow
or incomplete output, resumable leaf fragments, bounded parallel workers, and
deterministic source-locator ordering before hierarchical reconciliation. Stage 2
and Stage 4 receive a small preceding overlap labelled context-only; immutable owned
unit IDs prevent duplicate dispositions while retaining boundary meaning. This applies to
rendering plans, target narratives, and document reports. Narrative targets are
restricted to individually selectable features with deterministically valid geometry
and reconciled by immutable target ID because each target has an independent bounded
evidence context. A report-only study produces an empty Stage 3 package without a
model call. Rendering and report fragments use
hierarchical model reconciliation with exact-counted, parallel approximately 128K
groups. The same operating band applies to initial and reconciliation calls, with
smaller calls only for unavoidable remainders or adaptive splits.

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

