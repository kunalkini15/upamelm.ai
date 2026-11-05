# Generic synthesizer evaluation and implementation plan

## Executive assessment

The extractor output is scientifically rich enough to support a detailed report
and a visualization-ready UI package comparable to the prototype fixture. The
remaining work is mainly evidence assembly, normalization, reconciliation, and
output design rather than further document extraction.

The full logical run contains 35 planned chunks. The unbounded run completed 34;
the missing dense chunk was recovered as two physical child artifacts. The
effective synthesis input is therefore 36 physical evidence artifacts plus 22
target-level analyses. Across those artifacts are approximately:

- 417 extracted facts;
- 208 structured or semi-structured records;
- 30 relationships;
- 160 explicit uncertainties; and
- 152 limitations.

Every extracted fact has an evidence object. 323 of 417 facts have an explicit
`pdf_page_number`; the remaining references are less machine-precise and need
normalization or review. The output includes spatial bounds, coordinates,
monitoring and well records, exploration intervals, litholog sequences,
properties and measurements, temporal trends, maps and cross-section references,
resource and management evidence, and explicit warnings about unsupported
geometry.

## Important current failure mode

The current synthesizer loads only the latest evidence manifest and the current
top-level compact bundle. In this run, those are the bounded recovery artifacts.
That means the current implementation would see only the two recovered child
chunks and one group analysis, silently omitting the 34 successful artifacts from
the original unbounded run.

Synthesis must first construct an **effective evidence manifest**:

1. Select the latest unbounded manifest as the base run.
2. Overlay later successful bounded recoveries by logical `chunk_id` or
   `parent_chunk_id`.
3. Replace the failed logical chunk with all successful recovery children.
4. Rebuild affected target-level analyses from the recovered set, or select the
   latest complete target analysis.
5. Verify that every required planned chunk is either covered or explicitly
   unresolved.
6. Persist the assembled manifest as a synthesis input artifact so the selection
   is auditable and resumable.

The top-level `evidence_manifest.json` should never be treated as synonymous with
the complete run history.

## What the extractor already supports

The handoff can support these generic synthesis products today:

| Product | Readiness | Notes |
| --- | --- | --- |
| Narrative research report | High | Broad findings, interpretations, limitations, and citations are present. |
| Evidence explorer | High | Artifact, document, page, table, and figure provenance are available, though some citations need canonicalization. |
| Point map | High | Coordinate-bearing records exist; invalid or ambiguous coordinates must be quarantined. |
| Charts and tables | High | Time series, measurements, categories, and source tables are present. |
| Profiles and sections | Medium-high | Vertical intervals and source-authored section interpretations exist; metric geometry varies by artifact. |
| 3D evidence scene | Medium | Point/column geometry can be rendered. Continuous surfaces remain interpreted unless source geometry is digitized. |
| Fully authoritative 3D model | Low-medium | CRS, datum, entity matching, original mesh geometry, and interpolation controls are not consistently available. |

This distinction should be encoded in the output rather than left to UI judgment.

## Quality issues the synthesizer must handle

### 1. Heterogeneous vocabulary

Fact types currently contain many equivalent spellings, for example
`direct_source_observation`, `direct source observation`, `direct-observation`,
and `source_observation`. This is rich evidence with an unstable label layer.

Normalize into a small generic enum while preserving the original value:

- `direct_observation`
- `source_interpretation`
- `extractor_derivation`
- `recommendation`
- `hypothesis`
- `missing_or_negative_evidence`

### 2. Heterogeneous record shapes

Records legitimately differ by source, but common metadata is inconsistent.
Create a canonical envelope and keep domain payloads opaque:

```json
{
  "id": "stable-id",
  "entity_type": "source-defined-type",
  "label": "human label",
  "attributes": {},
  "measurements": [],
  "spatial": {},
  "temporal": {},
  "evidence_refs": [],
  "classification": {},
  "quality": {},
  "source_payload": {}
}
```

This remains domain-independent: the synthesizer does not need an aquifer, legal,
medical, financial, or other fixed schema.

### 3. Grounding flags

The artifacts contain 336 grounding flags. Many are repetitive validator messages
such as an evidence pointer with no normalized target, but 73 records are explicitly
flagged as lacking grounded evidence. The synthesizer must not promote those records
to material findings without resolving their backing source.

Treat grounding as a gate:

- `grounded`: valid document and source locator;
- `partially_grounded`: source exists but locator is incomplete;
- `unresolved`: backing evidence cannot be resolved;
- `invalid`: locator contradicts the artifact or source inventory.

### 4. Identity resolution

Names can vary across narrative, tables, annexures, and figures. Entity matching
should use normalized names plus available coordinates, administrative context,
time, type, and source identifiers. Never merge on name alone. Preserve aliases and
record the match confidence and rationale.

### 5. Units, coordinate systems, and datums

Normalize units but retain raw values. Never combine values whose reference frames
are incompatible. Spatial and vertical values need independent metadata:

```json
{
  "horizontal": { "coordinates": [], "crs": null, "crs_status": "assumed_or_unknown" },
  "vertical": { "value": 0, "unit": "m", "reference": "below_ground|amsl|other|unknown" }
}
```

Coordinates outside declared or observed bounds, impossible latitude/longitude,
and source spreadsheet errors must be quarantined.

### 6. Geometry and visualization claims

Keep five classes distinct:

1. measured point or interval;
2. source-authored interpreted geometry;
3. extractor-normalized geometry;
4. synthesizer-derived calculation;
5. hypothetical or interpolated display geometry.

Only the first three may be presented as source-backed geometry. The fourth and
fifth require method, parameters, confidence, and explicit UI labeling.

## Recommended synthesizer architecture

### Phase A: deterministic run assembly

Build and persist `effective_evidence_manifest.json`. Resolve artifact versions,
recoveries, supersession, coverage, hashes, and source inventories without an LLM.
Fail closed on missing required artifacts; allow partial completion only with an
explicit coverage record.

### Phase B: evidence normalization and indexing

Transform every fact, record, relationship, uncertainty, limitation, table, figure,
and visual reference into canonical envelopes. Preserve lossless references to the
original artifacts. Build indexes by:

- objective outcome or planner target;
- entity and alias;
- document/page/table/figure;
- spatial and temporal scope;
- measurement/property;
- evidence class and grounding status; and
- contradiction or uncertainty cluster.

This stage should be deterministic wherever possible. Model assistance may suggest
aliases or semantic classes, but code must validate the result.

### Phase C: coverage and conflict audit

Before writing conclusions, assess each planner target and requested downstream use:

- evidence present;
- evidence present but weak or conflicting;
- missing expected information;
- visualization possible as measured data;
- visualization possible only as interpretation; or
- visualization blocked.

Cluster duplicate claims, preserve materially different scope, and create explicit
conflict sets rather than selecting a convenient value silently.

### Phase D: bounded thematic synthesis

Do not place every complete artifact into one model prompt. Use the compact bundle
and indexes for routing, then retrieve complete artifacts only for the themes being
synthesized. A generic sequence is:

1. objective and coverage synthesis;
2. entity and relationship synthesis;
3. measurement and temporal synthesis;
4. spatial and visualization synthesis;
5. uncertainty, conflict, and limitation synthesis; and
6. final integration.

Each intermediate output must cite evidence IDs, not free-form page prose. This
allows retrying one theme without regenerating the entire report.

### Phase E: deterministic validation

Before publication, validate:

- every material finding resolves to one or more admissible evidence items;
- every citation resolves to a source document and locator;
- every referenced entity and relationship exists;
- units and reference frames are compatible;
- numeric ranges are ordered and plausible;
- invalid coordinates are excluded from renderable datasets;
- visualization recipes declare measured versus interpreted inputs;
- limitations and unresolved conflicts are retained; and
- no unsupported claim appears only in narrative text.

### Phase F: projections for consumers

The source of truth should be a structured synthesis bundle. Other outputs are
projections:

- `research_report.md` for humans;
- `synthesis_bundle.json` for UI and APIs;
- `evidence_ledger.json` for citations and audit;
- `entity_catalog.json` for search and drill-down;
- `datasets/*.json|geojson|csv` for charts and maps;
- `visualization_manifest.json` for renderable and blocked visual products;
- `synthesis_result.json` for stage status, coverage, versions, and usage.

## Generic output contract

The structured bundle should avoid domain-specific top-level fields. A suitable
shape is:

```json
{
  "schema_version": "synthesis.v1",
  "research": {},
  "summary": {},
  "coverage": [],
  "findings": [],
  "entities": [],
  "relationships": [],
  "measurements": [],
  "datasets": [],
  "spatial_extents": [],
  "temporal_extents": [],
  "visualizations": [],
  "evidence": [],
  "conflicts": [],
  "uncertainties": [],
  "limitations": [],
  "unresolved_questions": [],
  "provenance": {}
}
```

Domain meaning lives in extensible `type`, `attributes`, and `semantics` fields,
not hard-coded aquifer-specific properties. Visualization entries are declarative
recipes containing data references, channels, geometry class, confidence,
transformations, and blockers. They should not embed invented meshes.

## Suggested implementation order

1. Implement effective-manifest assembly and tests for full-run plus bounded
   recovery merging.
2. Define versioned Pydantic models for canonical evidence and synthesis output,
   allowing extensible payload fields.
3. Implement provenance, citation, coordinate, unit, and reference-frame validators.
4. Build the deterministic normalizer and evidence indexes.
5. Implement coverage/conflict auditing and persist the audit artifact.
6. Add bounded thematic synthesis with artifact retrieval rather than one giant
   prompt.
7. Generate the structured bundle first, then derive Markdown and UI datasets.
8. Validate outputs and add offline tests with generic fixtures from more than one
   domain so example-specific assumptions are caught.

## Acceptance criteria

The synthesizer is ready when it can:

- reconstruct a complete logical evidence run across retries and recoveries;
- produce the same canonical output shape for unrelated domains;
- trace every material claim and rendered datum to versioned evidence;
- preserve conflicts instead of flattening them;
- distinguish observation, source interpretation, derivation, and hypothetical
  visualization;
- produce useful UI datasets even when 3D geometry is unavailable;
- label every visualization as `ready`, `interpretable`, or `blocked` with reasons;
- resume after a failed thematic pass without repeating completed passes; and
- generate a report without requiring the original document to fit in one model
  context.

