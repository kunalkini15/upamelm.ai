# Translate Requests

One JSON file per translate job. The workflow reads only this file for job
specifics; instructions stay generic. Create a new request for each job and
independently verify every path and language.

## Fields

- `input`: path to a `study_package.json` file or to a directory containing
  `study_package.json`, `narrative_package.json`, and/or `report.json`.
- `output_dir`: run directory `muse-translate/runs/<run-id>/`.
- `languages[]`: language names or ISO 639-1 codes, e.g.
  `["Kannada"]`, `["Hindi", "Tamil"]`, or `["kn", "hi"]`. Names are
  case-insensitive and normalized to codes (table in `../contracts.md`).
- `scope` (optional): `full` (default), `narrative_only`, or `report_only`.
- `overwrite` (optional): default false; when false, existing verified outputs
  are reused.
- `guidance` (optional): qualitative preferences only. It must not contain
  numeric lane, file, model-call, or time limits.

Paths are relative to the `subsurface` directory. Use
`muse-document-processing/runs/<study-id>` as input and
`muse-translate/runs/<study-id>` as output; do not add another `subsurface/`
prefix.

## Example

See `naquim-bangalore-north-kn.json` for a single-language Kannada job.
Copy it for a new job, change `input`, `output_dir`, and `languages`, and keep
one job per file.
