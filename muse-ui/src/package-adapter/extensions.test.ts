import { describe, expect, it } from "vitest";
import { cameraDuration } from "../design/components.tsx";
import { validatePackage } from "./validate.ts";
import { referenceWaterElevation } from "../three/ThreeViewport.tsx";

const LAYER = (id: string, capability: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: id,
  capability,
  ...extra,
});

function pkg(layers: unknown[], features: unknown[], extra: Record<string, unknown> = {}) {
  return {
    schema_version: "muse-scene-package.v1",
    crs: "EPSG:4326",
    metadata: { title: "t", description: "d" },
    layers,
    features,
    ...extra,
  };
}

describe("extended vertical evidence boundary", () => {
  it("parses uncertainty, dip, easting bound, and referenceKind generically", () => {
    const result = validatePackage(
      pkg(
        [
          LAYER("l-h", "subsurface-surface"),
          LAYER("l-w", "reference-surface", { referenceKind: "water-level" }),
        ],
        [
          {
            id: "h",
            layer: "l-h",
            label: "horizon",
            geometry: {
              kind: "polygon",
              coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
              elevationMeters: -100,
              uncertaintyMeters: 4,
              dipDegrees: 5,
            },
            uncertaintyEastingMinMeters: 600,
          },
          {
            id: "w",
            layer: "l-w",
            label: "water",
            geometry: {
              kind: "polygon",
              coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
              elevationMeters: -10,
              uncertaintyMeters: null,
              dipDegrees: 0,
            },
          },
        ],
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const horizon = result.scene.features.find((f) => f.id === "h")!;
    expect(horizon.geometry.uncertaintyMeters).toBe(4);
    expect(horizon.geometry.dipDegrees).toBe(5);
    expect(horizon.uncertaintyEastingMinMeters).toBe(600);
    expect(result.scene.layers.find((l) => l.id === "l-w")?.referenceKind).toBe("water-level");
    expect(referenceWaterElevation(result.scene)).toBe(-10);
  });

  it("quarantines non-finite or out-of-range vertical evidence per feature", () => {
    const bad = (geometry: unknown, extra: Record<string, unknown> = {}) => ({
      id: "f",
      layer: "l",
      label: "f",
      geometry,
      ...extra,
    });
    const base = {
      kind: "point",
      coordinates: [0, 0],
      elevationMeters: -5,
      uncertaintyMeters: null,
      dipDegrees: null,
    };
    for (const geometry of [
      { ...base, uncertaintyMeters: -1 },
      { ...base, uncertaintyMeters: Number.NaN },
      { ...base, uncertaintyMeters: "4" },
      { ...base, dipDegrees: 91 },
      { ...base, dipDegrees: Number.POSITIVE_INFINITY },
      { ...base, dipDegrees: 5 }, // dip on a point is rejected
      { ...base, elevationMeters: Number.NaN },
    ]) {
      const result = validatePackage(pkg([LAYER("l", "point-observation")], [bad(geometry)]));
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.scene.features.map((f) => f.id)).not.toContain("f");
    }
    // A bad easting bound quarantines the feature, never the package.
    const easting = validatePackage(
      pkg(
        [LAYER("l", "point-observation")],
        [bad(base, { uncertaintyEastingMinMeters: "east" })],
      ),
    );
    expect(easting.ok).toBe(true);
    if (easting.ok) expect(easting.scene.features).toHaveLength(0);
  });

  it("treats unknown referenceKind as ordinary evidence with a limitation", () => {
    const result = validatePackage(
      pkg(
        [LAYER("l", "reference-surface", { referenceKind: "lava" })],
        [
          {
            id: "f",
            layer: "l",
            label: "f",
            geometry: {
              kind: "polygon",
              coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
              elevationMeters: -10,
              uncertaintyMeters: null,
              dipDegrees: null,
            },
          },
        ],
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.layers[0]?.referenceKind).toBeNull();
    expect(result.scene.limitations.join(" ")).toMatch(/referenceKind/);
    expect(referenceWaterElevation(result.scene)).toBeNull();
  });

  it("records adapter transform provenance without inventing coordinates", () => {
    const result = validatePackage(pkg([], []));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.provenance).toHaveLength(1);
    expect(result.scene.provenance[0]).toMatchObject({
      sourceCrs: "EPSG:4326",
      targetFrame: "WGS84-lonlat",
    });
  });
});

describe("camera pacing", () => {
  it("collapses to zero under reduced motion and passes through otherwise", () => {
    expect(cameraDuration(500, true)).toBe(0);
    expect(cameraDuration(500, false)).toBe(500);
  });
});
