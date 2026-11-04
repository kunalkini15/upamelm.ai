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
  if ((!request && !input) || !outputDir || (!request && !languages)) {
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

  async function run(scope, input, stageSchema, model = SPARK) {
    let result;
    try { result = await host.agent({ input, schema: stageSchema, label: scope, model }); }
    catch { return record(scope, model, null, "agent_exception"); }
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
  function partial(stage, message) {
    return finish({ status: "partial", failed_stage: stage, request: request || null, input, output_dir: outputDir, stages, unresolved: [message], notes, token_usage: aggregateTokenUsage(stages) });
  }

  // 1. Freeze the request and inventory the input before translating.
  const plan = await run(
    "translate-planner",
    `${BASE} Freeze the request as ${outputDir}/request.json (copy the request file, or write the inline input/output_dir/languages args as the request). Resolve input to a file list: study_package.json, narrative_package.json, report.json when present. Validate each parses as JSON and record schema keys, bytes, sha256, and counts of translatable units (insights, limitations, blocks, metrics, study header fields). Normalize languages: accept ISO codes or language names case-insensitively per muse-translate/contracts.md (Hindi/hi to hi, Kannada/kn to kn, Tamil/ta to ta, Telugu/te to te, plus ml/mr/bn/gu/pa/ur/or/as/sa/en), lowercase, dedupe, reject empties and unknown values as unresolved. Write ${outputDir}/inventory.json with the input list, normalized languages, per-language output filenames (study_package_<lang>.json plus narrative/report copies when inputs exist), and lane ids. Return complete/evidence/unresolved plus request_path, inventory_path, lessons_loaded, language_count, lane_ids, insight_count, block_count.`,
    schema({ request_path: path, inventory_path: path, lessons_loaded: { type: "boolean" }, language_count: { type: "integer" }, lane_ids: { type: "array", items: { type: "string" } }, insight_count: { type: "integer" }, block_count: { type: "integer" } })
  );
  if (!plan.ok) return partial("translate-planner", "translate plan or inventory was not produced");

  // 2. One Spark lane per language translates and writes its final packages.
  const laneIds = (plan.data.lane_ids || []).map((id) => String(id).trim().toLowerCase().replace(/[^a-z0-9-]+/gi, "-")).filter(Boolean);
  if (laneIds.length < 1) return partial("translate-planner", "translation plan must define at least one language lane");
  const laneSchema = schema({
    translation_path: path,
    trace_path: path,
    usage_path: path,
    output_paths: { type: "array", items: path },
    unit_count: { type: "integer" },
    output_count: { type: "integer" },
  });
  const laneInputs = laneIds.map((id) => ({
    input: `${BASE} Run only the "${id}" language lane from ${plan.data.inventory_path} and ${plan.data.request_path}. Read the inventoried inputs only. Translate exactly the prose fields in muse-translate/contracts.md and nothing else; empty source prose stays empty. Preserve every id, order, count, evidence ref, metric display_value, number, unit, coordinate, checksum, filename, schema key, and proper noun. In this same lane, immediately apply the translations to copies of the source packages and write the final ${outputDir}/study_package_${id}.json, plus ${outputDir}/narrative_package_${id}.json and ${outputDir}/report_${id}.json when those source files exist. The study package must embed the same translated narrative and report content. Also write ${outputDir}/lanes/${id}/translation.json keyed by object/block id, trace.jsonl, and usage.json. Validate all files written by this lane as JSON and check schema keys, IDs, ordering, counts, evidence refs, numbers, units, and non-empty source/translation parity. Continue until every translatable unit is translated or explicitly recorded as unresolved. Return complete/evidence/unresolved plus translation_path, trace_path, usage_path, output_paths, unit_count, and output_count.`,
    schema: laneSchema,
    label: `translate-${id}`,
    model: SPARK,
  }));
  let laneResults;
  try { laneResults = await host.parallel(laneInputs); } catch { laneResults = []; }
  const liveLanes = [];
  const laneOutputs = {};
  laneResults.forEach((result, index) => {
    const scope = laneInputs[index].label;
    const failed = !result || result.error_kind || result.data_spilled_for_size || !result.data || result.data.complete !== true;
    stages.push({ scope, ref: result?.ref || null, complete: !failed, model: SPARK, error_kind: failed ? result?.error_kind || (result?.data_spilled_for_size ? "result_spilled_for_size" : "incomplete") : null, token_usage: readTokenUsage(result) });
    if (!failed) {
      liveLanes.push(result);
      laneOutputs[laneIds[index]] = result.data.output_paths || [];
    }
  });
  if (liveLanes.length !== laneIds.length) return partial("parallel-translation", `only ${liveLanes.length}/${laneIds.length} language lanes completed`);

  // 3. One final pass verifies all parallel outputs and repairs only defects.
  const finalize = await run(
    "verify-and-finalize",
    `${BASE} Inventory: ${plan.data.inventory_path}. Completed parallel lanes: ${liveLanes.map((r) => r.ref).join(" ")}. Verify every requested per-language output already written by the lanes. Do not repeat translation or consolidation when files are valid. Confirm every output parses as JSON; schema keys, IDs, order, insight/block/metric counts, evidence refs, source refs, metric display values, numbers, units, coordinates, filenames, and all non-prose fields match the source; every non-empty source prose unit has a non-empty translation; and each study package embeds the same translated narrative/report content as its standalone files. Repair only the specific affected language files when a check fails. Write ${outputDir}/verification.md and ${outputDir}/run_summary.json (translate-run.v1). Return complete/evidence/unresolved plus verification_path, summary_path, output_count, valid, warning_count, and issue_count.`,
    schema({ verification_path: path, summary_path: path, output_count: { type: "integer" }, valid: { type: "boolean" }, warning_count: { type: "integer" }, issue_count: { type: "integer" } })
  );

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
  const status = finalValid ? (warningCount === 0 ? "complete" : "complete_with_limitations") : "partial";
  return finish({ status, request: request || null, input, output_dir: outputDir, outputs, stages, unresolved: finalize.ok ? finalize.data.unresolved : ["final verification failed"], notes, warning_count: warningCount, token_usage: aggregateTokenUsage(stages) });
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
