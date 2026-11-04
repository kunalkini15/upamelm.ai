import { describe, expect, it } from "vitest";
import { isSupportedCrs, SUPPORTED_CRS, transformToWgs84 } from "./transform.ts";

describe("supported CRS declarations", () => {
  it("declares an explicit allowlist", () => {
    expect([...SUPPORTED_CRS]).toEqual(["EPSG:4326", "EPSG:3857"]);
    expect(isSupportedCrs("EPSG:4326")).toBe(true);
    expect(isSupportedCrs("EPSG:27700")).toBe(false);
    expect(isSupportedCrs("WGS84-ish guess")).toBe(false);
  });

  it("passes EPSG:4326 through as identity", () => {
    const result = transformToWgs84("EPSG:4326", -30.0, 5.0);
    expect(result?.lonlat).toEqual([-30, 5]);
    expect(result?.provenance).toMatchObject({
      sourceCrs: "EPSG:4326",
      targetFrame: "WGS84-lonlat",
    });
  });

  it("converts EPSG:3857 web mercator to WGS84", () => {
    const result = transformToWgs84("EPSG:3857", 0, 0);
    expect(result?.lonlat[0]).toBeCloseTo(0, 4);
    expect(result?.lonlat[1]).toBeCloseTo(0, 4);
  });

  it("refuses undeclared CRS values instead of guessing", () => {
    expect(transformToWgs84("EPSG:27700", 0, 0)).toBeNull();
    expect(transformToWgs84("", 0, 0)).toBeNull();
  });

  it("refuses non-finite and out-of-range results", () => {
    expect(transformToWgs84("EPSG:4326", Number.NaN, 0)).toBeNull();
    expect(transformToWgs84("EPSG:3857", 1e9, 1e9)).toBeNull();
  });
});
