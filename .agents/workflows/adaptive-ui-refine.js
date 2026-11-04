/**
 * @file adaptive-ui-refine.js
 * @module .agents/workflows/adaptive-ui-refine
 * @description Repeated requirement-driven visual, layout, and interaction refinement loop.
 * Executes targeted design improvements against specific human requirements while preserving
 * existing package boundaries, registries, and unit test invariants.
 *
 * @workflow
 *   1. Refinement Plan (Spark) -> Translates requirement into concrete visual adjustments.
 *   2. Art Direction Review (Wonder) -> Critiques proposed visual changes (max 3 Wonder calls total).
 *   3. Implementation & Testing (Spark) -> Applies CSS, canvas, and layout updates.
 *   4. Visual Acceptance (Wonder) -> Audits browser screenshots against requirement criteria.
 *
 * @param {Object} host - The Muse workflow host context.
 * @param {string} [host.args.module_dir="muse-ui"] - Target module directory.
 * @param {string} host.args.requirement_path - Path to the requirement specification markdown.
 * @param {string} [host.args.run_id] - Optional run identifier.
 * @returns {Promise<Object>} Execution report containing status, verification paths, and stages.
 */

const SPARK = "muse-spark-1.3-contributor";
const WONDER = "muse-wonder-1.0";
const MAX_WONDER_CALLS = 3;

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
  const requirementPath = args.requirement_path;
  const defaultRunId = typeof requirementPath === "string" && requirementPath.trim() !== ""
    ? `refine-${requirementPath.split("/").pop().replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase()}`
    : "refine-run";
  const runId = args.run_id || defaultRunId;
  const runDir = `${moduleDir}/verification/${runId}`;
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
  const reviewSchema = () => schema({
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
  const result = (status, unresolved = [], extra = {}) => {
    const value = {
      status,
      unresolved,
      stages,
      wonder_calls: wonderCalls,
      module_dir: moduleDir,
      requirement_path: requirementPath || null,
      run_id: runId,
      ...extra,
    };
    return { ...value, summary: JSON.stringify(value) };
  };

  if (typeof requirementPath !== "string" || requirementPath.trim() === "") {
    return result("invalid_args", ["requirement_path is required"]);
  }

  const common = [
    `Work only on the adaptive visualization module at ${moduleDir}.`,
    `The active UI requirement is ${requirementPath}.`,
    `The verification run id is ${runId}.`,
    `Read ${moduleDir}/BASELINE.md, ${moduleDir}/EXPERIENCE.md, ${moduleDir}/DESIGN_SYSTEM.md, ${moduleDir}/AGENTS.md, ${moduleDir}/WORKFLOW.md, and the complete requirement before acting.`,
    `If present, read ${moduleDir}/lessons/shared.md and ${moduleDir}/lessons/refine.md; treat them as human-curated guidance, never edit them, and never let them override the contracts or active requirement.`,
    `Load the project adaptive-visualization skill. Do not inspect ui-v2 or another application for design or implementation reference.`,
    `This workflow refines presentation and interaction only. Do not edit capability-registry.json, package-registry.json, the accepted package schema, package adapter semantics, or upstream study packages. If the outcome requires new evidence semantics or a registry capability, record a precise evolve handoff and return blocked instead of approximating or broadening scope.`,
  ].join(" ");
  const reviewCommon = `Review ${moduleDir} refinement run ${runId} for requirement ${requirementPath}.`;

  const analysis = await run(
    "refine-research-and-plan",
    `${common} Act as a read-only senior product designer and visualization engineer. Inspect the current rendered application, source boundaries, design system, existing fixtures, recent verification evidence, and the active requirement. Capture up to three visually inspected baseline screenshots under ${runDir}/before/. Research primary sources only where the requirement introduces a consequential or unfamiliar visual technique. Write ${runDir}/plan.md with: the user outcome; current defects evidenced in pixels; explicit in-scope and out-of-scope boundaries; applied research decisions; the smallest coherent implementation strategy; affected states and regressions; desktop and compact acceptance criteria; and a screenshot plan. Copy exact snapshots of both live registries to ${runDir}/registry-snapshot/ for later equality checks. Return blocked=true when new package semantics or a registry capability are actually required. Do not edit application source.`,
    schema({ blocked: { type: "boolean" }, plan_path: { type: "string" }, baseline_screenshots: { type: "array", items: { type: "string" } }, registry_snapshot_path: { type: "string" } }),
  );
  if (!analysis.ok) return result("partial", ["refinement analysis did not complete"]);
  if (analysis.data.blocked) {
    return result("blocked", ["requirement needs new evidence semantics or a registry capability; use package evolution with the recorded handoff"], { plan_path: analysis.data.plan_path });
  }

  const directionReview = await run(
    "refine-art-direction-review",
    `${reviewCommon} Act as a read-only flagship art and interaction director. Read ONLY the active requirement, ${analysis.data.plan_path}, ${moduleDir}/EXPERIENCE.md, ${moduleDir}/DESIGN_SYSTEM.md, and up to three baseline screenshots named in the plan. Judge whether the plan will materially improve the requested experience rather than merely restyle controls. Reject vague taste claims, generic dashboard composition, cosmetic-only changes, decorative or unreadable 3D, weak visual hierarchy, missing responsive behavior, non-verifiable acceptance, and scope drift into package semantics. Write ${runDir}/direction-review.md with approved, concrete must_fix items, and risks.`,
    reviewSchema(),
    WONDER,
  );
  if (!directionReview.ok) {
    return result("partial", ["Wonder art-direction review did not complete; implementation was not started"], { plan_path: analysis.data.plan_path });
  }

  const builder = await run(
    "refine-builder",
    `${common} Read ${analysis.data.plan_path} and ${directionReview.data.review_path}. You are the sole application writer. Implement the complete active requirement and every art-direction must_fix item as one coherent experience change. You may reshape UI components, responsive composition, styling, MapLibre/Three.js presentation, cameras, lighting, materials, animation, derived display geometry, and interaction, while preserving truthful evidence and the frozen data/registry boundary. Do not branch on fixture names. Update DESIGN_SYSTEM.md only when the accepted reusable design language actually changes. Add focused unit/browser regression coverage. Build, run tests, serve the app, and inspect actual rendered pixels at the requirement's desktop and compact states. Retain at most six final screenshots under ${runDir}/screenshots/ and write ${runDir}/report.md with before/after dispositions, commands, browser states, evidence tiers, issues fixed, and limitations. Stop every server you start.`,
    schema({ report_path: { type: "string" }, screenshot_paths: { type: "array", items: { type: "string" } } }),
  );
  if (!builder.ok) return result("partial", ["refinement implementation did not complete"]);

  const critic = await run(
    "refine-browser-critic",
    `${common} Act as a fresh read-only visual and interaction critic. Run the built application in a real browser and exercise every state named by the requirement and plan, plus the global landing, important existing map/3D/narrative/report continuity, compact layout, keyboard focus, reduced motion when applicable, and browser console. Compare the baseline screenshots with the current rendered pixels. Write ${runDir}/critique.md with material defects, regressions, and the three weakest remaining visual or interaction aspects. Return passed=false for any material defect; even when passed, give a concrete improvement for each weak aspect. Do not edit files and stop the server.`,
    schema({ passed: { type: "boolean" }, critique_path: { type: "string" }, weakest: { type: "array", items: { type: "string" } } }),
  );
  if (!critic.ok) return result("partial", ["browser critique did not complete"]);

  const refinement = await run(
    "refine-visual-repair",
    `${common} You are the sole application writer. Read ${critic.data.critique_path}. Fix every material defect and improve all three weakest aspects unless the run report gives a specific evidence-based disposition. Rerun affected tests and browser paths, reinspect pixels, refresh the bounded screenshots, update ${runDir}/report.md with before/after evidence, and stop every server. Preserve the frozen registries and package semantics.`,
    schema({ report_path: { type: "string" } }),
  );
  if (!refinement.ok) return result("partial", ["visual repair did not complete"]);

  const verifier = await run(
    "refine-functional-verifier",
    `${common} Act as a read-only verifier. Run the standard build, unit, and browser checks; exercise the requirement's complete flow and existing core regressions; inspect the final screenshots and console; compare both live registries byte-for-byte or structurally exactly with ${analysis.data.registry_snapshot_path}; and verify no package/schema semantics changed. Write ${runDir}/verification.md. Return accepted=true only when functional, responsive, accessibility, truthfulness, regression, screenshot, and frozen-boundary evidence all pass. Do not judge aesthetic excellence on test counts and do not edit files.`,
    schema({ accepted: { type: "boolean" }, verification_path: { type: "string" }, report_path: { type: "string" }, must_fix: { type: "array", items: { type: "string" } } }),
  );
  if (!verifier.ok || verifier.data.accepted !== true) {
    return result("partial", verifier.data?.must_fix || ["functional verification did not pass"], { report_path: verifier.data?.report_path || refinement.data.report_path });
  }

  const visualReview = await run(
    "refine-final-visual-review",
    `${reviewCommon} Act as a read-only flagship visual reviewer. Read ONLY the active requirement, ${analysis.data.plan_path}, ${verifier.data.verification_path}, ${verifier.data.report_path}, ${moduleDir}/EXPERIENCE.md, ${moduleDir}/DESIGN_SYSTEM.md, up to three baseline screenshots, and at most six final screenshots named by the report. Judge the rendered result, not test counts or implementation effort. Require a material improvement over the baseline and full satisfaction of the requested visual experience. Reject scaffold-like composition, unreadable or decorative 3D, weak hierarchy, excessive chrome, unclear interaction, responsive compromise, contradicted screenshot claims, or unresolved direction-review items. Write ${runDir}/visual-review.md with approved, concise must_fix items, and risks.`,
    reviewSchema(),
    WONDER,
  );
  if (!visualReview.ok) {
    return result("partial", ["Wonder final visual review did not complete; visual acceptance is unresolved"], { report_path: verifier.data.report_path });
  }
  if (visualReview.data.approved === true) {
    return result("complete", [], { report_path: verifier.data.report_path, visual_review_path: visualReview.data.review_path });
  }

  const postReviewRepair = await run(
    "refine-rejected-visual-repair",
    `${common} You are the sole application writer. Read ${visualReview.data.review_path} and fix every Wonder must_fix item. Treat aesthetic rejection as binding; do not replace visual corrections with report explanations. Rerun affected checks and browser paths, regenerate and visually inspect the final screenshots, update ${runDir}/report.md with concrete before/after dispositions, preserve frozen registries and package semantics, and stop every server.`,
    schema({ report_path: { type: "string" } }),
  );
  if (!postReviewRepair.ok) {
    return result("partial", ["repair after Wonder rejection did not complete"], { visual_review_path: visualReview.data.review_path });
  }

  const postRepairVerify = await run(
    "refine-post-rejection-verifier",
    `${common} Act as a read-only functional verifier after the rejected-result repair. Rerun affected build, unit, browser, responsive, accessibility, and console checks; inspect the refreshed screenshots; confirm every Wonder must_fix item has a corresponding rendered change; compare both live registries with ${analysis.data.registry_snapshot_path}; and confirm package/schema semantics remain unchanged. Write ${runDir}/post-repair-verification.md and return accepted=true only with no functional regression or frozen-boundary violation. Do not decide visual excellence and do not edit files.`,
    schema({ accepted: { type: "boolean" }, verification_path: { type: "string" }, must_fix: { type: "array", items: { type: "string" } } }),
  );
  if (!postRepairVerify.ok || postRepairVerify.data.accepted !== true) {
    return result("partial", postRepairVerify.data?.must_fix || ["post-rejection functional verification did not pass"], {
      report_path: postReviewRepair.data.report_path,
      visual_review_path: visualReview.data.review_path,
    });
  }

  const finalReReview = await run(
    "refine-final-visual-rereview",
    `${reviewCommon} Perform the final read-only visual re-review after repair. Read ONLY the active requirement, ${visualReview.data.review_path}, ${postRepairVerify.data.verification_path}, ${postReviewRepair.data.report_path}, ${moduleDir}/EXPERIENCE.md, ${moduleDir}/DESIGN_SYSTEM.md, and at most six refreshed final screenshots named in the report. Confirm every prior must_fix item in rendered pixels and reject unsupported claims or remaining material visual defects. Write ${runDir}/visual-rereview.md with approved, any still-open must_fix items, and risks.`,
    reviewSchema(),
    WONDER,
  );
  if (!finalReReview.ok || finalReReview.data.approved !== true) {
    return result("partial", finalReReview.data?.must_fix || ["final Wonder visual re-review did not approve the result"], {
      report_path: postReviewRepair.data.report_path,
      visual_review_path: finalReReview.data?.review_path || visualReview.data.review_path,
    });
  }

  return result("complete", [], {
    report_path: postReviewRepair.data.report_path,
    visual_review_path: finalReReview.data.review_path,
  });
}
