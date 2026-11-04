# Loop 1 — Pending Changes From Exhaustive Document Runs

This is the running record of code changes discovered while exhaustively processing the Bengaluru documents. Findings should be recorded here during the remaining runs and implemented together after those runs finish.

The evaluation standard is the hackathon pipeline: preserve obvious and useful information, support a compelling spatial/subsurface demonstration, remain generic across document types, and avoid expensive reruns unless extracted evidence is materially incomplete.

## Pending

No currently known blocking changes remain before Stage 7 validation.

## Resolved During Runs

### 1. Namespace generated identifiers during consolidation

**Discovered from:** `bangalore_metro_phase_3.pdf` and confirmed by `bangalore_metro_phase_3_env_impact.pdf`, Stages 4–5.

**Status:** Implemented and verified across all four selected Bengaluru documents.

**Observed result:**

- 509/509 meaningful visual artifacts were interpreted successfully.
- The extraction content is good and does not need to be regenerated.
- Independently generated batches reused local identifiers such as `EV-01`, `REL-01`, and `ent-bmrcl`.
- Across the 51 visual-extraction batches there were:
  - 28 duplicate evidence-ID instances.
  - 78 duplicate relationship-ID instances.
  - 96 duplicate entity-ID instances.
  - 46 evidence references that did not resolve inside their originating batch.

**Why it matters:**

Stage 6 currently assumes evidence IDs are globally unique and skips later evidence items when an ID has already been seen. This could discard valid evidence and leave ambiguous references when batches and documents are combined.

**Planned generic change:**

During deterministic consolidation, namespace every model-generated local ID using stable run context, for example:

```text
<document-id>:<batch-id>:<local-id>
```

Rewrite all references in the same result consistently, including:

- Evidence IDs and `evidence_refs`.
- Entity IDs and entity references.
- Relationship IDs and relationship endpoints.
- Spatial feature IDs.
- Vertical interval IDs and their feature references.

After rewriting, validate referential integrity. Preserve content with an explicit validation warning when a model emitted a genuinely unresolved reference; do not silently drop otherwise valid extraction content.

**Rerun requirement:** None. Apply normalization to the saved Stage 3 and Stage 5 artifacts during Stage 6.

**Environmental-impact report confirmation:**

- 274/274 meaningful visuals were interpreted, producing 662 evidence items, 447 entities, 167 spatial features, 9 vertical intervals and 115 relationships.
- All 662 evidence IDs and all 167 spatial feature IDs were already unique.
- Local batch IDs still produced 53 duplicate entity-ID instances and 40 duplicate relationship-ID instances across batches.
- One entity referenced an evidence ID that was not emitted in its own batch.
- This confirms that deterministic namespacing/reference validation belongs in generic consolidation rather than requiring extraction reruns or source-specific prompts.

**Final verification:**

- Zero evidence items, entities, spatial features, vertical intervals, relationships or visual interpretations were lost during consolidation.
- Zero duplicate normalized IDs remain in any of the five generated-object collections.
- Native artifact and unit references are reconciled only through exact bundle IDs and authoritative artifact locators.
- The Metro report required 114 deterministic provenance repairs; the environmental-impact report required 15. All four documents now have zero provenance errors.
- Unresolved model-generated cross-references are retained in an explicit batch namespace and reported as non-fatal warnings rather than deleted or guessed.

### Completed empty-stage reuse

Stage loaders now distinguish a successfully completed zero-output stage from a missing prerequisite by consulting stage telemetry. This allows structured sources such as the BWSSB KML, which legitimately has zero visual batches, to proceed through consolidation without fabricating empty batch files.

### Token-counter transient failure handling

The Meta input-token counter now retries transient `429`/`5xx`, timeout, and network failures. If the auxiliary counter remains unavailable, the pipeline uses a conservative local estimate and continues to the actual model request while retaining the cost guard.

This resolved the failure mode in which a temporary `504` from `/responses/input_tokens` aborted an otherwise valid visual-extraction stage.

## Remaining-run Review Checklist

For each remaining document, record only findings that could materially affect the hackathon output:

- Missing or incorrectly excluded meaningful artifacts.
- Failed or incomplete batches after resume/retry.
- Important maps, tables, drawings, coordinates, depths, materials, or relationships omitted from extraction.
- Generic adapter or document-type limitations.
- Identifier or cross-reference integrity problems.
- Changes required before consolidation or synthesis.

Do not add production-hardening work that does not improve the hackathon demonstration or protect extracted evidence.

