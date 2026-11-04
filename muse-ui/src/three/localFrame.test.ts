import { describe, expect, it } from "vitest";
import { anchorOfBounds, lonLatToLocal } from "./localFrame.ts";

describe("anchored local metric frame", () => {
  it("anchors exactly at the bounds center with zero local offset", () => {
    const anchor = anchorOfBounds({ west: 9, south: 49, east: 11, north: 51, crossesAntimeridian: false });
    expect(anchor).toEqual({ lon: 10, lat: 50 });
    expect(lonLatToLocal(10, 50, anchor)).toEqual({ x: 0, z: -0 });
  });

  it("scales longitude by latitude and keeps north at negative z", () => {
    const anchor = { lon: 0, lat: 60 };
    const east = lonLatToLocal(1, 60, anchor);
    expect(east.x).toBeCloseTo(111320 * Math.cos((60 * Math.PI) / 180), 6);
    expect(east.z).toBeCloseTo(0, 10);
    const north = lonLatToLocal(0, 61, anchor);
    expect(north.z).toBeCloseTo(-110540, 6);
  });

  it("wraps dateline deltas to the shorter arc", () => {
    const anchor = anchorOfBounds({
      west: 179.5,
      south: 10,
      east: -179.5,
      north: 12,
      crossesAntimeridian: true,
    });
    const local = lonLatToLocal(-179.5, 11, anchor);
    expect(Math.abs(local.x)).toBeLessThan(111320);
  });
});
