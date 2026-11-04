# Consolidation: Bengaluru 2026-11-04 — comparison & selection record

Run dir: `agentic-sourcing/runs/bengaluru-2026-11-04/consolidation/`
Brief: `source-intelligence/examples/bengaluru.json` (gaps: borehole lithology with depth, soil horizons, recent groundwater observations; targets: subsurface cross-section, depth-to-rock map, monitoring time series; max 5 packages).

## 1. Prior-manifest situation (no old `source_manifest.json`)

No `source_manifest.json` exists anywhere in the repo for this run (repo-wide search: zero hits; recon confirmed the same-named files in research-engine-v2 and agentic-subsurface are those modules' own internal artifacts with different schemas, not consumers of this run). So `manifest.json` follows the canonical contract in `source-intelligence/src/source_intelligence/models.py` (`SourceManifest` / `AcquiredSource`, schema `source-intelligence.v1`) verbatim for all native fields, and carries the 4 already-held inventory items plus consolidation bookkeeping in documented added fields (section 2). Nothing was renamed: inventory ids (`aquifer_report`, `metro_phase3_engineering`, `metro_phase3_environmental`, `bwssb_water_supply_kml`) are preserved verbatim under `existing_sources[].id`.

## 2. Added fields (every non-schema field, with reason)

Top-level additions to `SourceManifest`:
- `existing_sources` — the 4 verified inventory items (coverage, dates, file+sha256, pages). Reason: the manifest must represent the full evidence base; these local-only files have no landing/download URL so they cannot be `AcquiredSource`s without fabricating URLs.
- `packages` — 2 selected packages grouping 4 acquired files by investigation identity. Reason: `AcquiredSource` is per-file; selection was per-package (task: up to two packages), so the grouping must be explicit.
- `rejected_candidates` — every non-selected candidate with a reason. Reason: auditability of the up-to-two cut.
- `dedupe_log` — cross-lane identity resolutions with evidence. Reason: prevents double extraction/counting.

Per-source additions to `AcquiredSource`:
- `package_id` — which selected package the file belongs to. Reason: joins `sources[]` to `packages[]`.
- `lane_candidate_ref` — e.g. `gap-structure/C2`. Reason: traceability back to lane outputs.
- `coverage` (`class`, `description`, `bbox_declared`) — taluk/citywide scoping. Reason: schema has no per-source coverage; class (citywide vs taluk vs local) drives visual eligibility.
- `observation_date_text` — free-text observation dating. Reason: `data_period_start/end` cannot express multi-campaign histories (e.g. 1995-96 + 2011-12 + 2021-22) or modeled-data caveats.
- `upload_date` — Reason: schema has no upload-date slot; kept `unknown` honestly where unknowable.
- `achievable_visual` — concrete visual each file enables. Reason: selection criterion was explorable-subsurface visuals; the schema's closest slot (`achievable_visual_features`) exists only on `Candidate`, not `AcquiredSource`.
- `candidate_id` — native optional field, used for lane candidate cross-ref (deduped where applicable).

## 3. Dedupe across lanes (verified, not assumed)

| Identity | Evidence |
|---|---|
| gap-structure C2 == gap-groundwater CAN-02 (NAQUIM Bangalore North 2022) | sha256 `1a7a4ccb…` on both files; `cmp` byte-identical (consolidation re-verified). Single `source_id struct-naquim-north-2022`; extract once. |
| gap-structure C4 == gap-groundwater CAN-05 (CGWB Urban booklet 2013) | Same title/edition (Mar 2013, data to 2012); structure-lane sha `c6840e93…`. Neither selected (superseded). |
| Metro engineering ch.14 == EIA baseline | Carried from inventory: Table 14-57 identical to Table 7-1 (27 stations, identical coords). Extract env baseline once. |

All selected-file checksums and PDF page counts (21/27/7/7) were re-verified in consolidation with `shasum -a 256` + pypdf; all match lane claims.

## 4. Selected packages (2 of max 5; no filler)

### PKG-STRUCT-01 — CGWB taluk structure set (scores 0.88 / 0.82 / 0.80)
East NAQUIM 2022 (21 pp, `f1a7ac88…`, drilling 2021) + North NAQUIM July 2022 (27 pp, `1a7a4ccb…`, levels 2019, AAP 2020-21) + South exploration IJRES Dec 2023 (7 pp, `72b70225…`, campaigns 1995-2022). Covers 3 of 4 Bangalore Urban taluks (Anekal missing — top follow-up).
- New evidence vs inventory: 34 georeferenced exploratory wells with per-well lithology (granitic gneiss/granite/quartzite/pegmatite/dolerite dykes), casing, fracture zones, SWL, yields; weathered-thickness ranges per taluk (East 10-58 m, North 3-32.75 m, South to 40 m); geology + weathered-thickness maps; 2D/3D sections and RockWorks fence diagrams; fracture-frequency stats.
- Achievable visuals: subsurface cross-sections / fence re-plots; depth-to-weathering (rockhead proxy) choropleths; per-well strip logs; fracture histogram.
- Limitations: taluk-scale (sub-city); section/fence figures are images needing digitising; North 2019 levels aging (geology stable); South paper is condensed (full South NAQUIM 2022 still unretrieved).
- Validation: all `validated` (magic bytes, masthead/report-no. match, pypdf parse, sha re-verified).

### PKG-SOIL-01 — SoilGrids 2.0 Bengaluru raster (score 0.78)
Clay 0-5 cm GeoTIFF, bbox 77.2-78.0E/12.7-13.5N, 354x335 px ~250 m, EPSG:4326 (`7b1bff19…`, 102,807 B; release 2023; accessed 2026-11-04).
- New evidence vs inventory: the ONLY wall-to-wall soil property covering Bengaluru (inventory has zero soil mapping). WCS pattern reproduces 6 depths x 11 properties without new discovery.
- Achievable visuals: topsoil clay choropleth; stackable depth-slice panel.
- Limitations: MODELED global compilation, not observed profiles; 250 m smoothing; only one depth/property persisted; must never be presented as field survey.
- Validation: `validated` (tags/CRS/stats verified by lane; sha re-verified here).

## 5. Rejections (strongest-first reasoning)

- Soil thesis C1 (Doddaballapura, 2001): only real horizon dataset, but LOCAL (2 villages, Bangalore Rural, ~25 km outside city, ~2000-01 fieldwork). Stays labelled local; wall-to-wall wins for city visuals.
- GW Outlook CAN-01 (IISc Jan 2025, 80 wards): freshest GW item, but recent-GW is already covered citywide (2025 aquifer plan); projections modeled; 7-page interim. First reserve.
- Soil C3 (NBSS physiography scan): undated, landform-not-taxonomy, needs georeferencing.
- Soil C4 (WoSIS): >10 km positional uncertainty; priors only.
- GW CAN-03 (national quality 2024): Bengaluru in district tables only; city quality already covered.
- Structure C4/CAN-05 (2013 booklet): superseded. C5 (metro Vol 1): no logs in file. C6 (IISc papers): partial (403/gated). C7/C8 (South + Anekal NAQUIM 2022): bodies not retrieved; C8 top follow-up.
- GW CAN-04..09: reference/landing-page level only, no persisted evidence to package.
- No evidence type outside the gaps beat them: geohazard/subsidence evidence never rose above abstract level, so that category is left `unresolved` rather than filled with a weak package.

## 6. Gap closure vs brief

Borehole lithology with depth: PARTIAL -> SUBSTANTIALLY CLOSED (34 taluk wells + sections; Anekal + city-centre deep logs still missing). Soil horizons: OPEN -> MAPPING CLOSED / OBSERVED STILL OPEN (gridded modeled coverage yes; observed city profiles still none). Recent groundwater: already COVERED, unchanged. Depth-to-rock map and cross-section targets are now buildable at taluk scale; monitoring time series was already supported.
