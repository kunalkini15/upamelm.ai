# Registry Contracts

The registries are deliberately small. They record accepted capabilities and
fixtures; they do not replace the application's typed internal model.

## Capability registry

Each entry in `capability-registry.json` uses:

```json
{
  "id": "stable-kebab-case-id",
  "title": "Human-readable capability",
  "description": "What evidence and user outcome it represents",
  "renderer": "source-level renderer identifier",
  "input_kinds": ["semantic or geometry kinds"],
  "interaction_kinds": ["selection", "inspection"],
  "verified_fixture_ids": ["package fixture ids"],
  "status": "verified"
}
```

Only browser-verified implementations belong here. A planned or failed renderer
stays in the run report, not in the registry.

## Package registry

Each entry in `package-registry.json` uses:

```json
{
  "id": "stable-fixture-id",
  "path": "repo-relative path to the package",
  "title": "Human-readable study name",
  "enabled": true,
  "required_capability_ids": ["capability ids"],
  "smoke_states": ["observable browser state"],
  "accepted_in_run": "verification run id"
}
```

Paths must remain resolvable from the repository root. A package becomes enabled
only after its initial browser verification succeeds.

## Staged promotion

Application writers describe proposed changes in
`verification/<run-id>/proposed-registry.json` and leave both live registries
unchanged. The proposal contains complete replacement documents for
`capability-registry.json` and `package-registry.json`, preserving their schema
metadata, plus a short reason for each addition, update, or removal. A read-only verifier checks the proposal
against browser evidence before promotion.

The registry promoter must first save both current registry files under the run
directory, validate the proposed JSON and all cross-references, replace both
live registries, and validate them again. If any step fails, it restores both
saved files. A separate read-only validation stage confirms that the promoted
registries exactly match the accepted proposal.
