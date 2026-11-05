/**
 * @file translate-workflow.js
 * @module muse-translate/translate-workflow
 * @description Per-language translation packaging pipeline.
 * Inventories a study input (file or directory), translates prose fields lane
 * by lane, and outputs verified per-language copies
 * (`study_package_<lang>.json` matching document-study.v2).
 *
 * @workflow
 *   1. Plan & Inventory (Spark) -> Freezes request, validates inputs, plans language lanes.
 *   2. Parallel Translation & Packaging (Spark) -> One lane per language writes final package copies.
 *   3. Final Verification (Spark) -> Cross-language checks and targeted repairs only when needed.
 *
 * @modelRouting
 *   - Spark: Planning, parallel translation/package writing, validation, and
 *     targeted repair. This workflow is Spark-only.
 *
 * @param {Object} host - Muse workflow host context.
 * @param {string} host.args.request - Path to the translate request JSON (requests/<job>.json).
 * @param {string} host.args.input - Input file or directory (alternative to request).
 * @param {string} host.args.output_dir - Run output directory.
 * @param {string[]|string} host.args.languages - Language codes/names as an array or comma-separated string (alternative to request).
 * @param {boolean} [host.args.dry_run=false] - Reuse a compatible completed translation.
 * @param {boolean} [host.args.resume=false] - Resume the same run from validated durable artifacts.
 * @param {string} [host.args.failure_report] - Failure report to audit (defaults to output_dir/failure_report.json).
 * @param {string} [host.args.runs_dir=muse-translate/runs] - Dry-run search root when output_dir is omitted.
 * @returns {Promise<Object>} Execution report containing status, manifest paths, and stage telemetry.
 */
const SPARK = "muse-spark-1.3-contributor";

export default async function workflow(host) {
  let args = host.args || {};
  if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = {}; } }
  const request = args.request || null;
  const input = args.input || args.input_dir || args.document || null;
  const outputDir = args.output_dir || args.outputDir || null;
  const languages = Array.isArray(args.languages)
    ? args.languages
    : typeof args.languages === "string"
      ? args.languages.split(",").map((value) => value.trim()).filter(Boolean)
      : null;
  const dryRun = args.dry_run === true;
  const resume = args.resume === true;
  if ((!request && !input) || (!outputDir && !dryRun) || (!request && !languages)) {
    return finish({ status: "invalid_args", unresolved: ["args must include request or (input + output_dir + languages)"] });
  }

  const path = { type: "string" };
  const schema = (extra) => ({
    type: "object",
    required: ["complete", "evidence", "unresolved", ...Object.keys(extra)],
    properties: {
      complete: { type: "boolean" },
      evidence: { type: "array", items: { type: "string" } },
      unresolved: { type: "array", items: { type: "string" } },
      ...extra,
    },
  });
  const COMPACT = "Return under 3KB: at most 6 short evidence/unresolved strings; keep full detail in files and return paths/counts only.";
  if (dryRun) {
    const searchRoot = args.runs_dir || "muse-translate/runs";
    let result;
    try {
      result = await host.agent({
        label: "dry-run-resolver",
        model: SPARK,
        input: `Dry-run only: do not create, edit, copy, rename, translate, or regenerate anything. ${request ? `Read translate request ${request} completely.` : `Input study: ${input}. Requested languages: ${(languages || []).join(",")}.`} ${outputDir ? `First inspect the exact candidate translation run ${outputDir}; if that path does not exist, search direct run folders under ${searchRoot}. If it exists but is incompatible or incomplete, fail instead of silently substituting another run.` : `Search direct run folders under ${searchRoot}.`} Select the newest successfully completed translation matching the exact input study identity/checksum and the normalized requested language set. Do not accept a run with missing or extra requested languages. Require valid request.json, inventory.json, verification.md, run_summary.json with status starting with complete, and every expected study_package_<lang>.json (plus narrative/report language copies when inventoried). Return complete=false for partial, stale, mismatched, or invalid runs. Return paths only; perform no writes.`,
        schema: schema({ reused_from: path, input_sha256: path, request_path: path, inventory_path: path, verification_path: path, summary_path: path, lane_ids: { type: "array", items: path }, output_paths: { type: "array", items: path } }),
      });
    } catch { result = null; }
    const data = result?.data;
    if (!result || result.error_kind || result.data_spilled_for_size || !data || data.complete !== true) return finish({ status: "partial", failed_stage: "dry-run-resolver", dry_run: true, request, input, output_dir: outputDir || null, stages: [{ scope: "dry-run-resolver", ref: result?.ref || null, complete: false, model: SPARK, error_kind: result?.error_kind || "incomplete" }], unresolved: data?.unresolved || ["no compatible completed translation run found"], notes: [] });
    const laneOutputs = Object.fromEntries((data.lane_ids || []).map((id) => [id, (data.output_paths || []).filter((file) => file.endsWith(`_${id}.json`))]));
    const outputs = { request: data.request_path, inventory: data.inventory_path, language_count: (data.lane_ids || []).length, lane_ids: data.lane_ids, lane_outputs: laneOutputs, verification: data.verification_path, run_summary: data.summary_path };
    const resolvedDir = data.reused_from || String(data.summary_path || data.inventory_path || data.verification_path || "").replace(/\/[^/]+$/, "");
    if (!resolvedDir) return finish({ status: "partial", failed_stage: "dry-run-resolver", dry_run: true, request, input, output_dir: outputDir || null, stages: [{ scope: "dry-run-resolver", ref: result.ref || null, complete: false, model: SPARK, error_kind: "missing_resolved_dir" }], unresolved: ["compatible translation was found but its resolved directory could not be derived"], notes: [] });
    return finish({ status: "complete_reused", dry_run: true, request, input, output_dir: resolvedDir, reused_from: resolvedDir, input_sha256: data.input_sha256, outputs, stages: [{ scope: "dry-run-resolver", ref: result.ref || null, complete: true, model: SPARK, error_kind: null }], unresolved: data.unresolved || [], notes: [] });
  }
  const BASE = [
    request ? `Translate request file: ${request}. Output directory: ${outputDir}/.` : `Translate input: ${input}. Output directory: ${outputDir}/. Languages: ${(languages || []).join(",")}.`,
    "Read muse-translate/WORKFLOW.md and muse-translate/contracts.md completely.",
    "If muse-translate/lessons/LESSONS.md exists, read it completely as supplemental guidance before acting; never edit it during a run.",
    "Primary objective: verified per-language copies with identical shape to the input; translate only the prose fields in contracts.md.",
    "Never edit the input path. Never invent facts, numbers, evidence refs, units, or coordinates. Empty source prose stays empty.",
    "Hackathon mode: fluent, plain-language translations for a lay reader; keep technical terms, proper nouns, and measurements intact.",
    "Local-defect policy: repair, simplify, or quarantine only the affected language unit. Never fail all languages for one isolated unit.",
    "If a requested output artifact already exists and matches the current input and language list, validate and reuse it; regenerate only when missing, invalid, stale, or affected by an upstream change.",
    COMPACT,
  ].join(" ");
  const stages = [];
  const notes = [];
  const failureReportPath = args.failure_report || `${outputDir}/failure_report.json`;

  async function run(scope, input, stageSchema, model = SPARK) {
    let result;
    try { result = await host.agent({ input, schema: stageSchema, label: scope, model }); }
    catch { return record(scope, model, null, "agent_exception"); }
    if (result?.error_kind === "generated_child_model_step_cap" || result?.data_spilled_for_size) {
      try {
        result = await host.agent({ input: `${input} RECOVERY: Reuse every valid output from the interrupted attempt. Translate or repair only missing/invalid units, write outputs early, keep the return compact, and reserve the final turn for submit_result.`, schema: stageSchema, label: `${scope}-recovery`, model: SPARK });
      } catch { result = null; }
    }
    if (result?.notes) notes.push({ source: scope, ref: result.ref, value: result.notes });
    if (result?.data_spilled_for_size) return record(scope, model, result, "result_spilled_for_size");
    if (!result || result.error_kind) return record(scope, model, result, result?.error_kind || "null_result");
    const data = result.data && typeof result.data === "object" ? result.data : null;
    const ok = !!(data && data.complete === true);
    stages.push({ scope, ref: result.ref || null, complete: ok, model, error_kind: ok ? null : "incomplete", token_usage: readTokenUsage(result) });
    return { result, data, ok };
  }
  function record(scope, model, result, error) {
    stages.push({ scope, ref: result?.ref || null, complete: false, model, error_kind: error, token_usage: readTokenUsage(result) });
    return { result, data: null, ok: false };
  }
  async function partial(stage, message, safeRetryPoint = stage, completedArtifacts = []) {
    const failure = await run(
      "write-failure-report",
      `${BASE} The run has stopped at stage "${stage}". Write ${failureReportPath} immediately as valid JSON. It must contain status="partial", failed_stage="${stage}", safe_retry_point="${safeRetryPoint}", completed_artifacts (only fixed paths that currently exist and validate), unresolved_work=[${JSON.stringify(message)}], and an ISO-8601 timestamp. Inspect fixed paths under ${outputDir} to determine completed artifacts; model-returned counters and path lists are advisory. Preserve every valid artifact and do not translate, hash, validate, delete, or regenerate completed work. Suggested completed paths: ${completedArtifacts.join(", ") || "none"}. Reserve the final turn for submit_result. Return the report path.`,
      schema({ failure_report_path: path })
    );
    return finish({ status: "partial", failed_stage: stage, safe_retry_point: safeRetryPoint, failure_report: failure.ok ? failure.data.failure_report_path : failureReportPath, request: request || null, input, output_dir: outputDir, stages, unresolved: [message], notes, token_usage: aggregateTokenUsage(stages) });
  }

  let plan;
  let laneIds = [];
  let reusableLaneIds = [];
  let resumeStage = "plan";

  if (resume) {
    const checkpoint = await run(
      "resume-checkpoint-audit",
      `${BASE} READ-ONLY resume audit. Read ${failureReportPath}, ${outputDir}/request.json, ${outputDir}/inventory.json, fixed lane paths ${outputDir}/lanes/<language>/{translation.json,trace.jsonl,usage.json}, fixed generated package paths ${outputDir}/{study_package,narrative_package,report}_<language>.json, ${outputDir}/verification.md, and ${outputDir}/run_summary.json when present. Do not create, edit, delete, translate, extract, OCR, hash, or repair anything. Require failure_report.status="partial". Validate that the frozen request is semantically identical to the complete current configuration (request=${request || "inline"}, input=${input || "from request"}, output_dir=${outputDir}, languages=${(languages || []).join(",") || "from request"}); validate input identity/checksums recorded in inventory against the current input without recomputing work already represented by valid inventory checksums. Reject any mismatch. Determine resumability only from fixed paths and files that parse and satisfy their contracts; counters and path lists returned by prior models are advisory. Return normalized lane_ids, individually reusable_lane_ids, and resume_stage as plan, lanes, or finalize. A lane is reusable only when its lane artifacts and all expected language packages validate. If final verification and summary are already valid, return resume_stage=complete. Return complete=false for an unsafe or mismatched checkpoint. Reserve the final turn for submit_result.`,
      schema({ resume_stage: { type: "string" }, lane_ids: { type: "array", items: path }, reusable_lane_ids: { type: "array", items: path }, input_sha256: path })
    );
    if (!checkpoint.ok) return finish({ status: "partial", failed_stage: "resume-checkpoint-audit", safe_retry_point: "resume-checkpoint-audit", failure_report: failureReportPath, request: request || null, input, output_dir: outputDir, stages, unresolved: ["checkpoint does not match the frozen request, input identity, output directory, or languages"], notes, token_usage: aggregateTokenUsage(stages) });
    resumeStage = checkpoint.data.resume_stage;
    laneIds = (checkpoint.data.lane_ids || []).map(normalizeLaneId).filter(Boolean);
    reusableLaneIds = (checkpoint.data.reusable_lane_ids || []).map(normalizeLaneId).filter((id) => laneIds.includes(id));
    if (resumeStage === "complete") {
      return finish({ status: "complete_reused", resume: true, reuse: "validated-complete", request: request || null, input, output_dir: outputDir, failure_report: failureReportPath, outputs: fixedOutputs(outputDir, laneIds, reusableLaneIds), stages, unresolved: [], notes, token_usage: aggregateTokenUsage(stages) });
    }
    if (resumeStage !== "plan" && laneIds.length < 1) return finish({ status: "partial", failed_stage: "resume-checkpoint-audit", safe_retry_point: "plan", failure_report: failureReportPath, request: request || null, input, output_dir: outputDir, stages, unresolved: ["validated checkpoint did not contain a usable frozen language plan"], notes, token_usage: aggregateTokenUsage(stages) });
    if (resumeStage !== "plan") plan = { ok: true, result: checkpoint.result, data: { request_path: `${outputDir}/request.json`, inventory_path: `${outputDir}/inventory.json`, lessons_loaded: true, language_count: laneIds.length, lane_ids: laneIds } };
  }

  // 1. Freeze the request and inventory the input before translating.
  if (!plan) plan = await run(
    "translate-planner",
    `${BASE} Freeze the request as ${outputDir}/request.json (copy the request file, or write the inline input/output_dir/languages args as the request). Resolve input to a file list: study_package.json, narrative_package.json, report.json when present. Validate each parses as JSON and record schema keys, bytes, sha256, and counts of translatable units (insights, limitations, blocks, metrics, study header fields). Normalize languages: accept ISO codes or language names case-insensitively per muse-translate/contracts.md (Hindi/hi to hi, Kannada/kn to kn, Tamil/ta to ta, Telugu/te to te, plus ml/mr/bn/gu/pa/ur/or/as/sa/en), lowercase, dedupe, reject empties and unknown values as unresolved. Write ${outputDir}/inventory.json with the input list, normalized languages, per-language output filenames (study_package_<lang>.json plus narrative/report copies when inputs exist), and lane ids. Return complete/evidence/unresolved plus request_path, inventory_path, lessons_loaded, language_count, lane_ids, insight_count, block_count.`,
    schema({ request_path: path, inventory_path: path, lessons_loaded: { type: "boolean" }, language_count: { type: "integer" }, lane_ids: { type: "array", items: { type: "string" } }, insight_count: { type: "integer" }, block_count: { type: "integer" } })
  );
  if (!plan.ok) return partial("translate-planner", "translate plan or inventory was not produced", "plan", [`${outputDir}/request.json`, `${outputDir}/inventory.json`]);

  // 2. One Spark lane per language translates and writes its final packages.
  if (laneIds.length < 1) laneIds = (plan.data.lane_ids || []).map(normalizeLaneId).filter(Boolean);
  if (laneIds.length < 1) return partial("translate-planner", "translation plan must define at least one language lane", "plan");
  const laneSchema = schema({
    translation_path: path,
    trace_path: path,
    usage_path: path,
    output_paths: { type: "array", items: path },
    unit_count: { type: "integer" },
    output_count: { type: "integer" },
  });
  const pendingLaneIds = resumeStage === "finalize" ? [] : laneIds.filter((id) => !reusableLaneIds.includes(id));
  const laneInputs = pendingLaneIds.map((id) => ({
    input: `${BASE} Run only the "${id}" language lane from ${plan.data.inventory_path} and ${plan.data.request_path}. Read the inventoried inputs only. Translate exactly the prose fields in muse-translate/contracts.md and nothing else; empty source prose stays empty. Preserve every id, order, count, evidence ref, metric display_value, number, unit, coordinate, checksum, filename, schema key, and proper noun. In this same lane, immediately apply the translations to copies of the source packages and write the final ${outputDir}/study_package_${id}.json, plus ${outputDir}/narrative_package_${id}.json and ${outputDir}/report_${id}.json when those source files exist. The study package must embed the same translated narrative and report content. Also write ${outputDir}/lanes/${id}/translation.json keyed by object/block id, trace.jsonl, and usage.json. Validate all files written by this lane as JSON and check schema keys, IDs, ordering, counts, evidence refs, numbers, units, and non-empty source/translation parity. Continue until every translatable unit is translated or explicitly recorded as unresolved. Return complete/evidence/unresolved plus translation_path, trace_path, usage_path, output_paths, unit_count, and output_count.`,
    schema: laneSchema,
    label: `translate-${id}`,
    model: SPARK,
  }));
  let laneResults;
  try { laneResults = laneInputs.length ? await host.parallel(laneInputs) : []; } catch { laneResults = []; }
  for (let index = 0; index < laneInputs.length; index += 1) {
    const result = laneResults[index];
    if (!result || result.error_kind || result.data_spilled_for_size || !result.data || result.data.complete !== true) {
      try {
        laneResults[index] = await host.agent({ ...laneInputs[index], label: `${laneInputs[index].label}-recovery`, input: `${laneInputs[index].input} RECOVERY: Reuse valid translated packages and lane files already written. Complete only missing or invalid units, write required artifacts early, and reserve the final child-model turn exclusively for submit_result.` });
      } catch { laneResults[index] = result; }
    }
  }
  const liveLanes = [];
  const laneOutputs = Object.fromEntries(reusableLaneIds.map((id) => [id, fixedLanguageOutputs(outputDir, id)]));
  laneResults.forEach((result, index) => {
    const scope = laneInputs[index].label;
    const failed = !result || result.error_kind || result.data_spilled_for_size || !result.data || result.data.complete !== true;
    stages.push({ scope, ref: result?.ref || null, complete: !failed, model: SPARK, error_kind: failed ? result?.error_kind || (result?.data_spilled_for_size ? "result_spilled_for_size" : "incomplete") : null, token_usage: readTokenUsage(result) });
    if (!failed) {
      liveLanes.push(result);
      laneOutputs[pendingLaneIds[index]] = result.data.output_paths || [];
    }
  });
  const completedLaneCount = reusableLaneIds.length + liveLanes.length;
  if (completedLaneCount !== laneIds.length) return partial("parallel-translation", `only ${completedLaneCount}/${laneIds.length} language lanes completed`, "lanes", [`${outputDir}/request.json`, `${outputDir}/inventory.json`, ...Object.values(laneOutputs).flat()]);

  // 3. One final pass verifies all parallel outputs and repairs only defects.
  const finalize = await run(
    "verify-and-finalize",
    `${BASE} Inventory: ${plan.data.inventory_path}. ${resume ? `This is a validated resume at ${resumeStage}; reusable lanes: ${reusableLaneIds.join(",") || "none"}.` : ""} Completed parallel lane refs: ${liveLanes.map((r) => r.ref).join(" ") || "none; use durable fixed paths"}. Verify every requested per-language output already written by the lanes. Treat model-returned counters and paths as advisory and inspect the fixed paths from inventory. Do not repeat translation, hashing, or validation already recorded as valid. Confirm every output parses as JSON; schema keys, IDs, order, insight/block/metric counts, evidence refs, source refs, metric display values, numbers, units, coordinates, filenames, and all non-prose fields match the source; every non-empty source prose unit has a non-empty translation; and each study package embeds the same translated narrative/report content as its standalone files. Repair only the specific affected language files when a check fails. Write ${outputDir}/verification.md and ${outputDir}/run_summary.json (translate-run.v1) early enough to survive interruption; reserve the final child-model turn exclusively for submit_result. Return complete/evidence/unresolved plus verification_path, summary_path, output_count, valid, warning_count, and issue_count.`,
    schema({ verification_path: path, summary_path: path, output_count: { type: "integer" }, valid: { type: "boolean" }, warning_count: { type: "integer" }, issue_count: { type: "integer" } })
  );

  if (!finalize.ok) return partial("verify-and-finalize", "final verification failed", "finalize", [`${outputDir}/request.json`, `${outputDir}/inventory.json`, ...Object.values(laneOutputs).flat()]);
  const outputs = {
    request: plan.data.request_path,
    inventory: plan.data.inventory_path,
    lessons_loaded: plan.data.lessons_loaded,
    language_count: plan.data.language_count,
    lane_ids: laneIds,
    lane_outputs: laneOutputs,
    verification: finalize.ok ? finalize.data.verification_path : null,
    run_summary: finalize.ok ? finalize.data.summary_path : null,
  };
  const warningCount = finalize.ok ? finalize.data.warning_count || 0 : 0;
  const finalValid = finalize.ok && finalize.data.valid && (finalize.data.issue_count || 0) === 0;
  if (!finalValid) return partial("verify-and-finalize", "final verification reported unresolved or invalid outputs", "finalize", [`${outputDir}/request.json`, `${outputDir}/inventory.json`, ...Object.values(laneOutputs).flat(), finalize.data.verification_path, finalize.data.summary_path]);
  const status = warningCount === 0 ? (resume ? "complete_resumed" : "complete") : "complete_with_limitations";
  return finish({ status, resume, reuse: resume ? (reusableLaneIds.length ? "resumed-with-reuse" : "resumed") : "generated", request: request || null, input, output_dir: outputDir, outputs, stages, unresolved: finalize.data.unresolved, notes, warning_count: warningCount, token_usage: aggregateTokenUsage(stages) });
}

function normalizeLaneId(id) { return String(id).trim().toLowerCase().replace(/[^a-z0-9-]+/gi, "-"); }
function fixedLanguageOutputs(outputDir, id) { return [`${outputDir}/study_package_${id}.json`, `${outputDir}/narrative_package_${id}.json`, `${outputDir}/report_${id}.json`]; }
function fixedOutputs(outputDir, laneIds, reusableLaneIds) {
  return { request: `${outputDir}/request.json`, inventory: `${outputDir}/inventory.json`, language_count: laneIds.length, lane_ids: laneIds, lane_outputs: Object.fromEntries(reusableLaneIds.map((id) => [id, fixedLanguageOutputs(outputDir, id)])), verification: `${outputDir}/verification.md`, run_summary: `${outputDir}/run_summary.json` };
}

function finish(report) { return { ...report, summary: JSON.stringify(report) }; }

function readTokenUsage(result) {
  if (!result || typeof result !== "object") return { available: false };
  const candidates = [result.usage, result.token_usage, result.tokenUsage, result.usage_metadata, result.usageMetadata, result.metrics?.usage, result.meta?.usage, result.metadata?.usage, result.metadata?.token_usage];
  const source = candidates.find((value) => value && typeof value === "object");
  if (!source) return { available: false };
  const number = (...keys) => {
    for (const key of keys) if (Number.isFinite(source[key])) return Number(source[key]);
    return null;
  };
  const input = number("input_tokens", "prompt_tokens", "inputTokens", "promptTokens", "promptTokenCount");
  const output = number("output_tokens", "completion_tokens", "outputTokens", "completionTokens", "candidatesTokenCount");
  const explicitTotal = number("total_tokens", "totalTokens", "totalTokenCount");
  const total = explicitTotal ?? (input !== null && output !== null ? input + output : null);
  const usage = {
    available: input !== null || output !== null || total !== null,
    input_tokens: input,
    output_tokens: output,
    total_tokens: total,
  };
  const cached = number("cached_input_tokens", "cached_tokens", "cache_read_input_tokens");
  const reasoning = number("reasoning_tokens", "reasoningTokens");
  if (cached !== null) usage.cached_input_tokens = cached;
  if (reasoning !== null) usage.reasoning_tokens = reasoning;
  return usage;
}

function aggregateTokenUsage(stages) {
  const metered = stages.filter((stage) => stage.token_usage?.available);
  const sum = (key) => metered.reduce((total, stage) => total + (Number.isFinite(stage.token_usage[key]) ? stage.token_usage[key] : 0), 0);
  return {
    available: metered.length > 0,
    fully_metered: stages.length > 0 && metered.length === stages.length,
    metered_stage_count: metered.length,
    unmetered_stage_count: stages.length - metered.length,
    input_tokens: sum("input_tokens"),
    output_tokens: sum("output_tokens"),
    total_tokens: sum("total_tokens"),
    cached_input_tokens: sum("cached_input_tokens"),
    reasoning_tokens: sum("reasoning_tokens"),
  };
}
