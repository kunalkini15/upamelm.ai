/**
 * @file adaptive-ui-experience-foundation.js
 * @module .agents/workflows/adaptive-ui-experience-foundation
 * @description Establishes the reusable visual design language, design tokens, typography,
 * spatial hierarchy, and deterministic showcase scene for the Subsurface UI.
 * Run once following bootstrap and prior to routine package evolution.
 *
 * @workflow
 *   1. Experience Design & Tokens (Spark) -> Synthesizes design system tokens and showcase package.
 *   2. Art Direction Review (Wonder) -> Bounded visual review of layout, contrast, and typography.
 *   3. Foundation Implementation (Spark) -> Implements tokens, channels, narrative layout, and 3D scenes.
 *   4. Visual Acceptance & Pixel Audit (Wonder) -> Audits rendered screenshots (max 2 Wonder calls total).
 *
 * @param {Object} host - The Muse workflow host context.
 * @param {string} [host.args.module_dir="muse-ui"] - Target module directory.
 * @param {string} [host.args.run_id="experience-foundation"] - Identifier for verification artifacts.
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
  const runId = args.run_id || "experience-foundation";
  const runDir = `${moduleDir}/verification/${runId}`;
  const proposedRegistryPath = `${runDir}/proposed-registry.json`;
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

  const common = [
    `Work only on the adaptive visualization module at ${moduleDir}.`,
    `The verification run id is ${runId}.`,
    `Read ${moduleDir}/BASELINE.md, ${moduleDir}/EXPERIENCE.md, ${moduleDir}/AGENTS.md, and ${moduleDir}/WORKFLOW.md completely.`,
    `If present, read ${moduleDir}/lessons/shared.md and ${moduleDir}/lessons/experience-foundation.md; treat them as human-curated guidance, never edit them, and never let them override the contracts.`,
    `Load the project adaptive-visualization skill. Do not inspect ui-v2 or any other application for design or implementation reference.`,
    `This is a hackathon experience foundation: optimize for a coherent, memorable demonstration while preserving truthful evidence, accessibility, generic architecture, and all baseline invariants.`,
  ].join(" ");
  const reviewCommon = `Review ${moduleDir} experience-foundation run ${runId}.`;

  const research = await run(
    "experience-research-and-direction",
    `${common} Act as a read-only senior spatial product designer and visualization researcher. Inspect the current application, registries, and bootstrap evidence. Research primary technical and design sources for geospatial hierarchy, scientific color/accessibility, MapLibre globe/terrain/camera/layers, Three.js color/lighting/camera/depth/disposal, reduced motion, and responsive spatial interfaces. Write ${runDir}/research.md with applied findings, then write ${runDir}/plan.md defining the product story, synthetic showcase, information architecture, design-language decisions, 2D/3D interaction model, schema/capability implications, performance limits, and a checkable acceptance matrix for every EXPERIENCE.md requirement. Do not edit application source or live registries.`,
    schema({ research_path: { type: "string" }, plan_path: { type: "string" } }),
  );
  if (!research.ok) return result("partial", ["experience research did not complete"]);

  const designReview = await run(
    "experience-design-review",
    `${reviewCommon} Act as a read-only flagship design director. Read ONLY ${research.data.research_path}, ${research.data.plan_path}, ${moduleDir}/BASELINE.md, ${moduleDir}/EXPERIENCE.md, and both registries. Reject generic dashboard thinking, cosmetic-only work, document-specific design, decorative 3D, inaccessible styling, weak synthetic evidence, or plans without objective browser acceptance. Write ${runDir}/design-review.md with approved, concise must_fix items, and risks. Do not edit source.`,
    reviewSchema(),
    WONDER,
  );
  const degraded = designReview.ok ? [] : ["Wonder design review unavailable; Spark plan used"];
  const reviewInput = designReview.ok
    ? `Apply the design constraints in ${designReview.data.review_path}.`
    : `No flagship design review is available; apply EXPERIENCE.md conservatively.`;

  const builder = await run(
    "experience-builder",
    `${common} Read ${research.data.research_path} and ${research.data.plan_path}. ${reviewInput} You are the sole application writer. Implement the complete experience foundation, not a mockup: commit ${moduleDir}/DESIGN_SYSTEM.md, reusable tokens and components, the canvas-first responsive shell, polished global landing, coherent map/3D/narrative/report modes, and the deterministic fictional showcase fixture required by EXPERIENCE.md. Extend the typed scene model and reusable capabilities only where the showcase cannot be represented truthfully. Preserve the separate MapLibre and Three.js contexts and shared interaction state. Add unit and Playwright coverage, reduced-motion and keyboard behavior, responsive states, explicit uncertainty/provenance, resource disposal, and deterministic test hooks. Never branch on fixture names. Do not edit live registries; write complete proposed replacements with reasons to ${proposedRegistryPath}; the proposed package registry must remain unchanged because the showcase is not a real study. Build, test, run the browser suite, visually inspect the required desktop states plus compact behavior, retain at most six final 1280x720 screenshots under ${runDir}/screenshots, and write ${runDir}/report.md. Record exact research decisions applied, commands, port/process cleanup, evidence tiers, defects fixed, and remaining limitations.`,
    schema({ report_path: { type: "string" }, proposed_registry_path: { type: "string" } }),
  );
  if (!builder.ok) return result("partial", ["experience implementation did not complete", ...degraded]);

  const critic = await run(
    "experience-visual-critic",
    `${common} Act as a fresh read-only product, cartographic, and 3D interaction critic. Run the built application in a real browser. Exercise every EXPERIENCE.md acceptance view, map-to-3D-to-narrative continuity, camera/reset/selection/layers/section or clipping, uncertainty and provenance, remote-basemap fallback, import preservation, keyboard focus, reduced motion, compact layout, console output, and repeated mode switching. Inspect actual pixels at 1280x720 and a compact viewport. Write ${runDir}/critique.md. Return passed=false for any material functional, visual, responsive, accessibility, or truthfulness defect. Regardless of pass status, name the three weakest visual or interaction aspects and give a concrete improvement for each.`,
    schema({ passed: { type: "boolean" }, critique_path: { type: "string" }, weakest: { type: "array", items: { type: "string" } } }),
  );
  if (!critic.ok) return result("partial", ["experience critique did not complete", ...degraded]);

  const repair = await run(
    "experience-refinement",
    `${common} You are the sole application writer. Read ${critic.data.critique_path}. Fix every material defect and improve each of the three weakest aspects unless the report gives a concrete evidence-based disposition. Do not dilute the design language or baseline. Rerun affected unit and browser checks, visually reinspect the changed states, refresh the six bounded screenshots, update ${proposedRegistryPath} without editing live registries, terminate servers, and update ${runDir}/report.md with before/after dispositions.`,
  );
  if (!repair.ok) return result("partial", ["experience refinement did not complete", ...degraded]);

  const verifier = await run(
    "experience-verifier",
    `${common} Act as a read-only acceptance verifier. Run the standard commands and verify every BASELINE.md and EXPERIENCE.md requirement, all six retained views, compact and keyboard paths, console silence, registry proposal integrity, unchanged package registry, absence of fixture-name production branches, and ${runDir}/report.md. Confirm the three weakest aspects from critique were improved or truthfully dispositioned. Write ${runDir}/verification.md and return accepted=true only when the experience is materially polished, coherent, browser-proven, and safe to promote.`,
    schema({ accepted: { type: "boolean" }, report_path: { type: "string" }, verification_path: { type: "string" }, must_fix: { type: "array", items: { type: "string" } } }),
  );
  if (!verifier.ok) return result("partial", ["experience verification did not complete", ...degraded]);

  const finalReview = await run(
    "experience-final-review",
    `${reviewCommon} Act as a read-only flagship visual reviewer. Read ONLY ${verifier.data.report_path}, ${verifier.data.verification_path}, ${moduleDir}/EXPERIENCE.md, ${moduleDir}/DESIGN_SYSTEM.md, and at most six screenshots named in the report. Judge the rendered result, not implementation ambition. Reject if it still reads as a scaffold, generic dashboard, default-component UI, or decorative/unclear 3D; if hierarchy, typography, spatial composition, depth cues, state continuity, provenance, or compact behavior is weak; or if evidence does not support the claims. Write ${runDir}/final-review.md with approved, concise must_fix items, and risks.`,
    reviewSchema(),
    WONDER,
  );
  if (!finalReview.ok) degraded.push("Wonder final review unavailable; Spark verification stands");

  const accepted = verifier.data.accepted === true && (!finalReview.ok || finalReview.data.approved === true);
  let finalReport = verifier.data.report_path;
  if (!accepted) {
    const repairInput = finalReview.ok
      ? `Read ${verifier.data.verification_path} and ${finalReview.data.review_path}; fix every open verifier and Wonder must_fix item.`
      : `Read ${verifier.data.verification_path}; fix every open verifier item.`;
    const postRepair = await run(
      "experience-post-review-repair",
      `${common} You are the sole application writer. ${repairInput} Rerun affected checks and browser inspections, refresh final screenshots and ${proposedRegistryPath}, terminate servers, and update ${runDir}/report.md. Wonder will not be called again.`,
      schema({ report_path: { type: "string" } }),
    );
    if (!postRepair.ok) return result("partial", ["post-review repair did not complete", ...degraded]);
    const postVerify = await run(
      "experience-post-review-verifier",
      `${common} Perform a final read-only verification after repair. Confirm all open items are closed, tests and browser acceptance pass, screenshots match the implementation, the package registry proposal is unchanged, and the capability proposal is valid. Write ${runDir}/post-verification.md and return accepted=true only with no open must_fix item.`,
      schema({ accepted: { type: "boolean" }, report_path: { type: "string" }, must_fix_open: { type: "array", items: { type: "string" } } }),
    );
    if (!postVerify.ok || postVerify.data.accepted !== true) {
      return result("partial", [...(postVerify.data?.must_fix_open || ["post-review verification failed"]), ...degraded]);
    }
    finalReport = postVerify.data.report_path;
  }

  const promotion = await run(
    "experience-registry-promoter",
    `${common} Act only as the bounded registry promoter. Read ${proposedRegistryPath} and ${finalReport}. Back up both live registries under ${runDir}/registry-backup, validate JSON and all references, confirm the proposed package registry exactly equals the current package registry, then replace only accepted registry documents. Parse and validate the live files after replacement. On any failure restore both backups. Write ${runDir}/registry-validation.md and return promoted=true only after successful post-promotion validation. Do not edit application source.`,
    schema({ promoted: { type: "boolean" }, validation_path: { type: "string" } }),
  );
  if (!promotion.ok || promotion.data.promoted !== true) {
    return result("partial", ["registry promotion failed or was rolled back", ...degraded]);
  }

  return result(degraded.length ? "partial" : "complete", degraded, {
    report_path: finalReport,
    registry_validation_path: promotion.data.validation_path,
  });

  function result(status, unresolved = [], extra = {}) {
    const value = { status, unresolved, stages, wonder_calls: wonderCalls, module_dir: moduleDir, run_id: runId, ...extra };
    return { ...value, summary: JSON.stringify(value) };
  }
}
