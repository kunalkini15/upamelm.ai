# Synthesizer output contract

This is the proposed hand-off between `research-engine-v2` and the UI. The
synthesizer should remain the only stage that turns executor evidence into
cross-document conclusions. It should emit a human-readable report for the
research panel and a structured `research_bundle` for maps, 2D sections, 3D
generation, search, and the assistant.

The example at [`docs/examples/gandhinagar-synthesis.json`](examples/gandhinagar-synthesis.json)
is generated from `atlas_output_16849256461403930555file.json`. It is an
illustrative output contract: values not present in the Atlas metadata are
represented as candidates or unresolved items, never as measurements.

## Recommended top-level shape

```json
{
  "schema_version": "synthesis.v1",
  "research_id": "...",
  "status": "completed | partial | failed",
  "objective": "...",
  "summary": { "headline": "...", "abstract": "...", "confidence": {} },
  "sources": [],
  "observations": [],
  "entities": { "aquifers": [], "geological_units": [], "wells": [], "water_conditions": [] },
  "relationships": [],
  "visualisations": [],
  "evidence": [],
  "limitations": [],
  "unresolved_questions": [],
  "provenance": { "plan_version": 0, "execution_manifest_version": 0, "synthesizer_version": "..." }
}
```

### Design rules

- Every observation has a stable ID, a location/domain, confidence tier, and one
  or more page-level citations.
- `measured` means directly reported. `interpreted` means a defensible synthesis
  or spatial/model interpretation. `unknown` means the evidence is insufficient.
- Entities reference observations; visualisations reference entities and
  observations. A renderer must not draw a continuous boundary or layer merely
  because two point observations exist.
- Candidate geometry is allowed, but must carry `status: "candidate"`,
  `confidence.level: "interpreted"`, and a human-readable generation note.
- The Markdown report is a projection of this bundle, not the source of truth.

## Minimum object contracts

An observation should look like:

```json
{
  "id": "obs_...",
  "kind": "aquifer | lithology | water_level | chemistry | resource | issue | recommendation",
  "statement": "...",
  "location_id": "gandhinagar-gj",
  "domain_id": "groundwater",
  "value": { "name": "...", "top_m_bgl": 0, "bottom_m_bgl": 0 },
  "confidence": { "level": "measured", "rationale": "..." },
  "citations": [{ "document_id": "...", "page": 0, "anchor": "...", "excerpt": "..." }]
}
```

An entity is a UI-ready aggregation, not a new source claim. It must list the
observation IDs that support it. A visualization should look like:

```json
{
  "id": "viz_...",
  "kind": "model-3d | cross-section | diagram | chart",
  "title": "...",
  "status": "ready | candidate | blocked",
  "input_observation_ids": ["obs_..."],
  "input_entity_ids": ["aquifer_..."],
  "geometry_spec": { "coordinate_reference": "EPSG:4326", "vertical_datum": "unknown", "layers": [] },
  "rendering_notes": ["Do not interpolate between wells without supporting evidence."],
  "blocked_by": []
}
```

The current v2 `write_synthesis` tool can adopt this by adding a required
`research_bundle` object while retaining `content`, `findings`,
`unresolved_questions`, and `limitations` for backwards compatibility. The
executor's evidence manifest remains the citation authority; the synthesizer
must not fabricate missing coordinates, depths, units, or geometry.

