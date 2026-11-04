# Registry validation — run bootstrap-default

Scope: read-only post-promotion validation of the adaptive visualization module.
No application, registry, or fixture file was edited. `ui-v2` was not inspected.

## Inputs parsed

- `muse-ui/capability-registry.json` (schema `visual-capabilities.v1`)
- `muse-ui/package-registry.json` (schema `visual-package-registry.v1`)
- `muse-ui/verification/bootstrap-default/proposed-registry.json` (accepted staged delta)

## Checks

1. **Live capability registry matches accepted proposal** — PASS. Parsed
   `muse-ui/capability-registry.json` is deep-equal (sorted-key JSON) to
   `proposed-registry.json` → `capability_registry` (3 capabilities:
   `point-observation`, `path`, `vertical-profile`).
2. **Live package registry matches accepted proposal** — PASS. Parsed
   `muse-ui/package-registry.json` is deep-equal to
   `proposed-registry.json` → `package_registry` (empty `packages: []`,
   as required for bootstrap with no accepted study package).
3. **Capability IDs unique** — PASS. 3/3 distinct.
4. **Package IDs unique** — PASS. No packages, so vacuously unique.
5. **Package paths resolve** — PASS (vacuous). No package entries; nothing to
   resolve. Consistent with the bootstrap rule that the proposed package
   registry remains empty.
6. **Every required capability reference exists** — PASS (vacuous). No package
   entries, so no `required_capability_ids` to resolve. Capability schema
   versions match the proposal.

## Result

valid=true — every check passes.
