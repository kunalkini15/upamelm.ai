#!/usr/bin/env bash
set -euo pipefail

force=false
resume=false
stale_failure_timestamp=""
if [[ ${1:-} == "--force" ]]; then
  force=true
  shift
fi

if [[ $# -ne 1 ]]; then
  echo "usage: scripts/run-pipeline-live.sh [--force] pipeline-requests/<city>.json" >&2
  exit 64
fi

request_path="$1"
workspace_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$workspace_dir"

[[ -f "$request_path" ]] || { echo "request not found: $request_path" >&2; exit 66; }
jq -e '.dry_run == false and (.max_docs | type == "number" and . > 0) and (.languages | type == "array" and length > 0)' "$request_path" >/dev/null

pipeline_dir="$(jq -r '.pipeline_dir' "$request_path")"
ingest_run="$(jq -r '.ingest_run' "$request_path")"
studies_dir="$(jq -r '.studies_dir' "$request_path")"
translate_dir="$(jq -r '.translate_dir' "$request_path")"
for value in "$pipeline_dir" "$ingest_run" "$studies_dir" "$translate_dir"; do
  [[ -n "$value" && "$value" != "null" && "$value" != "." && "$value" != "/" ]] || { echo "unsafe or missing output path: $value" >&2; exit 65; }
done

# Recognize either a harmless planner-only checkpoint or an explicit durable
# partial-run checkpoint. Material partial runs are never deleted by --force.
if [[ -e "$pipeline_dir" ]]; then
  pipeline_entry_count="$(find "$pipeline_dir" -mindepth 1 -maxdepth 1 -print 2>/dev/null | wc -l | tr -d ' ')"
  if [[ ! -L "$pipeline_dir" && -d "$pipeline_dir" && -f "$pipeline_dir/pipeline_request.json" && "$pipeline_entry_count" == "1" ]]; then
    if [[ "$force" == true ]]; then
      echo "Force-resetting planner-only checkpoint: $pipeline_dir/pipeline_request.json"
      rm -f -- "$pipeline_dir/pipeline_request.json"
      rmdir -- "$pipeline_dir"
    else
      echo "Resuming planner-only checkpoint: $pipeline_dir/pipeline_request.json"
    fi
  elif [[ ! -L "$pipeline_dir" && -d "$pipeline_dir" && -f "$pipeline_dir/pipeline_request.json" && -f "$pipeline_dir/failure_report.json" ]] \
    && jq -e '.status == "partial" and (.safe_retry_point == "ingestion" or .safe_retry_point == "study-fanout")' "$pipeline_dir/failure_report.json" >/dev/null; then
    resume=true
    stale_failure_timestamp="$(jq -r '.timestamp // empty' "$pipeline_dir/failure_report.json")"
    echo "Resuming validated partial checkpoint: $pipeline_dir/failure_report.json"
  else
    echo "refusing live run; pipeline destination contains more than a planner-only checkpoint: $pipeline_dir" >&2
    exit 73
  fi
fi

if [[ "$resume" == true ]]; then
  retry_point="$(jq -r '.safe_retry_point' "$pipeline_dir/failure_report.json")"
  [[ -d "$ingest_run" && ! -L "$ingest_run" ]] || { echo "refusing resume; ingestion checkpoint missing: $ingest_run" >&2; exit 73; }
  if [[ "$retry_point" == "ingestion" ]]; then
    [[ ! -e "$studies_dir" ]] || { echo "refusing ingestion resume; studies destination already exists: $studies_dir" >&2; exit 73; }
    [[ ! -e "$translate_dir" ]] || { echo "refusing ingestion resume; translation destination already exists: $translate_dir" >&2; exit 73; }
  else
    [[ -d "$studies_dir" && ! -L "$studies_dir" ]] || { echo "refusing study resume; study checkpoint missing: $studies_dir" >&2; exit 73; }
    [[ ! -e "$translate_dir" ]] || { echo "refusing study resume; translation destination already exists: $translate_dir" >&2; exit 73; }
  fi
else
  for value in "$ingest_run" "$studies_dir" "$translate_dir"; do
    [[ ! -e "$value" ]] || { echo "refusing live run; stage destination already exists: $value" >&2; exit 73; }
  done
fi

node scripts/build-pipeline-workflow-runtime.mjs
node --check pipeline-workflow.runtime.js
node --test tests/pipeline-workflow.test.js

city_name="$(basename "$pipeline_dir")"
run_stamp="$(date -u +%Y%m%dT%H%M%SZ)"
session_id="$(uuidgen | tr '[:upper:]' '[:lower:]')"
log_dir="pipeline-logs/${city_name}-${run_stamp}"
mkdir -p "$log_dir"
cp "$request_path" "$log_dir/request.json"

workflow_name="subsurface-${city_name}-${run_stamp}"
# Pass the frozen request fields as authoritative structured args. This avoids
# asking the launch/planner model to reconstruct max_docs, languages, fan-out,
# and output roots from prose during a resume.
workflow_args="$(jq -c --arg request "$request_path" --argjson resume "$resume" '. + {request:$request,dry_run:false,resume:$resume}' "$request_path")"
prompt="Call workflow exactly once with workflowName=\"${workflow_name}\", scriptPath=\"pipeline-workflow.runtime.js\", and structured args ${workflow_args}. Do not edit files yourself and do not call any other tool. Return the complete workflow report verbatim."

echo "Launching exactly one workflow call"
echo "Session: $session_id"
echo "Logs: $log_dir"
echo "Console mode: concise (full JSONL is retained in $log_dir/launcher.jsonl)"
set +e
muse exec --json --session-id "$session_id" --trust-workspace --workspace "$workspace_dir" --approval-mode never --disable-reminders --max-model-steps 8 "$prompt" 2>&1 \
  | tee "$log_dir/launcher.jsonl" \
  | node scripts/format-muse-events.mjs "$pipeline_dir" "$request_path" "$resume" \
  | tee "$log_dir/progress.log"
muse_status=${PIPESTATUS[0]}
set -e

if [[ "$muse_status" -ne 0 ]]; then
  echo "Muse launcher failed with exit code $muse_status; see $log_dir/launcher.jsonl" | tee -a "$log_dir/progress.log" >&2
  muse export --session "$session_id" --out "$log_dir/session-export.json" >/dev/null 2>&1 || true
  exit "$muse_status"
fi

terminal_json="$(jq -Rc 'fromjson? | select(.payload_type == "run.terminal.completed" and (.payload.text // "") != "") | .payload.text' "$log_dir/launcher.jsonl" 2>/dev/null | tail -n 1 || true)"
terminal_text="$(printf '%s' "$terminal_json" | jq -r '.' 2>/dev/null || true)"
if [[ "$terminal_text" == *'"status":"partial"'* ]]; then
  echo "Workflow ended partial before the terminal bundle audit; it will not be relaunched" | tee -a "$log_dir/progress.log"
  failed_stage="$(printf '%s\n' "$terminal_text" | sed -n 's/.*"failed_stage":"\([^"]*\)".*/\1/p' | head -n 1)"
  echo "Failed stage: ${failed_stage:-unknown}. Full report: $log_dir/launcher.jsonl" | tee -a "$log_dir/progress.log"
  muse export --session "$session_id" --out "$log_dir/session-export.json" >/dev/null 2>&1 || true
  echo "Session export: $log_dir/session-export.json"
  exit 2
fi

echo "Background workflow launched; monitoring artifacts without invoking Muse again"
set +e
PIPELINE_MONITOR_IGNORE_FAILURE_TIMESTAMP="$stale_failure_timestamp" node scripts/monitor-pipeline-run.mjs "$pipeline_dir" "$log_dir/progress.log"
monitor_status=$?
set -e

muse export --session "$session_id" --out "$log_dir/session-export.json" >/dev/null 2>&1 || true
echo "Session export: $log_dir/session-export.json"
exit "$monitor_status"
