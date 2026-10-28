/**
 * Geographic primitives.
 *
 * All coordinates are WGS84 [longitude, latitude] decimal degrees, matching
 * GeoJSON and MapLibre GL JS conventions. No fictional geography: coordinates
 * in seed data must come from a verifiable gazetteer or survey source.
 */

/** WGS84 coordinate pair: [longitude, latitude]. */
export type LngLat = [longitude: number, latitude: number];

/** Bounding box: [west, south, east, north]. */
export type BoundingBox = [west: number, south: number, east: number, north: number];

export interface GeoPoint {
  coordinates: LngLat;
  /** Horizontal accuracy in metres, when known. Absent means unstated, not exact. */
  accuracyMetres?: number;
}

export interface GeoBounds {
  bbox: BoundingBox;
}

/** Administrative hierarchy level for a location. */
export type AdminLevel = 'country' | 'state' | 'district' | 'city' | 'site';

export interface AdminContext {
  country: string;
  state?: string;
  district?: string;
  /** Census code, LGD code, or other stable administrative identifier. */
  adminCode?: string;
}
