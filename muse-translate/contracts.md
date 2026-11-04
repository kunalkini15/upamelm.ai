# Kept Translate Contracts

The agent keeps the input package shapes exactly. The authoritative shapes
are the UI contracts in `../muse-document-processing/ui-output-contracts.json`
and the summaries in `../muse-document-processing/contracts.md`. Field shapes
below are summaries, not replacements — when in doubt, match the input file.

## Request file: `requests/<job>.json`

Keys: `input`, `output_dir`, `languages[]`. Optional: `scope`
(`full` | `narrative_only` | `report_only`, default `full`),
`overwrite` (default false), `guidance` (qualitative only, never counts).

- `input`: path to a `study_package.json` file or to a directory containing
  `study_package.json`, `narrative_package.json`, and/or `report.json`.
- `output_dir`: run directory `muse-translate/runs/<run-id>/`.
- `languages[]`: one or more languages, given as ISO 639-1 codes or as
  language names (case-insensitive), e.g. `kn`, `hi`, `ta`, `te`, or
  `Kannada`, `Hindi`, `Tamil`, `Telugu`. Names are normalized to codes
  before lane planning (see table below). Codes are lowercased.

When invoked from the `subsurface` directory, both paths are relative to that
directory. A normal pipeline handoff is therefore
`input=muse-document-processing/runs/<study-id>` and
`output_dir=muse-translate/runs/<study-id>` with no leading `subsurface/`.

## Language name to code table

| Code | Language |
|------|----------|
| `kn` | Kannada |
| `hi` | Hindi |
| `ta` | Tamil |
| `te` | Telugu |
| `ml` | Malayalam |
| `mr` | Marathi |
| `bn` | Bengali |
| `gu` | Gujarati |
| `pa` | Punjabi |
| `ur` | Urdu |
| `or` | Odia |
| `as` | Assamese |
| `sa` | Sanskrit |
| `en` | English |

Unrecognized entries fail the plan with an unresolved item naming the bad
value; the planner never guesses a code.

## Translatable prose fields (and only these)

- `narrative_package.target_insights[].analysis` (empty string stays empty)
- `narrative_package.limitations[]`
- `report.blocks[].headline`, `report.blocks[].content`
- `report.blocks[].metrics[].label`, `report.blocks[].metrics[].explanation`
- `rendering_package.study.title`, `short_title`, `summary`
- `report.display_title`, `report.short_title`, `report.brief_description`

## Never translated, never altered

IDs, order, counts, `evidence_refs`, `source_refs`, metric `display_value`,
numbers, units, coordinates, checksums, filenames, schema keys, and proper
noun spellings (CGWB, IISc, NIMHANS, place names) stay byte-identical.

## Output naming

For language `<lang>`, with `<stem>` in
(`study_package`, `narrative_package`, `report`):

- `<stem>_<lang>.json`, e.g. `study_package_kn.json`,
  `study_package_hi.json`, `narrative_package_ta.json`, `report_te.json`.

Only stems present in the input are emitted. `study_package_<lang>.json`
embeds the translated `narrative_package` and `report` sections so the UI can
read one file per language.

## Run manifest: `run_summary.json`

Top-level keys: `schema_version` (`translate-run.v1`), `run_id`, `input`,
`languages[]`, `outputs{}`, `counts{insights, blocks, metrics}`,
`verification{valid, issues[]}`, plus `status` and `unresolved[]`.

There is no separate draft or review artifact. Per-language lanes write final
package copies directly, and `verification.md` plus `run_summary.json` record
the single final verification and any targeted repairs.
