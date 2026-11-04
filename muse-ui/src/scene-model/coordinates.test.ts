import { describe, expect, it } from "vitest";
import {
  antimeridianCenter,
  boundsOfFeatures,
  boundsOfPositions,
  isValidGeometry,
  isValidLonLat,
} from "./coordinates.ts";

describe("coordinate validation", () => {
  it("accepts in-range longitude/latitude pairs", () => {
    expect(isValidLonLat([-30, 5])).toBe(true);
    expect(isValidLonLat([-180, -90])).toBe(true);
    expect(isValidLonLat([180, 90])).toBe(true);
  });

  it("rejects out-of-range and malformed pairs", () => {
    expect(isValidLonLat([999, 500])).toBe(false);
    expect(isValidLonLat([-181, 0])).toBe(false);
    expect(isValidLonLat([0, 91])).toBe(false);
    expect(isValidLonLat([Number.NaN, 0])).toBe(false);
    expect(isValidLonLat(["0", 0])).toBe(false);
    expect(isValidLonLat(null)).toBe(false);
    expect(isValidLonLat([0])).toBe(false);
  });

  it("validates geometry structure per kind", () => {
    expect(isValidGeometry({ kind: "point", coordinates: [0, 0], elevationMeters: null })).toBe(true);
    expect(isValidGeometry({ kind: "line", coordinates: [[0, 0]], elevationMeters: null })).toBe(false);
    expect(
      isValidGeometry({ kind: "line", coordinates: [[0, 0], [1, 1]], elevationMeters: null }),
    ).toBe(true);
    expect(isValidGeometry({ kind: "circle", coordinates: [0, 0] })).toBe(false);
    expect(isValidGeometry({ kind: "point", coordinates: [999, 0], elevationMeters: null })).toBe(false);
    expect(
      isValidGeometry({
        kind: "polygon",
        coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]],
        elevationMeters: null,
      }),
    ).toBe(true);
  });
});

describe("bounds", () => {
  it("returns null when no valid positions exist", () => {
    expect(boundsOfPositions([[999, 500]])).toBeNull();
    expect(boundsOfFeatures([])).toBeNull();
  });

  it("frames ordinary extents without a dateline flag", () => {
    const bounds = boundsOfPositions([
      [-30, 5],
      [-31.5, 6.25],
    ]);
    expect(bounds).toMatchObject({ west: -31.5, east: -30, south: 5, north: 6.25 });
    expect(bounds?.crossesAntimeridian).toBe(false);
  });

  it("detects antimeridian crossings and centers on the short arc", () => {
    const bounds = boundsOfPositions([
      [179.5, 10],
      [-179.5, 12],
    ]);
    expect(bounds?.crossesAntimeridian).toBe(true);
    const [lon] = antimeridianCenter(bounds!);
    expect(Math.abs(Math.abs(lon) - 180) < 1).toBe(true);
  });
});
