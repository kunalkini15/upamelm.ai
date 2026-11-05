/**
 * @file backend-workflow.js
 * @module backend/backend-workflow
 * @description Independent verification workflow for the read-only backend API.
 * Validates promoted pipeline bundles through compilation, parallel tests, and
 * an ephemeral live server without modifying backend code or pipeline outputs.
 *
 * @workflow
 *   1. Exhaustive Validation (Spark) -> Compile, run parallel tests, launch an
 *      ephemeral server, probe every city/study/language/asset, and write reports.
 *   2. Failure Review (Wonder, conditional) -> Read-only review of material
 *      findings and ownership classification. Maximum one Wonder call.
 *   3. Report Finalization (Spark, conditional) -> Incorporate the review into
 *      the existing reports without repairing code or generated data.
 *
 * @modelRouting
 *   - Spark: All command execution, live probing, evidence capture, and report writing.
 *   - Wonder: Read-only review only when warnings or failures exist. Max 1 call.
 *
 * @param {Object} host - Muse workflow host context.
 * @param {string} host.args.pipeline_dir - Promoted city bundle (for example runs/bengaluru).
 * @param {string} host.args.output_dir - Workflow-owned report directory.
 * @param {string} [host.args.backend_dir=backend] - Backend module directory.
 * @param {number} [host.args.test_workers=4] - Bounded pytest-xdist worker count.
 * @param {number} [host.args.probe_concurrency=8] - Bounded live-probe concurrency.
 * @returns {Promise<Object>} Compact validation result and report paths. The
 * caller owns copying or writing these reports into a root pipeline directory.
 */

const SPARK = "muse-spark-1.3-contributor";
const WONDER = "muse-wonder-1.0";
const MAX_WONDER_CALLS = 1;

export default async function workflow(host) {
  let args = host.args || {};
  if (typeof args === "string") {
    try { args = JSON.parse(args); } catch { args = {}; }
  }

  const pipelineDir = args.pipeline_dir || args.input || null;
  const outputDir = args.output_dir || null;
  const backendDir = args.backend_dir || "backend";
  const testWorkers = boundedInteger(args.test_workers, 4, 1, 8);
  const probeConcurrency = boundedInteger(args.probe_concurrency, 8, 1, 16);

  if (!pipelineDir || !outputDir) {
    return finish({ status: "invalid_args", pipeline_dir: pipelineDir, output_dir: outputDir, unresolved: ["args must include pipeline_dir and output_dir"], stages: [], notes: [] });
  }

  const path = { type: "string" };
  const schema = (extra) => ({
    type: "object",
    required: ["complete", "evidence", "unresolved"],
    properties: {
      complete: { type: "boolean" },
      evidence: { type: "array", items: { type: "string" } },
      unresolved: { type: "array", items: { type: "string" } },
      ...extra,
    },
  });
  const validationSchema = schema({
    valid: { type: "boolean" }, report_json_path: path, report_markdown_path: path,
    raw_results_path: path, city_count: { type: "integer" },
    study_count: { type: "integer" },
    package_combination_count: { type: "integer" }, test_passed_count: { type: "integer" },
    test_failed_count: { type: "integer" }, live_probe_passed_count: { type: "integer" },
    live_probe_failed_count: { type: "integer" }, warning_count: { type: "integer" },
    issue_count: { type: "integer" },
  });
  const reviewSchema = schema({ decision: { type: "string" }, review_path: path, confirmed_issue_count: { type: "integer" }, ownership_changes: { type: "integer" } });
  const finalizationSchema = schema({ valid: { type: "boolean" }, report_json_path: path, report_markdown_path: path, issue_count: { type: "integer" }, warning_count: { type: "integer" }, review_decision: { type: "string" } });

  const stages = [];
  const notes = [];
  let wonderCalls = 0;

  async function run(scope, input, stageSchema, model) {
    if (model === WONDER && wonderCalls >= MAX_WONDER_CALLS) return record(scope, model, null, "wonder_call_limit_reached");
    if (model === WONDER) wonderCalls += 1;
    let result;
    try { result = await host.agent({ input, schema: stageSchema, label: scope, model }); }
    catch { return record(scope, model, null, "agent_exception"); }
    if (result?.notes) notes.push({ source: scope, ref: result.ref || null, value: result.notes });
    if (result?.data_spilled_for_size) return record(scope, model, result, "result_spilled_for_size");
    if (!result || result.error_kind) return record(scope, model, result, result?.error_kind || "null_result");
    const data = result.data && typeof result.data === "object" ? result.data : null;
    const ok = !!(data && data.complete === true);
    stages.push({ scope, ref: result.ref || null, complete: ok, model, error_kind: ok ? null : "incomplete", token_usage: readTokenUsage(result) });
    return { result, data, ok };
  }

  function record(scope, model, result, errorKind) {
    stages.push({ scope, ref: result?.ref || null, complete: false, model, error_kind: errorKind, token_usage: readTokenUsage(result) });
    return { result, data: null, ok: false };
  }

  const compact = "Return under 3KB. Write commands, logs, probes, findings, and explanations under output_dir; return only paths, counts, booleans, and at most six short evidence/unresolved strings.";
  const base = [
    `Backend module: ${backendDir}. Promoted pipeline bundle: ${pipelineDir}. Workflow output: ${outputDir}.`,
    `Read ${backendDir}/WORKFLOW.md and ${backendDir}/contracts.md completely before acting.`,
    `Use ${testWorkers} bounded test workers and at most ${probeConcurrency} concurrent live probes.`,
    "This is read-only verification. Never edit backend source, tests, dependencies, configuration, pipeline data, study packages, translations, or assets.",
    "The caller owns promotion into a root run directory. Write only validation artifacts under output_dir.", compact,
  ].join(" ");

  const validation = await run(
    "backend-exhaustive-validator",
    `${base} Create the output directory and execute the complete validation contract. Inventory pipeline_summary.json, ingestion/manifest.json, studies, every study_package*.json, asset_manifest.json, and all study-relative references. Compile Python sources and tests, verify dependency consistency, import the app, construct create_app against the supplied pipeline directory, and generate OpenAPI. Run the full pytest suite in parallel with pytest-xdist using exactly ${testWorkers} workers; capture machine-readable and human-readable results. Start one real Uvicorn server bound to 127.0.0.1 on an operating-system-selected ephemeral port, record PID/port, wait for readiness with a bounded timeout, and guarantee termination in a finally-style cleanup even after failures. Never use fixed port 8010 for automated validation. Probe root, docs, OpenAPI, health, cities, bootstrap, city studies, every city x study x discovered-language package, and every package-relative file reference. Run independent probes with concurrency at most ${probeConcurrency}. Check status, structured errors, schemas, selection identity, language identity, assetBaseUrl containment, file existence, MIME types, CORS, missing resources, encoded traversal, absolute paths, symlink escape, invalid identifiers, concurrent bootstrap/language requests, and cache refresh behavior. Do not treat expected security rejections as failures. Classify findings as compile_failure, dependency_failure, unit_test_failure, api_contract_failure, live_server_failure, upstream_data_failure, missing_asset, translation_mismatch, security_failure, performance_warning, or environment_failure; include severity, endpoint/test, expected, actual, evidence, likely_owner (backend|promotion|document-processing|translation|environment|unknown), and recommended_action. Distinguish backend defects from upstream data defects. Write ${outputDir}/raw_results.json, ${outputDir}/server.log, ${outputDir}/backend_validation.json, and ${outputDir}/backend_validation.md. JSON must include inputs, timestamps, commands, environment, matrix coverage, totals, findings, cleanup confirmation, and valid status. Markdown must be detailed when issues exist and concise when clean. Return complete=true when the entire audit and cleanup completed even if valid=false.`,
    validationSchema, SPARK,
  );

  if (!validation.ok) return finish({ status: "partial", failed_stage: "backend-exhaustive-validator", pipeline_dir: pipelineDir, output_dir: outputDir, backend_dir: backendDir, stages, unresolved: validation.data?.unresolved || ["backend validation did not complete"], notes, wonder_calls: wonderCalls, token_usage: aggregateTokenUsage(stages) });

  let outputs = outputFromValidation(validation.data, outputDir);
  const hasFindings = validation.data.issue_count > 0 || validation.data.warning_count > 0 || validation.data.valid !== true;
  if (hasFindings) {
    const review = await run(
      "wonder-backend-findings-review",
      `${base} Act as a read-only senior reviewer. Read ${validation.data.report_json_path}, ${validation.data.report_markdown_path}, ${validation.data.raw_results_path}, and ${outputs.server_log}. Do not execute repairs or edit backend/pipeline data. Check evidence, false positives, expected security rejections, in-process/live disagreement, ownership, severity, security implications, and whether actions are generic rather than Bengaluru-specific. Write ${outputDir}/wonder_review.md. Return decision (approved_with_findings|revision_required|environment_inconclusive), review_path, confirmed_issue_count, and ownership_changes.`,
      reviewSchema, WONDER,
    );
    if (review.ok) {
      const finalization = await run(
        "spark-backend-report-finalizer",
        `${base} Read ${validation.data.report_json_path}, ${validation.data.report_markdown_path}, ${validation.data.raw_results_path}, and ${review.data.review_path}. Update only report JSON and Markdown under output_dir; do not edit backend or pipeline files and do not rerun unsupported checks. Incorporate confirmed corrections, ownership changes, false-positive removals, review decision, and disagreements while retaining raw totals. Include exact reproduction commands and owner actions.`,
        finalizationSchema, SPARK,
      );
      if (finalization.ok) outputs = { ...outputs, report_json: finalization.data.report_json_path, report_markdown: finalization.data.report_markdown_path, review: review.data.review_path, review_decision: finalization.data.review_decision, issue_count: finalization.data.issue_count, warning_count: finalization.data.warning_count, valid: finalization.data.valid };
      else { outputs.review = review.data.review_path; outputs.review_decision = review.data.decision; notes.push({ source: "spark-backend-report-finalizer", ref: null, value: "Review completed but finalization failed; original reports preserved." }); }
    } else notes.push({ source: "wonder-backend-findings-review", ref: null, value: "Wonder unavailable; deterministic reports remain authoritative." });
  }

  const valid = outputs.valid === true;
  return finish({ status: valid ? "complete" : "complete_with_findings", pipeline_dir: pipelineDir, output_dir: outputDir, backend_dir: backendDir, outputs, stages, unresolved: valid ? [] : ["backend validation completed with findings; see returned reports"], notes, wonder_calls: wonderCalls, token_usage: aggregateTokenUsage(stages) });
}

function outputFromValidation(data, outputDir) {
  return { report_json: data.report_json_path, report_markdown: data.report_markdown_path, raw_results: data.raw_results_path, server_log: data.server_log_path || `${outputDir}/server.log`, valid: data.valid, city_count: data.city_count, study_count: data.study_count, language_count: data.language_count, package_combination_count: data.package_combination_count, test_passed_count: data.test_passed_count, test_failed_count: data.test_failed_count, live_probe_passed_count: data.live_probe_passed_count, live_probe_failed_count: data.live_probe_failed_count, issue_count: data.issue_count, warning_count: data.warning_count };
}
function boundedInteger(value, fallback, minimum, maximum) { const parsed = Number(value); return Number.isInteger(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback; }
function readTokenUsage(result) { const usage = result?.usage || result?.token_usage || {}; return { input_tokens: Number(usage.input_tokens || 0), output_tokens: Number(usage.output_tokens || 0), total_tokens: Number(usage.total_tokens || 0) }; }
function aggregateTokenUsage(stages) { return stages.reduce((total, stage) => ({ input_tokens: total.input_tokens + Number(stage.token_usage?.input_tokens || 0), output_tokens: total.output_tokens + Number(stage.token_usage?.output_tokens || 0), total_tokens: total.total_tokens + Number(stage.token_usage?.total_tokens || 0) }), { input_tokens: 0, output_tokens: 0, total_tokens: 0 }); }
function finish(report) { return { ...report, summary: JSON.stringify(report) }; }
