// Capability vocabulary: reusable semantic/geometric ideas only. No entry
// may encode a document, place, publisher, or report (AGENTS.md). Bootstrap
// ships the interface plus a negotiation stub that reports "no evidence"; the
// live registry stays empty until a renderer is implemented and browser
// verified (BASELINE.md A3).

export interface CapabilityDefinition {
  id: string;
  title: string;
  description: string;
  renderer: string;
  input_kinds: string[];
  interaction_kinds: string[];
  verified_fixture_ids: string[];
  status: "verified";
}

export type NegotiationOutcome =
  | { kind: "no-evidence"; reason: string }
  | { kind: "render"; capabilityId: string; featureIds: string[] };

export function negotiateCapabilities(input: {
  layerCapabilityIds: string[];
  featureCount: number;
}): NegotiationOutcome {
  if (input.layerCapabilityIds.length === 0 || input.featureCount === 0) {
    return { kind: "no-evidence", reason: "No located layers or features." };
  }
  return {
    kind: "render",
    capabilityId: input.layerCapabilityIds[0] as string,
    featureIds: [],
  };
}

// Registry integrity check shared by unit tests and the staged-promotion
// validation: schema metadata must match and every required package
// capability must be registered.
export function validateRegistries(input: {
  capabilityRegistry: {
    schema_version?: unknown;
    capabilities?: Array<{ id?: unknown }>;
  };
  packageRegistry: {
    schema_version?: unknown;
    packages?: Array<{
      id?: unknown;
      path?: unknown;
      required_capability_ids?: unknown;
    }>;
  };
}): string[] {
  const problems: string[] = [];
  if (input.capabilityRegistry.schema_version !== "visual-capabilities.v1") {
    problems.push("capability registry schema_version must be visual-capabilities.v1");
  }
  if (input.packageRegistry.schema_version !== "visual-package-registry.v1") {
    problems.push("package registry schema_version must be visual-package-registry.v1");
  }
  const known = new Set(
    (input.capabilityRegistry.capabilities ?? []).map((c) => String(c.id)),
  );
  for (const pkg of input.packageRegistry.packages ?? []) {
    if (typeof pkg.id !== "string" || typeof pkg.path !== "string") {
      problems.push("package entry needs string id and path");
    }
    const required = Array.isArray(pkg.required_capability_ids)
      ? pkg.required_capability_ids
      : [];
    for (const cap of required) {
      if (!known.has(String(cap))) {
        problems.push(`package "${String(pkg.id)}" requires unknown capability "${String(cap)}"`);
      }
    }
  }
  return problems;
}
