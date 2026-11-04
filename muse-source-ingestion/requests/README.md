# City Requests

One JSON file per city. The workflow reads only this file for city
specifics; instructions stay generic. Create a new request for each city and
independently research every city-specific value.

## Fields

- `city`, `state`, `country`: required jurisdiction names. Use `state` for the
  closest applicable first-order administrative region (state, province,
  region, emirate, territory, constituent country, or local equivalent).
- `city_aliases[]`: alternate and historical city names.
- `district_aliases[]`: names of wider or overlapping administrative units the
  city spans or is confused with (district, county, prefecture, borough,
  province, metropolitan region, or local equivalent). The field name is kept
  for contract compatibility; its values need not literally be districts.
- `local_language_names[]`: names in local script(s) for search recall.
- `as_of_date`: request date (YYYY-MM-DD).
- `study_boundary`: free-text denominator for coverage claims (for example a
  municipal footprint, metropolitan boundary, or wider administrative frame).
  Every coverage class in the run is judged against this.
- `evidence_gaps[]`: priority suspected gaps, free text. These guide the Scout
  but do not limit discovery; the Scout also audits the wider subsurface evidence
  landscape and may combine related needs into broader complementary lanes.
- `target_capabilities[]`: visuals the collection should enable.
- `research_scope`: controls domain breadth. `mode` is `broad` or `focused`.
  In focused mode, `include_domains[]` defines the only primary research
  domains, `supporting_evidence[]` defines narrowly allowed dependencies, and
  `exclude_domains[]` names explicit non-goals. Prior-run inventory outside this
  scope may be recognized for dedupe but cannot suppress focused discovery or
  enter the final manifest.
- `source_policy`: freshness and format policy. Recommended fields:
  `recent_observation_window_years` (relative to `as_of_date`),
  optional `selection_window_mode` and `selection_cutoff_date`,
  `older_dynamic_evidence`, `older_stable_evidence`,
  `accept_any_useful_format`, `accepted_formats[]`, and
  `require_native_companion_search`. `accepted_formats[]` contains search hints,
  not an allowlist, when `accept_any_useful_format` is true. The recent window governs current-state
  claims for changing evidence; it is not a blanket ban on unique stable primary
  measurements or explicitly historical trend legs unless
  `selection_window_mode` is `strict`, in which case the cutoff applies to all
  acquisition, reuse, and selection.
- `trusted_domains[]`: jurisdiction-specific preferred host suffixes. These are
  search hints, not an allowlist; use an empty array when none are known.
- `preferred_publishers[]`: jurisdiction-specific preferred issuing bodies.
  These are search hints, not an allowlist; use an empty array when unknown.
- `guidance` (optional): qualitative research preferences. It must not contain
  hard search, fetch, download, byte, model-call, elapsed-time, lane-count, or
  selected-package limits. The workflow uses evidence saturation and marginal
  source value instead.

Never copy another request's country, administrative terminology, domains,
publishers, boundaries, dates, or evidence priorities. Research those values
for the requested jurisdiction.
