# Subsurface Study — Agent Operating Procedure

One run = one source document = one run directory. Follow the steps in order.
Use judgment on corner cases; the ground rules below are the only hard gates.

## Inputs

- `document`: path to a single file (PDF, image, KML/KMZ, GeoJSON, CSV/TSV,
  XLSX, text, or anything else readable). Read it with whatever tool fits;
  never assume a format.
- `output_dir`: `muse-document-processing/runs/<study-id>/`. Create it. All run outputs
  go here and only here.
- Scratch space: `muse-document-processing/playground/<study-id>/` for
  downloaded sources, extraction working files, and intermediate artifacts
  (see `playground/README.md`). Nothing the UI reads lives here.

## Steps

### 1. Read and inventory

Open the document natively. Inventory everything a UI could render or explain:

- named places and areas, explicit coordinates, map extents, alignments;
- depths, elevations, thicknesses, intervals, materials, water levels;
- tables, legends, sections, bore logs, charts, drawings, photos that carry
  technical meaning;
- the document's purpose, scope, methods, limitations, and open questions.

Write `evidence_inventory.json`: a flat list of findings, each with a short
`fact`, a `source_ref` (page / sheet+row / record id / image region — exact
enough to re-find), and a `use` tag: `render`, `pointer`, `report`, or a
combination. This file is the grounding anchor for everything after it.

### 2. Rendering package (Output 1)

Build `rendering_package.json` in the `study-rendering.v2` shape
(see [contracts.md](contracts.md)):

- `features`: one per locatable thing with explicit geometry or coordinates.
  Points need source-backed lon/lat; lines/polygons need explicit vertices.
  A place name without coordinates keeps its meaning via
  `location_description` — never geocode from general knowledge.
- `layers`: groupings the UI can toggle, including native-asset layers that
  reference (not embed) large source geometry files.
- `vertical_profiles` + `intervals`: depth/elevation stacks linked to their
  feature where the link is stated or unambiguous.
- `observations`: measurements and source-backed values tied to features.
- `structured_resources`: tables/datasets exposed as file-backed resources.
- `narrative_targets`: one `feature` target per rendered feature, one `layer`
  target per layer, one `vertical_profile` target per profile, one `study`
  target. IDs must be stable within the run.

### 3. Element pointers (Output 2, non-technical)

Build `narrative_package.json` in the `ui-narrative.v2` shape: one insight entry
per feature target with valid geometry.

- Write for a lay reader: two or three short sentences of plain summary,
  practical significance in `why_it_matters`, what to notice in
  `visual_takeaway`. Expand acronyms, spell out units, explain terms in place.
- Every claim must trace to `evidence_inventory.json` entries; cite their IDs
  in `evidence_refs`. If evidence is thin, say what is known and what is
  missing instead of inflating importance.
- Layers, profiles, and the study itself get no separate entries here; their
  story belongs in the report.

### 4. Whole-document report (Output 3, non-technical)

Build `report.json` in the `report-synthesis.v1` shape:

- Cover purpose, scope, methods, major themes, grounded findings, key numbers,
  uncertainties, limitations, and open questions — including valuable
  non-spatial material.
- Same plain-language standard as Output 2. Lead paragraphs with conclusions;
  keep numbers sparse in prose and preserve the rest in findings/stat callouts.
- No cross-document or city-wide conclusions. Distinguish what the source
  states from what you synthesized across its pages.

### 5. Final assembly and self-check

Build `study_package.json` in the `document-study.v2` shape: embed the three
outputs, attach each pointer to its rendered target as `narrative`, record
`native_assets`, `limitations`, and `unresolved_items`, and fill `validation`
honestly (counts + any issues found, not a forced `valid: true`).

Self-check before finishing:

- every feature/layer/profile/interval ID referenced anywhere exists;
- every narrative `target_id` matches a `narrative_targets` entry;
- every `evidence_ref` resolves to the inventory;
- no coordinate, depth, or geometry lacks a source_ref;
- prose in Outputs 2–3 contains no unexplained jargon, acronym chains, or
  number walls.

## Hard gates (fail the run rather than violate)

1. No fabricated locations, geometry, depths, units, dates, or values.
2. No bulk transcription of large native datasets into model output or JSON.
3. No geocoding place names from general knowledge.
4. No dropping minority findings or inconvenient limitations to make a
   cleaner story — quarantine and label instead.
