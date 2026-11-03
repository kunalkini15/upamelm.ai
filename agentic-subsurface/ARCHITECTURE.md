# Architecture

## Design boundary

The pipeline has two independent loops joined by a versioned Evidence Package.

```text
native sources
  -> immutable originals + deterministic derivatives
  -> semantic, multimodal evidence batches
  -> validated Evidence Package                 (Loop 1)
  -> scientific.v1 spatial/UI package
  -> feature narratives + report synthesis      (Loop 2)
```

The model never replaces native geometry, table rows, page images, or source files. It interprets them and returns references to stable artifacts.

## Source layer

`AdapterRegistry` currently supports PDF, KML/KMZ, CSV/TSV, XLSX/XLSM, JSON/GeoJSON, common images, and text/XML/HTML. Each adapter copies the original source, computes a SHA-256 checksum, writes native deterministic derivatives, and emits `SourceBundle` plus generic `SourceLocator` records.

PDF processing stores page text, layout blocks, every high-signal page render, detected tables with bounding boxes and rows, and visual-candidate metadata. KML processing preserves the full collection as GeoJSON while giving the model only a collection profile and bounded representative sample. Tabular sources preserve every row and use cell/range or row locators.

## Loop 1

`SemanticBatcher` creates lossless source-unit batches. Live batches are recursively split when their effective size or output density exceeds safe limits. Meta's `/responses/input_tokens` endpoint measures every live request before generation. Each batch uses a strict JSON Schema and high reasoning.

The consolidation validator resolves every evidence locator against an artifact or content unit, removes invalid evidence, reports duplicate IDs, and records coverage. It never destroys the source or batch artifacts.

## Loop 2

The spatial synthesis call consumes the validated Evidence Package and deterministic asset manifest. It emits the repository's existing `scientific.v1` contract. Unsupported/non-spatial findings remain observations instead of receiving fabricated coordinates. Native bulk geometry remains a dataset path/reference.

Feature narratives and report synthesis are separate strict-schema calls. The final UI package embeds the report and attaches narratives by feature ID.

## Provider safety

- Model is hard-locked to `muse-spark-1.3-contributor`.
- Base URL is hard-coded to the official Meta endpoint.
- Credentials are loaded from the environment or an existing project `.env`; values are never captured.
- Inline image bytes are redacted from request artifacts.
- The cost ledger uses official Contributor pricing: $0.10/M uncached input, $0.002/M cached input, $0.20/M output.
- A prospective worst-case check stops a call before the configured cost ceiling.
- Retry is limited to 429, 5xx, network, and timeout failures with exponential backoff and jitter.
- Completed batches and synthesis artifacts are resumable.

## Prompt engineering

Prompts are versioned in `prompts.py` and keep stable instructions/schema before volatile batch content to support prompt caching. The extraction contract requires explicit provenance, distinguishes direct/source-interpreted/derived evidence, forbids invented coordinates and bulk-record transcription, and retains unresolved gaps. Schema changes are validated by live smoke tests before corpus execution.

