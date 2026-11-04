# Registry validation — experience-foundation promotion

**Run id:** experience-foundation. **Result: PROMOTED.**

## Backups

- `registry-backup/capability-registry.json` — 3 verified entries
  (`point-observation`, `path`, `vertical-profile`).
- `registry-backup/package-registry.json` — `{"packages": []}`.

## Pre-promotion checks (all passed)

- Both live files and `proposed-registry.json` parse as valid JSON.
- Proposed schema version `visual-capabilities.v1`; all 3 staged entries carry
  the required fields plus a `composition_failure` reason each.
- Proposed packages `[]` exactly equals live packages `[]` — package registry
  left untouched per the replace-only-accepted-documents rule.
- No id collisions between staged and live capabilities.
- Every staged `verified_fixture_ids` suffix resolves to a feature id in
  `showcase-package.json` (`demo-horizon-a/b/c`, `demo-water-level`,
  `demo-transect-1`); showcase fixture remains unregistered, not a default.
- Implementation references exist in source (`ThreeViewport.tsx`,
  `package-adapter/validate.ts`, `extensions.test.ts`); read-only verifier
  verdict in `post-verification.md` is ACCEPTED with no open must_fix item.

## Promotion applied

Appended to `muse-ui/capability-registry.json` with `status: verified`
(live entry shape per `REGISTRIES.md`; staging-only `composition_failure`
reasons retained in `proposed-registry.json`):

- `subsurface-surface`, `reference-surface`, `cross-section`.

`muse-ui/package-registry.json` unchanged (still `{"packages": []}`).
No application source edited.

## Post-promotion validation (passed)

- Live capability registry parses: 6 entries, unique ids, all fields typed,
  all `status: verified`.
- First 3 entries byte-identical to backup; last 3 match the staged proposal
  field-for-field.
- Live package registry parses and still equals the accepted proposal.
- No rollback needed; backups retained under `registry-backup/`.
