# Kept Ingestion Contracts

The agent keeps the manifest shapes the codebase already defines. The
authoritative schema is
`../source-intelligence/src/source_intelligence/models.py`
(`SourceManifest`, `AcquiredSource`, `Candidate`, `CoverageOutcome`).
Field shapes below are summaries, not replacements — when in doubt, match
`models.py` and validate the produced manifest directly against that schema.

## Run manifest: `manifest.json` (`SourceManifest` core)

Top-level keys: `schema_version`, `run_id`, `city`, `state`, `country`,
`as_of_date`, `created_at`, `sources[]`, `coverage[]`, `budget_usage`,
plus the documented additions below.

`budget_usage` is retained only because it is part of the existing core schema;
in this agentic workflow it stores observed activity telemetry and stopping
rationale, never enforcement limits.

- Acquired source (`AcquiredSource` core): `source_id`, `category`,
  `title`, `publisher`, `landing_url`, `download_url`, `publication_date`,
  `data_period_start`, `data_period_end`, `freshness_basis`,
  `freshness_confidence`, `media_type`, `filename`, `local_path`,
  `sha256`, `size_bytes`, `selected_score`, `selection_reason`,
  `retrieved_at`.
- Coverage outcome: `category`, `status`
  (`selected | covered_by_existing | unresolved`), `selected_source_id`,
  `candidates_considered`, `reason`.
- Added fields (documented here, preserved across runs): top-level
  `existing_sources`, `packages`, `rejected_candidates`, `dedupe_log`;
  per-source `package_id`, `coverage` (class + footprint description),
  `observation_date_text`, `upload_date`, `achievable_visual`,
  `acquisition` (`acquired | reused_existing`), `lane_candidate_ref`,
  `limitations[]`, `validation{}`, and `successor_check` (newer editions,
  updated datasets, or wider-coverage alternatives checked, plus the unique
  evidence that justifies retaining an older source).

Unknown dates stay null with the reason in `limitations`; never default
a missing observation date to the publication date.

## Request file: `requests/<city>.json`

Keys: `city`, `state`, `country`, `city_aliases[]`,
`district_aliases[]`, `local_language_names[]`, `as_of_date`,
`study_boundary` (free-text denominator for coverage claims),
`evidence_gaps[]`, `target_capabilities[]`, `research_scope`,
`source_policy`, `trusted_domains[]`, `preferred_publishers[]`. Optional `guidance` may express
research preferences, but numeric activity or package limits are not part of the
operating contract.

`research_scope.mode` is `broad` or `focused`. In focused mode:

- `include_domains[]` are the only primary discovery and selection domains;
- `supporting_evidence[]` permits only evidence directly needed to interpret an
  included domain, with that dependency stated per candidate;
- `exclude_domains[]` are explicit non-goals;
- held sources outside scope may be fingerprinted for dedupe but cannot count as
  coverage, suppress a search lane, or enter the final manifest.

Scope controls scientific subject matter, while `source_policy` controls
freshness and file formats. Neither is inferred from invocation wording.

`source_policy.recent_observation_window_years` is calculated backwards from
`as_of_date`. Dynamic evidence outside that window cannot support a current-state
claim. It may be retained only as an explicitly historical trend leg when a
recent anchor exists. Older stable evidence is eligible only when a documented
successor check shows unique primary measurements, geometry, depths, or
stratigraphy. With `accept_any_useful_format: true`, `accepted_formats[]` is a
non-exhaustive set of search hints, not an allowlist, quota, or ranking. PDF is
fully eligible, while any useful native tabular, vector, raster, archive, API,
database, scientific-array, point-cloud, or other asset must also be considered
and retained when it adds usable evidence.

Optional `selection_window_mode: "strict"` with `selection_cutoff_date` makes
the cutoff a hard acquisition and selection gate for every evidence type.
Older held or discovered sources remain leads only and must not be downloaded,
reused, or selected in that run.
Never inherit geography, administrative hierarchy, publishers, trusted domains,
categories, dates, coverage conclusions, or source-selection decisions from a
different request or prior run.

`evidence_gaps[]` are priorities rather than an exhaustive category list. The
strategist records a domain-wide coverage audit in `evidence_map.md` and may create
lanes for important missing evidence not named in the request when it improves
the requested subsurface model.

## Activity telemetry (observability only)

`run_summary.json` and each lane `usage.json` report observed searches, fetches,
downloads, bytes, and any available model usage. These figures explain what the
agents did; they are not caps and may not be used to stop research or reject a
high-value source. Unknown or unavailable counters remain explicitly unmetered.

Each lane's `candidates.json` also records its `current_baseline_check`: the
official repositories searched, newest authoritative candidate found, coverage
class, observation and publication dates, and any predecessor/successor
relationship established. Unknowns remain explicit.

## Document information-value ranking

`document_ranking.json` is an advisory ordering of the final selected sources;
it does not change `manifest.json` membership or canonical paths. It contains
`rubric_version`, `ranked_count`, and `ranked_documents[]`. Each ranked item has
`rank`, `source_id`, `original_local_path`, `ranked_local_path`,
`information_value_score`, `criterion_scores`, `rationale`, `key_information`,
`limitations`, and `recommended_use`.

Ranks are contiguous and every selected source appears once. Files under
`ranked/` are byte-identical copies with zero-padded rank prefixes; their hashes
must match the corresponding canonical manifest entries.

The strategist's lane plan records, for every lane: `id`, bounded `objective`,
`included_evidence_needs[]`, `supported_capabilities[]`, `exclusions[]`,
`selection_reason`, and completion evidence. It also records deferred evidence
areas and scientific, availability, or marginal-value reasons.

## Review and verification artifacts

`review.json` is the Wonder review contract: `approved`, `must_fix[]`,
`risks[]`, and evidence references. It is advisory input to the Spark finalizer
and is never itself a manifest source of truth.

`verification.md` is the finalizer's evidence log. It records existence,
parseability, byte size and checksum checks for every selected file; manifest
and path checks; activity-telemetry reconciliation; review-item dispositions; and remaining
unresolved gaps. A research gap may remain without failing the run, but a hard
gate violation may not.

## Handoff to document-processing

Each manifest entry is processable on its own: `local_path`
(repo-relative) is directly the `document` argument of a
`muse-document-processing` run, and `handoff.md` adds the evidence the
source contributes plus extraction pointers (key tables, figures, layers,
coordinate availability). Reused sources hand off identically to acquired
ones — downstream never distinguishes them.
