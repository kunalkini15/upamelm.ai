# gap-soil excerpts (Bengaluru)

All excerpts transcribed from locally inspected files. Scanned-PDF OCR noise preserved where
material; obvious OCR glyph errors annotated in [brackets].

## C1 — Siddeswara (2001), UAS Bangalore MSc thesis, Doddaballapura taluk

Source file: `downloads/doddaballapura_soils_thesis.pdf` (145 pp., scanned).

- Title page (PDF p.1): "CHARACTERISATION AND CLASSIFICATION OF MAJOR SOILS OF
  INSTITUTE VILLAGE LINKAGE PROGRAMME AREA, DODDABALLAPURA TALUK, BANGALORE
  RURAL DISTRICT … UNIVERSITY OF AGRICULTURAL SCIENCES BANGALORE 2001"
- Certificate (PDF p.4): bona-fide MSc (Agriculture) research, MR. L. SIDDESWARA;
  guide V. NATARAJAN, Scientist-Pedology, NBSS&LUP Regional Centre, Hebbal;
  "Bangalore, December 2001".
- Study area (PDF p.34, thesis §3.1): "Institute Village Linkage Programme Area,
  Doddaballapura taluk, Bangalore rural district … comprises two villages namely
  Neralaghatta and Kestur, spread over 3000 hectares, representing eastern dry
  zone of Karnataka State (Fig 1). Neralaghatta village lies between 13°18'50"N
  latitudes and 77°29'0"E longitudes and covers an area of 1750 hectares. Kestur
  village … 13°18'6"N … 77°29'8"E … 1253 hectares." Rainfall 800–900 mm;
  isohyperthermic / ustic regimes.
- Classification result (PDF p.39, §3): "Out of the six profiles studied three
  profiles classified as Typic Haplustalfs (profile nos. 1, 4 and 5) … Kandic
  Paleustalfs (profile No. 2), Typic Haplustepts (profile No. 3) and Typic
  Paleustalfs (profile [No. 6])."
- Example horizons: Pedon 1 (PDF p.46): "0-19 cm ochric epipedon, 19-104 cm
  argillic horizon … Fine, mixed, isohyperthermic family of Typic Haplustalfs";
  Pedon 3 (PDF p.52): "0-17 cm ochric, 17-68 cm cambic horizon … Typic
  Haplustepts"; Pedon 6 (PDF p.61): "0-14 cm ochric … 14-164 cm argillic …
  Typic Paleustalfs".
- Tables (List of Tables, PDF p.8): T1 climatic data; T2 morphological
  characteristics; T3 bulk density + particle-size; T4 chemical characteristics;
  T5 available nutrients. Figures (PDF p.9): location map, soil-physiography
  diagram, 6 profile diagrams, particle-size charts, pH/OC/CEC/base-saturation
  charts.
- Context note (PDF p.32, literature review): "The red and lateritic soils of
  Bangalore district (Karnataka state) were classified as kandic Paleustalfs
  and Kandic Rhodustalfs by Reddy et al. (1993)."

## C2 — SoilGrids 2.0 clay 0-5 cm, Bengaluru bbox

Source file: `downloads/soilgrids_clay_0-5cm_bengaluru.tif` (WCS GetCoverage,
ISRIC dev-maps MapServer; DescribeCoverage inspected 2026-11-04).

- Coverage `clay_0-5cm_mean`: native grid EPSG:152160, 250 m; served here
  reprojected to EPSG:4326, tiepoint (77.2°E, 13.5°N), 354×335 px.
- Pixel values (16-bit): min 0, max 373, mean 207.0 → mean ≈ 20.7% clay,
  consistent with red loam/sandy soils of the region.
- Service card text (dev-maps.isric.org/generated/soilgrids/clay.html): "Clay
  content (0-2 micro meter) mass fraction in ‰ at 6 standard depths predicted
  using the global compilation of soil ground observations."
- Reproduction pattern: same endpoint with COVERAGEID
  `{property}_{depth}_mean` over property ∈ {clay, sand, silt, phh2o, soc,
  bdod, cec, nitrogen, cfvo, ocs, ocd} × 6 depths; WCS 2.0.1 requires
  SUBSETTINGCRS=EPSG:4326 with Lat/Long axis order (native axes are x/y metres).

## C3 — NBSS&LUP Physiographic Regions, Bangalore District (ESDAC IN3006_1PH)

Source file: `downloads/esdac_IN3006_1PH_bangalore-physiography.jpg` (6487×9327
px; visually inspected via downscaled preview).

- Title block: "PHYSIOGRAPHIC REGIONS / BANGALORE DISTRICT / (KARNATAKA)";
  bar scale "1:125,000"; north arrow; graticule ticks 77°45′ shown, sheet spans
  ≈77.2–78.0°E, ≈12.6–13.6°N.
- Imprint (bottom-right): "NBSS AND LUP / REGIONAL CENTRE, BANGALORE-560024".
  No year on sheet. Red stamp: "ISM - WAGENINGEN / Country: India".
- ESDAC page metadata: "Publisher: National Bureau of Soil Survey (NBSS) and
  Land Use Planning (LUP), Nagpur. Regional Centre, Bangalore."
- Centre of sheet: hatched "BANGALORE CITY URBAN AREA"; labelled taluk HQs:
  Dodballapur, Devanahalli, Hosakote, Nelamangala, Magadi, Ramanagaram,
  Channapatna, Kanakapura, Anekal (undivided district).
- Legend units (verified on sheet): (A) landscape on granite and granite
  gneiss — 1 hills (1.1 rock outcrop/steeply sloping hill), 2 rolling land,
  3 pediment (3.1 upper / 3.2 lower), 4 valley (4.1 wide / 4.2 narrow);
  (B) laterite landscape — 5 laterite mound, 6 pediment, 7 valley.

## C4 — WoSIS latest profiles, Bengaluru bbox (12.5–13.5°N, 77.2–78.1°E)

Source files: `downloads/wosis_bengaluru_bbox_profiles.json` (12 features),
`downloads/wosis_bengaluru_bbox_clay_layers.json` (10 layer records, sample).

- Profile count in bbox: 12 (datasets WD-ISIS ×3, WD-WISE ×9); WRB groups:
  Lixisol ×7, Luvisol ×4, Nitisol ×1. Six distinct coordinate clusters, e.g.
  (77.575, 13.0417) Luvisol 1–10 km uncertainty; (77.7833, 13.10) Lixisol
  >10 km; (77.3333, 12.8667) Lixisol >10 km.
- Horizon sample (profile 1115584, Lixisol, 77.78°E 13.10°N): clay value_avg
  20.8 (0–20 cm) / 22.7 (20–36) / 30.7 (36–68) / 43.8 (68–150 cm) —
  argillic increase with depth.
- Layer record schema: profile_id, layer_id, profile_code, layer_name,
  upper_depth, lower_depth, value/value_avg, dataset_id, licence, …

## Dead ends (checked, not cited as evidence)

- ESDAC `IN3006_1SO.jpg` (hypothesised soils companion): HTTP 404.
- K-GIS `downloads.aspx`: contains "Soil Map of Karnataka State" layer keys
  (`dm_soil`, `dlsoilmapk`) but download is JS/ASP.NET mediated; no direct file
  URL recoverable from static HTML.
- Soil Health Card portal: per-farmer lookup only; no bulk download found.
- Sujala-III LRI holdings on krishi.icar.gov.in: sampled records cover Koppal,
  Yadgir, Gadag, Tumkur, Gulbarga districts; none for Bangalore Urban/Rural.
