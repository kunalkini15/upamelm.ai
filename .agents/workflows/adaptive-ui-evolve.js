// Evolve the application from a human requirement or a new study package.
// Args: { module_dir, trigger_type: "requirement"|"package", trigger_path, run_id? }
//
// Model routing: Spark by default. Wonder is used at most once per run, and
// only for a design review when the analysis finds a new registry capability
// or a genuinely cross-cutting renderer change. Wonder reviews compact
// artifacts only, never edits source, and is never looped after repair.

const SPARK = "muse-spark-1.3-contributor";
const WONDER = "muse-wonder-1.0";
const MAX_WONDER_CALLS = 1;

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
  const triggerType = args.trigger_type;
  const triggerPath = args.trigger_path;
  const runId = args.run_id || `evolve-${Date.now()}`;
  const proposedRegistryPath = `${moduleDir}/verification/${runId}/proposed-registry.json`;
  const stages = [];
  let wonderCalls = 0;
  if (!triggerPath || !["requirement", "package"].includes(triggerType)) {
    return result("invalid_args", ["trigger_type must be requirement or package and trigger_path is required"]);
  }

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
  const reviewSchema = () =>
    schema({
      approved: { type: "boolean" },
      must_fix: { type: "array", items: { type: "string" } },
      risks: { type: "array", items: { type: "string" } },
      review_path: { type: "string" },
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
    `Work on ${moduleDir}.`,
    `The ${triggerType} trigger is ${triggerPath}.`,
    `The verification run id is ${runId}.`,
    `Read ${moduleDir}/BASELINE.md, ${moduleDir}/AGENTS.md, and ${moduleDir}/WORKFLOW.md completely. If present, also read ${moduleDir}/lessons/shared.md and ${moduleDir}/lessons/evolve.md; treat them as human-curated guidance, never edit them, and never let them override the contracts. Load the project adaptive-visualization skill. Preserve every baseline invariant and do not inspect ui-v2 except the exact active input when it is stored there.`,
  ].join(" ");
  const reviewCommon = `Review the adaptive visualization module at ${moduleDir} for verification run ${runId}.`;
  const promoteRegistries = async (reportPath) => {
    const promotion = await run(
      "evolution-registry-promoter",
      `${common} Act only as the bounded registry promoter; do not edit application source. Read the accepted proposal at ${proposedRegistryPath} and acceptance report at ${reportPath}. Save exact backups of both live registries under ${moduleDir}/verification/${runId}/registry-backup/, validate the proposed JSON and all cross-references, then replace both live registries. Parse and validate both live files after replacement. If any operation or validation fails, restore both backups before returning. Return promoted=true only when both live registries match the accepted proposal and validation succeeds.`,
      schema({ promoted: { type: "boolean" }, backup_path: { type: "string" } }),
    );
    if (!promotion.ok || promotion.data.promoted !== true) {
      return { ok: false, unresolved: ["registry promotion failed or was rolled back"] };
    }
    const validation = await run(
      "evolution-registry-validator",
      `${common} Act as a read-only post-promotion validator. Do not edit any file. Parse ${moduleDir}/capability-registry.json, ${moduleDir}/package-registry.json, and ${proposedRegistryPath}; confirm both live registry documents exactly match the accepted proposed documents, IDs are unique, package paths resolve, and every required capability reference exists. Write ${moduleDir}/verification/${runId}/registry-validation.md and return valid=true only when every check passes.`,
      schema({ valid: { type: "boolean" }, validation_path: { type: "string" } }),
    );
    if (!validation.ok || validation.data.valid !== true) {
      const rollback = await run(
        "evolution-registry-rollback",
        `${common} Act only as the bounded registry rollback operator; do not edit application source. Restore both live registry files from ${promotion.data.backup_path}, parse both restored files, and return restored=true only when both exactly match their backups.`,
        schema({ restored: { type: "boolean" } }),
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

  const analysis = await run(
    "evolution-analysis",
    `${common} Act as a read-only capability analyst. Inspect the trigger, current application, registries, and relevant fixtures. Research primary technical sources only when the visual problem is unfamiliar. Classify the need as supported, composed, extended, limited, or blocked and write ${moduleDir}/verification/${runId}/plan.md with reusable acceptance states. In the plan, identify the existing capabilities that cover the need and give evidence for reuse/composition; when they do not suffice, describe the semantic or geometric representation gap without relying on document or domain keywords. Report adds_registry_capability=true only when the plan adds a reusable entry to the capability registry, and cross_cutting_renderer_change=true only when shared behavior across multiple renderers changes. Do not decide which model reviews the plan and do not edit application source.`,
    schema({
      decision: { type: "string", enum: ["supported", "composed", "extended", "limited", "blocked"] },
      adds_registry_capability: { type: "boolean" },
      cross_cutting_renderer_change: { type: "boolean" },
      plan_path: { type: "string" },
    }),
  );
  if (!analysis.ok || analysis.data.decision === "blocked") {
    return result("partial", [analysis.ok ? "input is blocked by insufficient truthful rendering information" : "analysis did not complete"], stages);
  }

  let designConstraints = "No design review was requested; follow the plan conservatively.";
  const degraded = [];
  const needsWonderReview = analysis.data.decision === "extended"
    || analysis.data.adds_registry_capability === true
    || analysis.data.cross_cutting_renderer_change === true;
  if (needsWonderReview) {
    const designReview = await run(
      "evolution-design-review",
      `${reviewCommon} Act as a read-only design reviewer. Read ONLY ${analysis.data.plan_path}, ${moduleDir}/capability-registry.json, ${moduleDir}/BASELINE.md, ${moduleDir}/WORKFLOW.md, and ${moduleDir}/AGENTS.md; do not browse other repository files or inspect the trigger further. Reject changes that weaken a baseline invariant or introduce document-specific branching. Write findings to ${moduleDir}/verification/${runId}/design-review.md with an approved flag, concrete must_fix corrections for the writer, and residual risks. Keep each must_fix item to one sentence.`,
      reviewSchema(),
      WONDER,
    );
    if (designReview.ok) {
      designConstraints = `Apply the design review constraints in ${designReview.data.review_path}.`;
    } else {
      degraded.push("design review did not complete; Spark-only plan");
    }
  }

  const implement = await run(
    "evolution-writer",
    `${common} Read ${analysis.data.plan_path}. ${designConstraints} You are the sole application writer. Implement the smallest coherent generic change, or no source change when existing capabilities already suffice. Never add document-specific branching. Run configured checks and browser-verify the active input. Do not edit live registries; write complete proposed replacement registry documents and change reasons to ${proposedRegistryPath}. Retain at most six inspected final screenshots at the standard viewport, terminate the dev server, and write ${moduleDir}/verification/${runId}/report.md.`,
    schema({ changed: { type: "boolean" }, report_path: { type: "string" }, proposed_registry_path: { type: "string" } }),
  );
  if (!implement.ok) return result("partial", ["implementation did not complete", ...degraded], stages);

  const verify = await run(
    "evolution-verifier",
    `${common} Act as a fresh read-only verifier. Do not edit any file. Build and run configured tests, inspect the active experience in a real browser, check console output and important interactions, then smoke-test every currently enabled package registry entry. Validate ${proposedRegistryPath} against observed evidence, inspect retained screenshots, terminate the dev server, and write findings to ${moduleDir}/verification/${runId}/critique.md.`,
    schema({ passed: { type: "boolean" }, critique_path: { type: "string" } }),
  );
  if (!verify.ok) return result("partial", ["verification did not complete", ...degraded], stages);

  if (!verify.data.passed) {
    const repair = await run(
      "evolution-repair",
      `${common} You are the sole application writer. Read ${verify.data.critique_path}, repair material defects without adding document-specific code, rerun affected automated and browser checks, refresh the bounded final screenshots, update ${proposedRegistryPath} without editing live registries, terminate the dev server, and update the run report.`,
    );
    if (!repair.ok) return result("partial", ["repair did not complete", ...degraded], stages);
  }

  const finalCheck = await run(
    "evolution-final-verifier",
    `${common} Perform a final read-only pre-promotion check of every affected BASELINE.md state, the active input, all currently enabled fixtures, current registries, ${proposedRegistryPath}, screenshots, and run report. Do not edit files and terminate the dev server before returning. Return accepted=true only when baseline preservation and implementation evidence are present and both proposed registry documents are valid and safe to promote.`,
    schema({ accepted: { type: "boolean" }, report_path: { type: "string" } }),
  );
  const accepted = finalCheck.ok && finalCheck.data.accepted;
  if (!accepted) return result("partial", ["final acceptance did not pass", ...degraded], stages, {
    module_dir: moduleDir,
    trigger_type: triggerType,
    trigger_path: triggerPath,
    run_id: runId,
    report_path: finalCheck.data ? finalCheck.data.report_path : null,
  });
  const registry = await promoteRegistries(finalCheck.data.report_path);
  if (!registry.ok) return result("partial", [...registry.unresolved, ...degraded], stages);
  return result(degraded.length ? "partial" : "complete", degraded, stages, {
    module_dir: moduleDir,
    trigger_type: triggerType,
    trigger_path: triggerPath,
    run_id: runId,
    report_path: finalCheck.data.report_path,
    registry_validation_path: registry.validation_path,
  });

  function result(status, unresolved = [], completedStages = [], extra = {}) {
    const value = { status, unresolved, stages: completedStages, wonder_calls: wonderCalls, ...extra };
    return { ...value, summary: JSON.stringify(value) };
  }
}
