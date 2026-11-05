/**
 * @file study-workflow.js
 * @module muse-document-processing/study-workflow
 * @description Deep multimodal document extraction and scientific study packaging pipeline.
 * Ingests a single technical document (PDF, spreadsheet, report) and outputs a grounded,
 * schema-validated study package (`study_package.json` matching `document-study.v2`).
 *
 * @workflow
 *   1. Dynamic Extraction (Spark) -> Parses tables, logs, coordinates, and builds source cache & evidence inventory.
 *   2. Visual Direction (Wonder/Spark) -> Designs visual hierarchy and capability mapping.
 *   3. Integrated Authoring (Spark) -> Authors rendering package, lay narratives, and executive synthesis.
 *   4. Integrated Finalization (Wonder/Spark) -> Validates contracts and compiles the final study package.
 *
 * @modelRouting
 *   - Spark: Extraction, OCR transcription, rendering authoring, and schema checks.
 *   - Wonder: Visual direction and final holistic review. Max 2 calls with automatic Spark fallback.
 *
 * @param {Object} host - Muse workflow host context.
 * @param {string} host.args.document - Path to the input technical document.
 * @param {string} host.args.output_dir - Run output directory for artifacts.
 * @param {boolean} [host.args.dry_run=false] - Reuse a compatible completed study.
 * @param {boolean} [host.args.resume=false] - Resume a validated partial run from fixed durable artifacts.
 * @param {string} [host.args.runs_dir=muse-document-processing/runs] - Dry-run search root when output_dir is omitted.
 * @returns {Promise<Object>} Execution report containing status, artifact paths, and token telemetry.
 */
const SPARK = "muse-spark-1.3-contributor";
const WONDER = "muse-wonder-1.0";
const MAX_WONDER_CALLS = 2;
const MAX_CONTINUATION_CHILDREN = 10;

export default async function workflow(host) {
  let args = host.args || {};
  if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = {}; } }
  const document = args.document;
  const outputDir = args.output_dir;
  const dryRun = args.dry_run === true;
  const resume = args.resume === true;
  if (!document || (!outputDir && !dryRun)) return finish({ status: "invalid_args", unresolved: ["args must include document and output_dir (output_dir may be omitted in dry_run mode)"] });

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
    const searchRoot = args.runs_dir || "muse-document-processing/runs";
    let result;
    try {
      result = await host.agent({
        label: "dry-run-resolver",
        model: SPARK,
        input: `Dry-run only: do not create, edit, copy, rename, or regenerate anything. Source document: ${document}. ${outputDir ? `First inspect the exact candidate study run ${outputDir}; if that path does not exist, search direct run folders under ${searchRoot}. If it exists but is incompatible or incomplete, fail instead of silently substituting another run.` : `Search direct run folders under ${searchRoot}.`} Select the newest successfully completed study for this exact source document. Match using recorded source identity and checksum when available, not folder name; a ranked byte-identical copy may match its canonical source by checksum. Require valid study_package.json, narrative_package.json, report.json, grounding_selfcheck.json, and a completion record/checkpoint showing status starts with complete. Return complete=false for partial, stale, mismatched, or invalid runs. Return paths only; perform no writes.`,
        schema: schema({ reused_from: path, source_sha256: path, study_package: path, narrative_package: path, report: path, grounding_selfcheck: path }),
      });
    } catch { result = null; }
    const data = result?.data;
    if (!result || result.error_kind || result.data_spilled_for_size || !data || data.complete !== true) return finish({ status: "partial", failed_stage: "dry-run-resolver", dry_run: true, document, output_dir: outputDir || null, stages: [{ scope: "dry-run-resolver", ref: result?.ref || null, complete: false, model: SPARK, error_kind: result?.error_kind || "incomplete" }], unresolved: data?.unresolved || ["no compatible completed study run found"], notes: [] });
    const outputs = { study_package: data.study_package, narrative_package: data.narrative_package, report: data.report, grounding_selfcheck: data.grounding_selfcheck };
    const resolvedDir = data.reused_from || String(data.study_package || "").replace(/\/[^/]+$/, "");
    if (!resolvedDir) return finish({ status: "partial", failed_stage: "dry-run-resolver", dry_run: true, document, output_dir: outputDir || null, stages: [{ scope: "dry-run-resolver", ref: result.ref || null, complete: false, model: SPARK, error_kind: "missing_resolved_dir" }], unresolved: ["compatible study was found but its resolved directory could not be derived"], notes: [] });
    return finish({ status: "complete_reused", dry_run: true, document, output_dir: resolvedDir, reused_from: resolvedDir, source_sha256: data.source_sha256, outputs, stages: [{ scope: "dry-run-resolver", ref: result.ref || null, complete: true, model: SPARK, error_kind: null }], unresolved: data.unresolved || [], notes: [] });
  }
  const BASE = [
    `Source: ${document}. Output directory: ${outputDir}/.`,
    "Read muse-document-processing/WORKFLOW.md, contracts.md, and ui-output-contracts.json completely.",
    "If muse-document-processing/lessons/LESSONS.md exists, read it completely as supplemental guidance before acting; never edit it during a run.",
    "Primary objective: recover the maximum useful, source-traceable scientific and visual information for a compelling UI.",
    "Uncertainty changes labels, confidence, styling, and caveats; it does not justify silently discarding useful source content.",
    "Hackathon mode: use creative but scientifically reasonable explanations, analogies, derived comparisons, and presentation choices. Clearly distinguish source facts from synthesis, but do not become conservative merely because wording or presentation is not printed verbatim.",
    "Local-defect policy: correct, simplify, downgrade to limited, quarantine, or omit only the affected object. Never fail or discard an otherwise useful package because of an isolated reference, narrative, property, statistic, or optional UI element.",
    "OCR policy: scanned or image-only content is not automatically deferred. Use the OCR gate in ocr_plan.json; Spark visually transcribes required pages and skips only low-value pages with a concrete reason. 'Needs OCR' alone is never a sufficient final deferral reason.",
    "If the requested output artifact already exists, validate and reuse it when it matches the frozen request, source checksum, and upstream artifacts; regenerate only when missing, invalid, interrupted, stale, or affected by an upstream change.",
    `After completing a sequential stage, atomically update ${outputDir}/checkpoint.json with the stage name, validated fixed artifact paths and checksums, next safe stage, and timestamp. Never erase earlier valid checkpoint entries. Write required artifacts early and reserve the final child-model turn for submit_result.`,
    COMPACT,
  ].join(" ");
  const stages = [];
  const notes = [];
  let wonderCalls = 0;

  async function run(scope, input, stageSchema, model = SPARK) {
    if (model === WONDER && wonderCalls >= MAX_WONDER_CALLS) return record(scope, model, null, "wonder_call_limit_reached");
    if (model === WONDER) wonderCalls += 1;
    let result;
    try { result = await host.agent({ input, schema: stageSchema, label: scope, model }); }
    catch { return record(scope, model, null, "agent_exception"); }
    let continuation = 0;
    while ((result?.error_kind === "generated_child_model_step_cap" || result?.data_spilled_for_size) && continuation < MAX_CONTINUATION_CHILDREN) {
      stages.push({ scope: continuation === 0 ? scope : `${scope}-continuation-${continuation}`, ref: result?.ref || null, complete: false, model: continuation === 0 ? model : SPARK, error_kind: result?.error_kind || "result_spilled_for_size", token_usage: readTokenUsage(result) });
      continuation += 1;
      const continuationScope = `${scope}-continuation-${continuation}`;
      notes.push({ source: continuationScope, ref: result?.ref || null, value: `continuing interrupted stage from durable artifacts (${continuation}/${MAX_CONTINUATION_CHILDREN})` });
      try {
        result = await host.agent({ input: `${input} CONTINUATION ${continuation}/${MAX_CONTINUATION_CHILDREN}: Inspect the fixed current-stage artifacts first; earlier children may have advanced the stage. Reuse every valid durable artifact and preserve completed extraction or authoring. Finish only missing or invalid outputs, write them immediately, keep the return compact, and reserve the final turn for submit_result. If all required outputs are already valid, submit immediately without more tool work.`, schema: stageSchema, label: continuationScope, model: SPARK });
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
  async function partial(stage, message) {
    const completedStages = stages.filter((item) => item.complete).map((item) => item.scope);
    const failurePath = `${outputDir}/failure_report.json`;
    await run("write-failure-report", `${BASE} Write ${failurePath} now. This is bookkeeping only: do not rerun, repair, delete, re-hash the source, OCR, extract, render, author, or perform final validation. Inspect the fixed expected paths for completed stages ${JSON.stringify(completedStages)} and include only files that already exist, parse, and match their recorded checksums. Record status="partial", failed_stage=${stage}, safe_retry_point=${stage}, completed_artifacts as structured path/checksum/size entries, unresolved_work=${JSON.stringify([message])}, timestamp as current ISO-8601 UTC, document=${document}, output_dir=${outputDir}, resume=true, and frozen_request_path=${outputDir}/request.json. Preserve every existing artifact and prior checkpoint entry. Return complete/evidence/unresolved plus failure_report_path. Reserve the final turn for submit_result.`, schema({ failure_report_path: path }));
    return finish({ status: "partial", failed_stage: stage, safe_retry_point: stage, failure_report: failurePath, document, output_dir: outputDir, stages, completed_stages: completedStages, unresolved: [message], notes, wonder_calls: wonderCalls, token_usage: aggregateTokenUsage(stages) });
  }

  const STAGE_ORDER = ["source-cartographer", "parallel-extraction", "evidence-reconciler", "rendering-author", "visual-director", "spark-integrated-author", "integrated-finalizer", "ui-contract-compiler", "validate-and-assemble", "complete"];
  let resumeData = null;
  if (resume) {
    const audit = await run("resume-checkpoint-audit", `${BASE} READ-ONLY resume audit. Batch-read ${outputDir}/failure_report.json, ${outputDir}/request.json, ${outputDir}/checkpoint.json when present, and only the fixed artifact paths named in WORKFLOW.md. Validate status=partial or a fully completed checkpoint; after canonical normalization the frozen request must exactly match the immutable structured configuration ${JSON.stringify({ document, output_dir: outputDir, requested_languages: [] })}. Exclude runtime control flags such as resume, dry_run, and failure_report from identity comparison. Validate input identity/checksum and output directory against the frozen record and every claimed artifact. Treat model-returned counters and path lists as advisory. Infer resumability only from fixed paths and valid files. Determine the first incomplete stage and individually validate every planned extraction lane and lane checkpoint. Do not write, delete, rename, hash again when a recorded checksum is valid, OCR, extract, render, author, or repair. Return complete=false if identity/configuration differs or no safe checkpoint exists; return resume_stage=complete when the final package and verification are valid. Return complete/evidence/unresolved plus resume_stage, lane_ids, completed_lane_ids, document_shape, and source_sha256.`, schema({ resume_stage: { type: "string", enum: STAGE_ORDER }, lane_ids: { type: "array", items: { type: "string" } }, completed_lane_ids: { type: "array", items: { type: "string" } }, document_shape: { type: "string", enum: ["narrative", "mixed", "tabular_annex", "dataset"] }, source_sha256: path }));
    // Some auditors use `complete` to describe the unfinished study rather than
    // the validity of the resume audit. A concrete safe stage plus the verified
    // source checksum is an accepted resumable checkpoint even in that shape.
    const auditAccepted = audit.ok || !!(audit.data && STAGE_ORDER.includes(audit.data.resume_stage) && audit.data.source_sha256);
    if (!auditAccepted) return finish({ status: "partial", failed_stage: "resume-checkpoint-audit", safe_retry_point: "resume-checkpoint-audit", failure_report: `${outputDir}/failure_report.json`, document, output_dir: outputDir, stages, completed_stages: [], unresolved: ["checkpoint does not match the frozen request, source identity, or output directory"], notes, wonder_calls: wonderCalls, token_usage: aggregateTokenUsage(stages) });
    resumeData = audit.data;
    if (resumeData.resume_stage === "complete") return finish({ status: "complete_reused", resume: true, execution_mode: "reused", document, output_dir: outputDir, outputs: { study_package: `${outputDir}/study_package.json`, narrative_package: `${outputDir}/narrative_package.json`, report: `${outputDir}/report.json`, grounding_selfcheck: `${outputDir}/grounding_selfcheck.json` }, stages, unresolved: [], notes, wonder_calls: wonderCalls, token_usage: aggregateTokenUsage(stages) });
    notes.push({ source: "resume-checkpoint-audit", value: `resuming at ${resumeData.resume_stage}; valid earlier artifacts will be reused` });
  } else {
    const initialize = await run("run-initializer", `${BASE} Do no document extraction or OCR. Validate the input, compute its SHA-256 once, and atomically write ${outputDir}/request.json as immutable document-processing-request.v1 before substantive work. Freeze the canonical structured configuration ${JSON.stringify({ document, output_dir: outputDir, requested_languages: [] })}, normalized input identity, byte size, source checksum, workflow/schema versions, and creation timestamp. Runtime control flags are not identity fields. If an incompatible frozen request already exists, stop without overwriting it. Atomically initialize ${outputDir}/checkpoint.json with status=running, next_stage=source-cartographer, source identity, and no completed stages. Reserve the final turn for submit_result.`, schema({ request_path: path, checkpoint_path: path, source_sha256: path }));
    if (!initialize.ok) return await partial("run-initializer", "frozen request and initial checkpoint were not created");
  }
  const stageIndex = (name) => STAGE_ORDER.indexOf(name);
  const shouldRun = (name) => !resumeData || stageIndex(name) >= stageIndex(resumeData.resume_stage);
  const reused = (data) => ({ ok: true, result: { ref: `${outputDir}/checkpoint.json` }, data });
  const resultLike = (ref, data) => ({ ref, data: { complete: true, evidence: [ref], unresolved: [], ...data } });

  // 1. Map the whole source before extracting. This prevents early-page bias.
  const map = shouldRun("source-cartographer") ? await run(
    "source-cartographer",
    `${BASE} Freeze the complete structured request immediately at ${outputDir}/request.json, including document, output_dir, source identity/checksum, and workflow version. Pass 1 is structural mapping, never row-level scientific extraction. Inspect the complete source once, including every page/sheet, table, figure, legend, appendix, and attachment, and classify document_shape as narrative, mixed, tabular_annex, or dataset. Create a lightweight reusable cache under ${outputDir}/source-cache/: machine page text or a searchable text index, representative/required page images, table-of-contents and asset index. For repeated multi-page tables or a tabular_annex/dataset, read the contents, column headers, first/last and representative pages only to identify table schemas, page ranges, geographic coverage, parameter groups, and extraction methods. Do NOT parse every row, create full scientific CSVs, compute maxima/counts, validate thousands of cells, or perform geographic filtering in this stage; assign that work to parallel extraction lanes. Record large_table_ranges in the source map and source cache with extraction_status=planned. For narrative/mixed documents, still map every region, but leave evidence extraction to lanes. Detect pages/regions with missing, sparse, or garbled machine text. Write ${outputDir}/ocr_plan.json with one entry per affected page/range: source region, content hint, estimated evidence/UI value, decision (ocr|skip), reason, assigned Spark lane, image path, status (pending|skipped), and expected output. Choose ocr whenever content may materially affect science, rendering, narrative, report, or completeness; skip only when incremental value is low and state why. Render only representative visual assets and pages required for OCR at mapping time; lanes render other pages on demand. Write ${outputDir}/source_map.json, ${outputDir}/source_cache.json, ${outputDir}/extraction_plan.json, and update ${outputDir}/checkpoint.json before submit_result. Design the smallest complementary set of 2-6 extraction lanes actually needed; for large tabular sources, partition parameter/table ranges across lanes and have lanes extract relevant study-scope rows first, broader context second, without silently discarding the remainder. Each lane spec needs id, objective, assigned_regions/table ranges, required_assets including assigned OCR pages, exclusions, and completion evidence. Write required artifacts early and reserve the final child-model turn for submit_result. Return complete/evidence/unresolved plus source_map_path, source_cache_path, extraction_plan_path, ocr_plan_path, document_shape, lane_ids, page_count, region_count, large_table_range_count, and ocr_required_page_count.`,
    schema({ source_map_path: path, source_cache_path: path, extraction_plan_path: path, ocr_plan_path: path, document_shape: { type: "string", enum: ["narrative", "mixed", "tabular_annex", "dataset"] }, lessons_loaded: { type: "boolean" }, lane_ids: { type: "array", items: { type: "string" } }, page_count: { type: "integer" }, region_count: { type: "integer" }, large_table_range_count: { type: "integer" }, ocr_required_page_count: { type: "integer" } })
  ) : reused({ source_map_path: `${outputDir}/source_map.json`, source_cache_path: `${outputDir}/source_cache.json`, extraction_plan_path: `${outputDir}/extraction_plan.json`, ocr_plan_path: `${outputDir}/ocr_plan.json`, document_shape: resumeData.document_shape, lessons_loaded: true, lane_ids: resumeData.lane_ids });
  if (!map.ok) return await partial("source-cartographer", "complete-source map was not produced");

  // 2. Document-specific lanes use the shared cache instead of rereading all pages.
  const laneIds = (map.data.lane_ids || []).map((id) => String(id).trim().replace(/[^a-z0-9-]+/gi, "-").toLowerCase()).filter(Boolean);
  if (laneIds.length < 2 || laneIds.length > 6) return await partial("source-cartographer", "extraction plan must define 2-6 document-specific lanes");
  const laneSchema = schema({ evidence_path: path, asset_index_path: path, item_count: { type: "integer" }, candidate_count: { type: "integer" }, ocr_completed_page_count: { type: "integer" } });
  const completedLaneIds = new Set(resumeData?.completed_lane_ids || []);
  const laneInputs = laneIds.map((id) => ({
    input: `${BASE} Read the lane "${id}" from ${map.data.extraction_plan_path}, the source map, ${map.data.source_cache_path}, and ${map.data.ocr_plan_path}. Run only that lane and assigned regions/table ranges. Use cached text/indexes first; parse assigned rows and render assigned pages on demand. For tabular annexes/datasets, write durable structured tables under ${outputDir}/resources/; validate headers, row counts, coordinates, units, and representative boundary rows. Preserve quantitative records at observation grain: subject/location, parameter, date or category, numeric value, unit, range or uncertainty, status, and source reference. Keep missing values missing; never interpolate them, turn them into zero, or merge incompatible parameters or units. Extract rows relevant to the study scope first, then retain broader aggregates or indexed resources when useful; never turn thousands of homogeneous rows into thousands of prose facts. For each assigned ocr entry, visually read the rendered page image with Spark, transcribe only relevant text/tables into ${outputDir}/source-cache/ocr/, preserve layout and page references, mark uncertain cells, and perform a second visual comparison for names, coordinates, units, and measurements. Update that ocr_plan entry to completed with output paths and confidence. Do not OCR skipped entries. Write ${outputDir}/evidence/${id}.json, ${outputDir}/evidence/${id}-assets.json, and ${outputDir}/evidence/${id}-checkpoint.json before submit_result. The lane checkpoint records source checksum, lane specification checksum, artifact checksums, OCR entries completed or skipped, status, and timestamp. Continue until lane completion evidence is met, every assigned required OCR entry is completed or documented unreadable, and no material new UI evidence appears. Return complete/evidence/unresolved plus evidence_path, asset_index_path, item_count, candidate_count, and ocr_completed_page_count.`,
    schema: laneSchema,
    label: `extract-${id}`,
    model: SPARK,
  }));
  let laneResults = laneIds.map((id) => completedLaneIds.has(id) ? resultLike(`${outputDir}/evidence/${id}.json`, { evidence_path: `${outputDir}/evidence/${id}.json`, asset_index_path: `${outputDir}/evidence/${id}-assets.json`, item_count: 0, candidate_count: 0, ocr_completed_page_count: 0 }) : null);
  const pendingIndexes = laneIds.map((id, index) => ({ id, index })).filter(({ id }) => !completedLaneIds.has(id) && shouldRun("parallel-extraction"));
  try {
    const pendingResults = pendingIndexes.length ? await host.parallel(pendingIndexes.map(({ index }) => laneInputs[index])) : [];
    pendingIndexes.forEach(({ index }, offset) => { laneResults[index] = pendingResults[offset]; });
  } catch { /* recovery below handles each missing lane */ }
  for (let index = 0; index < laneInputs.length; index += 1) {
    const result = laneResults[index];
    if (!result || result.error_kind || result.data_spilled_for_size || !result.data || result.data.complete !== true) {
      try {
        laneResults[index] = await host.agent({ ...laneInputs[index], label: `${laneInputs[index].label}-recovery`, input: `${laneInputs[index].input} RECOVERY: Reuse the lane files and source cache already written. Complete only missing assigned regions/OCR and submit the compact schema result.` });
      } catch { laneResults[index] = result; }
    }
  }
  const liveLanes = [];
  laneResults.forEach((result, index) => {
    const scope = laneInputs[index].label;
    const failed = !result || result.error_kind || result.data_spilled_for_size || !result.data || result.data.complete !== true;
    stages.push({ scope, ref: result?.ref || null, complete: !failed, model: SPARK, error_kind: failed ? result?.error_kind || (result?.data_spilled_for_size ? "result_spilled_for_size" : "incomplete") : null, token_usage: readTokenUsage(result) });
    if (!failed) liveLanes.push(result);
  });
  if (liveLanes.length !== laneIds.length) return await partial("parallel-extraction", `only ${liveLanes.length}/${laneIds.length} evidence lanes completed after bounded recovery`);

  // 3. Merge, deduplicate, and audit coverage against the source map.
  const reconcile = shouldRun("evidence-reconciler") ? await run(
    "evidence-reconciler",
    `${BASE} Read the fixed ${outputDir}/source_map.json, ${outputDir}/extraction_plan.json, ${outputDir}/ocr_plan.json, and every planned ${outputDir}/evidence/<lane-id>.json plus lane checkpoint; prior child-agent references are not durable and must not be required. Merge validated lane files into canonical ${outputDir}/evidence_inventory.json and write ${outputDir}/coverage_audit.json. Use one stable inventory shape from contracts.md. Deduplicate facts but preserve per-row/per-feature and per-observation quantitative detail, including dates/categories, units, ranges, groups, thresholds, missingness, and evidence references. For every source-map region record extracted, intentionally deferred with a value-based reason, or missing. Record OCR-derived evidence with page, image path, confidence, and transcription limitations. Classify candidates for map, 3D/profile, chart/table, narrative, and report. Reopen source regions only to resolve material conflicts or omissions. Return complete only when each planned lane artifact is valid and all high-value assigned work is complete or explicitly unreadable. Return complete/evidence/unresolved plus inventory_path, coverage_path, evidence_count, render_candidate_count, and deferred_count.`,
    schema({ inventory_path: path, coverage_path: path, evidence_count: { type: "integer" }, render_candidate_count: { type: "integer" }, deferred_count: { type: "integer" } })
  ) : reused({ inventory_path: `${outputDir}/evidence_inventory.json`, coverage_path: `${outputDir}/coverage_audit.json`, evidence_count: 0, render_candidate_count: 0, deferred_count: 0 });
  if (!reconcile.ok) return await partial("evidence-reconciler", "evidence reconciliation or source coverage audit failed");

  // 4. Build science first, maximizing the UI vocabulary rather than only map points.
  const render = shouldRun("rendering-author") ? await run(
    "rendering-author",
    `${BASE} Read the fixed ${outputDir}/evidence_inventory.json and ${outputDir}/coverage_audit.json; never depend on a prior child-agent reference. Read the rendering contract in ui-output-contracts.json and the relevant expectations in ui/src/core/AgenticStudyAdapter.ts before writing. Build ${outputDir}/rendering_package.json directly as valid study-rendering.v2; do not use draft aliases for a later compiler to guess. Maximize useful UI objects: map features, vertical profiles, intervals, observations, structured tables, chart-ready series, figure panels, proposed-vs-observed layers, and confidence styling. Emit every worthwhile quantitative presentation in rendering_package.chart_series using the exact generic chart_series and point fields in ui-output-contracts.json. Choose the kind from the evidence, not from a fixed domain template; keep numeric y/range/threshold values numeric, preserve missingness and units, and link points to features, observations or datasets when applicable. Preserve source-backed geometry as candidate evidence even when it may only support aggregate coverage. Keep suspect outliers quarantined individually, not by excluding an entire table. Include feature-analysis targets for candidate objects; a later evidence-value decision determines which points become interactive. Validate the written JSON and contract fields before returning. Return complete/evidence/unresolved plus rendering_path, mapped_count, profile_count, resource_count, and visible_object_count.`,
    schema({ rendering_path: path, mapped_count: { type: "integer" }, profile_count: { type: "integer" }, resource_count: { type: "integer" }, visible_object_count: { type: "integer" } })
  ) : reused({ rendering_path: `${outputDir}/rendering_package.json`, mapped_count: 0, profile_count: 0, resource_count: 0, visible_object_count: 0 });
  if (!render.ok) return await partial("rendering-author", "scientific rendering package was not produced");

  // 5. Wonder acts as visual director before narratives are written.
  const expansionSchema = schema({ audit_path: path, newly_added_count: { type: "integer" }, final_visible_object_count: { type: "integer" }, final_mapped_count: { type: "integer" } });
  const expansionInput = `${BASE} Act as the visual director. Read ${map.data.source_map_path}, ${reconcile.data.inventory_path}, ${reconcile.data.coverage_path}, ${render.data.rendering_path}, source visual assets, the rendering contract in ui-output-contracts.json, and relevant adapter expectations. Treat Spark's rendering as a strong draft, not a fixed answer. Ask for every table, coordinate row, figure, profile, range, proposal, and comparison: can it become a compelling map object, depth view, chart/table resource, filter, callout, timeline, comparison, or visual panel with honest confidence labelling? Inspect quantitative evidence specifically: ensure useful numeric dimensions are represented by exact-contract chart_series and structured resources, select presentation kinds from their semantics, and preserve numeric values, units, dates/categories, ranges, groups, thresholds, missingness, object links, and evidence references. Improve visual hierarchy, layer organization, presentation roles, display priorities, default visibility, and the default story without hiding useful minority evidence. Add worthwhile derived or contextual views with clear labels; remove clutter or downgrade weak objects locally. Use the source cache first and reopen the source only for ambiguity. Expand rendering_package.json in place while preserving exact study-rendering.v2 fields and types. Write ${outputDir}/renderability_audit.json, including additions, presentation decisions, deferred opportunities, and remaining limitations. Validate the expanded rendering JSON before returning. Return complete/evidence/unresolved plus audit_path, newly_added_count, final_visible_object_count, and final_mapped_count.`;
  let expand = shouldRun("visual-director") ? await run("wonder-visual-director", expansionInput, expansionSchema, WONDER) : reused({ audit_path: `${outputDir}/renderability_audit.json`, newly_added_count: 0, final_visible_object_count: 0, final_mapped_count: 0 });
  let renderingFinalizedBy = shouldRun("visual-director") ? "wonder" : "reused";
  if (shouldRun("visual-director") && !expand.ok) {
    renderingFinalizedBy = "spark-fallback";
    expand = await run("spark-visual-director", `${expansionInput} Wonder was unavailable or failed to return a usable result. Complete the same visual-direction pass with Spark and reuse any valid work already written.`, expansionSchema, SPARK);
  }
  if (!expand.ok) return await partial("visual-director", "renderability expansion and visual direction did not complete");

  // 6. One Spark author writes the complete human experience in final schemas.
  const author = shouldRun("spark-integrated-author") ? await run(
    "spark-integrated-author",
    `${BASE} Read ${reconcile.data.inventory_path}, ${render.data.rendering_path}, ${expand.data.audit_path}, the narrative/report contracts in ui-output-contracts.json, and the relevant expectations in ui/src/core/AgenticStudyAdapter.ts. Write ${outputDir}/narrative_package.json directly as ui-narrative.v3 and ${outputDir}/report.json directly as document-analysis.v1. For each feature target, decide whether the document contains a meaningful finding about that exact object. If yes, write one evidence-backed analysis in language an absolute beginner can understand; explain necessary terms naturally and use as much or as little text as the evidence warrants. If the material is only a name, coordinate, identifier, table position, list membership, shared dataset conclusion, or missing-data statement, write analysis as an empty string. Never pad an empty result, repeat layer-level context, or manufacture point-specific uniqueness. Empty analysis is expected and makes the point non-interactive while preserving its geometry for aggregate coverage. Keep measurements structured in observations and mention only those that clarify the meaning. For the report, preserve the required identity fields, then write only the ordered blocks the document genuinely supports. Each block may have a short factual headline, clear Markdown content, compact evidence-backed metrics, and related UI object IDs; omit every empty or low-value field, metric group, and block. Do not force themes, chapters, findings, caveats, or metrics. Then self-check grounding, beginner comprehension, non-empty analyses for object-specific value, empty-analysis correctness, cross-package IDs/links, and exact fields/types. Repair obvious issues before returning and write ${outputDir}/authoring_selfcheck.json. Validate both JSON files. Return complete/evidence/unresolved plus narrative_path, report_path, selfcheck_path, insight_count, finding_count, warning_count.`,
    schema({ narrative_path: path, report_path: path, selfcheck_path: path, insight_count: { type: "integer" }, finding_count: { type: "integer" }, warning_count: { type: "integer" } })
  ) : reused({ narrative_path: `${outputDir}/narrative_package.json`, report_path: `${outputDir}/report.json`, selfcheck_path: `${outputDir}/authoring_selfcheck.json`, insight_count: 0, finding_count: 0, warning_count: 0 });
  if (!author.ok) return await partial("spark-integrated-author", "integrated narrative and report authoring did not complete");

  // 7. One decisive Wonder pass owns the integrated final experience.
  const finalizationSchema = schema({ finalization_path: path, checkpoint_path: path, usable: { type: "boolean" }, blocking_issue_count: { type: "integer" }, warning_count: { type: "integer" }, changed_object_count: { type: "integer" }, newly_extracted_count: { type: "integer" } });
  const finalizationInput = `${BASE} Act as the independent integrated finalizer, not a passive reviewer. Read Spark's ${author.data.narrative_path}, ${author.data.report_path}, ${author.data.selfcheck_path}, all evidence/rendering/audit artifacts, ui-output-contracts.json, and the relevant expectations in ui/src/core/AgenticStudyAdapter.ts. Treat Spark's output as a strong draft, not truth. Independently challenge completeness, grounding, visual value, beginner comprehension, story coherence, cross-package references, and exact schemas. For every non-empty feature analysis, verify that it conveys meaningful evidence about that exact object rather than coordinates, identifiers, table rows, list membership, missing information, or shared layer conclusions. Clear the analysis when it fails that test; an empty result is preferable to filler and makes that point non-interactive. For document-analysis.v1, preserve the identity envelope but let the evidence determine the ordered blocks. Remove empty or generic blocks and unsupported metrics; do not force any topic, section count, caveat, or statistic. Produce the strongest coherent final experience in one decisive pass. You may edit evidence_inventory.json, coverage_audit.json, rendering_package.json, renderability_audit.json, narrative_package.json, report.json, and source-linked assets. Preserve correct useful evidence; recover material omissions; improve visual presentation; rewrite weak prose; and make rendering, analyses, and report tell one story. Use targeted source-cache regions for disputed claims or omissions. Never invent scientific measurements or source claims. Correct obvious local defects; otherwise simplify, limit, quarantine, or omit only the affected object. Do not sacrifice the package for an isolated issue. Validate study-rendering.v2, ui-narrative.v3, and document-analysis.v1 before returning. Write ${outputDir}/finalization_record.json and ${outputDir}/checkpoint.json with changes, remaining warnings, and any package-wide blocker. Return complete/evidence/unresolved plus finalization_path, checkpoint_path, usable, blocking_issue_count, warning_count, changed_object_count, and newly_extracted_count.`;
  let finalization = shouldRun("integrated-finalizer") ? await run("wonder-integrated-finalizer", finalizationInput, finalizationSchema, WONDER) : reused({ finalization_path: `${outputDir}/finalization_record.json`, checkpoint_path: `${outputDir}/checkpoint.json`, usable: true, blocking_issue_count: 0, warning_count: 0, changed_object_count: 0, newly_extracted_count: 0 });
  let finalizedBy = shouldRun("integrated-finalizer") ? "wonder" : "reused";
  if (shouldRun("integrated-finalizer") && !finalization.ok) {
    finalizedBy = "spark-fallback";
    finalization = await run("spark-integrated-finalizer", `${finalizationInput} Wonder was unavailable or failed to return a usable result. Complete the same integrated finalization with Spark; reuse any valid work already written.`, finalizationSchema, SPARK);
  }
  if (!finalization.ok || !finalization.data.usable || finalization.data.blocking_issue_count) return await partial("integrated-finalizer", "integrated finalization found a package-wide blocking issue");

  // 8. Verify and lightly normalize the exact consumer contract, then inspect
  // the adapted content rather than treating a non-throwing adapter as success.
  const compile = shouldRun("ui-contract-compiler") ? await run(
    "ui-contract-compiler",
    `${BASE} Read muse-document-processing/ui-output-contracts.json, ui/src/core/AgenticStudyAdapter.ts, and the finalized packages. These packages were already authored against the exact schemas: verify them and make only small mechanical normalizations such as types, optional defaults, or stale counts without rewriting scientific or narrative content. Run the real adapter/loader and inspect adapted content. Compare source and adapted quantitative content explicitly: every intended chart series and valid point must retain numeric values, dimensions, units, ranges, groups, thresholds, related-object links, and evidence references. Record source/adapted series and point counts plus every rejected or normalized item and reason; material loss is blocking, while an isolated defective point is repaired or omitted locally. In ui-narrative.v3, empty feature analysis is an intentional eligibility decision: confirm that the point is absent from interactive map/3D collections while its geometry remains available for aggregate coverage; do not count it as empty-content failure or create fallback prose. Repair obvious local contract defects; if one object cannot be repaired safely, omit or downgrade only that object and record a warning. Do not fail a rich package for an isolated fallback or empty optional field. Write ${outputDir}/contract_compilation.json. Return complete/evidence/unresolved plus compilation_path, usable, blocking_issue_count, warning_count, normalized_object_count, fallback_count, empty_content_count, adapter_diagnostic_count, source_series_count, adapted_series_count, source_point_count, adapted_point_count, and rejected_quantitative_count.`,
    schema({ compilation_path: path, usable: { type: "boolean" }, blocking_issue_count: { type: "integer" }, warning_count: { type: "integer" }, normalized_object_count: { type: "integer" }, fallback_count: { type: "integer" }, empty_content_count: { type: "integer" }, adapter_diagnostic_count: { type: "integer" }, source_series_count: { type: "integer" }, adapted_series_count: { type: "integer" }, source_point_count: { type: "integer" }, adapted_point_count: { type: "integer" }, rejected_quantitative_count: { type: "integer" } })
  ) : reused({ compilation_path: `${outputDir}/contract_compilation.json`, usable: true, blocking_issue_count: 0, warning_count: 0, normalized_object_count: 0, fallback_count: 0, empty_content_count: 0, adapter_diagnostic_count: 0, source_series_count: 0, adapted_series_count: 0, source_point_count: 0, adapted_point_count: 0, rejected_quantitative_count: 0 });
  if (!compile.ok || !compile.data.usable || compile.data.blocking_issue_count) {
    return await partial("ui-contract-compiler", "final package did not survive UI adaptation as a usable experience");
  }

  // 9. Assemble only after contract, UI-adapter, and coverage checks.
  const assemble = shouldRun("validate-and-assemble") ? await run(
    "validate-and-assemble",
    `${BASE} Validate exact schema versions and canonical evidence shape; references and counts; scientific copy preservation; map bounds; non-empty analysis for every interactive feature; exclusion of empty-analysis points from interactive map/3D collections while retaining their geometry for coverage; structured-resource accessibility; quantitative-series and point survival recorded by contract compilation; and warning vs hard-error separation. Run the real AgenticStudyAdapter/ScientificPackageLoader when available. Geometry-free packages must not inherit unrelated fallback geography. Material loss of intended quantitative series or points is a hard issue; an explicitly recorded isolated rejected point is a warning after local removal. Write ${outputDir}/grounding_selfcheck.json and ${outputDir}/study_package.json. valid=true means zero hard errors; warnings must be listed separately and status must remain complete_with_limitations when present. Return complete/evidence/unresolved plus study_path, selfcheck_path, valid, warning_count, and issue_count.`,
    schema({ study_path: path, selfcheck_path: path, valid: { type: "boolean" }, warning_count: { type: "integer" }, issue_count: { type: "integer" } })
  ) : reused({ study_path: `${outputDir}/study_package.json`, selfcheck_path: `${outputDir}/grounding_selfcheck.json`, valid: true, warning_count: 0, issue_count: 0 });
  if (!assemble.ok || !assemble.data.valid) return await partial("validate-and-assemble", "final verification did not produce a valid study package");

  const outputs = {
    source_map: map.data.source_map_path,
    source_cache: map.data.source_cache_path,
    extraction_plan: map.data.extraction_plan_path,
    ocr_plan: map.data.ocr_plan_path,
    document_shape: map.data.document_shape,
    lessons_loaded: map.data.lessons_loaded,
    evidence_inventory: reconcile.data.inventory_path,
    coverage_audit: reconcile.data.coverage_path,
    rendering_package: render.data.rendering_path,
    renderability_audit: expand.data.audit_path,
    rendering_finalized_by: renderingFinalizedBy,
    narrative_package: author.data.narrative_path,
    report: author.data.report_path,
    authoring_selfcheck: author.data.selfcheck_path,
    finalization_record: finalization.data.finalization_path,
    checkpoint: finalization.data.checkpoint_path,
    finalized_by: finalizedBy,
    contract_compilation: compile.data.compilation_path,
    grounding_selfcheck: assemble.ok ? assemble.data.selfcheck_path : null,
    study_package: assemble.ok ? assemble.data.study_path : null,
  };
  const warningCount = (author.data.warning_count || 0) + (finalization.data.warning_count || 0) + (compile.data.warning_count || 0) + (assemble.ok ? assemble.data.warning_count || 0 : 0);
  const status = warningCount === 0 ? "complete" : "complete_with_limitations";
  return finish({ status, resume, execution_mode: resume ? "resumed" : "regenerated", document, output_dir: outputDir, outputs, stages, unresolved: assemble.data.unresolved, notes, wonder_calls: wonderCalls, rendering_finalized_by: renderingFinalizedBy, finalized_by: finalizedBy, warning_count: warningCount, token_usage: aggregateTokenUsage(stages) });
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
