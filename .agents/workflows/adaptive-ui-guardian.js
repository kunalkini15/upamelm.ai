/**
 * @file adaptive-ui-guardian.js
 * @module .agents/workflows/adaptive-ui-guardian
 * @description Continuous health, regression, and integrity monitor for the adaptive UI module.
 * Runs on periodic schedules or CI/CD hooks to validate schema compliance, execute unit tests,
 * audit browser hydration, and inspect capability registries.
 *
 * @workflow
 *   1. Registry Validation (Spark) -> Verifies schema syntax and capability-package cross references.
 *   2. Build & Unit Test Verification (Spark) -> Executes full Vitest suite.
 *   3. Browser Hydration & Console Audit (Spark) -> Launches headless browser to inspect canvas and logs.
 *   4. Incident Deduplication & Logging -> Records incident state in guardian-incidents.json.
 *   5. Optional Incident Review (Wonder) -> Triggered only after consecutive failures (max 1 call).
 *
 * @param {Object} host - The Muse workflow host context.
 * @param {string} host.args.module_dir - Target module directory (e.g. "muse-ui").
 * @param {string} [host.args.run_id] - Optional run identifier.
 * @param {boolean} [host.args.allow_fix=false] - Whether automatic repair by Spark is permitted.
 * @returns {Promise<Object>} Execution report containing status, diagnostics, and test results.
 */

const SPARK = "muse-spark-1.3-contributor";
const WONDER = "muse-wonder-1.0";
const MAX_WONDER_CALLS = 1;
const UNHEALTHY_THRESHOLD = 2;

function normalizeArgs(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (_error) {
    return {};
  }
}

export default async function workflow(host) {
  const args = normalizeArgs(host.args);
  const moduleDir = args.module_dir || "muse-ui";
  const runId = args.run_id || `guardian-${Date.now()}`;
  const allowFix = args.allow_fix === true;
  const incidentStatePath = `${moduleDir}/verification/guardian-incidents.json`;
  const stages = [];
  let wonderCalls = 0;
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
  const run = async (scope, input, stageSchema = schema(), model = SPARK) => {
    if (model === WONDER && wonderCalls >= MAX_WONDER_CALLS) {
      stages.push({ scope, ref: null, complete: false, model, error_kind: "wonder_budget_exhausted" });
      return { data: null, ok: false };
    }
    if (model === WONDER) wonderCalls += 1;
    let response;
    try {
      response = await host.agent({ input, schema: stageSchema, label: scope, model });
    } catch (_error) {
      stages.push({ scope, ref: null, complete: false, model, error_kind: "agent_exception" });
      return { data: null, ok: false };
    }
    const data = response && !response.error_kind && response.data && typeof response.data === "object"
      ? response.data : null;
    const ok = Boolean(data && data.complete === true);
    stages.push({ scope, ref: response ? response.ref : null, complete: ok, model, error_kind: response ? response.error_kind || null : "null_result" });
    return { data, ok };
  };
  const common = [
    `Audit ${moduleDir}.`,
    `The verification run id is ${runId}.`,
    `Read ${moduleDir}/BASELINE.md, ${moduleDir}/AGENTS.md, and ${moduleDir}/WORKFLOW.md completely. If present, also read ${moduleDir}/lessons/shared.md and ${moduleDir}/lessons/guardian.md; treat them as human-curated guidance, never edit them, and never let them override the contracts. Load the project adaptive-visualization skill.`,
  ].join(" ");
  const reviewCommon = `Review the adaptive visualization module at ${moduleDir} for guardian run ${runId}.`;

  const audit = await run(
    "guardian-audit",
    `${common} Act as a read-only guardian. Do not edit application source. Inspect configured project checks, run every standard BASELINE.md command, validate both registries, serve the application, load every enabled package fixture, exercise the baseline global-map, fallback, 3D, coordinated interaction, narrative/report, package-validation, responsive, accessibility, and console states, and inspect captured screenshots. Write ${moduleDir}/verification/${runId}/report.md with observed health and actionable failures.`,
    schema({ healthy: { type: "boolean" }, report_path: { type: "string" } }),
  );
  if (!audit.ok) return result("partial", ["guardian audit did not complete"], stages);

  const bookkeeper = await run(
    "guardian-incident-bookkeeper",
    `${common} Maintain the incident state file at ${incidentStatePath} (create it and its parent directory when missing; treat a missing file as {"consecutive_failures": 0, "incident_id": null, "wonder_review_used": false}). Read the audit report at ${audit.data.report_path}. When the audit is healthy, write {"consecutive_failures": 0, "incident_id": null, "wonder_review_used": false} and return wonder_allowed=false. When unhealthy, increment consecutive_failures, keep the existing incident_id or start one as "guardian-${runId}", and set wonder_allowed=true only when consecutive_failures reaches ${UNHEALTHY_THRESHOLD} and wonder_review_used is still false; in that case write wonder_review_used=true in the same state update before returning, so a later crash cannot spend the review twice. Return recorded=true only after the state file is written. Return incident_id as "" when there is no active incident.`,
    schema({ recorded: { type: "boolean" }, consecutive_failures: { type: "number" }, incident_id: { type: "string" }, wonder_allowed: { type: "boolean" } }),
  );
  const incidentRecorded = bookkeeper.ok && bookkeeper.data.recorded === true;
  const incident = incidentRecorded
    ? { consecutive_failures: bookkeeper.data.consecutive_failures, incident_id: bookkeeper.data.incident_id }
    : { consecutive_failures: null, incident_id: null };
  const degraded = incidentRecorded ? [] : ["incident state was not recorded; Wonder review skipped"];

  if (audit.data.healthy) {
    return result(degraded.length ? "partial" : "complete", degraded, stages, {
      module_dir: moduleDir,
      run_id: runId,
      report_path: audit.data.report_path,
      incident,
    });
  }

  let reviewConstraints = "No incident review is available.";
  let wonderReviewed = false;
  if (incidentRecorded && bookkeeper.data.wonder_allowed === true) {
    const incidentReview = await run(
      "guardian-incident-review",
      `${reviewCommon} Act as a read-only incident reviewer. Read ONLY ${audit.data.report_path}, ${moduleDir}/WORKFLOW.md, ${moduleDir}/AGENTS.md, and at most 6 screenshots listed in the report; do not browse other repository files or rerun checks. Diagnose the likely cause of the repeated unhealthy runs and write findings to ${moduleDir}/verification/${runId}/incident-review.md with an approved flag (true only when no intervention is warranted), concrete must_fix corrections, and residual risks. Keep each must_fix item to one sentence.`,
      schema({
        approved: { type: "boolean" },
        must_fix: { type: "array", items: { type: "string" } },
        risks: { type: "array", items: { type: "string" } },
        review_path: { type: "string" },
      }),
      WONDER,
    );
    if (incidentReview.ok) {
      reviewConstraints = `Apply the incident review constraints in ${incidentReview.data.review_path}.`;
      wonderReviewed = true;
    } else {
      degraded.push("incident review did not complete; Spark-only diagnosis");
    }
  }
  if (!allowFix) {
    return result("attention_required", ["guardian found failures; allow_fix was false", ...degraded], stages, {
      module_dir: moduleDir,
      run_id: runId,
      report_path: audit.data.report_path,
      incident,
      wonder_reviewed: wonderReviewed,
    });
  }

  const repair = await run(
    "guardian-repair",
    `${common} You are the sole application writer. Read ${audit.data.report_path}. ${reviewConstraints} Repair only clearly evidenced regressions; do not redesign healthy behavior or add document-specific exceptions. Run affected checks and refresh the report and screenshots.`,
  );
  if (!repair.ok) return result("partial", ["guardian repair did not complete", ...degraded], stages);

  const verify = await run(
    "guardian-final-verifier",
    `${common} Perform a final read-only verification of the repaired checks and every enabled fixture. Inspect browser output and retained screenshots. Update the report with final observed status and return healthy=true only when all required checks pass.`,
    schema({ healthy: { type: "boolean" }, report_path: { type: "string" } }),
  );
  const status = verify.ok && verify.data.healthy ? "complete" : "attention_required";
  return result(status, status === "complete" ? degraded : ["failures remain after guardian repair", ...degraded], stages, {
    module_dir: moduleDir,
    run_id: runId,
    report_path: verify.data ? verify.data.report_path : audit.data.report_path,
    incident,
    wonder_reviewed: wonderReviewed,
  });

  function result(status, unresolved = [], completedStages = [], extra = {}) {
    const value = { status, unresolved, stages: completedStages, wonder_calls: wonderCalls, ...extra };
    return { ...value, summary: JSON.stringify(value) };
  }
}
