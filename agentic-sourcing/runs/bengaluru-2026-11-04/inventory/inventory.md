# Bengaluru existing-source inventory (verified)

Run: `agentic-sourcing/runs/bengaluru-2026-11-04` · Brief: `source-intelligence/examples/bengaluru.json`
Machine companion: `inventory.json`. All four files opened and inspected page-by-page excerpts; checksums via `shasum -a 256`; page counts via pypdf.

## 1. Aquifer report — citywide

- File: `playground/bangalore/sample_docs/input/bangalore_aquifier.pdf` · 233 pp · PDF 1.7 · 11,543,811 B · `69450486…`
- Title: Aquifer Management Plan of Bengaluru City (SWR), CGWB / Ministry of Jal Shakti; NAQUIM 2.0 Urban Agglomerate, AAP 2023-24 + 2024-25.
- Coverage: **citywide** — BBMP 711 km², lat 12.833–13.142, lon 77.462–77.786 (§1.1).
- Published 2025 (cover; PDF metadata Feb–Mar 2026 = file-write dates). Observed: pre/post-monsoon **2023 and 2024** (110 WL keywells, 82 WQ keywells), piezometers drilled 2023/2024, exploratory drilling in-window, 52 wards flagged to BWSSB Feb 2025, GWRA 2024. InSAR undated.
- Key evidence: well-level annexures (WL, chemistry incl. uranium, fracture zones/yields), 22 new VES + 85 existing with interpreted layers (Annex 17), 6 TEM, 8 infiltration tests, tritium recharge, ward scarcity map (238 km²), 68 recharge sites.
- Limits: no lithology-with-depth logs or soil horizons; GW chemistry only; tables need parsing.

## 2. Metro Phase 3 engineering report — corridor

- File: `playground/bangalore/sample_docs/input/bangalore_metro_phase_3.pdf` · 726 pp · PDF 1.6 · 42,997,609 B · `3183ee13…`
- Title: Preparatory Survey on Bengaluru Metro Rail Project (Phase 3), Final Report (Advance Release), JICA, Jan 2026.
- Coverage: **corridor** — Corridor 3-1 JP Nagar–Kempapura 32.15 km/22 stn; Corridor 3-2 Hosahalli–Kadabagere 12.50 km/9 stn (§1.4, Table 1-2).
- Observed: DPR survey of **36 boreholes** (26+10, ~1 km spacing, ≤30 m, SPT/UDS/GW/lab) reported in RITES DPR 2023 — exact fieldwork year unknown. Dense Package 1–4 survey (~50 m) was still in progress; results **not** in this report. DPR approved 2024.
- Key evidence: borehole coordinates/depths/SPT/lab + pile-foundation recommendations (§5.3.1); PGC geology overview; embedded ESIA baseline (ch.14).
- Limits: no borehole logs or cross-sections appended (none existed at survey time); corridor-strip only; advance-release version.

## 3. Metro Phase 3 environmental (EIA) report — corridor

- File: `playground/bangalore/sample_docs/input/bangalore_metro_phase_3_env_impact.pdf` · 379 pp · PDF 1.7 · 26,787,852 B · `4ec2e594…`
- Title: EIA for Bengaluru Metro Rail Project (Phase 3) for BMRCL, Nov 2025 (same JICA study team).
- Coverage: **corridor** — same two corridors (32.2/12.5 km, ROW 27 m); 27 monitoring stations along alignments.
- Observed: BMRCL/Monarch dry season Jan–Apr 2025; JST 2025 campaigns — air from 7 Feb 2025, noise 15 Mar–25 Apr, vibration 1 Jun–~18 Jul, water/soil 15 & 27 Apr, rainy-season air 5–25 Jun, GW/SW/biodiversity 7–18 Jul (ch.7 preamble; air end-date has a year typo “2024” as printed). Legacy DPR 2023 samples, CPCB 2024, CGWB 2013 booklet, stakeholder meetings Sept 2025.
- Key evidence: 27 stations with lat/lon; DPR soil texture/chemistry (Table 2-4) and 8×26 water analyses (Table 2-5); hydrogeology context.
- Limits: **no geotech** (topography/geology deferred); corridor-strip only; old GW baseline.

## 4. BWSSB water-supply KML — citywide

- File: `playground/bangalore/sample_docs/input/bangalore_bwssb_water_supply_lines.kml` · 41,099,984 B · `0c9cc631…` · KML 2.2, `Layers_BWSSB_WATERLINE`.
- Contents: **97,827 placemarks; 140,361 LineStrings; 513,803 vertices; ~10,741 km**. No points/polygons, no attributes, no names, no timestamps; all z = 0.
- Coverage: **citywide** — measured bbox lon 77.46162–77.77281, lat 12.82464–13.13414 (matches BBMP envelope).
- Dates: **all unknown** — no temporal metadata in file.
- Key evidence: citywide network geometry for utility/conflict screening (WGS84, GIS-ready).
- Limits: geometry only (no diameter/material/status/depth/vintage); no subsurface content.

## Metro package overlap (read before extracting)

The two metro reports are one package from the same author team. Engineering ch.14 embeds the EIA baseline **verbatim** (verified: Table 14-57 ≡ Table 7-1, identical A1–A27 station coordinates; identical ToR tables). Both cite the same RITES DPR 2023 legacy data. Rule: extract the environmental baseline **once** (prefer the standalone EIA); take geotechnical evidence **only** from the engineering report (§5.3.1). Minor length-label difference: Corridor 3-1 = 32.15 km (engineering) vs 32.2 km (EIA).

## Gap check vs brief

Brief gaps were borehole lithology with depth, soil horizons, recent groundwater observations. Verified holdings: recent GW observations ✔ (aquifer report 2023–24 + metro 2025 corridor points); DPR borehole summaries partial ◐ (no logs); soil horizons ✘ (only 6 DPR texture samples + 8 infiltration rates).
