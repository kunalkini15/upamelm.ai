# Document Package Capability Envelope

## Purpose

This note translates the Bengaluru ingestion collection (18 packages, 34 source
files) into the reusable UI capabilities that document processing can produce
at its intended best quality. The target is a generic UI that renders roughly
90-95% of these studies without code changes. The always-on agent handles the
remaining unusual extraction, visualisation, or composition cases.

This is a capability forecast, not a claim that every source contains every
listed object. The processor must preserve source scope, time, confidence, and
uncertainty.

## Executive conclusion

The collection does not require 34 bespoke interfaces. It resolves into seven
primary experience families:

1. located observations and monitoring points;
2. boreholes, depth intervals, sections, and 3D subsurface profiles;
3. lines, polygons, corridors, and map/raster overlays;
4. time series, comparisons, distributions, and water-budget statistics;
5. structured tables and searchable source records;
6. source figures, conceptual models, and image-first studies;
7. linked narrative and report experiences.

Supporting these as composable primitives should cover nearly all selected
documents. A study chooses a layout mode and combines only the primitives its
evidence supports.

## Package-by-package forecast

| Source package | Likely best UI package | Strongest UI contribution | Important limits |
|---|---|---|---|
| NAQUIM 2022: North, East, South, Anekal (4 PDFs) | Map + 3D/depth + report | Located wells; drilled depth; casing; lithology; fracture zones; water levels; aquifer intervals; 2D/3D sections; quality ranges/maps; proposed recharge structures | Some table rows/units ambiguous; several quality maps lack station tables; proposals must not look observed |
| Groundwater yearbooks 2022-23 to 2024-25 (3 PDFs) | Dashboard/report-first | Seasonal and annual district values; multi-year trend; decadal comparisons; fluctuation summaries | Bengaluru values are district aggregates, not dense station series |
| GWRA 2024/2025 + 2023-25 CSVs (2 PDFs, 3 CSVs) | Table/dashboard + comparison map | Six assessment units; extraction/recharge budgets; stage-of-extraction percentages; status categories; year comparison; 2024 categorisation plate | 2023 CSV is provisional; PDF/CSV companions must not be double-counted |
| Annual Groundwater Quality Report 2025 (2 PDFs) | Sparse point map + contaminant dashboard | Located nitrate, uranium, and manganese exceedances; threshold comparisons; state context; source tables | Only a few Bengaluru station-parameters; no citywide interpolation |
| Bengaluru Groundwater Outlook 2025 (1 PDF) | Map-first forecast story | 80 reported ward reference points; critical-ward layer; 5/10-15/20-25 m scenario comparison; 800 MLD callout; recommendations | Coordinates are reported references, not ward polygons; scenarios are projections, not measurements |
| JSEE site characterization 2012 (1 PDF) | Section/profile + figure-first report | Rockhead/overburden distributions; typical borelog; SPT; MASW; soil classes; site-response comparison; rock-depth map | Underlying 370-log coordinates/database are unpublished; footprint is local 220 sq km |
| KSRSAC lineament series (5 PDFs) | Layered map/image experience | Lineament and fracture networks; drainage, tanks, villages, taluk context; per-sheet legend and scale | Mostly visual geometry without vectors; dates and source vintage unknown |
| Karnataka groundwater factsheet 2025 (1 PDF) | Compact executive dashboard | 2017-2025 extraction-stage series; May/November water-level summary; quality anomaly list | Mostly state/district context, limited located detail |
| KSRSAC Bengaluru Urban soil map (1 PDF) | Raster/image overlay + legend | Six soil textures; rock, dyke, habitation, and water mapping units | Visual polygons only; no pedon/horizon data; display scale is not survey precision |
| GSI regional geology report + map (2 PDFs) | Geology reference + figure panels | Lithostratigraphy; structural geology; regional lithology map; mapping lineage; conceptual context | Map is 1:2M and coarse for city decisions |
| BGS Bangalore Plateau field geology (1 PDF) | Conceptual-section story | Regolith thickness; gneiss, saprolite, fracture, lineament, and dyke models; quarry/outcrop examples | Reconnaissance observations; not a continuous city model |
| South Bangalore lineament study (1 PDF) | Map + analytical dashboard | Lineament-density map; geology map; potential-zone relationship; area statistics | Study region is broader than the district; imagery vintage unstated |
| Geomorphology Bangalore North (1 PDF) | Image overlay + legend | Landform units and taluk-scale geomorphic context | Single taluk; visual-only mapping and unknown vintage |
| Seismic microzonation 2008 (1 PDF) | Hazard-map + profile/chart story | SPT/MASW, shear-wave profiles, site response, liquefaction, microtremor, hazard maps | Historical and local 220 sq km footprint, not current BBMP-wide conditions |
| Bengaluru InSAR 2018 (1 PDF) | Time-series hazard map | Four located deformation points; velocity classes; point time series; eastern subsidence narrative | May 2016-Dec 2017 window; urban persistent scatterers only; no ground truth |
| BMRCL Reach 6 EIA + addendum (2 PDFs) | Corridor-first engineering UI | Station chainage; underground alignment; longitudinal/cross sections; tunnel/station geology; soil and groundwater tables; design-revision timeline | Corridor only; no located borelogs; metro alignment is not utility evidence |
| BMRCL Phase 3 EIA 2025 (1 PDF) | Corridor map + monitoring dashboard | Two current corridors; 27 monitoring locations; six soil samples; secondary groundwater network; tables and sections | Elevated-only project; no underground tunnel geometry |
| DMG groundwater quality survey 2011 (1 PDF) | Historical quality atlas | Large sample programme; locality exceedance lists; chemistry ranges; geochemical/sample maps | Scanned/OCR-heavy; 2010 sampling; in-and-around-city survey, not current BBMP-wide state |

## Generic UI primitives required

### 1. Spatial scene

Support all common GeoJSON geometries:

- Point and MultiPoint;
- LineString and MultiLineString;
- Polygon and MultiPolygon;
- raster/image overlays with bounds or control points;
- source-figure overlays that may remain non-georeferenced.

Every spatial object needs visible semantics:

- observed, reported, derived, figure-derived, proposed, or external context;
- exact, approximate, or unlocated;
- confidence/fidelity;
- observation and publication time;
- source footprint and scope;
- selectable layer, legend, and source reference.

This supports wells, wards, monitoring sites, stations, alignments, lineaments,
soil/geology/geomorphology units, hazard regions, recharge proposals, and
coverage envelopes.

### 2. Subsurface and vertical scene

Support:

- borehole/shaft with total depth and casing;
- material/lithology intervals;
- fracture and water-bearing zones;
- standing-water observations;
- rockhead and overburden;
- neutral shaft when only total depth exists;
- vertical profile attached to a feature;
- unlocated representative profile;
- 2D cross-section and fence-diagram panel;
- corridor longitudinal section;
- comparison of multiple profiles.

Intervals must distinguish direct log data, reported ranges, representative
sections, and figure-derived approximation. Never manufacture strata.

### 3. Quantitative visualisation

Provide a generic chart system rather than bespoke chart components:

- line/time-series chart;
- range/band chart;
- grouped/stacked bar chart;
- category/share chart;
- histogram/distribution;
- scatter/relationship plot;
- water-budget or component comparison;
- threshold/exceedance plot;
- KPI/stat callout;
- before/after or scenario comparison.

Chart series link back to features, observations, datasets, evidence, units,
time basis, and uncertainty. Selection should cross-highlight map/profile/table.

### 4. Structured resource browser

Support file-backed JSON/CSV tables with:

- human-readable title and description;
- searchable, sortable, filterable columns;
- unit and field explanations;
- row selection linked to map/profile objects;
- pagination/virtualisation for hundreds or thousands of rows;
- source/download link;
- provenance and limitations.

Important examples are 80 wards, well inventories, taluk budgets, monitoring
stations, soil samples, chainage tables, and exceedance lists.

### 5. Figure and native-asset panel

Many valuable documents contain evidence only in figures. Support:

- full-page or cropped figure image;
- caption, legend, page reference, and extraction quality;
- pan/zoom;
- optional annotated hotspots;
- optional georeferenced overlay;
- side-by-side figure comparison;
- explicit label: direct source figure versus model-generated visualisation.

This is essential for maps without vector companions, borelogs, cross-sections,
fence diagrams, conceptual models, hazard maps, and scanned surveys.

### 6. Time and version semantics

Treat time as a first-class dimension:

- observed period;
- forecast horizon;
- publication date;
- historical/current/proposed state;
- edition or design revision;
- time slider when values are comparable;
- comparison mode when sources use incompatible methods.

This prevents 2010 chemistry, 2016-17 deformation, 2008 hazards, and 2025
forecasts from appearing as one current condition.

### 7. Narrative and report system

Support three linked levels:

- **study/layer context:** the shared explanation and pattern;
- **feature narrative:** only the evidence-specific delta for the selected item;
- **report chapter:** the whole-document story with findings and statistics.

Narratives and report elements should link to map features, profiles, chart
series, table rows/resources, figures, observations, and evidence references.
The UI must handle honest limited narratives without forcing generic filler.

### 8. Provenance, uncertainty, and scope

Every view needs a consistent disclosure surface for:

- source page/table/figure;
- direct versus derived versus external context;
- confidence and fidelity;
- geographic denominator and study footprint;
- missing fields or ambiguous units;
- historic/projection/proposed status;
- conflicts and reviewer warnings.

These should be badges/tooltips/details, not repeated paragraphs that overwhelm
the main experience.

## Layout modes

The UI can cover nearly all packages with six adaptive shells:

1. **Map-first:** many located points/lines/polygons (ward outlook, quality,
   InSAR, monitoring sites, lineaments).
2. **Subsurface-first:** boreholes and depth relationships (NAQUIM, JSEE,
   microzonation).
3. **Corridor-first:** alignment, chainage, stations, sections, monitoring
   (BMRCL studies).
4. **Dashboard/table-first:** aggregates, budgets, trends, categories
   (yearbooks, GWRA, factsheet).
5. **Figure-first:** maps or sections without machine-readable geometry
   (soil, geomorphology, regional geology, scanned quality survey).
6. **Report-first:** strong conclusions with weak spatial/depth detail.

The processor selects a primary mode and optional secondary modes. The shell
should be capability-driven rather than domain-name-driven.

## Current consumer gaps

The current `ui-v2` adapter does not yet cover the full package envelope:

- feature geometry is retained only for `Point`; lines and polygons become
  null geometry;
- `chart_series`, `figure_panels`, and `timelines` are not adapted;
- structured-resource metadata is retained, but inline rows are not; file-backed
  resource loading/table rendering is required;
- native assets are retained as metadata but need a general asset viewer;
- raster/image overlay and non-georeferenced figure modes need first-class UI;
- cross-selection between map, chart, table, profile, figure, and report needs a
  shared selection model;
- capability-specific empty states are required so a report-first or
  figure-first study never falls back to unrelated map geography.

## Recommended generic scene model

Use one capability registry per loaded package:

```text
spatial: points | lines | polygons | rasters | imageOverlays
vertical: shafts | intervals | profiles | sections | fenceDiagrams
quantitative: stats | series | distributions | comparisons | thresholds
resources: tables | files | nativeAssets
story: featureNarratives | layerNarratives | chapters | findings
time: observations | forecasts | revisions
quality: provenance | confidence | limitations | warnings
```

The application chooses navigation and layout from populated capabilities. New
package types should usually compose existing capabilities rather than trigger
new domain-specific pages.

## What belongs to the always-on agent (remaining 5-10%)

Keep dynamic agent intervention for:

- OCR repair of badly scanned or rotated tables;
- figure digitisation where axes/legends are unusual;
- georeferencing a map without reliable control points;
- a novel chart or scientific object not represented by generic primitives;
- reconciling conflicting units or duplicated source tables;
- designing a one-off hero composition for a particularly visual source;
- mapping a new package extension into the capability registry;
- repairing a package whose source structure breaks normal extraction.

The agent should extend or compose capabilities, not rewrite the application
for ordinary wells, maps, profiles, tables, charts, reports, or corridors.

## Implementation priority

### Foundation (covers most documents)

1. Preserve Point/LineString/Polygon/Multi* geometry in the adapter.
2. Add file-backed resource loading and a generic table browser.
3. Adapt generic chart series and render the core chart types.
4. Add figure/native-asset viewer with source/page provenance.
5. Add shared selection/linking across map, table, chart, profile, and report.
6. Add explicit time/status/confidence styling.

### High-impact scientific experience

7. Generalise vertical profiles, sections, and corridor chainage views.
8. Add raster/image overlay support and legend handling.
9. Add adaptive layout mode selection and capability-aware empty states.
10. Add comparison mode for years, scenarios, editions, and profiles.

### Agent extension surface

11. Permit registered package extensions with a safe generic fallback.
12. Let the always-on agent propose a layout or renderer mapping without
    mutating grounded scientific data.

## Representative acceptance suite

Use these six documents to exercise nearly the entire generic envelope:

1. NAQUIM Bangalore North 2022 - wells, depth, fractures, proposals, quality.
2. Groundwater Outlook 2025 - 80 points, table, forecast comparison, report.
3. JSEE 2012 - borelog, rockhead, SPT/MASW, distributions, figures.
4. BMRCL Reach 6 EIA - corridor, chainage, sections, engineering tables.
5. Bengaluru InSAR 2018 - point time series and deformation/hazard story.
6. KSRSAC soil or lineament map - figure/raster/line/polygon and legend path.

If these render correctly through the same capability system, the remaining
collection is predominantly recombination rather than new UI engineering.
