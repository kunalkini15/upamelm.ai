/**
 * @file ui-workflow.js
 * @module ui/ui-workflow
 * @description Independent read-only UI verification workflow over a promoted
 * city bundle and the real backend API.
 *
 * @workflow
 *   1. Exhaustive Validation (workhorse) -> Build, test, launch Docker services,
 *      run Playwright, inspect pixels and write reports.
 *   2. Findings Review (flagship, conditional) -> Read-only evidence review.
 *   3. Report Finalization (workhorse, conditional) -> Incorporate review only.
 */

const DEFAULT_WORKHORSE = "muse-spark-1.3-contributor";
const DEFAULT_REVIEWER = "muse-wonder-1.0";
const MAX_REVIEWER_CALLS = 1;

export default async function workflow(host) {
  let args = host.args || {};
  if (typeof args === "string") {
    try { args = JSON.parse(args); } catch { args = {}; }
  }

  const pipelineDir = args.pipeline_dir || args.input || null;
  const outputDir = args.output_dir || null;
  const uiDir = args.ui_dir || "ui";
  const browserWorkers = boundedInteger(args.browser_workers, 2, 1, 4);
  const workhorse = args.workhorse_model || DEFAULT_WORKHORSE;
  const reviewer = args.reviewer_model || DEFAULT_REVIEWER;
  const backendReport = args.backend_report || null;

  if (!pipelineDir || !outputDir) {
    return finish({ status: "invalid_args", pipeline_dir: pipelineDir, output_dir: outputDir, unresolved: ["args must include pipeline_dir and output_dir"], stages: [], notes: [] });
  }

  const path = { type: "string" };
  const schema = (extra = {}) => ({
    type: "object",
    required: ["complete", "evidence", "unresolved", ...Object.keys(extra)],
    properties: {
      complete: { type: "boolean" },
      evidence: { type: "array", items: { type: "string" } },
      unresolved: { type: "array", items: { type: "string" } },
      ...extra,
    },
  });
  const validationSchema = schema({
    valid: { type: "boolean" },
    artifacts: {
      type: "object",
      required: ["report_json_path", "report_markdown_path", "raw_results_path", "playwright_results_path", "console_log_path", "screenshot_paths"],
      properties: {
        report_json_path: path, report_markdown_path: path, raw_results_path: path,
        playwright_results_path: path, console_log_path: path,
        screenshot_paths: { type: "array", items: path },
      },
    },
    totals: {
      type: "object",
      required: ["city_count", "study_count", "language_count", "combination_count", "test_passed_count", "test_failed_count", "browser_passed_count", "browser_failed_count", "warning_count", "issue_count"],
      properties: {
        city_count: { type: "integer" }, study_count: { type: "integer" },
        language_count: { type: "integer" }, combination_count: { type: "integer" },
        test_passed_count: { type: "integer" }, test_failed_count: { type: "integer" },
        browser_passed_count: { type: "integer" }, browser_failed_count: { type: "integer" },
        warning_count: { type: "integer" }, issue_count: { type: "integer" },
      },
    },
    cleanup_confirmed: { type: "boolean" },
  });
  const reviewSchema = schema({
    decision: { type: "string" }, review_path: path,
    confirmed_issue_count: { type: "integer" }, ownership_changes: { type: "integer" },
  });
  const finalizationSchema = schema({
    valid: { type: "boolean" }, report_json_path: path,
    report_markdown_path: path, issue_count: { type: "integer" },
    warning_count: { type: "integer" }, review_decision: { type: "string" },
  });

  const stages = [];
  const notes = [];
  let reviewerCalls = 0;

  async function run(scope, input, stageSchema, model) {
    if (model === reviewer && reviewerCalls >= MAX_REVIEWER_CALLS) return record(scope, model, null, "reviewer_call_limit_reached");
    if (model === reviewer) reviewerCalls += 1;
    let result;
    try { result = await host.agent({ input, schema: stageSchema, label: scope, model }); }
    catch { return record(scope, model, null, "agent_exception"); }
    if (result?.notes) notes.push({ source: scope, ref: result.ref || null, value: result.notes });
    if (result?.data_spilled_for_size) return record(scope, model, result, "result_spilled_for_size");
    if (!result || result.error_kind) return record(scope, model, result, result?.error_kind || "null_result");
    const data = result.data && typeof result.data === "object" ? result.data : null;
    const ok = Boolean(data && data.complete === true);
    stages.push({ scope, ref: result.ref || null, complete: ok, model, error_kind: ok ? null : "incomplete", token_usage: readTokenUsage(result) });
    return { result, data, ok };
  }

  function record(scope, model, result, errorKind) {
    stages.push({ scope, ref: result?.ref || null, complete: false, model, error_kind: errorKind, token_usage: readTokenUsage(result) });
    return { result, data: null, ok: false };
  }

  const compact = "Return under 3KB. Keep commands, logs, screenshots, findings, and explanations under output_dir; return only paths, counts, booleans, and at most six short evidence/unresolved strings.";
  const base = [
    `UI module: ${uiDir}. Promoted city bundle: ${pipelineDir}. Workflow output: ${outputDir}.`,
    `Read ${uiDir}/BASELINE.md, ${uiDir}/AGENTS.md, ${uiDir}/WORKFLOW.md, and ${uiDir}/contracts.md completely before acting. Load the adaptive-visualization skill.`,
    backendReport ? `Prior backend validation report: ${backendReport}. Cross-check it but do not modify it.` : "No prior backend report was supplied; validate backend readiness as part of this run.",
    `Use exactly ${browserWorkers} Playwright workers.`,
    "This is read-only verification. Never edit UI source, backend source, tests, dependencies, promoted packages, translations, or assets.",
    "Write only validation artifacts under output_dir. Do not repair findings. The invoker owns all follow-up decisions.",
    compact,
  ].join(" ");

  const validation = await run(
    "ui-exhaustive-validator",
    `${base} Create output_dir and execute the complete validation contract. Inventory pipeline_summary.json, studies, translations, asset manifests, and expected city/study/language counts. Run npm test and npm run build in the UI module and capture results. Use ${uiDir}/docker-compose.validation.yml to launch the real backend, UI, and Docker-based Playwright runner against the supplied runs root. Use unique project naming so concurrent runs do not collide. Record container IDs, ports, image versions, commands, readiness, and cleanup. Guarantee docker compose down --volumes --remove-orphans in finally-style cleanup and confirm no run containers remain. Run the Playwright semantic matrix for every backend-discovered city, study, and language. Exercise semantic URL reload, selectors, language switching with active-view preservation, Map, 3D, Analysis, report blocks, charts, resources, and downloads only where capabilities exist. Capture page errors, console errors, failed first-party requests, API errors, accessibility names, obvious overflow/clipping, and stable canvas state. Inspect every retained screenshot at 1280x720/device-scale 1; retain at most six representative successful screenshots plus one per unique material failure. Classify every finding using contracts.md with severity, location, expected, actual, evidence, likely_owner, and recommended_action. Distinguish UI defects from backend, promotion, document-processing, translation, and environment defects. Write ${outputDir}/raw_results.json, ${outputDir}/playwright-results.json, ${outputDir}/browser-console.log, ${outputDir}/ui_validation.json, and ${outputDir}/ui_validation.md. JSON must include inputs, timestamps, versions, commands, matrix coverage, screenshots, findings, totals, and cleanup confirmation. Return valid, artifacts {report_json_path, report_markdown_path, raw_results_path, playwright_results_path, console_log_path, screenshot_paths}, totals {city_count, study_count, language_count, combination_count, test_passed_count, test_failed_count, browser_passed_count, browser_failed_count, warning_count, issue_count}, and cleanup_confirmed. Return complete=true when the full audit and cleanup completed even when valid=false.`,
    validationSchema,
    workhorse,
  );

  if (!validation.ok) {
    return finish({ status: "partial", failed_stage: "ui-exhaustive-validator", pipeline_dir: pipelineDir, output_dir: outputDir, ui_dir: uiDir, stages, unresolved: validation.data?.unresolved || ["UI validation did not complete"], notes, reviewer_calls: reviewerCalls, token_usage: aggregateTokenUsage(stages) });
  }

  let outputs = outputFromValidation(validation.data);
  const hasFindings = validationTotals(validation.data).issue_count > 0 || validationTotals(validation.data).warning_count > 0 || validation.data.valid !== true;
  if (hasFindings) {
    const review = await run(
      "ui-findings-review",
      `${base} Act as the read-only flagship reviewer. Read only the validation JSON, Markdown, raw results, console log, Playwright results, prior backend report when supplied, and retained screenshots listed in the report. Do not rerun checks, browse unrelated files, repair code, or edit promoted data. Verify that screenshots support the claims; identify false positives; assess capability-aware behavior, translated typography, visual hierarchy, clipping, interaction clarity, severity, and likely ownership. Reject document-specific recommendations. Write ${outputDir}/review.md and return decision (approved_with_findings|revision_required|environment_inconclusive), confirmed_issue_count, and ownership_changes.`,
      reviewSchema,
      reviewer,
    );
    if (review.ok) {
      const finalization = await run(
        "ui-report-finalizer",
        `${base} Read the existing validation reports and ${review.data.review_path}. Update only ui_validation.json and ui_validation.md under output_dir. Incorporate confirmed corrections, false-positive removals, ownership changes, disagreements, and the review decision. Preserve raw evidence and exact reproduction commands. Do not repair or rerun the UI, backend, packages, or translations.`,
        finalizationSchema,
        workhorse,
      );
      if (finalization.ok) {
        outputs = { ...outputs, report_json: finalization.data.report_json_path, report_markdown: finalization.data.report_markdown_path, review: review.data.review_path, review_decision: finalization.data.review_decision, issue_count: finalization.data.issue_count, warning_count: finalization.data.warning_count, valid: finalization.data.valid };
      } else {
        outputs.review = review.data.review_path;
        outputs.review_decision = review.data.decision;
        notes.push({ source: "ui-report-finalizer", ref: null, value: "Review completed but finalization failed; original reports were preserved." });
      }
    } else notes.push({ source: "ui-findings-review", ref: null, value: "Flagship review was unavailable; deterministic reports remain authoritative." });
  }

  const valid = outputs.valid === true;
  return finish({ status: valid ? "complete" : "complete_with_findings", pipeline_dir: pipelineDir, output_dir: outputDir, ui_dir: uiDir, outputs, stages, unresolved: valid ? [] : ["UI validation completed with findings; see returned reports"], notes, reviewer_calls: reviewerCalls, token_usage: aggregateTokenUsage(stages) });
}

function validationArtifacts(data) {
  const nested = data && typeof data.artifacts === "object" && data.artifacts !== null ? data.artifacts : {};
  return {
    report_json_path: nested.report_json_path ?? data.report_json_path,
    report_markdown_path: nested.report_markdown_path ?? data.report_markdown_path,
    raw_results_path: nested.raw_results_path ?? data.raw_results_path,
    playwright_results_path: nested.playwright_results_path ?? data.playwright_results_path,
    console_log_path: nested.console_log_path ?? data.console_log_path,
    screenshot_paths: nested.screenshot_paths ?? data.screenshot_paths ?? [],
  };
}

function validationTotals(data) {
  const nested = data && typeof data.totals === "object" && data.totals !== null ? data.totals : {};
  return {
    city_count: nested.city_count ?? data.city_count,
    study_count: nested.study_count ?? data.study_count,
    language_count: nested.language_count ?? data.language_count,
    combination_count: nested.combination_count ?? data.combination_count,
    test_passed_count: nested.test_passed_count ?? data.test_passed_count,
    test_failed_count: nested.test_failed_count ?? data.test_failed_count,
    browser_passed_count: nested.browser_passed_count ?? data.browser_passed_count,
    browser_failed_count: nested.browser_failed_count ?? data.browser_failed_count,
    issue_count: nested.issue_count ?? data.issue_count,
    warning_count: nested.warning_count ?? data.warning_count,
  };
}

function outputFromValidation(data) {
  const artifacts = validationArtifacts(data);
  const totals = validationTotals(data);
  return {
    report_json: artifacts.report_json_path,
    report_markdown: artifacts.report_markdown_path,
    raw_results: artifacts.raw_results_path,
    playwright_results: artifacts.playwright_results_path,
    console_log: artifacts.console_log_path,
    screenshots: artifacts.screenshot_paths || [],
    valid: data.valid,
    city_count: totals.city_count,
    study_count: totals.study_count,
    language_count: totals.language_count,
    combination_count: totals.combination_count,
    test_passed_count: totals.test_passed_count,
    test_failed_count: totals.test_failed_count,
    browser_passed_count: totals.browser_passed_count,
    browser_failed_count: totals.browser_failed_count,
    issue_count: totals.issue_count,
    warning_count: totals.warning_count,
    cleanup_confirmed: data.cleanup_confirmed,
  };
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function readTokenUsage(result) {
  const usage = result?.usage || result?.token_usage || {};
  return { input_tokens: Number(usage.input_tokens || 0), output_tokens: Number(usage.output_tokens || 0), total_tokens: Number(usage.total_tokens || 0) };
}

function aggregateTokenUsage(stages) {
  return stages.reduce((total, stage) => ({ input_tokens: total.input_tokens + Number(stage.token_usage?.input_tokens || 0), output_tokens: total.output_tokens + Number(stage.token_usage?.output_tokens || 0), total_tokens: total.total_tokens + Number(stage.token_usage?.total_tokens || 0) }), { input_tokens: 0, output_tokens: 0, total_tokens: 0 });
}

function finish(report) { return { ...report, summary: JSON.stringify(report) }; }

