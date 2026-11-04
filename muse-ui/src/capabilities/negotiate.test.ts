import { describe, expect, it } from "vitest";
import capabilityRegistry from "../../capability-registry.json";
import packageRegistry from "../../package-registry.json";
import { negotiateCapabilities, validateRegistries } from "./negotiate.ts";

describe("capability negotiation", () => {
  it("reports no evidence for the bootstrap empty scene", () => {
    expect(negotiateCapabilities({ layerCapabilityIds: [], featureCount: 0 })).toEqual({
      kind: "no-evidence",
      reason: "No located layers or features.",
    });
  });

  it("renders the first declared capability when evidence exists", () => {
    const outcome = negotiateCapabilities({
      layerCapabilityIds: ["point-observation"],
      featureCount: 3,
    });
    expect(outcome).toMatchObject({ kind: "render", capabilityId: "point-observation" });
  });
});

describe("registry integrity", () => {
  it("live registries parse with the expected schema versions", () => {
    expect(capabilityRegistry.schema_version).toBe("visual-capabilities.v1");
    expect(packageRegistry.schema_version).toBe("visual-package-registry.v1");
    expect(Array.isArray(capabilityRegistry.capabilities)).toBe(true);
    expect(Array.isArray(packageRegistry.packages)).toBe(true);
  });

  it("accepts coherent registries and flags dangling capability references", () => {
    expect(
      validateRegistries({ capabilityRegistry, packageRegistry }),
    ).toEqual([]);
    const problems = validateRegistries({
      capabilityRegistry: { schema_version: "visual-capabilities.v1", capabilities: [] },
      packageRegistry: {
        schema_version: "visual-package-registry.v1",
        packages: [
          {
            id: "ghost",
            path: "fixtures/ghost.json",
            required_capability_ids: ["missing-capability"],
          },
        ],
      },
    });
    expect(problems.some((p) => p.includes("missing-capability"))).toBe(true);
  });

  it("rejects wrong schema metadata", () => {
    const problems = validateRegistries({
      capabilityRegistry: { schema_version: "wrong", capabilities: [] },
      packageRegistry: { schema_version: "visual-package-registry.v1", packages: [] },
    });
    expect(problems.length).toBeGreaterThan(0);
  });
});
