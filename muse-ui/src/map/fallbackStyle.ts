// Bundled neutral fallback style: flat land/water treatment plus a graticule
// so geometry, controls, and attribution stay usable when remote tiles fail
// (BASELINE.md M3). No remote URLs anywhere in this style.

import type { StyleSpecification } from "maplibre-gl";

export const FALLBACK_ATTRIBUTION =
  "Fallback basemap · bundled graticule (no remote tiles)";

function graticuleLines(): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (let lon = -180; lon <= 180; lon += 20) {
    features.push({
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: [
          [lon, -90],
          [lon, 90],
        ],
      },
    });
  }
  for (let lat = -80; lat <= 80; lat += 20) {
    const line: GeoJSON.Position[] = [];
    for (let lon = -180; lon <= 180; lon += 10) line.push([lon, lat]);
    features.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: line } });
  }
  return { type: "FeatureCollection", features };
}

export function fallbackStyle(): StyleSpecification {
  return {
    version: 8,
    name: "Muse neutral fallback",
    sources: {
      graticule: {
        type: "geojson",
        data: graticuleLines(),
        attribution: FALLBACK_ATTRIBUTION,
      },
    },
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": "#dfe9ef" },
      },
      {
        id: "graticule",
        type: "line",
        source: "graticule",
        paint: { "line-color": "#8aa0b0", "line-width": 1, "line-opacity": 0.7 },
      },
    ],
  };
}

export const DEFAULT_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

export function configuredStyleUrl(): string {
  const fromEnv = (import.meta.env.VITE_MAP_STYLE_URL as string | undefined)?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_STYLE_URL;
}
