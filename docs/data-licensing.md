# Data licensing & attribution

Phase 1 ships no scientific datasets. This file tracks every third-party geographic
data source rendered by the application, so future phases inherit the obligations.

## Basemap tiles (CARTO + OpenStreetMap)

- **Styles:** `https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json` (default)
  and `https://basemaps.cartocdn.com/gl/positron-gl-style/style.json` (light alternative).
- **Provider:** CARTO basemaps, free for use with attribution, no API key required.
- **Underlying data:** © OpenStreetMap contributors (ODbL). See
  https://www.openstreetmap.org/copyright.
- **Attribution in-app:** rendered on-map by the MapLibre attribution control
  (`© OpenStreetMap contributors © CARTO`) and noted in the location panel footer.
- **Operational note:** tiles stream from CARTO's CDN at runtime; the app needs
  internet access for map rendering. No tile data is copied into this repository.

## Automatic fallbacks (used only if CARTO is unreachable)

The map tries sources in order until one renders, and tells the user when a
fallback is active (see `src/services/basemapStyles.ts`).

1. **OpenFreeMap Liberty** — `https://tiles.openfreemap.org/styles/liberty`.
   Free keyless vector tiles (OpenMapTiles schema, OSM data). Attribution:
   © OpenMapTiles © OpenStreetMap contributors, rendered on-map.
2. **OpenStreetMap raster** — `https://tile.openstreetmap.org/{z}/{x}/{y}.png`,
   embedded via an inline style with no style-JSON dependency. Attribution:
   © OpenStreetMap contributors. Note the OSM tile usage policy (bulk/heavy use
   requires own infrastructure); acceptable as a low-volume fallback.

## Administrative geography

- Country/state/district names and the Gandhinagar seed coordinates
  (23.2239° N, 72.6500° E) are general gazetteer facts used for navigation only.
- No boundary dataset is bundled in Phase 1; all boundaries shown come from the
  basemap tiles above.

## Future datasets (not yet ingested)

When Phase 2+ adds CGWB/GSI report content, aquifer extents, or water-level
surfaces, record here per dataset: publisher, publication year, access URL or
licence, and the exact attribution string shown alongside it in the UI.
