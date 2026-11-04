// Anchored local metric frame for the scientific 3D boundary. Map positions
// arrive as WGS84 longitude/latitude; 3D renders in meters about a validated
// study anchor (the antimeridian-aware center of the validated bounds).
// Heights are passed through untouched: they must already be validated
// finite meters at the package boundary, never invented here.

import { antimeridianCenter } from "../scene-model/coordinates.ts";
import type { LonLat, ValidatedBounds } from "../scene-model/types.ts";

export interface LocalAnchor {
  lon: number;
  lat: number;
}

export function anchorOfBounds(bounds: ValidatedBounds): LocalAnchor {
  const [lon, lat] = antimeridianCenter(bounds);
  return { lon, lat };
}

const METERS_PER_DEGREE_LATITUDE = 110540;
const METERS_PER_DEGREE_LONGITUDE_AT_EQUATOR = 111320;

function wrappedDeltaLon(lon: number, anchorLon: number): number {
  let delta = lon - anchorLon;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
}

// Equirectangular projection about the anchor: exact at the anchor, with
// distortion growing with distance. Honest for study-scale inspection; the
// viewport caption states the method and anchor so it is never mistaken for
// a surveyed grid.
export function lonLatToLocal(
  lon: number,
  lat: number,
  anchor: LocalAnchor,
): { x: number; z: number } {
  const x =
    wrappedDeltaLon(lon, anchor.lon) *
    METERS_PER_DEGREE_LONGITUDE_AT_EQUATOR *
    Math.cos((anchor.lat * Math.PI) / 180);
  const z = -(lat - anchor.lat) * METERS_PER_DEGREE_LATITUDE;
  return { x, z };
}

export function featurePositionsToLocal(
  positions: LonLat[],
  anchor: LocalAnchor,
): Array<{ x: number; z: number }> {
  return positions.map(([lon, lat]) => lonLatToLocal(lon, lat, anchor));
}
