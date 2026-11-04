# Kept UI Contracts

The agent keeps the exact shapes the UI already consumes. The authoritative
live sample is `../ui-v2/dist/study_package.json`
(read by `../ui-v2/src/core/AgenticStudyAdapter.ts`).
Field shapes below are summaries, not replacements — when in doubt, match the
sample and the Loop 2 producers in
`../agentic-subsurface/src/agentic_subsurface/loop2.py`.

The exact model-facing serialization contract is
[`ui-output-contracts.json`](ui-output-contracts.json). Final outputs must use
those field names and types. Draft aliases are never accepted merely because
the UI adapter does not throw.

## Final: `study_package.json` (`document-study.v2`)

Top-level keys: `schema_version`, `study_id`, `study_version_id`,
`document_id`, `status`, `source`, `primary_rendering_mode`, `capabilities`,
`rendering_package`, `scientific_rendering_package`, `narrative_package`,
`report`, `native_assets`, `limitations`, `unresolved_items`, `validation`.

- `rendering_package`: the Output 1 object, plus per-target `narrative`
  attachments and report headline/abstract as study title/summary.
- `scientific_rendering_package`: byte-identical copy of Output 1 before
  narrative attachment (lets the UI diff science from presentation).
- `validation`: `{ valid, issues[], counts{features, layers, profiles,
  narratives, issues}, scientific_package_preserved }`.

## Output 1: `rendering_package.json` (`study-rendering.v2`)

Keys: `schema_version`, `study{id, document_id, title, short_title, domain,
summary}`, `primary_rendering_mode`, `capabilities{map, native_vector_layers,
generated_features, vertical_profiles, structured_resources,
feature_selection, layer_selection, report}`, `layers`, `features`,
`observations`, `vertical_profiles`, `intervals`, `structured_resources`,
`narrative_targets`, `non_renderable`, `evidence_sidecar`, `coverage`,
`limitations`, `semantic_presentation`.

Backward-compatible extension fields may carry `chart_series`,
`figure_panels`, `timelines`, and asset references. They remain structured and
source-linked even when the current UI does not yet consume them.

`chart_series[]` is a first-class UI input. Every series has `id`, `title`,
`kind`, numeric `points[]`, and `evidence_refs[]`; optional fields describe
axes, units, ranges, groups, thresholds, uncertainty, status, and links to
features, observations, or datasets. Exact fields and types are defined in
`ui-output-contracts.json`. Preserve source rows as observations and series
points rather than replacing them with prose or a screenshot. Missing values
stay missing and incompatible parameters or units remain separate.

- feature: `id`, `name`, `type`, `geometry` (GeoJSON or null),
  `location_description`, `properties[{name, value, unit}]`, `source_refs`,
  `dataset_ids`, `fidelity`, `source_object_ids`, plus `geometry_origin`
  (`source_exact|source_reported|figure_derived|external_context|none`),
  `confidence`, `scientific_type`, `presentation_role`, `display_priority`,
  and `default_visibility` when applicable.
- narrative target: `id`, `kind` (`study|layer|vertical_profile|feature`),
  `object_id`, `priority`, `source_refs`.
- `coverage`: counts reconciling Loop 1-style inputs to rendered outputs;
  `discarded_*` counts must be zero — unrenderable material goes to
  `non_renderable`, never vanishes.

## Output 2: `narrative_package.json` (`ui-narrative.v3`)

Keys: `schema_version`, `study_id`, `target_insights[]`, `coverage`,
`limitations`.

- target analysis: `target_id`, `target_kind`, `object_id`, `analysis`,
  `evidence_refs`.
- `analysis` is one plain-language explanation of useful evidence tied to that
  exact object. Its length follows the evidence; it is not a template.
- Use `analysis: ""` when the document has no meaningful object-specific
  finding. Do not describe missing data or expand an identifier, coordinate,
  table row, list membership, or shared layer conclusion into prose.
- Empty feature analysis means the geometry may support aggregate coverage but
  must not become an interactive map or 3D point.

## Output 3: `report.json` (`document-analysis.v1`)

The stable identity envelope is `schema_version`, `report_id`, `source_title`,
`display_title`, `short_title`, `brief_description`, and ordered `blocks[]`.
Each block requires only `id`; it may contain a short factual `headline`, clear
Markdown `content`, compact `metrics[]`, `evidence_refs[]`, and
`related_object_ids[]`. A metric has `label`, presentation-ready
`display_value`, optional `explanation`, and `evidence_refs[]`.

The document decides the story shape. Do not force themes, chapters, findings,
metrics, caveats, or a minimum block count. Omit an empty block or metric group
instead of filling it with generic prose or statements about missing data.

## Evidence inventory (agent-only, not UI-read)

`evidence_inventory.json` has one canonical top-level shape:

`{ schema_version: "evidence-inventory.v2", study_id, source_document,
items[] }`.

Do not substitute `inventory`, a bare array, or another wrapper. Each item contains:

- `id`, `fact`, `source_ref`, and `use[]` (`render|pointer|report`);
- `evidence_type` (`observed|reported|derived|proposed|context`);
- `grounding_status` (`direct|derived|limited|conflicting`), plus a calibrated
  `confidence` (`high|medium|low`);
- `spatial_status` (`valid|suspect|unlocated|not_applicable`);
- `quality_flags[]`, using flags such as `suspect_coordinate`,
  `ambiguous_unit`, `conflicting_source_values`, `figure_only`,
  `proposed_not_observed`, `historical_not_current`,
  `regional_not_site_specific`, or `missing_context`;
- `plain_language_meaning`: one short sentence explaining the fact without
  adding an interpretation that is absent from the source.

UI contracts cite inventory IDs in `evidence_refs`/`source_refs`. A low-quality
item stays in the inventory and may become a qualified UI object. Its origin,
confidence, uncertainty, and source wording must remain visible.

## Source and coverage artifacts

`source_map.json` enumerates every source region with `region_id`, `source_ref`,
`content_type`, `description`, `estimated_ui_value`, and `assigned_lanes[]`.
It also records `document_shape` (`narrative|mixed|tabular_annex|dataset`) and
large table ranges with schema/header, page range, scope, and
`extraction_status: planned` when row extraction belongs to downstream lanes.
`extraction_plan.json` records extraction methods and lane assignments.
`source_cache.json` indexes reusable page text, rendered pages, extracted
tables, and assets so downstream agents do not repeatedly parse the source.
For large tabular sources it indexes ranges and representative pages instead
of containing prematurely parsed full datasets.

`ocr_plan.json` lists pages/ranges with missing or unreliable machine text.
Each entry records region, content hint, evidence/UI value, `ocr|skip` decision,
reason, assigned Spark lane, rendered image path, expected output, status,
output paths, and confidence. `ocr` entries cannot remain pending at
reconciliation; `skip` requires a value-based reason, not merely “needs OCR”.

`coverage_audit.json` accounts for every region as `extracted`, `deferred`, or
`missing`, with evidence IDs, candidate UI modes, and a reason. A missing
high-value region makes the stage incomplete.

`renderability_audit.json` groups opportunities into `included`, `newly_added`,
and `deferred`. Deferred items require evidence IDs, UI modes considered, and a
concrete reason; generic caution is not a reason.

`authoring_selfcheck.json` records narrative-target coverage, report coverage,
grounding, repeated-language checks, beginner-readability checks, cross-package
links, exact-schema checks, repairs, and remaining warnings. `checkpoint.json`
records completed phases and durable paths for targeted recovery without
repeating source work.

## Review artifacts (agent-only, not UI-read)

`finalization_record.json` records the one integrated Wonder finalization (or
Spark fallback), including reviewed artifacts, changes, recovered omissions,
review dispositions, remaining warnings, package-wide blockers, and the model
that finalized the package. The authority order remains source evidence,
inventory, contracts/grounding, current artifact, then reviewer suggestion.
The finalizer may mutate all draft packages coherently but does not become a
new scientific evidence source.

`grounding_selfcheck.json` records each final check with `id`, `passed`,
`evidence`, and `issues[]`, plus top-level `valid`, `errors[]`, and `warnings[]`.
It must report failures honestly; it is not a ceremonial `valid: true` file.

Contract failures are blocking only when the consumer cannot load or
meaningfully use the package, or when a systemic defect makes the result
misleading. Isolated malformed references, fields, narratives, statistics, or
optional objects are repaired when obvious; otherwise only the affected item
is limited or omitted and recorded as a warning. Unrelated valid content must
survive.

## Presentation semantics

Within existing extensible feature/layer metadata, preserve both scientific
meaning and UI intent: `scientific_type`, `presentation_role`,
`display_priority`, and `default_visibility`. Derived sample envelopes must be
named “sample coverage” or “located-well coverage”, never “study area”. A well
with total depth but no logged intervals may show a neutral depth shaft, but
must not contain synthetic strata.

Explicit coordinates with uncertain semantics are not automatically suspect.
Render them as `geometry_origin: source_reported` and describe them as reported
reference points. Reserve `suspect` for an internal inconsistency, implausible
outlier, transcription problem, or conflict with the source itself.

Narrative coverage applies to every interactive feature, including selectable
or listable null-geometry objects.
