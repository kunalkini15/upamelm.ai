# Kept UI Contracts

The agent keeps the exact shapes the UI already consumes. The authoritative
live sample is `../ui-v2/dist/study_package.json`
(read by `../ui-v2/src/core/AgenticStudyAdapter.ts`).
Field shapes below are summaries, not replacements — when in doubt, match the
sample and the Loop 2 producers in
`../agentic-subsurface/src/agentic_subsurface/loop2.py`.

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

- feature: `id`, `name`, `type`, `geometry` (GeoJSON or null),
  `location_description`, `properties[{name, value, unit}]`, `source_refs`,
  `dataset_ids`, `fidelity`, `source_object_ids`.
- narrative target: `id`, `kind` (`study|layer|vertical_profile|feature`),
  `object_id`, `priority`, `source_refs`.
- `coverage`: counts reconciling Loop 1-style inputs to rendered outputs;
  `discarded_*` counts must be zero — unrenderable material goes to
  `non_renderable`, never vanishes.

## Output 2: `narrative_package.json` (`ui-narrative.v2`)

Keys: `schema_version`, `study_id`, `target_insights[]`, `coverage`,
`limitations`.

- insight: `target_id`, `target_kind`, `object_id`, `status`
  (`complete|limited`), `headline`, `summary`, `why_it_matters`,
  `visual_takeaway`, `insights[{type, title, explanation, evidence_refs,
  grounding_status}]`, `secondary_context`, `evidence_refs`, `limitations`.

## Output 3: `report.json` (`report-synthesis.v1`)

Keys: `schema_version`, `report_id`, `executive_overview{headline, abstract,
key_finding_ids[], key_stat_callout_ids[], generation_mode}`, `themes`,
`chapters`, `findings`, `stat_callouts`, `uncertainties`, `coverage`.

## Evidence inventory (agent-only, not UI-read)

`evidence_inventory.json` is the run's private grounding anchor: a flat list
of `{ id, fact, source_ref, use[] }`. UI contracts cite these IDs in
`evidence_refs`/`source_refs` so any claim can be traced back to an exact
page, row, record, or image region.
