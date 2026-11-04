// Agentic source ingestion: one city -> validated source manifest + handoff.
// Run via muse.workflow with scriptPath "muse-source-ingestion/ingest-workflow.js"
// and args { request: "<path to requests/<city>.json>", output_dir: "muse-source-ingestion/runs/<run-id>" }.
// Child results stay under the ~4KB inline limit: stages write full artifacts to
// files and return only paths, counts, and short strings; oversized results are
// recovered through a compact SPARK distiller instead of failing the stage.

// Model routing: Wonder is reserved for two high-leverage judgment stages
// (research strategy and cross-lane review). Spark performs parallel discovery,
// draft synthesis, targeted repair, and final verification. The whole pipeline
// remains one Muse workflow invocation; agents may use deterministic utilities
// as tools, but no external deterministic pipeline stage is required.

const SPARK = "muse-spark-1.3-contributor";
const WONDER = "muse-wonder-1.0";
const MAX_WONDER_CALLS = 2;

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
    `${brief} Steps 1-3 only: resolve the city and boundaries, inventory and validate held sources from muse-source-ingestion/runs/ only (current plus previous run dirs; nothing else), and write inventory.json, evidence_map.md, and lanes.json (one object per lane: id, objective, included_evidence_needs, supported_capabilities, exclusions, selection_reason, completion evidence). Treat request evidence_gaps as priorities, not the full scope: audit the wider subsurface evidence landscape, then design the smallest coherent set of bounded, complementary lanes needed for strong scientific and visual coverage. Combine related gaps where useful and add high-value evidence not named in the request. Do not assign search, fetch, download, byte, model-call, time, or package-count budgets; source quality and evidence saturation govern the work. Return complete/evidence/unresolved plus inventory_path, evidence_map_path, lanes_path, and lane_ids (short ids matching lanes.json). ${COMPACT}`,
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
      input: `${brief} ${COMPACT} Prior scout result: ${scout.result.ref}. Read your full lane spec (lane "${id}") from ${scout.data.lanes_path} and run that discovery lane only. Follow WORKFLOW.md steps 4-5 inside ${outputDir}/lanes/${id}/: candidates.json, excerpts.md, validation.json, trace.jsonl, usage.json, downloads/. Perform live web searches and do not rely on model knowledge for source availability, URLs, dates, publishers, or contents. Begin with the mandatory current-baseline check: find the newest authoritative citywide, metropolitan, or closest-available source, search for successor editions and updated datasets, and record the check. Prefer fresh observations for dynamic evidence; retain older sources only for explicit unique scientific value. Continue until the lane's material leads are resolved, inaccessible with recorded reasons, or further query refinement yields no materially better or complementary source. Counts in usage.json are observability only and must never be used as stopping limits. Return complete/evidence/unresolved plus lane_dir, download_count, and usage_path. Candidate lists, traces, and telemetry stay in the lane files, never in the returned JSON.`,
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
    `${brief} Prior results: ${scout.result.ref} ${liveLanes.join(" ")}. Steps 6-7 only: dedupe across lanes by URL/checksum/identity and rank candidates using type-aware freshness, geographic coverage, authority, renderable scientific content, and unique value. Select every validated package that makes a material, non-redundant contribution to the requested subsurface experience; use judgment rather than a fixed package count, and never add filler. Prefer current authoritative citywide or closest-available anchors followed by complementary detailed sources. Do not select an older source without a documented successor check and unique-evidence justification. Write draft/manifest.json, draft/comparison.md, draft/handoff.md, and draft/run_summary.json. Keep the draft compact but evidence-linked so a reviewer need not repeat discovery. The selected package list lives in draft/manifest.json. Return complete/evidence/unresolved plus manifest_path, handoff_path, and selected_count. ${COMPACT}`,
    stageSchema({ manifest_path: pathProp, handoff_path: pathProp, selected_count: { type: "number" } })
  );

  if (!consolidate.ok) {
    const report = { status: "partial", failed_stage: "consolidate", stages, unresolved: ["draft consolidation did not complete"], notes, wonder_calls: wonderCalls };
    return { ...report, summary: JSON.stringify(report) };
  }

  // 4. Wonder reviewer: challenge strategy and selection without redoing tool work.
  const review = await runStage(
    "strategic-review",
    `${brief} Act as a read-only senior subsurface research reviewer. Read the request, inventory, evidence map, lane outputs, and the four files under ${outputDir}/draft/. Do not search, download, edit, consolidate, rerun validation, or edit lessons. Test whether the lane design covered the material subsurface landscape, the baseline/successor checks are credible, freshness was applied by evidence type, geographic claims match their denominator, selected packages have high marginal and visual value, strong discovered sources were not deferred for arbitrary counters, and unresolved gaps are honestly represented. Write ${outputDir}/review.json with approved, concise must_fix items, risks, and evidence references. Distinguish required fixes from optional improvements. Return complete/evidence/unresolved plus approved, review_path, must_fix (short titles only, at most 6 under 120 chars each; full detail stays in review.json), and risk_count. ${COMPACT}`,
    stageSchema({ approved: { type: "boolean" }, must_fix: { type: "array", items: { type: "string" } }, risk_count: { type: "number" }, review_path: pathProp }),
    WONDER
  );

  // 5. Spark repair/finalizer: resolve review findings and verify final artifacts.
  const reviewInstruction = review.ok
    ? `Read ${review.data.review_path}; address every must_fix item and explicitly disposition each risk.`
    : "The independent Wonder review was unavailable. Re-audit the draft against every WORKFLOW.md self-check and record this degraded condition.";
  const finalize = await runStage(
    "repair-and-finalize",
    `${brief} Prior scout: ${scout.result.ref}. Prior lanes: ${liveLanes.join(" ")}. Draft synthesis: ${consolidate.result.ref}. ${reviewInstruction} Act as the Spark repair and final-verification agent. Continue with additional searches, fetches, downloads, or validation whenever needed to resolve a material review finding or obtain a clearly stronger source. Stop on evidence saturation or documented external unavailability, never because an arbitrary activity counter was reached. Produce the final root manifest.json, comparison.md, handoff.md, and run_summary.json. Record whether the lessons file was loaded, but never edit it. Then execute the complete WORKFLOW.md self-check using available tools: reopen selected files, recompute sha256 and sizes, validate parseability and recorded counts, reconcile activity telemetry, and confirm required paths and schema fields. Write verification.md with pass/fail evidence and unresolved items. Return complete=true only if the final artifacts exist and all hard gates pass; unresolved research gaps may remain when honestly reported. The selected package list lives in the final manifest.json. Return complete/evidence/unresolved plus manifest_path, handoff_path, verification_path, and selected_count. ${COMPACT}`,
    stageSchema({ manifest_path: pathProp, handoff_path: pathProp, verification_path: pathProp, selected_count: { type: "number" } })
  );

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
    selected_count: finalize.ok ? finalize.data.selected_count : 0,
  };
  const unresolved = [
    ...(review.ok ? review.data.unresolved : ["independent Wonder review did not complete"]),
    ...(finalize.ok ? finalize.data.unresolved : ["repair and final verification did not complete"]),
  ];
  const report = {
    status: finalize.ok && review.ok ? "complete" : "partial",
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
