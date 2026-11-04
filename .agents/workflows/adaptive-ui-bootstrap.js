/**
 * @file adaptive-ui-bootstrap.js
 * @module .agents/workflows/adaptive-ui-bootstrap
 * @description Bootstraps the neutral adaptive scientific visualization foundation from scratch.
 * Operates without any document-specific study package, establishing the baseline MapLibre 2D GIS map,
 * Three.js 3D viewport, unified interaction store, and capability negotiation framework.
 *
 * @workflow
 *   1. Architecture Design (Spark) -> Defines invariants and boundary interfaces.
 *   2. Architecture Review (Wonder) -> Validates clean-room design and rejects document couplings.
 *   3. Application Build (Spark) -> Synthesizes shell, map, 3D workspace, and tests.
 *   4. Visual & Interaction Critique (Spark/Wonder) -> Headless browser checks and screenshots.
 *   5. Registry Promotion & Staged Rollback -> Promotes capabilities with full schema validation.
 *
 * @modelRouting
 *   - Spark: Writes code and runs active checks.
 *   - Wonder: Reviews compact artifacts only; capped at 2 calls (architecture + final).
 *
 * @param {Object} host - The Muse workflow host context.
 * @param {string} [host.args.module_dir="muse-ui"] - Target module directory.
 * @param {string} [host.args.run_id="bootstrap-default"] - Identifier for verification artifacts.
 * @returns {Promise<Object>} Execution report containing status, verification paths, and stages.
 */

const SPARK = "muse-spark-1.3-contributor";
const WONDER = "muse-wonder-1.0";
const MAX_WONDER_CALLS = 2;

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
  const runId = args.run_id || "bootstrap-default";
  const proposedRegistryPath = `${moduleDir}/verification/${runId}/proposed-registry.json`;
  const stages = [];
  let wonderCalls = 0;
  const stageSchema = (extra = {}) => ({
    type: "object",
    required: ["complete", "evidence", "unresolved", ...Object.keys(extra)],
    properties: {
      complete: { type: "boolean" },
      evidence: { type: "array", items: { type: "string" } },
      unresolved: { type: "array", items: { type: "string" } },
      ...extra,
    },
  });
  const reviewSchema = () =>
    stageSchema({
      approved: { type: "boolean" },
      must_fix: { type: "array", items: { type: "string" } },
      risks: { type: "array", items: { type: "string" } },
      review_path: { type: "string" },
    });
  const run = async (scope, input, schema = stageSchema(), model = SPARK) => {
    if (model === WONDER && wonderCalls >= MAX_WONDER_CALLS) {
      stages.push({ scope, ref: null, complete: false, model, error_kind: "wonder_budget_exhausted" });
      return { response: null, data: null, ok: false };
    }
    if (model === WONDER) wonderCalls += 1;
    let response;
    try {
      response = await host.agent({ input, schema, label: scope, model });
    } catch (_error) {
      stages.push({ scope, ref: null, complete: false, model, error_kind: "agent_exception" });
      return { response: null, data: null, ok: false };
    }
    const data = response && !response.error_kind && response.data && typeof response.data === "object"
      ? response.data : null;
    const ok = Boolean(data && data.complete === true);
    stages.push({ scope, ref: response ? response.ref : null, complete: ok, model, error_kind: response ? response.error_kind || null : "null_result" });
    return { response, data, ok };
  };

  const common = [
    `Work only on the adaptive visualization module at ${moduleDir}.`,
    `The verification run id is ${runId}.`,
    `Read ${moduleDir}/BASELINE.md, ${moduleDir}/AGENTS.md, and ${moduleDir}/WORKFLOW.md completely. If present, also read ${moduleDir}/lessons/shared.md and ${moduleDir}/lessons/bootstrap.md; treat them as human-curated guidance, never edit them, and never let them override the contracts. Load the project adaptive-visualization skill.`,
    `Treat BASELINE.md as mandatory. This bootstrap has no study package and must not inspect ui-v2 or implement document-specific visualization.`,
  ].join(" ");
  const reviewCommon = `Review the adaptive visualization module at ${moduleDir} for verification run ${runId}.`;
  const promoteRegistries = async (reportPath) => {
    const promotion = await run(
      "bootstrap-registry-promoter",
      `${common} Act only as the bounded registry promoter; do not edit application source. Read the accepted proposal at ${proposedRegistryPath} and acceptance report at ${reportPath}. Save exact backups of both live registries under ${moduleDir}/verification/${runId}/registry-backup/, validate the proposed JSON and all capability/package cross-references, then replace both live registries. Parse and validate both live files after replacement. If any operation or validation fails, restore both backups before returning. Return promoted=true only when both live registries match the accepted proposal and validation succeeds.`,
      stageSchema({ promoted: { type: "boolean" }, backup_path: { type: "string" } }),
    );
    if (!promotion.ok || promotion.data.promoted !== true) {
      return { ok: false, unresolved: ["registry promotion failed or was rolled back"] };
    }
    const validation = await run(
      "bootstrap-registry-validator",
      `${common} Act as a read-only post-promotion validator. Do not edit any file. Parse ${moduleDir}/capability-registry.json, ${moduleDir}/package-registry.json, and ${proposedRegistryPath}; confirm both live registry documents exactly match the accepted proposed documents, IDs are unique, package paths resolve, and every required capability reference exists. Write ${moduleDir}/verification/${runId}/registry-validation.md and return valid=true only when every check passes.`,
      stageSchema({ valid: { type: "boolean" }, validation_path: { type: "string" } }),
    );
    if (!validation.ok || validation.data.valid !== true) {
      const rollback = await run(
        "bootstrap-registry-rollback",
        `${common} Act only as the bounded registry rollback operator; do not edit application source. Restore both live registry files from ${promotion.data.backup_path}, parse both restored files, and return restored=true only when both exactly match their backups.`,
        stageSchema({ restored: { type: "boolean" } }),
      );
      const restored = rollback.ok && rollback.data.restored === true;
      return {
        ok: false,
        unresolved: [restored
          ? "post-promotion registry validation failed; both registries were restored"
          : "post-promotion registry validation failed and automatic rollback was not confirmed"],
      };
    }
    return { ok: true, validation_path: validation.data.validation_path };
  };

  const architect = await run(
    "bootstrap-architecture",
    `${common} Act as the read-only product and visualization architect. Inspect only the module contracts and permitted repository configuration, research primary technical sources where needed, and write ${moduleDir}/verification/${runId}/plan.md. Map every BASELINE.md invariant to an implementation boundary and checkable acceptance state. Define the neutral bird's-eye global-map landing experience, empty/unlocated states, package-import boundary, coordinated application shell, and extension points without designing for any document. Do not create application source or weaken the baseline.`,
    stageSchema({ plan_path: { type: "string" } }),
  );
  if (!architect.ok) return result("partial", ["architecture stage did not complete"], stages);

  const archReview = await run(
    "bootstrap-architecture-review",
    `${reviewCommon} Act as a read-only architecture reviewer. Read ONLY ${architect.data.plan_path}, ${moduleDir}/capability-registry.json, ${moduleDir}/BASELINE.md, ${moduleDir}/WORKFLOW.md, and ${moduleDir}/AGENTS.md; do not browse other repository files. Reject any plan that omits or weakens a baseline invariant, clean-room rule, generic boundary, or checkable acceptance state, or that introduces a document-specific view. Write findings to ${moduleDir}/verification/${runId}/architecture-review.md with an approved flag, concrete must_fix corrections for the builder, and residual risks. Keep each must_fix item to one sentence.`,
    reviewSchema(),
    WONDER,
  );
  const archConstraints = archReview.ok
    ? `Apply the architecture review constraints in ${archReview.data.review_path}.`
    : `No architecture review is available; follow the plan conservatively.`;
  const degraded = archReview.ok ? [] : ["architecture review did not complete; Spark-only plan"];

  const builder = await run(
    "bootstrap-builder",
    `${common} Read ${architect.data.plan_path}. ${archConstraints} You are the sole application writer. Work through explicit checkpoints in one continuous stage: (1) scaffold the mandatory BASELINE.md stack and prove the clean build, (2) implement the validated package-import boundary, typed empty scene model, coordinate boundary, unified interaction state, and safe local JSON loading, (3) implement the neutral bird's-eye global MapLibre landing view, resilient basemap, separate initialized Three.js workspace, coordinated application modes, narrative/report empty states, and honest loading/unlocated/unsupported/error states without any document-specific rendering, (4) implement baseline unit and browser checks using clearly labelled deterministic test fixtures only, and (5) serve and visually inspect every package-independent baseline acceptance state before writing the report. Use the available frontend design, MapLibre, and Three.js guidance. Do not edit the live capability or package registries; instead write complete proposed replacement registry documents and change reasons to ${proposedRegistryPath}; the package registry must remain empty. Retain at most six inspected final screenshots under ${moduleDir}/verification/${runId}/screenshots/ at the standard viewport, record each checkpoint and baseline disposition in the report, and terminate the dev server before returning. Do not stop at a plan.`,
    stageSchema({ app_path: { type: "string" }, verification_path: { type: "string" }, proposed_registry_path: { type: "string" } }),
  );
  if (!builder.ok) return result("partial", ["application build did not complete", ...degraded], stages);

  const critic = await run(
    "bootstrap-visual-critic",
    `${common} Act as a fresh read-only visual and interaction critic. Do not edit application source. Run the built application and inspect it in a real browser at desktop and compact viewports. Exercise the bird's-eye global map, world navigation, projection/reset controls, basemap fallback, empty layer/selection states, initialized 3D workspace, narrative/report empty states, invalid local-package validation, keyboard focus, console output, and retained screenshots required by the package-independent BASELINE.md foundation. Write precise findings to ${moduleDir}/verification/${runId}/critique.md and return passed=false for any missing invariant or material defect.`,
    stageSchema({ passed: { type: "boolean" }, critique_path: { type: "string" } }),
  );
  if (!critic.ok) return result("partial", ["visual critique did not complete", ...degraded], stages);

  if (!critic.data.passed) {
    const repair = await run(
      "bootstrap-repair",
      `${common} You are the sole application writer. Read ${critic.data.critique_path}, fix every material issue without weakening generic architecture, rerun affected automated and browser checks, refresh the bounded final screenshots, update ${proposedRegistryPath} without editing live registries, terminate the dev server, and update ${moduleDir}/verification/${runId}/report.md with observed results and remaining limitations.`,
    );
    if (!repair.ok) return result("partial", ["repair stage did not complete", ...degraded], stages);
  }

  const verifier = await run(
    "bootstrap-final-verifier",
    `${common} Perform the final read-only pre-promotion acceptance pass. Verify every package-independent BASELINE.md invariant, all standard npm commands, the neutral global-map landing view, initialized 3D workspace, coordinate boundary tests, basemap fallback, invalid local-package flow, honest empty states, browser console, responsive/accessibility states, retained screenshots, current registries, ${proposedRegistryPath}, and ${moduleDir}/verification/${runId}/report.md. Confirm the proposed capability registry contains only browser-verified reusable foundation capabilities and the proposed package registry remains empty. Do not edit any file. Return accepted=true only when the complete neutral baseline and implementation evidence are present and the proposal is safe to promote. Terminate the dev server before returning.`,
    stageSchema({ accepted: { type: "boolean" }, report_path: { type: "string" } }),
  );
  if (!verifier.ok) return result("partial", ["final acceptance did not complete", ...degraded], stages);

  const finalReview = await run(
    "bootstrap-final-review",
    `${reviewCommon} Act as a read-only final reviewer. Read ONLY ${verifier.data.report_path}, ${moduleDir}/BASELINE.md, ${moduleDir}/WORKFLOW.md, ${moduleDir}/AGENTS.md, and at most 6 screenshots listed in the report; do not browse other repository files or rerun checks. Judge whether every baseline and completion claim is supported by truthful observed evidence. Write findings to ${moduleDir}/verification/${runId}/final-review.md with an approved flag, concrete must_fix corrections, and residual risks. Keep each must_fix item to one sentence.`,
    reviewSchema(),
    WONDER,
  );
  if (!finalReview.ok) degraded.push("final review did not complete; Spark acceptance stands");

  if (verifier.data.accepted && (!finalReview.ok || finalReview.data.approved)) {
    const registry = await promoteRegistries(verifier.data.report_path);
    if (!registry.ok) return result("partial", [...registry.unresolved, ...degraded], stages);
    return result(degraded.length ? "partial" : "complete", degraded, stages, {
      module_dir: moduleDir,
      run_id: runId,
      report_path: verifier.data.report_path,
      registry_validation_path: registry.validation_path,
    });
  }

  const repairInput = finalReview.ok
    ? `Read both ${verifier.data.report_path} and ${finalReview.data.review_path}; address every verifier failure and every Wonder must_fix item.`
    : `Read ${verifier.data.report_path} and address every acceptance failure.`;
  const postRepair = await run(
    "bootstrap-post-review-repair",
    `${common} You are the sole application writer. ${repairInput} Rerun affected automated and browser checks, refresh the bounded final screenshots, update ${proposedRegistryPath} without editing live registries, terminate the dev server, and update ${moduleDir}/verification/${runId}/report.md.`,
  );
  if (!postRepair.ok) return result("partial", ["post-review repair did not complete", ...degraded], stages);

  const postVerify = await run(
    "bootstrap-post-review-verifier",
    `${common} Perform a read-only pre-promotion re-verification after post-review repair. Confirm all standard commands, every affected BASELINE.md acceptance state, browser console, ${proposedRegistryPath}, and that every verifier failure and must_fix item is addressed or explicitly dispositioned. Do not edit files and terminate the dev server before returning. List any still-open item in must_fix_open and return accepted=true only when none remain and the registry proposal is safe to promote.`,
    stageSchema({ accepted: { type: "boolean" }, must_fix_open: { type: "array", items: { type: "string" } }, report_path: { type: "string" } }),
  );
  const open = postVerify.ok ? postVerify.data.must_fix_open : ["post-review verification did not complete"];
  const acceptedAfterRepair = postVerify.ok && postVerify.data.accepted;
  if (!acceptedAfterRepair) return result("partial", [...open, ...degraded], stages, {
    module_dir: moduleDir,
    run_id: runId,
    report_path: postVerify.data ? postVerify.data.report_path : verifier.data.report_path,
  });
  const registry = await promoteRegistries(postVerify.data.report_path);
  if (!registry.ok) return result("partial", [...registry.unresolved, ...degraded], stages);
  return result(degraded.length ? "partial" : "complete", degraded, stages, {
    module_dir: moduleDir,
    run_id: runId,
    report_path: postVerify.data.report_path,
    registry_validation_path: registry.validation_path,
  });

  function result(status, unresolved = [], completedStages = [], extra = {}) {
    const value = { status, unresolved, stages: completedStages, wonder_calls: wonderCalls, ...extra };
    return { ...value, summary: JSON.stringify(value) };
  }
}
