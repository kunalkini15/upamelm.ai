// Coordinate validation and bounds. WGS84 longitude/latitude ranges are
// enforced before anything renders; antimeridian-crossing extents are framed
// without inventing a camera position (BASELINE.md C3, M5).

import type { LonLat, SceneGeometry, ValidatedBounds } from "./types.ts";
import { isValidDip, isValidUncertainty } from "./types.ts";

function isOptionalUncertainty(value: unknown): boolean {
  return value === null || value === undefined || isValidUncertainty(value);
}

function isOptionalDip(value: unknown): boolean {
  return value === null || value === undefined || isValidDip(value);
}

function hasValidVerticals(g: Record<string, unknown>): boolean {
  const e = g.elevationMeters;
  if (!(e === null || e === undefined || (typeof e === "number" && Number.isFinite(e)))) {
    return false;
  }
  return isOptionalUncertainty(g.uncertaintyMeters) && isOptionalDip(g.dipDegrees);
}

export function isValidLonLat(value: unknown): value is LonLat {
  if (!Array.isArray(value) || value.length !== 2) return false;
  const [lon, lat] = value;
  return (
    typeof lon === "number" &&
    typeof lat === "number" &&
    Number.isFinite(lon) &&
    Number.isFinite(lat) &&
    lon >= -180 &&
    lon <= 180 &&
    lat >= -90 &&
    lat <= 90
  );
}

function allPositions(geometry: SceneGeometry): LonLat[] {
  switch (geometry.kind) {
    case "point":
      return [geometry.coordinates];
    case "line":
      return geometry.coordinates;
    case "polygon":
      return geometry.coordinates.flat();
  }
}

export function isValidGeometry(value: unknown): value is SceneGeometry {
  if (typeof value !== "object" || value === null) return false;
  const g = value as Record<string, unknown>;
  if (g.kind === "point") {
    return isValidLonLat(g.coordinates) && hasValidVerticals(g);
  }
  if (g.kind === "line") {
    return (
      Array.isArray(g.coordinates) &&
      g.coordinates.length >= 2 &&
      g.coordinates.every(isValidLonLat) &&
      hasValidVerticals(g)
    );
  }
  if (g.kind === "polygon") {
    return (
      Array.isArray(g.coordinates) &&
      g.coordinates.length > 0 &&
      g.coordinates.every(
        (ring) => Array.isArray(ring) && ring.length >= 4 && ring.every(isValidLonLat),
      ) &&
      hasValidVerticals(g)
    );
  }
  return false;
}

function ringOfLongitudes(lons: number[]): { west: number; east: number; crosses: boolean } {
  const min = Math.min(...lons);
  const max = Math.max(...lons);
  if (max - min <= 180) return { west: min, east: max, crosses: false };
  // Antimeridian crossing: the shorter arc wraps the dateline.
  return { west: max, east: min, crosses: true };
}

export function boundsOfPositions(positions: LonLat[]): ValidatedBounds | null {
  const valid = positions.filter(isValidLonLat);
  if (valid.length === 0) return null;
  const lats = valid.map(([, lat]) => lat);
  const { west, east, crosses } = ringOfLongitudes(valid.map(([lon]) => lon));
  return {
    west,
    south: Math.min(...lats),
    east,
    north: Math.max(...lats),
    crossesAntimeridian: crosses,
  };
}

export function boundsOfFeatures(geometries: SceneGeometry[]): ValidatedBounds | null {
  return boundsOfPositions(geometries.flatMap(allPositions));
}

// MapLibre fitBounds cannot frame a dateline-crossing extent; callers use
// this center (circular mean of longitudes) with a world-level zoom instead.
export function antimeridianCenter(bounds: ValidatedBounds): LonLat {
  if (!bounds.crossesAntimeridian) {
    return [(bounds.west + bounds.east) / 2, (bounds.south + bounds.north) / 2];
  }
  const toCircle = (lon: number) => ((lon + 360) % 360);
  const mean = (toCircle(bounds.west) + toCircle(bounds.east)) / 2;
  const wrapped = ((mean + 540) % 360) - 180;
  return [wrapped, (bounds.south + bounds.north) / 2];
}
