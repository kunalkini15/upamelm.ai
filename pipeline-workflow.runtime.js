// GENERATED FILE — do not edit directly.

// Run: node scripts/build-pipeline-workflow-runtime.mjs

// Muse workflow scripts reject imports, so stage modules are scoped and bundled here.

const ingestWorkflow = (() => {
/**
 * @file ingest-workflow.js
 * @module muse-source-ingestion/ingest-workflow
 * @description Autonomous municipal-scale source ingestion pipeline.
 * Discovers, downloads, validates, and indexes authoritative subsurface documents
 * (CGWB reports, NAQUIM yearbooks, EIA assessments) for a target city request.
 *
 * @workflow
 *   1. Scout & Strategy (Wonder) -> Resolves bounds, inventories local runs, and designs discovery lanes.
 *   2. Parallel Discovery (Spark) -> Executes web queries, retrieves files, and checks successors per lane.
 *   3. Draft Consolidation (Spark) -> Dedupes candidates, ranks authority/freshness, and drafts manifest.
 *   4. Strategic Review (Wonder) -> Independent senior critique of evidence gaps and selections.
 *   5. Repair & Final Verification (Spark) -> Re-validates files, checks SHA-256 hashes, and outputs manifest.
 *   6. Information-Value Ranking (Wonder) -> Ranks final documents and creates ordered access copies.
 *
 * @modelRouting
 *   - Spark: Parallel discovery, synthesis, file validation, and repair.
 *   - Wonder: Strategic planning, independent critique, and final information-value ranking. Max 3 calls.
 *
 * @param {Object} host - Muse workflow host context.
 * @param {string} host.args.request - Path to the city request specification JSON (e.g., requests/bengaluru.json).
 * @param {string} host.args.output_dir - Run output directory (e.g., runs/bengaluru-2025).
 * @param {boolean} [host.args.dry_run=false] - Reuse a compatible completed run.
 * @param {string} [host.args.runs_dir=muse-source-ingestion/runs] - Dry-run search root when output_dir is omitted.
 * @returns {Promise<Object>} Execution report containing status, manifest paths, and stage telemetry.
 */

const SPARK = "muse-spark-1.3-contributor";
const WONDER = "muse-wonder-1.0";
const MAX_WONDER_CALLS = 3;

async function workflow(host) {
  let args = host.args || {};
  if (typeof args === "string") {
    try { args = JSON.parse(args); } catch { args = {}; }
  }
  const request = args.request;
  const outputDir = args.output_dir;
  const dryRun = args.dry_run === true;
  if (!request || (!outputDir && !dryRun)) {
    const report = {
      status: "invalid_args",
      unresolved: ["args must include request and output_dir"],
      evidence: [],
      notes: [],
    };
    return { ...report, summary: JSON.stringify(report) };
  }

  const stageSchema = (extra) => ({
    type: "object",
    required: ["complete", "evidence", "unresolved", ...Object.keys(extra)],
    properties: {
      complete: { type: "boolean" },
      evidence: { type: "array", items: { type: "string" } },
      unresolved: { type: "array", items: { type: "string" } },
      ...extra,
    },
  });
  const pathProp = { type: "string" };

  if (dryRun) {
    const searchRoot = args.runs_dir || "muse-source-ingestion/runs";
    const result = await host.agent({
      label: "dry-run-resolver",
      model: SPARK,
      input: `Dry-run only: do not create, edit, copy, rename, download, or regenerate anything. Read ${request} completely. ${outputDir ? `First inspect the exact candidate run ${outputDir}; if that path does not exist, search direct run folders under ${searchRoot}. If it exists but is incompatible or incomplete, fail instead of silently substituting another run.` : `Search direct run folders under ${searchRoot}.`} Select the newest successfully completed ingestion run whose frozen request.json is semantically compatible with the supplied request (city/geography, research scope, source policy, and material guidance must match; ignore only run-output paths). Never select by folder name alone. Require and validate manifest.json, handoff.md, verification.md, document_ranking.json, document_ranking.md, ranked/, and run_summary.json; normally require run_summary status to start with complete. For a legacy run_summary that has no status field, accept it only when verification.md explicitly records every hard gate as passing, the manifest/ranking counts reconcile, and every ranked_local_path exists with its recorded checksum/size validation. Return complete=false rather than using a partial or mismatched run. Return paths only; perform no writes.`,
      schema: stageSchema({
        reused_from: pathProp,
        request_path: pathProp,
        request_sha256: pathProp,
        manifest_path: pathProp,
        handoff_path: pathProp,
        verification_path: pathProp,
        ranking_path: pathProp,
        ranking_markdown_path: pathProp,
        ranked_dir: pathProp,
        run_summary_path: pathProp,
        ranked_count: { type: "integer" },
        selected_count: { type: "integer" },
      }),
    });
    const data = result?.data;
    if (!result || result.error_kind || result.data_spilled_for_size || !data || data.complete !== true) {
      const report = { status: "partial", failed_stage: "dry-run-resolver", dry_run: true, request, output_dir: outputDir || null, unresolved: data?.unresolved || ["no compatible completed ingestion run found"], stages: [{ scope: "dry-run-resolver", ref: result?.ref || null, complete: false, model: SPARK, error_kind: result?.error_kind || "incomplete" }], notes: [] };
      return { ...report, summary: JSON.stringify(report) };
    }
    const outputs = { manifest: data.manifest_path, handoff: data.handoff_path, verification: data.verification_path, document_ranking: data.ranking_path, document_ranking_markdown: data.ranking_markdown_path, ranked_dir: data.ranked_dir, run_summary: data.run_summary_path, ranked_count: data.ranked_count, selected_count: data.selected_count };
    const report = { status: "complete_reused", dry_run: true, request, output_dir: data.reused_from, reused_from: data.reused_from, request_sha256: data.request_sha256, outputs, stages: [{ scope: "dry-run-resolver", ref: result.ref || null, complete: true, model: SPARK, error_kind: null }], unresolved: data.unresolved || [], notes: [] };
    return { ...report, summary: JSON.stringify(report) };
  }

  const brief = [
    `Ingest subsurface sources for the city in request file: ${request}.`,
    `Write outputs only under: ${outputDir}/.`,
    "First read muse-source-ingestion/WORKFLOW.md and muse-source-ingestion/contracts.md completely. If muse-source-ingestion/lessons/LESSONS.md exists, read it completely as supplemental guidance and never edit it during the run.",
    "Treat research_scope in the frozen request as authoritative: broad mode audits the wider subsurface landscape; focused mode searches and selects only included domains plus explicitly allowed direct supporting dependencies. Invocation wording cannot broaden the scope.",
    "Apply the request source_policy exactly. In ordinary mode, enforce its recent-observation window for current dynamic evidence and preserve uniquely valuable stable legacy evidence only after successor checks. If selection_window_mode is strict, reject every source older than selection_cutoff_date from acquisition, reuse, and selection regardless of evidence type; keep it only as a lead and search for an in-window successor. Remain open to every accepted format without demoting PDFs or imposing format quotas.",
    "Derive all geography, administrative units, publishers, domains, dates, gaps, and priorities from this request and live research; never inherit them from another request or prior run.",
    "Freeze the request as request.json first. Never invent coordinates, dates, coverage, or values.",
  ].join(" ");

  // Compact-return protocol: child payloads over ~4KB spill to durable storage
  // with no inline data, which the script cannot read back directly. Every stage
  // therefore returns paths and counts while full detail lives in run files.
  const COMPACT = [
    "Return-value protocol (hard): keep your entire returned JSON under ~3KB.",
    "Cap evidence and unresolved to 6 short strings each (each under 150 chars): file paths plus one-line facts only.",
    "Write every full listing, spec, table, and comparison to files under the run directory and return only paths and counts, never the full text.",
  ].join(" ");

  const stages = [];
  const notes = [];
  let wonderCalls = 0;
  const collectNotes = (result, scope) => {
    if (result && typeof result.notes === "string" && result.notes.trim()) {
      notes.push({ source: scope, ref: result.ref, value: result.notes });
    }
  };

  const runStage = async (scope, input, schema, model = SPARK) => {
    if (model === WONDER && wonderCalls >= MAX_WONDER_CALLS) {
      stages.push({ scope, ref: null, complete: false, model, error_kind: "wonder_call_limit_reached" });
      return { result: null, data: null, ok: false };
    }
    if (model === WONDER) wonderCalls += 1;
    let result;
    try {
      result = await host.agent({ input, schema, label: scope, model });
    } catch (_error) {
      stages.push({ scope, ref: null, complete: false, model, error_kind: "agent_exception" });
      return { result: null, data: null, ok: false };
    }
    collectNotes(result, scope);
    if (result && result.data_spilled_for_size === true && !result.error_kind) {
      notes.push({ source: scope, ref: result.ref, value: `large submission (${result.submitted_payload_bytes}B) spilled; distilling to compact form` });
      let distilled = null;
      try {
        distilled = await host.agent({
          input: `Prior result: ${result.ref}. Read that result's full data and return the SAME required fields in compact form: ${COMPACT} Do not redo research or write new artifacts.`,
          schema,
          label: `${scope}-distill`,
          model: SPARK,
        });
      } catch (_distillError) {
        distilled = null;
      }
      collectNotes(distilled, `${scope}-distill`);
      const distilledData = distilled && !distilled.error_kind && distilled.data_spilled_for_size !== true && distilled.data && typeof distilled.data === "object" ? distilled.data : null;
      if (distilledData) {
        result = distilled;
      } else {
        stages.push({ scope, ref: result.ref, complete: false, model, error_kind: "result_spilled_for_size" });
        return { result, data: null, ok: false };
      }
    }
    const failed = result === null || result.error_kind;
    const data = !failed && result.data && typeof result.data === "object" ? result.data : null;
    const ok = !failed && data && data.complete === true;
    stages.push({ scope, ref: result ? result.ref : null, complete: !!ok, model, error_kind: result ? result.error_kind || null : "null_result" });
    return { result, data, ok };
  };

  // 1. Wonder strategist: resolve geography, audit evidence, and design lanes.
  const scout = await runStage(
    "scout",
    `${brief} Steps 1-3 only: resolve the city and boundaries, inventory and validate held sources from muse-source-ingestion/runs/ only (current plus previous run dirs; nothing else), and write inventory.json, evidence_map.md, and lanes.json (one object per lane: id, objective, included_evidence_needs, supported_capabilities, exclusions, selection_reason, scope mapping, recent-observation cutoff, useful native formats, completion evidence). Apply research_scope before gap analysis: broad mode audits the wider subsurface landscape; focused mode designs the smallest coherent set of lanes covering only include_domains and never creates general lanes for excluded or merely contextual domains. A supporting-evidence item is allowed only with its direct dependency on an included capability stated. Prior holdings outside scope are cache/inventory only and cannot suppress discovery. Treat evidence_gaps as priorities inside scope. Do not assign search, fetch, download, byte, model-call, time, or package-count budgets; source quality and evidence saturation govern the work. Return complete/evidence/unresolved plus inventory_path, evidence_map_path, lanes_path, and lane_ids (short ids matching lanes.json). ${COMPACT}`,
    stageSchema({ inventory_path: pathProp, evidence_map_path: pathProp, lessons_loaded: { type: "boolean" }, lanes_path: pathProp, lane_ids: { type: "array", items: { type: "string" } } }),
    WONDER
  );
  if (!scout.ok) {
    const report = { status: "partial", failed_stage: "scout", stages, unresolved: ["scout did not complete; no inventory or lane plan"], notes, wonder_calls: wonderCalls };
    return { ...report, summary: JSON.stringify(report) };
  }

  // 2. Discovery lanes in parallel, one dir each.
  const laneIds = scout.data.lane_ids || [];
  const laneSchema = stageSchema({ lane_dir: pathProp, download_count: { type: "number" }, usage_path: pathProp });
  const laneInputs = laneIds.map((rawId) => {
    const id = String(rawId).trim().replace(/[^a-z0-9-]+/gi, "-").toLowerCase() || "lane";
    return {
      input: `${brief} ${COMPACT} Prior scout result: ${scout.result.ref}. Read your full lane spec (lane "${id}") from ${scout.data.lanes_path} and run that discovery lane only. Do not expand beyond its mapping to research_scope. Follow WORKFLOW.md steps 4-5 inside ${outputDir}/lanes/${id}/: candidates.json, excerpts.md, validation.json, trace.jsonl, usage.json, downloads/. Perform live web searches and do not rely on model knowledge for source availability, URLs, dates, publishers, or contents. Reject out-of-scope candidates unless they are direct permitted supporting evidence and record the included domain they support. Begin with the mandatory current-baseline check: find the newest authoritative citywide, metropolitan, or closest-available source, search for successor editions and updated datasets, and record the check. Apply the request's freshness mode exactly: a strict cutoff excludes older sources from download, reuse, and selection; otherwise older dynamic or stable evidence follows the configured exception policy. Perform and record a native-format sweep across applicable CSV/TSV, spreadsheets, JSON/GeoJSON, KML/KMZ, shapefile/GeoPackage/spatial archives, rasters/GeoTIFF, APIs, repository attachments, and PDF companions. PDFs remain fully eligible; never choose a weaker asset for format variety. Validate every acquired asset according to its format. Continue until the lane's material leads are resolved, inaccessible with recorded reasons, or further query refinement yields no materially better or complementary source. Counts in usage.json are observability only and must never be used as stopping limits. Return complete/evidence/unresolved plus lane_dir, download_count, and usage_path. Candidate lists, traces, format_sweep, and telemetry stay in the lane files, never in the returned JSON.`,
      schema: laneSchema,
      label: `lane-${id}`,
      model: SPARK,
    };
  });
  const laneResults = laneInputs.length ? await host.parallel(laneInputs) : [];
  const spilledLanes = [];
  laneResults.forEach((result, i) => {
    if (result && result.data_spilled_for_size === true && !result.error_kind) spilledLanes.push(i);
  });
  if (spilledLanes.length) {
    const distills = await host.parallel(spilledLanes.map((i) => ({
      input: `Prior result: ${laneResults[i].ref}. Read that result's full data and return the SAME required fields in compact form: ${COMPACT} Do not redo research or write new artifacts.`,
      schema: laneSchema,
      label: `${laneInputs[i].label}-distill`,
      model: SPARK,
    })));
    distills.forEach((distilled, k) => {
      const i = spilledLanes[k];
      collectNotes(distilled, `${laneInputs[i].label}-distill`);
      const distilledData = distilled && !distilled.error_kind && distilled.data_spilled_for_size !== true && distilled.data && typeof distilled.data === "object" ? distilled.data : null;
      if (distilledData) {
        laneResults[i] = distilled;
      } else {
        laneResults[i] = { ref: laneResults[i].ref, data: null, error_kind: "result_spilled_for_size" };
      }
    });
  }
  const liveLanes = [];
  laneResults.forEach((result, i) => {
    const scope = laneInputs[i].label;
    collectNotes(result, scope);
    const failed = result === null || result.error_kind;
    const data = !failed && result.data && typeof result.data === "object" ? result.data : null;
    const ok = !failed && data && data.complete === true;
    stages.push({ scope, ref: result ? result.ref : null, complete: !!ok, model: SPARK, error_kind: result ? result.error_kind || null : "null_result" });
    if (ok) liveLanes.push(result.ref);
  });
  if (!liveLanes.length) {
    const report = { status: "partial", failed_stage: "lanes", stages, unresolved: ["no discovery lane completed"], notes, wonder_calls: wonderCalls };
    return { ...report, summary: JSON.stringify(report) };
  }

  // 3. Spark synthesizer: produce a compact draft for independent review.
  const consolidate = await runStage(
    "consolidate",
    `${brief} Prior results: ${scout.result.ref} ${liveLanes.join(" ")}. Steps 6-7 only: enforce research_scope and source_policy as hard selection gates, then dedupe across lanes by URL/checksum/identity and rank eligible candidates using type-aware freshness, geographic coverage, authority, renderable scientific content, native usability, and unique value. Reject out-of-scope holdings and candidates; allow supporting evidence only when its direct dependency on an included domain is recorded. In strict-window mode, reject every source older than selection_cutoff_date; do not reuse it or retain it as a historical/stable package. In ordinary mode, apply the configured dynamic and stable exceptions. Select every validated eligible package that makes a material, non-redundant contribution to the requested focused or broad experience; use judgment rather than a fixed package count, and never add filler. PDFs and non-PDFs compete on evidence value, not format; keep useful native companions and report selected/rejected format distribution without quotas. Prefer current authoritative citywide or closest-available anchors followed by complementary detailed sources. Write draft/manifest.json, draft/comparison.md, draft/handoff.md, and draft/run_summary.json, including scope exclusions and supporting-dependency dispositions. Keep the draft compact but evidence-linked so a reviewer need not repeat discovery. The selected package list lives in draft/manifest.json. Return complete/evidence/unresolved plus manifest_path, handoff_path, and selected_count. ${COMPACT}`,
    stageSchema({ manifest_path: pathProp, handoff_path: pathProp, selected_count: { type: "number" } })
  );

  if (!consolidate.ok) {
    const report = { status: "partial", failed_stage: "consolidate", stages, unresolved: ["draft consolidation did not complete"], notes, wonder_calls: wonderCalls };
    return { ...report, summary: JSON.stringify(report) };
  }

  // 4. Wonder reviewer: challenge strategy and selection without redoing tool work.
  const review = await runStage(
    "strategic-review",
    `${brief} Act as a read-only senior subsurface research reviewer. Read the request, inventory, evidence map, lane outputs, and the four files under ${outputDir}/draft/. Do not search, download, edit, consolidate, rerun validation, or edit lessons. First audit scope compliance: in focused mode, every lane and selection must map to an included domain or an explicit direct supporting dependency, and out-of-scope prior holdings must not suppress discovery or enter the manifest. Then test whether focused-domain coverage is complete, the baseline/successor checks are credible, the configured freshness window was enforced for current dynamic evidence, older stable or historical evidence has a valid role, every lane completed a credible native-format sweep, geographic claims match their denominator, selected packages have high marginal and visual value, PDFs were neither privileged nor demoted, strong discovered sources were not deferred for arbitrary counters, and unresolved gaps are honestly represented. Write ${outputDir}/review.json with approved, concise must_fix items, risks, and evidence references. Distinguish required fixes from optional improvements. Return complete/evidence/unresolved plus approved, review_path, must_fix (short titles only, at most 6 under 120 chars each; full detail stays in review.json), and risk_count. ${COMPACT}`,
    stageSchema({ approved: { type: "boolean" }, must_fix: { type: "array", items: { type: "string" } }, risk_count: { type: "number" }, review_path: pathProp }),
    WONDER
  );

  // 5. Spark repair/finalizer: resolve review findings and verify final artifacts.
  const reviewInstruction = review.ok
    ? `Read ${review.data.review_path}; address every must_fix item and explicitly disposition each risk.`
    : "The independent Wonder review was unavailable. Re-audit the draft against every WORKFLOW.md self-check and record this degraded condition.";
  const finalize = await runStage(
    "repair-and-finalize",
    `${brief} Prior scout: ${scout.result.ref}. Prior lanes: ${liveLanes.join(" ")}. Draft synthesis: ${consolidate.result.ref}. ${reviewInstruction} Act as the Spark repair and final-verification agent. Continue with additional in-scope searches, fetches, downloads, or validation whenever needed to resolve a material review finding, replace stale current-state evidence, obtain a clearly stronger source, or complete a missing native-format sweep. Do not broaden a focused request. Stop on in-scope evidence saturation or documented external unavailability, never because an arbitrary activity counter was reached. Produce the final root manifest.json, comparison.md, handoff.md, and run_summary.json. Record scope compliance and exclusions, direct supporting dependencies, whether the lessons file was loaded, the freshness-policy disposition of every older selection, and selected/rejected media-type distributions, but never edit the lessons file. Then execute the complete WORKFLOW.md self-check using available tools: confirm every lane and selected source is in scope, reopen selected files, recompute sha256 and sizes, perform format-appropriate validation, validate recorded counts, reconcile activity telemetry, and confirm required paths and schema fields. Write verification.md with pass/fail evidence and unresolved items. Return complete=true only if the final artifacts exist and all hard gates pass; unresolved in-scope research gaps may remain when honestly reported. The selected package list lives in the final manifest.json. Return complete/evidence/unresolved plus manifest_path, handoff_path, verification_path, and selected_count. ${COMPACT}`,
    stageSchema({ manifest_path: pathProp, handoff_path: pathProp, verification_path: pathProp, selected_count: { type: "number" } })
  );

  // 6. Wonder ranker: order the final validated documents for downstream top-N use.
  // Canonical downloads and manifest paths remain untouched; ordered copies are
  // an access layer and therefore cannot invalidate source hashes or provenance.
  const ranking = finalize.ok ? await runStage(
    "information-value-ranking",
    `${brief} Final manifest: ${finalize.data.manifest_path}. Final handoff: ${finalize.data.handoff_path}. Act as the Wonder information-value ranker. Rank every final selected source by how much useful understanding it can contribute to the requested study, not by file size, page count, format, or publisher prestige alone. Use the final manifest, handoff, comparison, lane excerpts, and validation summaries first; inspect only a document's title page, abstract/executive summary, table of contents, key tables/figures, or equivalent high-signal portions when those artifacts are insufficient. Do not reread or summarize every page, browse, download, change selections, or edit canonical files. Apply a generic evidence rubric: requested-scope relevance; density and specificity of usable measurements; vertical/depth and spatial detail where applicable; geographic coverage with its true denominator; explanatory and visual value for users; downstream extractability; authority/freshness; and unique contribution versus other selected sources. Do not reward verbosity, duplicate coverage, or PDFs as a format. Write ${outputDir}/document_ranking.json with rubric_version, ranked_count, and ranked_documents[] containing rank, source_id, original_local_path, ranked_local_path, information_value_score (0-100), criterion_scores, concise rationale, key_information, limitations, and recommended_use. Create ${outputDir}/ranked/ and place a byte-identical copy of every selected source there named with a zero-padded rank prefix, for example 01__<original-filename>; never rename, move, or modify the canonical download. Recompute each ranked copy's hash and confirm it matches the canonical source. Also write ${outputDir}/document_ranking.md as a concise human-readable table. Ties must be broken by unique downstream contribution, then scope relevance. Return complete/evidence/unresolved plus ranking_path, ranking_markdown_path, ranked_dir, and ranked_count. ${COMPACT}`,
    stageSchema({ ranking_path: pathProp, ranking_markdown_path: pathProp, ranked_dir: pathProp, ranked_count: { type: "number" } }),
    WONDER
  ) : { ok: false, data: null };

  const outputs = {
    inventory: scout.data.inventory_path,
    evidence_map: scout.data.evidence_map_path,
    lanes: scout.data.lanes_path,
    lane_ids: scout.data.lane_ids,
    lessons_loaded: scout.data.lessons_loaded,
    review: review.ok ? review.data.review_path : null,
    manifest: finalize.ok ? finalize.data.manifest_path : null,
    handoff: finalize.ok ? finalize.data.handoff_path : null,
    verification: finalize.ok ? finalize.data.verification_path : null,
    document_ranking: ranking.ok ? ranking.data.ranking_path : null,
    document_ranking_markdown: ranking.ok ? ranking.data.ranking_markdown_path : null,
    ranked_dir: ranking.ok ? ranking.data.ranked_dir : null,
    ranked_count: ranking.ok ? ranking.data.ranked_count : 0,
    selected_count: finalize.ok ? finalize.data.selected_count : 0,
  };
  const unresolved = [
    ...(review.ok ? review.data.unresolved : ["independent Wonder review did not complete"]),
    ...(finalize.ok ? finalize.data.unresolved : ["repair and final verification did not complete"]),
    ...(finalize.ok && !ranking.ok ? ["Wonder information-value ranking did not complete"] : ranking.ok ? ranking.data.unresolved : []),
  ];
  const report = {
    status: finalize.ok && review.ok && ranking.ok ? "complete" : "partial",
    request,
    output_dir: outputDir,
    outputs,
    stages,
    unresolved,
    notes,
    wonder_calls: wonderCalls,
  };
  return { ...report, summary: JSON.stringify(report) };
}

return workflow;
})();

const studyWorkflow = (() => {
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
 * @param {string} [host.args.runs_dir=muse-document-processing/runs] - Dry-run search root when output_dir is omitted.
 * @returns {Promise<Object>} Execution report containing status, artifact paths, and token telemetry.
 */
const SPARK = "muse-spark-1.3-contributor";
const WONDER = "muse-wonder-1.0";
const MAX_WONDER_CALLS = 2;

async function workflow(host) {
  let args = host.args || {};
  if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = {}; } }
  const document = args.document;
  const outputDir = args.output_dir;
  const dryRun = args.dry_run === true;
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
    "If the requested output artifact already exists, validate and reuse it when it matches the current source and upstream artifacts; regenerate only when missing, invalid, stale, or affected by an upstream change.",
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
    return finish({ status: "partial", failed_stage: stage, document, output_dir: outputDir, stages, unresolved: [message], notes, wonder_calls: wonderCalls, token_usage: aggregateTokenUsage(stages) });
  }

  // 1. Map the whole source before extracting. This prevents early-page bias.
  const map = await run(
    "source-cartographer",
    `${BASE} Pass 1 is structural mapping, never row-level scientific extraction. Inspect the complete source once, including every page/sheet, table, figure, legend, appendix, and attachment, and classify document_shape as narrative, mixed, tabular_annex, or dataset. Create a lightweight reusable cache under ${outputDir}/source-cache/: machine page text or a searchable text index, representative/required page images, table-of-contents and asset index. For repeated multi-page tables or a tabular_annex/dataset, read the contents, column headers, first/last and representative pages only to identify table schemas, page ranges, geographic coverage, parameter groups, and extraction methods. Do NOT parse every row, create full scientific CSVs, compute maxima/counts, validate thousands of cells, or perform geographic filtering in this stage; assign that work to parallel extraction lanes. Record large_table_ranges in the source map and source cache with extraction_status=planned. For narrative/mixed documents, still map every region, but leave evidence extraction to lanes. Detect pages/regions with missing, sparse, or garbled machine text. Write ${outputDir}/ocr_plan.json with one entry per affected page/range: source region, content hint, estimated evidence/UI value, decision (ocr|skip), reason, assigned Spark lane, image path, status (pending|skipped), and expected output. Choose ocr whenever content may materially affect science, rendering, narrative, report, or completeness; skip only when incremental value is low and state why. Render only representative visual assets and pages required for OCR at mapping time; lanes render other pages on demand. Write ${outputDir}/source_map.json, ${outputDir}/source_cache.json, and ${outputDir}/extraction_plan.json. Design the smallest complementary set of 2-6 extraction lanes actually needed; for large tabular sources, partition parameter/table ranges across lanes and have lanes extract relevant study-scope rows first, broader context second, without silently discarding the remainder. Each lane spec needs id, objective, assigned_regions/table ranges, required_assets including assigned OCR pages, exclusions, and completion evidence. Return complete/evidence/unresolved plus source_map_path, source_cache_path, extraction_plan_path, ocr_plan_path, document_shape, lane_ids, page_count, region_count, large_table_range_count, and ocr_required_page_count.`,
    schema({ source_map_path: path, source_cache_path: path, extraction_plan_path: path, ocr_plan_path: path, document_shape: { type: "string", enum: ["narrative", "mixed", "tabular_annex", "dataset"] }, lessons_loaded: { type: "boolean" }, lane_ids: { type: "array", items: { type: "string" } }, page_count: { type: "integer" }, region_count: { type: "integer" }, large_table_range_count: { type: "integer" }, ocr_required_page_count: { type: "integer" } })
  );
  if (!map.ok) return partial("source-cartographer", "complete-source map was not produced");

  // 2. Document-specific lanes use the shared cache instead of rereading all pages.
  const laneIds = (map.data.lane_ids || []).map((id) => String(id).trim().replace(/[^a-z0-9-]+/gi, "-").toLowerCase()).filter(Boolean);
  if (laneIds.length < 2 || laneIds.length > 6) return partial("source-cartographer", "extraction plan must define 2-6 document-specific lanes");
  const laneSchema = schema({ evidence_path: path, asset_index_path: path, item_count: { type: "integer" }, candidate_count: { type: "integer" }, ocr_completed_page_count: { type: "integer" } });
  const laneInputs = laneIds.map((id) => ({
    input: `${BASE} Read the lane "${id}" from ${map.data.extraction_plan_path}, the source map, ${map.data.source_cache_path}, and ${map.data.ocr_plan_path}. Run only that lane and assigned regions/table ranges. Use cached text/indexes first; parse assigned rows and render assigned pages on demand. For tabular annexes/datasets, write durable structured tables under ${outputDir}/resources/; validate headers, row counts, coordinates, units, and representative boundary rows. Preserve quantitative records at observation grain: subject/location, parameter, date or category, numeric value, unit, range or uncertainty, status, and source reference. Keep missing values missing; never interpolate them, turn them into zero, or merge incompatible parameters or units. Extract rows relevant to the study scope first, then retain broader aggregates or indexed resources when useful; never turn thousands of homogeneous rows into thousands of prose facts. For each assigned ocr entry, visually read the rendered page image with Spark, transcribe only relevant text/tables into ${outputDir}/source-cache/ocr/, preserve layout and page references, mark uncertain cells, and perform a second visual comparison for names, coordinates, units, and measurements. Update that ocr_plan entry to completed with output paths and confidence. Do not OCR skipped entries. Write ${outputDir}/evidence/${id}.json and ${outputDir}/evidence/${id}-assets.json. Continue until lane completion evidence is met, every assigned required OCR entry is completed or documented unreadable, and no material new UI evidence appears. Return complete/evidence/unresolved plus evidence_path, asset_index_path, item_count, candidate_count, and ocr_completed_page_count.`,
    schema: laneSchema,
    label: `extract-${id}`,
    model: SPARK,
  }));
  let laneResults;
  try { laneResults = await host.parallel(laneInputs); } catch { laneResults = []; }
  const liveLanes = [];
  laneResults.forEach((result, index) => {
    const scope = laneInputs[index].label;
    const failed = !result || result.error_kind || result.data_spilled_for_size || !result.data || result.data.complete !== true;
    stages.push({ scope, ref: result?.ref || null, complete: !failed, model: SPARK, error_kind: failed ? result?.error_kind || (result?.data_spilled_for_size ? "result_spilled_for_size" : "incomplete") : null, token_usage: readTokenUsage(result) });
    if (!failed) liveLanes.push(result);
  });
  if (liveLanes.length !== laneIds.length) return partial("parallel-extraction", `only ${liveLanes.length}/${laneIds.length} evidence lanes completed`);

  // 3. Merge, deduplicate, and audit coverage against the source map.
  const reconcile = await run(
    "evidence-reconciler",
    `${BASE} Source map: ${map.result.ref}. Extraction lanes: ${liveLanes.map((r) => r.ref).join(" ")}. Read ${map.data.ocr_plan_path}; no material ocr decision may remain pending, and 'needs OCR' is not a valid deferral when the gate selected ocr. Merge all lane files into canonical ${outputDir}/evidence_inventory.json and write ${outputDir}/coverage_audit.json. Use one stable inventory shape from contracts.md. Deduplicate facts but preserve per-row/per-feature and per-observation quantitative detail, including dates/categories, units, ranges, groups, thresholds, missingness, and evidence references. For every source-map region record extracted, intentionally deferred with a value-based reason, or missing. Record OCR-derived evidence with page, image path, confidence, and transcription limitations. Classify candidates for map, 3D/profile, chart/table, narrative, and report. Reopen source regions to resolve lane conflicts. Return complete only when no high-value region or required OCR entry is unaccounted for. Return complete/evidence/unresolved plus inventory_path, coverage_path, evidence_count, render_candidate_count, and deferred_count.`,
    schema({ inventory_path: path, coverage_path: path, evidence_count: { type: "integer" }, render_candidate_count: { type: "integer" }, deferred_count: { type: "integer" } })
  );
  if (!reconcile.ok) return partial("evidence-reconciler", "evidence reconciliation or source coverage audit failed");

  // 4. Build science first, maximizing the UI vocabulary rather than only map points.
  const render = await run(
    "rendering-author",
    `${BASE} Evidence: ${reconcile.result.ref}. Read the rendering contract in ui-output-contracts.json and the relevant expectations in ui-v2/src/core/AgenticStudyAdapter.ts before writing. Build ${outputDir}/rendering_package.json directly as valid study-rendering.v2; do not use draft aliases for a later compiler to guess. Maximize useful UI objects: map features, vertical profiles, intervals, observations, structured tables, chart-ready series, figure panels, proposed-vs-observed layers, and confidence styling. Emit every worthwhile quantitative presentation in rendering_package.chart_series using the exact generic chart_series and point fields in ui-output-contracts.json. Choose the kind from the evidence, not from a fixed domain template; keep numeric y/range/threshold values numeric, preserve missingness and units, and link points to features, observations or datasets when applicable. Preserve source-backed geometry as candidate evidence even when it may only support aggregate coverage. Keep suspect outliers quarantined individually, not by excluding an entire table. Include feature-analysis targets for candidate objects; a later evidence-value decision determines which points become interactive. Validate the written JSON and contract fields before returning. Return complete/evidence/unresolved plus rendering_path, mapped_count, profile_count, resource_count, and visible_object_count.`,
    schema({ rendering_path: path, mapped_count: { type: "integer" }, profile_count: { type: "integer" }, resource_count: { type: "integer" }, visible_object_count: { type: "integer" } })
  );
  if (!render.ok) return partial("rendering-author", "scientific rendering package was not produced");

  // 5. Wonder acts as visual director before narratives are written.
  const expansionSchema = schema({ audit_path: path, newly_added_count: { type: "integer" }, final_visible_object_count: { type: "integer" }, final_mapped_count: { type: "integer" } });
  const expansionInput = `${BASE} Act as the visual director. Read ${map.data.source_map_path}, ${reconcile.data.inventory_path}, ${reconcile.data.coverage_path}, ${render.data.rendering_path}, source visual assets, the rendering contract in ui-output-contracts.json, and relevant adapter expectations. Treat Spark's rendering as a strong draft, not a fixed answer. Ask for every table, coordinate row, figure, profile, range, proposal, and comparison: can it become a compelling map object, depth view, chart/table resource, filter, callout, timeline, comparison, or visual panel with honest confidence labelling? Inspect quantitative evidence specifically: ensure useful numeric dimensions are represented by exact-contract chart_series and structured resources, select presentation kinds from their semantics, and preserve numeric values, units, dates/categories, ranges, groups, thresholds, missingness, object links, and evidence references. Improve visual hierarchy, layer organization, presentation roles, display priorities, default visibility, and the default story without hiding useful minority evidence. Add worthwhile derived or contextual views with clear labels; remove clutter or downgrade weak objects locally. Use the source cache first and reopen the source only for ambiguity. Expand rendering_package.json in place while preserving exact study-rendering.v2 fields and types. Write ${outputDir}/renderability_audit.json, including additions, presentation decisions, deferred opportunities, and remaining limitations. Validate the expanded rendering JSON before returning. Return complete/evidence/unresolved plus audit_path, newly_added_count, final_visible_object_count, and final_mapped_count.`;
  let expand = await run("wonder-visual-director", expansionInput, expansionSchema, WONDER);
  let renderingFinalizedBy = "wonder";
  if (!expand.ok) {
    renderingFinalizedBy = "spark-fallback";
    expand = await run("spark-visual-director", `${expansionInput} Wonder was unavailable or failed to return a usable result. Complete the same visual-direction pass with Spark and reuse any valid work already written.`, expansionSchema, SPARK);
  }
  if (!expand.ok) return partial("visual-director", "renderability expansion and visual direction did not complete");

  // 6. One Spark author writes the complete human experience in final schemas.
  const author = await run(
    "spark-integrated-author",
    `${BASE} Read ${reconcile.data.inventory_path}, ${render.data.rendering_path}, ${expand.data.audit_path}, the narrative/report contracts in ui-output-contracts.json, and the relevant expectations in ui-v2/src/core/AgenticStudyAdapter.ts. Write ${outputDir}/narrative_package.json directly as ui-narrative.v3 and ${outputDir}/report.json directly as document-analysis.v1. For each feature target, decide whether the document contains a meaningful finding about that exact object. If yes, write one evidence-backed analysis in language an absolute beginner can understand; explain necessary terms naturally and use as much or as little text as the evidence warrants. If the material is only a name, coordinate, identifier, table position, list membership, shared dataset conclusion, or missing-data statement, write analysis as an empty string. Never pad an empty result, repeat layer-level context, or manufacture point-specific uniqueness. Empty analysis is expected and makes the point non-interactive while preserving its geometry for aggregate coverage. Keep measurements structured in observations and mention only those that clarify the meaning. For the report, preserve the required identity fields, then write only the ordered blocks the document genuinely supports. Each block may have a short factual headline, clear Markdown content, compact evidence-backed metrics, and related UI object IDs; omit every empty or low-value field, metric group, and block. Do not force themes, chapters, findings, caveats, or metrics. Then self-check grounding, beginner comprehension, non-empty analyses for object-specific value, empty-analysis correctness, cross-package IDs/links, and exact fields/types. Repair obvious issues before returning and write ${outputDir}/authoring_selfcheck.json. Validate both JSON files. Return complete/evidence/unresolved plus narrative_path, report_path, selfcheck_path, insight_count, finding_count, warning_count.`,
    schema({ narrative_path: path, report_path: path, selfcheck_path: path, insight_count: { type: "integer" }, finding_count: { type: "integer" }, warning_count: { type: "integer" } })
  );
  if (!author.ok) return partial("spark-integrated-author", "integrated narrative and report authoring did not complete");

  // 7. One decisive Wonder pass owns the integrated final experience.
  const finalizationSchema = schema({ finalization_path: path, checkpoint_path: path, usable: { type: "boolean" }, blocking_issue_count: { type: "integer" }, warning_count: { type: "integer" }, changed_object_count: { type: "integer" }, newly_extracted_count: { type: "integer" } });
  const finalizationInput = `${BASE} Act as the independent integrated finalizer, not a passive reviewer. Read Spark's ${author.data.narrative_path}, ${author.data.report_path}, ${author.data.selfcheck_path}, all evidence/rendering/audit artifacts, ui-output-contracts.json, and the relevant expectations in ui-v2/src/core/AgenticStudyAdapter.ts. Treat Spark's output as a strong draft, not truth. Independently challenge completeness, grounding, visual value, beginner comprehension, story coherence, cross-package references, and exact schemas. For every non-empty feature analysis, verify that it conveys meaningful evidence about that exact object rather than coordinates, identifiers, table rows, list membership, missing information, or shared layer conclusions. Clear the analysis when it fails that test; an empty result is preferable to filler and makes that point non-interactive. For document-analysis.v1, preserve the identity envelope but let the evidence determine the ordered blocks. Remove empty or generic blocks and unsupported metrics; do not force any topic, section count, caveat, or statistic. Produce the strongest coherent final experience in one decisive pass. You may edit evidence_inventory.json, coverage_audit.json, rendering_package.json, renderability_audit.json, narrative_package.json, report.json, and source-linked assets. Preserve correct useful evidence; recover material omissions; improve visual presentation; rewrite weak prose; and make rendering, analyses, and report tell one story. Use targeted source-cache regions for disputed claims or omissions. Never invent scientific measurements or source claims. Correct obvious local defects; otherwise simplify, limit, quarantine, or omit only the affected object. Do not sacrifice the package for an isolated issue. Validate study-rendering.v2, ui-narrative.v3, and document-analysis.v1 before returning. Write ${outputDir}/finalization_record.json and ${outputDir}/checkpoint.json with changes, remaining warnings, and any package-wide blocker. Return complete/evidence/unresolved plus finalization_path, checkpoint_path, usable, blocking_issue_count, warning_count, changed_object_count, and newly_extracted_count.`;
  let finalization = await run("wonder-integrated-finalizer", finalizationInput, finalizationSchema, WONDER);
  let finalizedBy = "wonder";
  if (!finalization.ok) {
    finalizedBy = "spark-fallback";
    finalization = await run("spark-integrated-finalizer", `${finalizationInput} Wonder was unavailable or failed to return a usable result. Complete the same integrated finalization with Spark; reuse any valid work already written.`, finalizationSchema, SPARK);
  }
  if (!finalization.ok || !finalization.data.usable || finalization.data.blocking_issue_count) return partial("integrated-finalizer", "integrated finalization found a package-wide blocking issue");

  // 8. Verify and lightly normalize the exact consumer contract, then inspect
  // the adapted content rather than treating a non-throwing adapter as success.
  const compile = await run(
    "ui-contract-compiler",
    `${BASE} Read muse-document-processing/ui-output-contracts.json, ui-v2/src/core/AgenticStudyAdapter.ts, and the finalized packages. These packages were already authored against the exact schemas: verify them and make only small mechanical normalizations such as types, optional defaults, or stale counts without rewriting scientific or narrative content. Run the real adapter/loader and inspect adapted content. Compare source and adapted quantitative content explicitly: every intended chart series and valid point must retain numeric values, dimensions, units, ranges, groups, thresholds, related-object links, and evidence references. Record source/adapted series and point counts plus every rejected or normalized item and reason; material loss is blocking, while an isolated defective point is repaired or omitted locally. In ui-narrative.v3, empty feature analysis is an intentional eligibility decision: confirm that the point is absent from interactive map/3D collections while its geometry remains available for aggregate coverage; do not count it as empty-content failure or create fallback prose. Repair obvious local contract defects; if one object cannot be repaired safely, omit or downgrade only that object and record a warning. Do not fail a rich package for an isolated fallback or empty optional field. Write ${outputDir}/contract_compilation.json. Return complete/evidence/unresolved plus compilation_path, usable, blocking_issue_count, warning_count, normalized_object_count, fallback_count, empty_content_count, adapter_diagnostic_count, source_series_count, adapted_series_count, source_point_count, adapted_point_count, and rejected_quantitative_count.`,
    schema({ compilation_path: path, usable: { type: "boolean" }, blocking_issue_count: { type: "integer" }, warning_count: { type: "integer" }, normalized_object_count: { type: "integer" }, fallback_count: { type: "integer" }, empty_content_count: { type: "integer" }, adapter_diagnostic_count: { type: "integer" }, source_series_count: { type: "integer" }, adapted_series_count: { type: "integer" }, source_point_count: { type: "integer" }, adapted_point_count: { type: "integer" }, rejected_quantitative_count: { type: "integer" } })
  );
  if (!compile.ok || !compile.data.usable || compile.data.blocking_issue_count) {
    return partial("ui-contract-compiler", "final package did not survive UI adaptation as a usable experience");
  }

  // 9. Assemble only after contract, UI-adapter, and coverage checks.
  const assemble = await run(
    "validate-and-assemble",
    `${BASE} Validate exact schema versions and canonical evidence shape; references and counts; scientific copy preservation; map bounds; non-empty analysis for every interactive feature; exclusion of empty-analysis points from interactive map/3D collections while retaining their geometry for coverage; structured-resource accessibility; quantitative-series and point survival recorded by contract compilation; and warning vs hard-error separation. Run the real AgenticStudyAdapter/ScientificPackageLoader when available. Geometry-free packages must not inherit unrelated fallback geography. Material loss of intended quantitative series or points is a hard issue; an explicitly recorded isolated rejected point is a warning after local removal. Write ${outputDir}/grounding_selfcheck.json and ${outputDir}/study_package.json. valid=true means zero hard errors; warnings must be listed separately and status must remain complete_with_limitations when present. Return complete/evidence/unresolved plus study_path, selfcheck_path, valid, warning_count, and issue_count.`,
    schema({ study_path: path, selfcheck_path: path, valid: { type: "boolean" }, warning_count: { type: "integer" }, issue_count: { type: "integer" } })
  );

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
  const status = assemble.ok && assemble.data.valid ? (warningCount === 0 ? "complete" : "complete_with_limitations") : "partial";
  return finish({ status, document, output_dir: outputDir, outputs, stages, unresolved: assemble.ok ? assemble.data.unresolved : ["final assembly failed"], notes, wonder_calls: wonderCalls, rendering_finalized_by: renderingFinalizedBy, finalized_by: finalizedBy, warning_count: warningCount, token_usage: aggregateTokenUsage(stages) });
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

return workflow;
})();

const translateWorkflow = (() => {
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
 * @param {string} [host.args.runs_dir=muse-translate/runs] - Dry-run search root when output_dir is omitted.
 * @returns {Promise<Object>} Execution report containing status, manifest paths, and stage telemetry.
 */
const SPARK = "muse-spark-1.3-contributor";

async function workflow(host) {
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

return workflow;
})();

/**
 * @file pipeline-workflow.js
 * @module subsurface/pipeline-workflow
 * @description Root end-to-end subsurface pipeline orchestrator.
 * Runs ingestion -> document-processing -> translation in order, with
 * ranked top-N fan-out and key-file promotion between stages.
 *
 * @workflow
 *   0. Plan (Spark) -> Freezes the pipeline request and normalizes config.
 *   1. Ingest (imported muse-source-ingestion runner) -> Manifest + ranked docs.
 *   2. Promote-ingestion (Spark) -> Selects top-N ranked docs, copies key
 *      ingestion files into pipeline_dir/ingestion/.
 *   3. Study fan-out (imported muse-document-processing runner, sequential or
 *      parallel) -> One study package per selected document.
 *   4. Promote-studies (Spark) -> Copies each study_package/narrative/report
 *      into pipeline_dir/studies/<doc-id>/.
 *   5. Translate fan-out (imported muse-translate runner, sequential or
 *      parallel) -> Per-language copies per completed study.
 *   6. Promote-translations (Spark) -> Copies every language package into both
 *      pipeline_dir/studies/<doc-id>/ (canonical UI-serving folder) and
 *      pipeline_dir/translations/<doc-id>/ (translation-stage mirror), then
 *      writes pipeline_summary.json.
 *
 * @controlFlow Deterministic sequencing with adaptive fan-out. Stage order,
 *   handoff paths, and failure handling are fixed code, not model judgment:
 *   each stage runs only after the previous one succeeds, a failed document
 *   never blocks its siblings (local-defect policy), and downstream stages
 *   process exactly the completed subset. Add a future step by appending one
 *   block that reads the previous outputs and returns its own report.
 *
 * @param {Object} host - Muse workflow host context.
 * @param {string} [host.args.request] - Path to a pipeline request JSON
 *   (e.g. pipeline-requests/bengaluru.json).
 * @param {string} [host.args.ingest_request] - Inline alternative: city
 *   request file for the ingestion stage.
 * @param {string} [host.args.ingest_run] - Ingestion run output directory.
 * @param {string} [host.args.studies_dir] - Parent dir for per-doc study runs.
 * @param {string} [host.args.translate_dir] - Parent dir for translate runs.
 * @param {string} [host.args.pipeline_dir] - Root consolidation folder that
 *   receives the promoted key files and pipeline_summary.json.
 * @param {number} [host.args.max_docs=5] - How many top-ranked docs to study.
 * @param {string[]} [host.args.doc_ids] - Explicit doc-id override for max_docs.
 * @param {string[]|string} [host.args.languages] - Translate target languages.
 * @param {string} [host.args.study_fanout=parallel] - sequential|parallel.
 * @param {string} [host.args.translate_fanout=parallel] - sequential|parallel.
 * @param {number} [host.args.study_concurrency=3] - Max simultaneous studies.
 * @param {number} [host.args.translate_concurrency=3] - Max simultaneous translations.
 * @param {boolean} [host.args.dry_run=false] - Reuse compatible completed stage runs while still exercising selection, fan-out, and promotion.
 * @returns {Promise<Object>} Pipeline report with status, promoted outputs,
 *   and per-stage telemetry.
 */


const SPARK = "muse-spark-1.3-contributor";

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, limit), items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      try { results[index] = await worker(items[index], index); }
      catch { results[index] = null; }
    }
  }));
  return results;
}

export default async function workflow(host) {
  // Test seam: production hosts never set runners, so the real checked-in
  // stage modules always run. Tests inject stub runners through host.runners.
  const runners = (host && host.runners) || {
    ingest: ingestWorkflow,
    study: studyWorkflow,
    translate: translateWorkflow,
  };
  let args = (host && host.args) || {};
  if (typeof args === "string") {
    try { args = JSON.parse(args); } catch { args = {}; }
  }
  // Invocation-level safety latch: an explicit inline dry_run=true can never
  // be weakened by request-file contents or planner output.
  const forcedDryRun = args.dry_run === true;

  const stages = [];
  const notes = [];
  const failures = [];
  const track = (scope, report) => {
    stages.push({
      scope,
      ref: (report && report.summary) || null,
      complete: !!report && typeof report.status === "string" && report.status.startsWith("complete"),
      model: "sub-workflow",
      error_kind: null,
    });
  };

  async function run(scope, input, stageSchema) {
    let result;
    try {
      result = await host.agent({ input, schema: stageSchema, label: scope, model: SPARK });
    } catch {
      stages.push({ scope, ref: null, complete: false, model: SPARK, error_kind: "agent_exception" });
      return { result: null, data: null, ok: false };
    }
    if (result && typeof result.notes === "string" && result.notes.trim()) {
      notes.push({ source: scope, ref: result.ref, value: result.notes });
    }
    if (!result || result.error_kind || result.data_spilled_for_size) {
      stages.push({ scope, ref: result ? result.ref || null : null, complete: false, model: SPARK, error_kind: result ? result.error_kind || "result_spilled_for_size" : "null_result" });
      return { result, data: null, ok: false };
    }
    const data = result.data && typeof result.data === "object" ? result.data : null;
    const ok = !!(data && data.complete === true);
    stages.push({ scope, ref: result.ref || null, complete: ok, model: SPARK, error_kind: ok ? null : "incomplete" });
    return { result, data, ok };
  }

  const path = { type: "string" };
  const schema = (extra, requiredExtra = Object.keys(extra)) => ({
    type: "object",
    required: ["complete", "evidence", "unresolved", ...requiredExtra],
    properties: {
      complete: { type: "boolean" },
      evidence: { type: "array", items: { type: "string" } },
      unresolved: { type: "array", items: { type: "string" } },
      ...extra,
    },
  });
  const COMPACT = "Return under 3KB: at most 6 short evidence/unresolved strings; keep full detail in files and return paths/counts only.";
  const finish = (report) => ({ ...report, summary: JSON.stringify(report) });
  const partial = (stage, message, extra = {}) => finish({
    status: "partial", failed_stage: stage, stages, failures, unresolved: [message], notes, ...extra,
  });
  const okStatus = (report) => !!report && typeof report.status === "string" && report.status.startsWith("complete");

  // 0. Freeze the pipeline request and normalize config. File reads happen
  // here inside the agent because the orchestrator script itself does no I/O.
  const requestLine = args.request
    ? `Pipeline request file: ${args.request}. Read it completely; inline args (if any) override its fields.`
    : `No request file; use these inline args as the request: ${JSON.stringify(args)}.`;
  const plan = await run(
    "pipeline-planner",
    `${requestLine} Create the root consolidation folder and write the frozen effective config as <pipeline_dir>/pipeline_request.json (copy the request file when given, else write the inline args). Normalize: dry_run defaults to false; max_docs defaults to 5 (positive integer); languages accept ISO codes or names case-insensitively per muse-translate/contracts.md, lowercased, deduped, at least one required; doc_ids defaults to [] (explicit rank/source-id override for max_docs); study_fanout and translate_fanout default to parallel and must be sequential|parallel; study_concurrency and translate_concurrency default to 3 and must be positive integers (fanout=sequential forces effective concurrency 1). In dry_run mode, ingest_run/studies_dir/translate_dir identify preferred exact cached locations; each stage may resolve a newer compatible completed run when its exact candidate is absent, but pipeline_dir must be a fresh consolidation destination. Write nothing outside <pipeline_dir> except creating stage output dirs in live mode. ${COMPACT} Return complete/evidence/unresolved plus pipeline_request_path, ingest_request, ingest_run, studies_dir, translate_dir, pipeline_dir, dry_run, max_docs, languages (array of strings), doc_ids (array of strings), study_fanout, translate_fanout, study_concurrency, and translate_concurrency.`,
    schema(
      { pipeline_request_path: path, ingest_request: path, ingest_run: path, studies_dir: path, translate_dir: path, pipeline_dir: path, dry_run: { type: "boolean" }, max_docs: { type: "integer" }, languages: { type: "array", items: path }, doc_ids: { type: "array", items: path }, study_concurrency: { type: "integer" }, translate_concurrency: { type: "integer" } },
      ["pipeline_request_path", "ingest_request", "ingest_run", "studies_dir", "translate_dir", "pipeline_dir", "dry_run", "max_docs", "languages", "doc_ids"]
    )
  );
  if (!plan.ok) return partial("pipeline-planner", "pipeline request was not frozen or config is invalid");
  const cfg = plan.data;
  if (forcedDryRun) cfg.dry_run = true;
  const need = ["ingest_request", "ingest_run", "studies_dir", "translate_dir", "pipeline_dir"];
  const missing = need.filter((key) => !cfg[key]);
  if (!Array.isArray(cfg.languages) || cfg.languages.length < 1) missing.push("languages");
  if (missing.length > 0) return partial("pipeline-planner", `pipeline config missing: ${missing.join(", ")}`);
  const maxDocs = Number.isInteger(cfg.max_docs) && cfg.max_docs > 0 ? cfg.max_docs : 5;
  const configuredStudyConcurrency = Number.isInteger(cfg.study_concurrency) && cfg.study_concurrency > 0 ? cfg.study_concurrency : 3;
  const configuredTranslateConcurrency = Number.isInteger(cfg.translate_concurrency) && cfg.translate_concurrency > 0 ? cfg.translate_concurrency : 3;
  const studyConcurrency = cfg.study_fanout === "sequential" ? 1 : configuredStudyConcurrency;
  const translateConcurrency = cfg.translate_fanout === "sequential" ? 1 : configuredTranslateConcurrency;
  const BASE = `Pipeline root folder: ${cfg.pipeline_dir}/. ${COMPACT}`;

  // 1. Document ingestion: city request -> manifest + ranked documents.
  const ingest = await runners.ingest({ ...host, args: { request: cfg.ingest_request, output_dir: cfg.ingest_run, dry_run: cfg.dry_run } });
  track("ingestion", ingest);
  if (!okStatus(ingest)) {
    failures.push({ stage: "ingestion", status: ingest ? ingest.status : "no_report" });
    return partial("ingestion", "ingestion did not complete; downstream stages skipped", { outputs: { pipeline_request: cfg.pipeline_request_path } });
  }

  // 2. Promote-ingestion: top-N selection + key files into the root folder.
  // The orchestrator never parses run files itself; the agent reads the
  // ranking, applies max_docs/doc_ids, copies files, and returns machine-usable paths.
  const promoteIngest = await run(
    "promote-ingestion",
    `${BASE} Ingestion report: ${ingest.summary}. Read the ranking at ${ingest.outputs.document_ranking} (ranked copies live under ${ingest.outputs.ranked_dir}). Select documents: when doc_ids is non-empty use exactly those ids in that order, else take the top ${maxDocs} by rank (rank 1 first). Copy the key ingestion files that exist (manifest.json, handoff.md, comparison.md, document_ranking.json, document_ranking.md, run_summary.json, verification.md) from ${ingest.output_dir || cfg.ingest_run}/ into ${cfg.pipeline_dir}/ingestion/ without renaming. Never edit run outputs; copy only. Return complete/evidence/unresolved plus promoted_dir, promoted_paths (array of destination paths), and selected_docs (array of {id, rank, source_path} where source_path is the ranked byte-identical copy to study, in study order). Config doc_ids: ${(cfg.doc_ids || []).join(",") || "(none)"}.`,
    schema({ promoted_dir: path, promoted_paths: { type: "array", items: path }, selected_docs: { type: "array", items: { type: "object", required: ["id", "source_path"], properties: { id: path, rank: { type: "integer" }, source_path: path } } } })
  );
  if (!promoteIngest.ok || !Array.isArray(promoteIngest.data.selected_docs) || promoteIngest.data.selected_docs.length < 1) {
    failures.push({ stage: "promote-ingestion", status: "no_selection" });
    return partial("promote-ingestion", "no documents were selected for study", { outputs: { pipeline_request: cfg.pipeline_request_path, ingestion: promoteIngest.data ? promoteIngest.data.promoted_dir : null } });
  }
  const selectedDocs = promoteIngest.data.selected_docs;

  // 3. Study fan-out: one document-processing run per selected document.
  // A failed document never blocks its siblings; downstream stages process
  // exactly the completed subset.
  const runStudy = (doc) => runners.study({ ...host, args: { document: doc.source_path, output_dir: `${cfg.studies_dir}/${doc.id}`, runs_dir: cfg.studies_dir, dry_run: cfg.dry_run } });
  const studyReports = await mapWithConcurrency(selectedDocs, studyConcurrency, runStudy);
  const studies = [];
  studyReports.forEach((report, index) => {
    const doc = selectedDocs[index];
    track(`study:${doc.id}`, report);
    if (okStatus(report)) {
      const resolvedDir = report.output_dir || report.reused_from || String(report.outputs?.study_package || "").replace(/\/[^/]+$/, "") || (!cfg.dry_run ? `${cfg.studies_dir}/${doc.id}` : "");
      if (resolvedDir) studies.push({ id: doc.id, rank: doc.rank || index + 1, output_dir: resolvedDir, report });
      else failures.push({ stage: `study:${doc.id}`, status: "missing_resolved_dir" });
    }
    else failures.push({ stage: `study:${doc.id}`, status: report ? report.status : "no_report" });
  });
  if (studies.length < 1) return partial("study-fanout", "no study completed; translation skipped", { outputs: { pipeline_request: cfg.pipeline_request_path, ingestion: promoteIngest.data.promoted_dir, selected_docs: selectedDocs } });

  // 4. Promote-studies: key study files per document into the root folder.
  const promoteStudies = await run(
    "promote-studies",
    `${BASE} Completed studies: ${studies.map((s) => `${s.id} (report: ${s.report.summary}, dir: ${s.output_dir})`).join("; ")}. For each, copy the key files that exist (study_package.json, narrative_package.json, report.json, grounding_selfcheck.json) from its study dir into ${cfg.pipeline_dir}/studies/<doc-id>/ without renaming. Never edit run outputs; copy only. Return complete/evidence/unresolved plus promoted_dirs (array of {id, dir}) and study_count.`,
    schema({ promoted_dirs: { type: "array", items: { type: "object", required: ["id", "dir"], properties: { id: path, dir: path } } }, study_count: { type: "integer" } })
  );
  if (!promoteStudies.ok) {
    failures.push({ stage: "promote-studies", status: "promotion_failed" });
    return partial("promote-studies", "study outputs were not promoted to the root folder", { outputs: { pipeline_request: cfg.pipeline_request_path, ingestion: promoteIngest.data.promoted_dir, selected_docs: selectedDocs } });
  }

  // 5. Translate fan-out: per-language copies per completed study.
  const runTranslate = (s) => runners.translate({ ...host, args: { input: s.output_dir, output_dir: `${cfg.translate_dir}/${s.id}`, runs_dir: cfg.translate_dir, languages: cfg.languages, dry_run: cfg.dry_run } });
  const translateReports = await mapWithConcurrency(studies, translateConcurrency, runTranslate);
  const translations = [];
  translateReports.forEach((report, index) => {
    const s = studies[index];
    track(`translate:${s.id}`, report);
    if (okStatus(report)) translations.push({ id: s.id, output_dir: report.output_dir || `${cfg.translate_dir}/${s.id}`, report });
    else failures.push({ stage: `translate:${s.id}`, status: report ? report.status : "no_report" });
  });

  // 6. Promote-translations + pipeline summary in the root folder.
  const promoteTranslations = await run(
    "promote-translations",
    `${BASE} Completed translations: ${translations.map((t) => `${t.id} (report: ${t.report.summary}, dir: ${t.output_dir})`).join("; ") || "(none)"}. Failed stages (record these verbatim in the summary failure lists): ${JSON.stringify(failures)}. For each completed translation, read inventory.json/run_summary.json to enumerate its verified outputs. Copy every requested language artifact that exists—study_package_<lang>.json, narrative_package_<lang>.json, and report_<lang>.json—without renaming into BOTH ${cfg.pipeline_dir}/studies/<doc-id>/ (canonical single-folder UI serving location beside the source-language files) and ${cfg.pipeline_dir}/translations/<doc-id>/ (translation-stage mirror). Copy request.json, inventory.json, verification.md, and run_summary.json into the translation-stage mirror only. Missing an inventoried language artifact is a promotion failure; never silently omit it. Then write ${cfg.pipeline_dir}/pipeline_summary.json recording execution_mode (${cfg.dry_run ? "dry_run" : "live"}), the pipeline request path, resolved/reused ingestion run, selected docs with ranks, resolved/reused study and translation directories, completed/failed studies, completed/failed translations, languages, effective concurrency (study ${studyConcurrency}, translation ${translateConcurrency}), and promoted dirs. Never edit run outputs; copy only. Return complete/evidence/unresolved plus promoted_dirs (array of {id, dir}), summary_path, and translation_count.`,
    schema({ promoted_dirs: { type: "array", items: { type: "object", required: ["id", "dir"], properties: { id: path, dir: path } } }, summary_path: path, translation_count: { type: "integer" } })
  );
  if (!promoteTranslations.ok) failures.push({ stage: "promote-translations", status: "promotion_failed" });

  const outputs = {
    pipeline_request: cfg.pipeline_request_path,
    pipeline_dir: cfg.pipeline_dir,
    ingestion: promoteIngest.data.promoted_dir,
    ingestion_promoted_paths: promoteIngest.data.promoted_paths,
    selected_docs: selectedDocs,
    studies: studies.map((s) => ({ id: s.id, output_dir: s.output_dir })),
    studies_dir: promoteStudies.data ? promoteStudies.data.promoted_dirs : [],
    translations: translations.map((t) => ({ id: t.id, output_dir: t.output_dir })),
    translations_dir: promoteTranslations.ok ? promoteTranslations.data.promoted_dirs : [],
    pipeline_summary: promoteTranslations.ok ? promoteTranslations.data.summary_path : null,
  };
  if (failures.length > 0) return partial("pipeline", `${failures.length} stage(s) did not complete but siblings were preserved`, { outputs });
  return finish({ status: "complete", dry_run: cfg.dry_run, outputs, stages, failures, unresolved: [], notes });
}


