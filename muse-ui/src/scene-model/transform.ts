// CRS transformation boundary. Only explicitly declared supported CRS
// identifiers may be transformed; anything else stays unlocated. The CRS is
// never inferred from value ranges, filenames, place names, or apparent
// location (BASELINE.md C2).

import proj4 from "proj4";
import type { CoordinateProvenance, LonLat } from "./types.ts";

export const SUPPORTED_CRS = ["EPSG:4326", "EPSG:3857"] as const;
export type SupportedCrs = (typeof SUPPORTED_CRS)[number];

proj4.defs("EPSG:4326", "+proj=longlat +datum=WGS84 +no_defs +type=crs");
proj4.defs(
  "EPSG:3857",
  "+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs +type=crs",
);

export function isSupportedCrs(value: unknown): value is SupportedCrs {
  return typeof value === "string" && (SUPPORTED_CRS as readonly string[]).includes(value);
}

export interface TransformResult {
  lonlat: LonLat;
  provenance: CoordinateProvenance;
}

// Input coordinates are [x, y] in the declared source CRS; output is WGS84
// longitude/latitude for the map boundary.
export function transformToWgs84(
  crs: string,
  x: number,
  y: number,
): TransformResult | null {
  if (!isSupportedCrs(crs)) return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  try {
    const [lon, lat] = proj4(crs, "EPSG:4326", [x, y]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    const rounded: LonLat = [
      Math.round(lon * 1e6) / 1e6,
      Math.round(lat * 1e6) / 1e6,
    ];
    if (rounded[0] < -180 || rounded[0] > 180 || rounded[1] < -90 || rounded[1] > 90) {
      return null;
    }
    return {
      lonlat: rounded,
      provenance: {
        sourceCrs: crs,
        targetFrame: "WGS84-lonlat",
        transformedAt: new Date().toISOString(),
      },
    };
  } catch {
    return null;
  }
}
