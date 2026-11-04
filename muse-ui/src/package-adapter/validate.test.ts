import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PACKAGE_SCHEMA_VERSION, validatePackage } from "./validate.ts";

function syntheticRaw(): unknown {
  return JSON.parse(
    readFileSync(new URL("../../tests/fixtures/synthetic-package.json", import.meta.url), "utf-8"),
  );
}

describe("package validation boundary", () => {
  it("accepts the deterministic synthetic fixture through the adapter", () => {
    const result = validatePackage(syntheticRaw());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.schemaVersion).toBe(PACKAGE_SCHEMA_VERSION);
    // Two rendered layers; the unknown-capability layer is listed, not rendered.
    expect(result.scene.layers.map((l) => l.id)).toEqual(["syn-points", "syn-paths"]);
    expect(result.scene.limitations.some((l) => l.includes("not-a-real-capability"))).toBe(true);
    // Three valid features; the malformed one is quarantined per feature.
    expect(result.scene.features.map((f) => f.id)).toEqual(["syn-a", "syn-b", "syn-dateline"]);
    expect(result.scene.limitations.some((l) => l.includes("syn-broken"))).toBe(true);
    // Dateline-crossing line is preserved and flagged honestly.
    expect(result.scene.bounds?.crossesAntimeridian).toBe(true);
    expect(result.scene.unlocated).toBe(false);
    expect(result.scene.narrative).toHaveLength(1);
    expect(result.scene.reports).toHaveLength(1);
  });

  it("rejects outdated and missing schema versions before activation", () => {
    const outdated = validatePackage({ ...(syntheticRaw() as object), schema_version: "muse-scene-package.v0" });
    expect(outdated.ok).toBe(false);
    if (outdated.ok) throw new Error("outdated schema must be rejected");
    expect(outdated.errors[0]).toContain(PACKAGE_SCHEMA_VERSION);

    const missing = validatePackage({ layers: [] });
    expect(missing.ok).toBe(false);

    const nonObject = validatePackage("not a package");
    expect(nonObject.ok).toBe(false);
  });

  it("preserves unknown fields verbatim without render effect", () => {
    const result = validatePackage(syntheticRaw());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.rawUnknown).toEqual({
      custom_vendor_field: { kept: "verbatim", render_effect: "none" },
    });
    // Rendered surfaces only see typed fields: no unknown key leaks into layers/features.
    expect(JSON.stringify(result.scene.layers)).not.toContain("custom_vendor_field");
    expect(JSON.stringify(result.scene.features)).not.toContain("custom_vendor_field");
  });

  it("keeps narrative/report accessible for unlocated packages", () => {
    const result = validatePackage({
      schema_version: PACKAGE_SCHEMA_VERSION,
      crs: "EPSG:27700",
      metadata: { title: "Unlocated test", description: "" },
      layers: [],
      features: [],
      narrative: [{ id: "n1", title: "Held insight", body: "No geometry.", features: [] }],
      reports: [{ id: "r1", title: "Held section", body: "No geometry.", features: [] }],
      limitations: [],
      unresolved: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.unlocated).toBe(true);
    expect(result.scene.bounds).toBeNull();
    expect(result.scene.unresolved.some((u) => u.includes("EPSG:27700"))).toBe(true);
    expect(result.scene.narrative).toHaveLength(1);
    expect(result.scene.reports).toHaveLength(1);
  });

  it("skips duplicate ids and orphan-layer features without crashing", () => {
    const result = validatePackage({
      schema_version: PACKAGE_SCHEMA_VERSION,
      layers: [{ id: "l1", title: "L1", capability: "point-observation" }],
      features: [
        { id: "f1", layer: "l1", label: "ok", geometry: { kind: "point", coordinates: [0, 0], elevationMeters: null } },
        { id: "f1", layer: "l1", label: "dup", geometry: { kind: "point", coordinates: [1, 1], elevationMeters: null } },
        { id: "f2", layer: "nope", label: "orphan", geometry: { kind: "point", coordinates: [2, 2], elevationMeters: null } },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.features.map((f) => f.id)).toEqual(["f1"]);
  });

  it("derives 3D evidence generically from validated heights, not names", () => {
    // The flat synthetic fixture has no heights: 3D stays honestly disabled.
    const flat = validatePackage(syntheticRaw());
    expect(flat.ok).toBe(true);
    if (!flat.ok) return;
    expect(flat.scene.has3DEvidence).toBe(false);

    const elevated = validatePackage(
      JSON.parse(
        readFileSync(new URL("../../tests/fixtures/synthetic-3d-package.json", import.meta.url), "utf-8"),
      ),
    );
    expect(elevated.ok).toBe(true);
    if (!elevated.ok) return;
    expect(elevated.scene.has3DEvidence).toBe(true);
    expect(elevated.scene.unlocated).toBe(false);

    // Located but heightless stays disabled; unlocated with heights stays
    // disabled (no validated anchor, no fabricated origin).
    const noHeights = validatePackage({
      schema_version: PACKAGE_SCHEMA_VERSION,
      layers: [{ id: "l1", title: "L1", capability: "point-observation" }],
      features: [
        { id: "f1", layer: "l1", label: "flat", geometry: { kind: "point", coordinates: [0, 0], elevationMeters: null } },
      ],
    });
    expect(noHeights.ok).toBe(true);
    if (!noHeights.ok) return;
    expect(noHeights.scene.has3DEvidence).toBe(false);

    const unlocated = validatePackage({
      schema_version: PACKAGE_SCHEMA_VERSION,
      crs: "EPSG:27700",
      layers: [{ id: "l1", title: "L1", capability: "point-observation" }],
      features: [
        { id: "f1", layer: "l1", label: "high", geometry: { kind: "point", coordinates: [0, 0], elevationMeters: 10 } },
      ],
    });
    expect(unlocated.ok).toBe(true);
    if (!unlocated.ok) return;
    expect(unlocated.scene.unlocated).toBe(true);
    expect(unlocated.scene.has3DEvidence).toBe(false);
  });

  it("sanitizes by keeping display text inert (no code execution surface)", () => {
    const evil = '<img src=x onerror="alert(1)">';
    const result = validatePackage({
      schema_version: PACKAGE_SCHEMA_VERSION,
      metadata: { title: evil, description: evil },
      layers: [{ id: "l1", title: evil, capability: "point-observation" }],
      features: [
        { id: "f1", layer: "l1", label: evil, geometry: { kind: "point", coordinates: [0, 0], elevationMeters: null } },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Text is preserved as data; renderers emit it as text nodes, never HTML.
    expect(result.scene.features[0]?.label).toBe(evil);
  });
});
