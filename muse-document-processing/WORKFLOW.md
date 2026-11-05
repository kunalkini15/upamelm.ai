# Deep Document Study - Agent Operating Procedure

One run studies one source document. The goal is not the smallest defensible
package. The goal is the richest useful UI package the source can support,
with uncertainty made visible rather than used as a reason to omit evidence.

## Durable checkpoints and resume

Every run freezes its complete launcher configuration and source identity in
`request.json` before extraction. Each stage updates `checkpoint.json` only
after validating its fixed-path outputs. Checkpoint boundaries are source
mapping/cache/OCR planning, every extraction lane, evidence reconciliation,
rendering, narrative/report authoring, integrated finalization, contract
compilation, and final verification.

On any terminal failure, preserve all files and write `failure_report.json`
with `status: partial`, `failed_stage`, `safe_retry_point`, completed artifacts,
unresolved work, and an ISO-8601 timestamp. Never delete or regenerate valid
completed work.

`resume=true` performs a read-only audit before mutation. The frozen request,
source path and checksum, output directory, and fixed artifact paths must
match. Model-returned counts and paths are advisory. Resume from the first
incomplete stage; validate lanes independently and invoke only missing,
invalid, or interrupted lanes. Valid source cache, OCR, extraction, hashes,
rendering, authoring, and validation artifacts are reused without repeating
their work.

When a child reaches its step cap, launch at most one bounded Spark recovery
agent for that stage or lane. It reads durable artifacts, finishes only missing
work, writes required files early, and reserves its final turn for
`submit_result`. If recovery cannot finish, return terminal `partial` so the
root orchestrator stops and a later process can resume safely.

## Success hierarchy

1. Recover all material information from the complete source.
2. Turn as much of it as possible into useful UI objects.
3. Preserve traceability and distinguish printed, derived, approximate, and
   externally enriched information.
4. Explain the study to an absolute beginner without flattening the science.
5. Produce an engaging visual and narrative experience.

Only fabricated scientific measurements or falsely precise claims are hard
failures. Qualified uncertainty is acceptable and expected.

This is a hackathon workflow: favour a rich, compelling, usable result over
conservative omission. Models may create scientifically reasonable analogies,
derived comparisons, explanatory synthesis, and alternative presentations
when their status is clear. An isolated bad reference, property, statistic,
narrative, or optional object must be repaired, simplified, downgraded,
quarantined, or omitted locally; it must not invalidate unrelated good work.

## Inputs and storage

- If `muse-document-processing/lessons/LESSONS.md` exists, read it completely
  before acting. It is supplemental local guidance: it cannot override this
  workflow, contracts, hard gates, permissions, or source evidence. Record
  whether it was loaded and never edit it during a run.
- `document`: one source file of any readable format.
- `output_dir`: one isolated directory under `muse-document-processing/runs/`.
- Temporary extraction files may use `muse-document-processing/playground/`.
- Durable extracted tables and figure assets used by the UI belong under the
  run directory and must be indexed in the packages.
- `resume=true` continues a partial run only when `request.json`, the source
  identity/checksum, exact output directory, workflow options, and checkpoint
  agree with the new invocation. Otherwise it stops without modifying work.

## Durable checkpoints and resume

Write `request.json` before substantive source processing and never silently
change it. Each sequential stage updates `checkpoint.json` after its fixed
artifacts parse and validate. Each extraction lane independently writes
`evidence/<lane-id>.json`, `evidence/<lane-id>-assets.json`, and
`evidence/<lane-id>-checkpoint.json`, so one interrupted lane does not invalidate
the others.

On a partial failure, preserve every valid artifact and write
`failure_report.json` with `status`, `failed_stage`, `safe_retry_point`, validated
completed artifact paths/checksums, unresolved work, and an ISO-8601 timestamp.
A resume audit is read-only: it derives state from fixed paths and valid files,
not child-agent references, counters, or returned path lists. Continue at the
first incomplete stage and rerun only missing, invalid, or interrupted lanes.
Never repeat source hashing, PDF extraction, OCR, authoring, or validation whose
recorded artifact is still valid.

When a child reaches its step cap, one bounded Spark recovery may read durable
artifacts and finish only missing work. If that recovery cannot complete, write
a terminal `partial` report so the root orchestrator stops. Artifacts are written
early; the final child turn is reserved for `submit_result`.

## Model policy

Spark performs source mapping, parallel extraction, reconciliation, initial
rendering, integrated authoring, contract verification, and assembly. Wonder
performs two focused passes: visual direction before authoring, then integrated
finalization after the Spark draft and self-check. Spark is the fallback for
either pass when Wonder is unavailable. The finalizer may reopen targeted
source regions and re-extract omitted evidence.

Source evidence remains authoritative, but “the evidence is imperfect” is not
sufficient reason to hide it when honest labelling can make it useful.

## Workflow

### 1. Map the complete source

Inspect every page, sheet, table, figure, legend, appendix, and attachment.
Write `source_map.json`, `source_cache.json`, `ocr_plan.json`, and
`extraction_plan.json`.
Classify the source as narrative, mixed, tabular annex, or dataset. Build a
lightweight cache of searchable page text/indexes, representative images,
contents, table schemas/ranges, and assets. Later agents use this cache and
reopen the original only for assigned extraction or recorded ambiguity. Record
each information-rich region, its type, source reference, likely UI value, and
extraction lane.

Mapping is never row-level scientific extraction. For repeated multi-page
tables, annexures, and datasets, inspect contents, headers, boundary pages, and
representative pages to plan extraction, but do not parse all rows, build full
scientific CSVs, calculate aggregates, or validate thousands of cells. Record
large table ranges as planned and partition them across extraction lanes.

Detect image-only, sparse-text, and garbled-text pages. The OCR plan makes an
explicit value gate for each affected page/range: `ocr` when it may materially
affect evidence or the UI, or `skip` only when incremental value is low with a
specific reason. Render required pages at readable resolution and assign them
to a Spark lane. Needing OCR is not itself a valid reason to defer content.

This pass exists to prevent early-page bias and summary-only reading.

### 2. Run complementary extraction lanes

Choose the smallest complementary set of 2-6 Spark lanes needed by the actual
document. Typical lane capabilities include:

- **spatial-data:** every coordinate row, place, boundary, alignment, map,
  extent, and spatial relationship;
- **subsurface-structure:** boreholes, depths, intervals, lithology, fractures,
  water levels, sections, profiles, overburden, and rockhead;
- **quantitative-findings:** measurements, ranges, trends, comparisons,
  forecasts, methods, proposals, limitations, and conclusions;
- **visual-story:** maps, charts, diagrams, photographs, legends, visual
  relationships, and story opportunities.

Each lane owns explicit regions and exclusions from `extraction_plan.json` and
uses the shared cache. It rereads the original only when ambiguity remains.
Do not stop because an arbitrary item or pass count was reached.

For tabular annexures/datasets, lanes perform row extraction concurrently,
write durable resources, validate schemas, row counts, coordinates, units and
boundary rows, prioritize study-scope rows, and retain useful broader context
without turning thousands of homogeneous rows into prose facts.

Quantitative evidence remains structured from extraction onward. Preserve one
record per source-backed observation with its subject or location, parameter,
date or category, numeric value, unit, range or uncertainty, status, and source
reference. Keep missing values missing. Never merge incompatible parameters or
units, interpolate absent measurements, or convert absence to zero.

For assigned OCR pages, Spark visually transcribes the relevant text or table
into `source-cache/ocr/`, preserves page/layout references, marks uncertain
cells, and performs a second image comparison for names, coordinates, units,
and measurements. Required OCR must finish or be documented genuinely
unreadable before the lane completes.

### 3. Reconcile evidence and audit coverage

Merge lanes into canonical `evidence_inventory.json`. Write
`coverage_audit.json`, accounting for every source-map region as extracted,
deferred with a specific reason, or missing. Reopen the source to resolve
conflicts. A high-value missing region prevents completion.

Reconcile `ocr_plan.json` as well: no material entry may remain pending, and
OCR-derived evidence retains its page, image path, confidence, and transcription
limitations.

Full extraction of manageable source tables is encouraged. Hundreds of rows
are acceptable when they create useful map features, profiles, or filters.
Use structured resources or native assets for genuinely large datasets.

### 4. Author and visually direct the rendering

Spark builds `rendering_package.json` directly against the rendering contract.
Wonder then acts as visual director and asks of every evidence group: can this
become a map object, depth view, table, chart, timeline, comparison, callout,
filter, or figure panel? Wonder may improve visual hierarchy, layers,
presentation roles, priorities, default visibility, and the default story
before Spark writes any narratives. Spark performs the same pass if Wonder is
unavailable.

Every useful quantitative group becomes `observations[]`, a structured
resource, `chart_series[]`, or a combination of them. Series use the exact
domain-neutral contract in `ui-output-contracts.json`; the evidence determines
whether the useful presentation is temporal, categorical, comparative,
distributional, relational, threshold-based, ranged, or another supported
quantitative form. Numeric chart points must survive into the UI and retain
evidence references and links to related objects.

Use this uncertainty policy:

- explicit printed coordinates are renderable as **reported reference points**
  even when the source does not say centroid, office, or sampling point;
- an individually implausible coordinate is quarantined; do not discard the
  rest of its table;
- figure-derived or digitized values are allowed when axes or labels support
  them, with `geometry_origin`/`value_origin` and approximate confidence;
- named-place geocoding may provide separately styled contextual geometry,
  with URL/date provenance, but never masquerades as a measured study point;
- proposed assets remain visually distinct from observed assets;
- derived envelopes are labelled sample/observation coverage, never study or
  administrative boundaries;
- a total depth without logged intervals supports a neutral shaft, not invented
  geology.

Write `renderability_audit.json` with included, newly added, and deferred
opportunities. Deferred evidence needs a concrete UI/technical reason.

### 5. Write and self-check feature analysis and report

Evaluate each narrative target independently. For a feature, write one
plain-language `analysis` only when the source contains meaningful evidence
about that exact object. Someone with no technical background must be able to
understand it on first reading. Explain necessary terms naturally and include
measurements only when they help communicate the finding.

Return an empty `analysis` when the available material is only an identifier,
coordinate, table position, list membership, shared layer conclusion, or a
statement about what is missing. Empty analysis is a correct result: the
geometry can still contribute to coverage, but the UI will not expose it as an
interactive map or 3D point. Never manufacture prose to satisfy coverage.

One Spark integrated author writes the complete narrative package and report.
It reads their exact sections of `ui-output-contracts.json` and the real adapter
expectations first, then emits `ui-narrative.v3` and `document-analysis.v1`
directly. The schema governs structure, not the depth or creativity of content.

The report tells the strongest human story supported by this particular
document. Its identity fields remain stable for the UI, while ordered blocks
follow the material rather than a mandatory theme or chapter template. A block
may have a short factual headline, readable Markdown content, compact metrics,
and related UI objects. All are optional except the block ID. Omit empty or
low-value blocks and never invent a metric or section to fill a layout.

Explain acronyms, specialist terms, and local units. Analogies must be
quantitatively sound. Never call a reduction a solution when the resulting
condition remains adverse.

The same author self-checks target coverage, grounding, cross-package IDs and
links, exact fields/types, beginner comprehension, jargon, repetition, and
generic filler, then repairs obvious defects before returning. Shared facts
belong in study/layer context. A feature analysis contains only that object's
genuine evidence-backed finding. When the source gives only a name and
coordinate, leave the analysis empty.
Record this check in `authoring_selfcheck.json`.

### 6. Finalize the complete experience

Wonder receives Spark's narratives, report, self-check, and every upstream
evidence/rendering artifact, and owns one integrated finalization pass. It
may edit evidence, rendering, narratives, report, audits, and source-linked
assets together; independently challenge the draft; recover material omissions; improve
the visual story and beginner-facing prose; and reconcile IDs, links, and
counts. It writes `finalization_record.json` and a reusable checkpoint.

There is no review/repair/re-review loop. Wonder preserves correct useful work,
uses targeted source-cache regions for disputed claims, and never invents a
scientific measurement or source claim. If Wonder is unavailable or fails to
return a usable result, Spark performs the same single integrated finalization
as a fallback. If a local item cannot be repaired confidently, remove or limit
that item and keep the rest of the package.

### 7. Verify the UI contract

All packages should already use their exact contracts. Run a lightweight
verification/normalization pass for mechanical issues such as types, optional
defaults, or stale counts, without rewriting content. Run the real adapter and
inspect what survived adaptation. A non-throwing adapter is insufficient:
fallback titles, empty finding statements, empty chapter prose, nullified
numeric callouts, missing narratives, and unusable resources must be repaired
or downgraded. They fail the stage only when the resulting package is
materially unusable; isolated recoverable defects become warnings.

For quantitative content, compare the finalized rendering package with the
adapted UI model. Series count, point count, numeric values, ranges, groups,
units, thresholds, linked-object IDs, and evidence references must survive.
Record every rejected or normalized series or point and its reason. Material
quantitative loss blocks completion; an isolated defective point is repaired
or removed locally.

### 8. Validate and assemble

Write `grounding_selfcheck.json` and `study_package.json`. Validate:

- exact schema versions and canonical evidence shape;
- complete source-region accounting and renderability accounting;
- all IDs, evidence refs, counts, narrative targets, and resource paths;
- every visible feature has a useful narrative;
- suspicious points do not distort bounds;
- geometry-free packages do not inherit unrelated fallback geography;
- scientific rendering is preserved before narrative attachment;
- the real UI adapter/loader accepts the final package when available;
- the adapted report contains no fallback titles or unexpectedly empty prose;
- numeric statistics and human-readable resource names survive adaptation;
- intended quantitative series and points survive adaptation without unit,
  evidence, range, grouping, or object-link loss;
- hard errors and warnings are reported separately.

`valid: true` means no hard contract or grounding error. It does not mean
warning-free. Any remaining warning produces `complete_with_limitations`.

On a rerun into the same output directory, validate and reuse source cache,
extraction, and other unaffected artifacts. Regenerate only missing, invalid,
stale, or upstream-affected outputs.

The workflow report records runtime-provided token usage for every attempted
agent call, including parallel extraction lanes and Spark fallbacks, and an
aggregate for the whole run. Never estimate missing usage: mark a call
unmetered and report whether the aggregate is fully or only partially metered.

## External context

Limited web use is allowed for term explanations, named-place context, and
contextual geocoding. Record URL, access date, purpose, and confidence. External
context cannot supply a missing scientific measurement or silently strengthen a
source conclusion.

## Hard gates

1. Do not fabricate scientific measurements, source statements, or precision.
2. Do not present derived, approximate, proposed, or externally enriched data
   as direct observation.
3. Do not silently discard a material source region or minority finding.
4. Do not mark a package fully complete while package-wide high-value
   extraction or UI omissions remain unexplained. Local unresolved defects may
   produce `complete_with_limitations` after the affected object is made safe.
