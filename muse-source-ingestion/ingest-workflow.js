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
 * @returns {Promise<Object>} Execution report containing status, manifest paths, and stage telemetry.
 */

const SPARK = "muse-spark-1.3-contributor";
const WONDER = "muse-wonder-1.0";
const MAX_WONDER_CALLS = 3;

export default async function workflow(host) {
  let args = host.args || {};
  if (typeof args === "string") {
    try { args = JSON.parse(args); } catch { args = {}; }
  }
  const request = args.request;
  const outputDir = args.output_dir;
  if (!request || !outputDir) {
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
