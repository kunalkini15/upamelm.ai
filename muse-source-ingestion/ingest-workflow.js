/**
 * @file ingest-workflow.js
 * @module muse-source-ingestion/ingest-workflow
 * @description Autonomous municipal-scale source ingestion pipeline.
 * Discovers, downloads, validates, and indexes authoritative subsurface documents
 * (CGWB reports, NAQUIM yearbooks, EIA assessments) for a target city request.
 *
 * @workflow
 *   1. Run Initialization (Spark) -> Freezes the request and writes an empty inventory.
 *   2. Scout & Strategy (Wonder) -> Resolves bounds, maps evidence gaps, and designs discovery lanes.
 *   3. Parallel Candidate Discovery (Spark) -> Searches and writes bounded candidate sets per lane.
 *   4. Parallel Acquisition (Spark) -> Downloads and validates the discovered candidates per lane.
 *   5. Draft Consolidation (Spark) -> Dedupes candidates, ranks authority/freshness, and drafts manifest.
 *   6. Strategic Review (Wonder) -> Independent senior critique of evidence gaps and selections.
 *   7. Repair & Final Verification (Spark) -> Re-validates files, checks SHA-256 hashes, and outputs manifest.
 *   8. Information-Value Ranking (Wonder) -> Ranks final documents and creates ordered access copies.
 *
 * @modelRouting
 *   - Spark: Parallel discovery, synthesis, file validation, and repair.
 *   - Wonder: Strategic planning, independent critique, and final information-value ranking. Max 3 calls.
 *
 * @param {Object} host - Muse workflow host context.
 * @param {string} host.args.request - Path to the city request specification JSON (e.g., requests/bengaluru.json).
 * @param {string} host.args.output_dir - City run directory (e.g., runs/mumbai).
 * @param {boolean} [host.args.resume=false] - Continue a validated partial run from its durable checkpoint.
 * @returns {Promise<Object>} Execution report containing status, manifest paths, and stage telemetry.
 */

const SPARK = "muse-spark-1.3-contributor";
const WONDER = "muse-wonder-1.0";
const MAX_WONDER_CALLS = 3;
const MAX_CONTINUATION_CHILDREN = 10;

export default async function workflow(host) {
  let args = host.args || {};
  if (typeof args === "string") {
    try { args = JSON.parse(args); } catch { args = {}; }
  }
  const request = args.request;
  const outputDir = args.output_dir;
  const dryRun = args.dry_run === true;
  const resume = args.resume === true;
  if (!request || !outputDir) {
    const report = {
      status: "invalid_args",
      unresolved: ["args must include request and output_dir"],
      evidence: [],
      notes: [],
    };
    return { ...report, summary: JSON.stringify(report) };
  }
  if (dryRun) {
    const report = { status: "invalid_args", unresolved: ["dry_run reuse is disabled; run ingestion fresh for the city directory"], evidence: [], notes: [] };
    return { ...report, summary: JSON.stringify(report) };
  }

  // The writable run directory is the city identity. This keeps backend city
  // discovery simple and prevents one city from inventorying another city.
  const normalizedOutputDir = outputDir ? String(outputDir).replace(/\\/g, "/").replace(/\/+$/, "") : null;
  const runsMarker = "muse-source-ingestion/runs/";
  const runsMarkerIndex = normalizedOutputDir ? normalizedOutputDir.lastIndexOf(runsMarker) : -1;
  const outputRelativeToRuns = runsMarkerIndex >= 0 ? normalizedOutputDir.slice(runsMarkerIndex + runsMarker.length) : "";
  const outputParts = outputRelativeToRuns.split("/").filter(Boolean);
  if (!dryRun && (outputParts.length !== 1 || outputParts.some((part) => part === "." || part === ".."))) {
    const report = {
      status: "invalid_args",
      unresolved: ["output_dir must use muse-source-ingestion/runs/<city-slug>"],
      evidence: [],
      notes: [],
    };
    return { ...report, summary: JSON.stringify(report) };
  }
  const citySlug = outputParts.length === 1 ? outputParts[0] : null;

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

  const runStage = async (scope, input, schema, model = SPARK, recoveryInput = null) => {
    if (model === WONDER && wonderCalls >= MAX_WONDER_CALLS) {
      stages.push({ scope, ref: null, complete: false, model, error_kind: "wonder_call_limit_reached" });
      return { result: null, data: null, ok: false };
    }
    if (model === WONDER) wonderCalls += 1;
    let result;
    let resultScope = scope;
    try {
      result = await host.agent({ input, schema, label: scope, model });
    } catch (_error) {
      stages.push({ scope, ref: null, complete: false, model, error_kind: "agent_exception" });
      return { result: null, data: null, ok: false };
    }
    collectNotes(result, scope);
    let continuation = 0;
    while (result && result.error_kind === "generated_child_model_step_cap" && continuation < MAX_CONTINUATION_CHILDREN) {
      stages.push({ scope: resultScope, ref: result.ref || null, complete: false, model: continuation === 0 ? model : SPARK, error_kind: result.error_kind });
      continuation += 1;
      const continuationScope = `${scope}-continuation-${continuation}`;
      notes.push({ source: resultScope, ref: result.ref, value: `step cap reached; starting continuation child ${continuation}/${MAX_CONTINUATION_CHILDREN} from durable artifacts` });
      try {
        result = await host.agent({
          input: `${recoveryInput || `${input} RECOVERY: Continue from durable artifacts. Reuse all valid files already present; do not redo searches, downloads, extraction, or validation that is complete. Finish only missing work, write required artifacts early, and reserve the final turn exclusively for submit_result. ${COMPACT}`} This is continuation child ${continuation}/${MAX_CONTINUATION_CHILDREN}. Inspect current artifacts as the source of truth because earlier children may have advanced the stage. Submit immediately if the required outputs are already complete.`,
          schema,
          label: continuationScope,
          model: SPARK,
        });
      } catch (_recoveryError) { result = null; }
      resultScope = continuationScope;
      collectNotes(result, continuationScope);
    }
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
    stages.push({ scope: resultScope, ref: result ? result.ref : null, complete: !!ok, model: resultScope === scope ? model : SPARK, error_kind: result ? result.error_kind || null : "null_result" });
    return { result, data, ok };
  };

  let inventory;
  let scout;
  let liveLanes;

  if (resume) {
    const failureReport = args.failure_report;
    if (!failureReport) {
      const report = { status: "invalid_args", unresolved: ["resume requires failure_report"], evidence: [], notes: [] };
      return { ...report, summary: JSON.stringify(report) };
    }
    let checkpointResult = { ref: "orchestrator-resume-preflight" };
    if (args.checkpoint_validated !== true) {
      const checkpoint = await runStage(
        "resume-checkpoint-audit",
        `${brief} Read-only resume audit for the same interrupted run. Batch-read ${failureReport}, ${outputDir}/request.json, inventory.json, evidence_map.md, lanes.json, and existing lane validation.json files. Require the failure report status=partial and safe_retry_point=ingestion; require the frozen request to be semantically identical to ${request}; require at least one usable lane validation and no completed final manifest/ranking. Do not browse, search, create, edit, delete, move, rename, hash, extract, or redownload anything. Return complete=false if the checkpoint belongs to another city/scope or is unsafe. The complete boolean is the sole decision field; paths are fixed by the workflow. ${COMPACT}`,
        stageSchema({})
      );
      if (!checkpoint.ok) {
        const report = { status: "partial", failed_stage: "resume-checkpoint-audit", stages, unresolved: ["no safe consolidation checkpoint found"], notes, wonder_calls: wonderCalls };
        return { ...report, summary: JSON.stringify(report) };
      }
      checkpointResult = checkpoint.result;
    } else {
      stages.push({ scope: "resume-checkpoint-authorized", ref: failureReport, complete: true, model: "orchestrator-preflight", error_kind: null });
    }
    inventory = { ok: true, result: checkpointResult, data: { inventory_path: `${outputDir}/inventory.json`, lessons_loaded: true } };
    scout = { ok: true, result: checkpointResult, data: { evidence_map_path: `${outputDir}/evidence_map.md`, lanes_path: `${outputDir}/lanes.json`, lane_ids: [] } };
    // Consolidation reads usable validation artifacts below this fixed root.
    // Avoid trusting a model-generated list that can be blank despite a pass.
    liveLanes = [`${outputDir}/lanes`];
  } else {
  // 1. Fresh-run initialization. No prior run is inspected or reused.
  inventory = await runStage(
    "run-initialization",
    `${brief} Perform WORKFLOW.md steps 1-2 as fresh-run initialization. Runtime discipline is mandatory. This run's structural city slug is "${citySlug}" and its isolated city-run directory is ${outputDir}/. Confirm the slug represents the request city; fail on mismatch. In the first tool turn batch-read the request, relevant WORKFLOW.md sections, contracts.md, and optional lessons only. Never list, read, inventory, compare, hash, or reuse any existing ingestion run or any other directory under muse-source-ingestion/runs/. Freeze the current request as ${outputDir}/request.json immediately. Write ${outputDir}/inventory.json immediately with sources=[], source_count=0, reuse_enabled=false, and a note that every source must come from this run's live discovery. Do not browse or search. Reserve the final child-model turn exclusively for submit_result. Return complete/evidence/unresolved plus request_path, inventory_path, lessons_loaded, and prior_source_count=0. ${COMPACT}`,
    stageSchema({ request_path: pathProp, inventory_path: pathProp, lessons_loaded: { type: "boolean" }, prior_source_count: { type: "number" } })
  );
  if (!inventory.ok) {
    const report = { status: "partial", failed_stage: "run-initialization", stages, unresolved: ["fresh-run initialization did not complete"], notes, wonder_calls: wonderCalls };
    return { ...report, summary: JSON.stringify(report) };
  }

  // 2. Wonder strategist: resolve geography, map evidence, and design lanes.
  scout = await runStage(
    "scout",
    `${brief} Fresh-run initialization: ${inventory.result.ref}; read the empty ${inventory.data.inventory_path}. Perform only the planning portion of WORKFLOW.md steps 1-3. In your first tool turn, batch-read the frozen request, inventory.json, relevant WORKFLOW.md sections, contracts.md, and optional lessons file. Never inspect any previous run. Resolve the city denominator and apply research_scope. By the end of child-model turn 3, write a usable ${outputDir}/evidence_map.md and ${outputDir}/lanes.json, even if concise; improve them only after both exist. lanes.json contains one object per lane: id, query_mode, objective, included_evidence_needs, supported_capabilities, exclusions, selection_reason, scope mapping, recent-observation cutoff, useful native formats, and completion evidence. Domain lanes use query_mode=year_qualified. Always add exactly one cross-cutting lane with id yearless-repository-sweep and query_mode=yearless; it covers all included domains through searches that contain no year/date tokens, emphasizing official repositories, catalogues, APIs, native datasets, attachment lists, and report collections. Its candidates still face the same scope and freshness gates later. In broad mode audit the requested subsurface landscape; in focused mode use the smallest coherent set of domain lanes plus the mandatory yearless sweep for include_domains only. Supporting evidence requires a stated direct dependency. Treat evidence_gaps as priorities, not a literal lane list. Do not browse, search, download, hash, extract, render, validate PDFs, or modify inventory.json. Do not assign activity budgets. Reserve the final child-model turn exclusively for submit_result: once the two artifacts exist, stop analysis and submit the schema result with no intervening tool call. Return complete/evidence/unresolved plus evidence_map_path, lanes_path, and lane_ids. ${COMPACT}`,
    stageSchema({ evidence_map_path: pathProp, lanes_path: pathProp, lane_ids: { type: "array", items: { type: "string" } } }),
    WONDER
  );
  if (!scout.ok) {
    const report = { status: "partial", failed_stage: "scout", stages, unresolved: ["scout did not complete the evidence map and lane plan"], notes, wonder_calls: wonderCalls };
    return { ...report, summary: JSON.stringify(report) };
  }

  // Parallel-stage resolver with the same compact spill recovery used by
  // individual stages. Keeping it shared lets discovery and acquisition have
  // separate ten-step agent loops without duplicating failure handling.
  const resolveParallel = async (inputs, results, schema, laneIds) => {
    const spilled = [];
    results.forEach((result, i) => {
      if (result && result.data_spilled_for_size === true && !result.error_kind) spilled.push(i);
    });
    if (spilled.length) {
      const distills = await host.parallel(spilled.map((i) => ({
        input: `Prior result: ${results[i].ref}. Read that result's full data and return the SAME required fields in compact form: ${COMPACT} Do not redo research or write new artifacts.`,
        schema,
        label: `${inputs[i].label}-distill`,
        model: SPARK,
      })));
      distills.forEach((distilled, k) => {
        const i = spilled[k];
        collectNotes(distilled, `${inputs[i].label}-distill`);
        const data = distilled && !distilled.error_kind && distilled.data_spilled_for_size !== true && distilled.data && typeof distilled.data === "object" ? distilled.data : null;
        results[i] = data ? distilled : { ref: results[i].ref, data: null, error_kind: "result_spilled_for_size" };
      });
    }
    const completed = [];
    results.forEach((result, i) => {
      const scope = inputs[i].label;
      collectNotes(result, scope);
      const failed = result === null || result.error_kind;
      const data = !failed && result.data && typeof result.data === "object" ? result.data : null;
      const ok = !failed && data && data.complete === true;
      stages.push({ scope, ref: result ? result.ref : null, complete: !!ok, model: SPARK, error_kind: result ? result.error_kind || null : "null_result" });
      if (ok) completed.push({ id: laneIds[i], ref: result.ref, data });
    });
    return completed;
  };

  // 3. Candidate discovery lanes in parallel. This call searches and writes
  // compact candidate artifacts only; it does not also attempt acquisition.
  const laneIds = scout.data.lane_ids || [];
  const discoverySchema = stageSchema({ lane_dir: pathProp, candidates_path: pathProp, excerpts_path: pathProp, usage_path: pathProp, candidate_count: { type: "number" } });
  const normalizedLaneIds = laneIds.map((rawId) =>
    String(rawId).trim().replace(/[^a-z0-9-]+/gi, "-").toLowerCase() || "lane"
  );
  const discoveryInputs = normalizedLaneIds.map((id) => {
    return {
      input: `${brief} ${COMPACT} Prior scout: ${scout.result.ref}. This is candidate-discovery only for lane "${id}". In the first tool turn batch-read the frozen request, this lane spec from ${scout.data.lanes_path}, the relevant WORKFLOW.md discovery section, contracts.md, and optional lessons. Never reread those files. Obey the lane's query_mode. For year_qualified lanes, derive eligible calendar years from source_policy.selection_cutoff_date (or the recent-observation window) through as_of_date and search newest-first with batched queries containing eligible year tokens plus current/latest/successor terms, city aliases, evidence terms, preferred publishers/domains, and useful formats; step backward only as gaps remain and include the cutoff year because late-year evidence may qualify. For query_mode=yearless, use no numeric year, date range, or date token in any search query; search all included domains across official repositories, catalogues, APIs, native datasets, attachment lists, and report collections using city aliases, evidence terms, publisher/domain hints, current/latest/successor words, and format terms. Do not spend turns deeply inspecting clearly pre-cutoff results: record them as leads and continue to an in-window successor. Perform batched live searches for the newest authoritative baseline, successors, specialist evidence, and applicable native formats. Fetch only high-signal landing pages needed to establish title, publisher, date, coverage, media type, and a stable download/API URL. Do not download, hash, parse, render, or validate source files in this call. By child-model turn 5, write ${outputDir}/lanes/${id}/candidates.json, excerpts.md, trace.jsonl, and usage.json even if unresolved leads remain. Candidate records must contain enough URLs and metadata for a separate acquisition agent. Keep a bounded high-value shortlist rather than an exhaustive web catalogue; document rejected/blocked leads concisely. Reserve the final child-model turn exclusively for submit_result, with no tool call after artifacts exist. Return complete/evidence/unresolved plus lane_dir, candidates_path, excerpts_path, usage_path, and candidate_count.`,
      schema: discoverySchema,
      label: `discover-${id}`,
      model: SPARK,
    };
  });
  const discoveryResults = discoveryInputs.length ? await host.parallel(discoveryInputs) : [];
  const discoveredLanes = await resolveParallel(discoveryInputs, discoveryResults, discoverySchema, normalizedLaneIds);
  const discoveredIds = new Set(discoveredLanes.map((lane) => lane.id));
  const interruptedDiscoveryIds = normalizedLaneIds.filter((id) => !discoveredIds.has(id));
  if (interruptedDiscoveryIds.length) {
    const discoveryRecoveryInputs = interruptedDiscoveryIds.map((id) => ({
      input: `${brief} ${COMPACT} Recover interrupted candidate-discovery lane "${id}". Work only inside ${outputDir}/lanes/${id}. In the first tool turn batch-read the frozen request, this lane spec from ${scout.data.lanes_path}, and any existing candidates.json, excerpts.md, trace.jsonl, or usage.json. Preserve usable work already on disk. If all four required artifacts already contain a credible bounded shortlist, do no more research; normalize them and submit. Otherwise perform only the minimum targeted searches/fetches needed to close the shortlist, obeying the lane query_mode and source-policy cutoff. Do not download or validate source files. By turn 3 ensure candidates.json, excerpts.md, trace.jsonl, and usage.json exist. After turn 5 perform no tool calls. Reserve the final turn exclusively for submit_result. Return complete/evidence/unresolved plus lane_dir, candidates_path, excerpts_path, usage_path, and candidate_count.`,
      schema: discoverySchema,
      label: `rediscover-${id}`,
      model: SPARK,
    }));
    const discoveryRecoveryResults = await host.parallel(discoveryRecoveryInputs);
    const recoveredDiscovery = await resolveParallel(discoveryRecoveryInputs, discoveryRecoveryResults, discoverySchema, interruptedDiscoveryIds);
    discoveredLanes.push(...recoveredDiscovery);
  }
  if (!discoveredLanes.length) {
    const report = { status: "partial", failed_stage: "candidate-discovery", stages, unresolved: ["no candidate-discovery lane completed"], notes, wonder_calls: wonderCalls };
    return { ...report, summary: JSON.stringify(report) };
  }

  // 4. Acquisition/validation gets a fresh agent loop per completed lane.
  const acquisitionSchema = stageSchema({ lane_dir: pathProp, validation_path: pathProp, download_count: { type: "number" }, usage_path: pathProp });
  const acquisitionLaneIds = discoveredLanes.map((lane) => lane.id);
  const acquisitionInputs = discoveredLanes.map((lane) => ({
    input: `${brief} ${COMPACT} Candidate-discovery result: ${lane.ref}. This is acquisition and validation only for lane "${lane.id}". Batch-read ${lane.data.candidates_path}, ${lane.data.excerpts_path}, the frozen request source_policy, and only the relevant WORKFLOW.md validation rules in the first tool turn; never repeat setup reads. Do not restart broad discovery. In turn 2 create ${lane.data.lane_dir}/validation.json with a valid empty/in-progress structure so every subsequent successful acquisition can be checkpointed immediately. Resolve a download URL only when a shortlisted candidate's recorded endpoint needs one targeted fetch. Apply scope and freshness gates before downloading. Establish a validated core from the strongest eligible, materially distinct candidates before attempting optional companions. After each download, immediately record its path and provisional disposition in validation.json; batch file hashing/opening/metadata inspection wherever tools permit, then update the same record. Blocked candidates remain documented rather than retried indefinitely. By child-model turn 6, ensure candidates.json, excerpts.md, trace.jsonl, usage.json, validation.json, and downloads/ exist under ${lane.data.lane_dir}; after turn 6 start no new acquisition and spend remaining turns closing records and submitting. Validate acquired assets according to format, recording size, sha256, parse/open result, dates, coverage, limitations, and successor relationship. It is acceptable to complete with unresolved inaccessible or optional leads when at least one valuable source is validated, or with zero downloads only when every strong lead is honestly blocked and all required lane artifacts exist. Reserve the final child-model turn exclusively for submit_result. Return complete/evidence/unresolved plus lane_dir, validation_path, download_count, and usage_path.`,
    schema: acquisitionSchema,
    label: `acquire-${lane.id}`,
    model: SPARK,
  }));
  const acquisitionResults = acquisitionInputs.length ? await host.parallel(acquisitionInputs) : [];
  const acquiredLanes = await resolveParallel(acquisitionInputs, acquisitionResults, acquisitionSchema, acquisitionLaneIds);

  // A child step-cap after downloads is recoverable execution state, not an
  // evidence failure. Give every unfinished lane a fresh, validation-only
  // Spark loop over its durable on-disk checkpoints before failing ingestion.
  const acquiredIds = new Set(acquiredLanes.map((lane) => lane.id));
  const recoveryLanes = discoveredLanes.filter((lane) => !acquiredIds.has(lane.id));
  if (recoveryLanes.length) {
    const recoveryLaneIds = recoveryLanes.map((lane) => lane.id);
    const recoveryInputs = recoveryLanes.map((lane) => ({
      input: `${brief} ${COMPACT} Recover interrupted acquisition lane "${lane.id}" after its prior agent failed to submit a terminal result. Work only inside ${lane.data.lane_dir}. In the first tool turn batch-list the lane directory and batch-read candidates.json, excerpts.md, usage.json, trace.jsonl, any existing validation.json, and the frozen request source_policy. Do not browse, search, restart discovery, or redownload an asset that already exists. Treat files already present in downloads/ as durable work to salvage, regardless of whether the previous agent returned structured data. By turn 2 write a valid validation.json inventorying every downloaded file with a pending or final disposition. Then batch-compute sizes and sha256 values and perform the minimum format-appropriate open/parse checks needed to distinguish valid evidence from corrupt or irrelevant files. Update validation.json, candidates.json, trace.jsonl, usage.json, and excerpts.md with honest accepted/rejected/unresolved dispositions. Preserve every valid in-scope file; duplicates may be marked rather than deleted. If downloads/ is empty, complete honestly with zero downloads and document why rather than doing new research. By turn 6 stop tool work. Reserve the final turn exclusively for submit_result and return complete/evidence/unresolved plus lane_dir, validation_path, download_count, and usage_path.`,
      schema: acquisitionSchema,
      label: `recover-${lane.id}`,
      model: SPARK,
    }));
    const recoveryResults = await host.parallel(recoveryInputs);
    const recovered = await resolveParallel(recoveryInputs, recoveryResults, acquisitionSchema, recoveryLaneIds);
    acquiredLanes.push(...recovered);
  }
  if (!acquiredLanes.length) {
    const report = { status: "partial", failed_stage: "acquisition", stages, unresolved: ["no acquisition lane completed"], notes, wonder_calls: wonderCalls };
    return { ...report, summary: JSON.stringify(report) };
  }
  liveLanes = acquiredLanes.map((lane) => lane.ref);
  }

  // 3. Spark synthesizer: produce a compact draft for independent review.
  let consolidate = await runStage(
    resume ? "consolidate-resume" : "consolidate",
    resume
      ? `${brief} Resume the interrupted consolidation from durable current-run artifacts only. Validated lane directories: ${liveLanes.join(", ")}. Partial draft files may exist under ${outputDir}/draft/. In the first tool turn batch-read all lane validation/candidate files and every existing draft file. Do not browse, search, download, revalidate, or repeat discovery/acquisition. Preserve correct partial content. Apply scope, strict freshness, authority, geographic-denominator, deduplication, and non-redundancy gates. By turn 3 ensure draft/manifest.json, comparison.md, handoff.md, and run_summary.json all exist and reconcile IDs/counts. After turn 5 perform no tool calls. Reserve the final turn for submit_result. Return complete/evidence/unresolved plus manifest_path, handoff_path, and selected_count. ${COMPACT}`
      : `${brief} Prior results: ${scout.result.ref} ${liveLanes.join(" ")}. Steps 6-7 only: enforce research_scope and source_policy as hard selection gates, then dedupe current-run candidates across lanes by URL/checksum/identity and rank eligible candidates using type-aware freshness, geographic coverage, authority, renderable scientific content, native usability, and unique value. Reject out-of-scope candidates; allow supporting evidence only when its direct dependency on an included domain is recorded. In strict-window mode, reject every source older than selection_cutoff_date. In ordinary mode, apply the configured dynamic and stable exceptions. Prior-run reuse is disabled. Select every validated eligible package that makes a material, non-redundant contribution to the requested focused or broad experience; use judgment rather than a fixed package count, and never add filler. PDFs and non-PDFs compete on evidence value, not format; keep useful native companions and report selected/rejected format distribution without quotas. Prefer current authoritative citywide or closest-available anchors followed by complementary detailed sources. Write draft/manifest.json, draft/comparison.md, draft/handoff.md, and draft/run_summary.json, including scope exclusions and supporting-dependency dispositions. Keep the draft compact but evidence-linked so a reviewer need not repeat discovery. The selected package list lives in draft/manifest.json. Return complete/evidence/unresolved plus manifest_path, handoff_path, and selected_count. ${COMPACT}`,
    stageSchema({ manifest_path: pathProp, handoff_path: pathProp, selected_count: { type: "number" } })
  );

  if (!consolidate.ok) {
    consolidate = await runStage(
      "consolidate-recovery",
      `${brief} Recover an interrupted draft consolidation. Current-run lane outputs are under ${outputDir}/lanes/ and partial draft files may exist under ${outputDir}/draft/. In the first tool turn batch-read the request, every lane validation.json and candidates.json, plus any existing draft/manifest.json, draft/comparison.md, draft/handoff.md, and draft/run_summary.json. Do not browse, search, download, revalidate files, or restart synthesis. Preserve correct partial draft content. Apply scope, strict freshness, authority, geographic-denominator, deduplication, and material non-redundancy gates to the available validated lane evidence. By turn 3 ensure all four draft files exist and reconcile their selected IDs/counts. After turn 5 perform no tool calls. Reserve the final turn exclusively for submit_result. Return complete/evidence/unresolved plus manifest_path=${outputDir}/draft/manifest.json, handoff_path=${outputDir}/draft/handoff.md, and selected_count. ${COMPACT}`,
      stageSchema({ manifest_path: pathProp, handoff_path: pathProp, selected_count: { type: "number" } })
    );
  }

  if (!consolidate.ok) {
    const report = { status: "partial", failed_stage: "consolidate", stages, unresolved: ["draft consolidation did not complete"], notes, wonder_calls: wonderCalls };
    return { ...report, summary: JSON.stringify(report) };
  }

  // 4. Wonder reviewer: challenge strategy and selection without redoing tool work.
  let review = resume ? {
    ok: true,
    result: { ref: `${outputDir}/review.json` },
    data: { complete: true, approved: false, review_path: `${outputDir}/review.json`, must_fix: [], risk_count: 0, evidence: [`${outputDir}/review.json`], unresolved: [] },
  } : await runStage(
    "strategic-review",
    `${brief} Act as a read-only senior subsurface research reviewer. Read the request, empty inventory, evidence map, current-run lane outputs, and the four files under ${outputDir}/draft/. Do not search, download, edit, consolidate, rerun validation, or edit lessons. First audit scope compliance: in focused mode, every lane and selection must map to an included domain or an explicit direct supporting dependency. Confirm no prior-run source was reused. Then test whether focused-domain coverage is complete, the baseline/successor checks are credible, the configured freshness window was enforced for current dynamic evidence, older stable or historical evidence has a valid role, every lane completed a credible native-format sweep, geographic claims match their denominator, selected packages have high marginal and visual value, PDFs were neither privileged nor demoted, strong discovered sources were not deferred for arbitrary counters, and unresolved gaps are honestly represented. Write ${outputDir}/review.json with approved, concise must_fix items, risks, and evidence references. Distinguish required fixes from optional improvements. Return complete/evidence/unresolved plus approved, review_path, must_fix (short titles only, at most 6 under 120 chars each; full detail stays in review.json), and risk_count. ${COMPACT}`,
    stageSchema({ approved: { type: "boolean" }, must_fix: { type: "array", items: { type: "string" } }, risk_count: { type: "number" }, review_path: pathProp }),
    WONDER
  );
  if (resume) stages.push({ scope: "strategic-review-reused", ref: `${outputDir}/review.json`, complete: true, model: "durable-artifact", error_kind: null });
  if (!review.ok) {
    review = await runStage(
      "strategic-review-spark-fallback",
      `${brief} Wonder review was unavailable. Perform the same read-only review using current-run request, evidence map, lane outputs, and ${outputDir}/draft/. Do not browse, download, edit draft files, or repeat validation. Write ${outputDir}/review.json with approval, concise must_fix items, risks, and evidence references. Return complete/evidence/unresolved plus approved, review_path, must_fix, and risk_count. ${COMPACT}`,
      stageSchema({ approved: { type: "boolean" }, must_fix: { type: "array", items: { type: "string" } }, risk_count: { type: "number" }, review_path: pathProp })
    );
  }

  // 5. Spark repair/finalizer: resolve review findings and verify final artifacts.
  const reviewInstruction = review.ok
    ? `Read ${review.data.review_path}; repair any defect that affects the selected package's validity. Disposition unavailable-source, missing-coverage, and additional-research findings as explicit limitations rather than reopening discovery.`
    : "The independent Wonder review was unavailable. Re-audit the draft against every WORKFLOW.md self-check and record this degraded condition.";
  const finalizeTask = resume
    ? `${brief} RESUMED FINALIZATION ONLY. Read the four existing files under ${outputDir}/draft/, ${outputDir}/review.json, and validation.json for each selected source. ${reviewInstruction} Do not browse, search, fetch, download, inspect rejected leads, or reopen completed discovery lanes. Preserve the current validated selection. By turn 2 write final root manifest.json, comparison.md, handoff.md, and run_summary.json from the reconciled draft. By turn 4 write verification.md after checking selected local files, recorded hashes/sizes, JSON validity, scope, freshness disposition, and required fields. Missing sources, incomplete lanes, and coverage gaps must remain explicit limitations and do not block completion. Return complete=true when at least one selected in-scope local source validates and all five required final artifacts exist and parse; return false only for fabricated evidence, wrong city/scope, zero valid selected files, or invalid required outputs. Reserve the final turn exclusively for submit_result. Return complete/evidence/unresolved plus manifest_path, handoff_path, verification_path, and selected_count. ${COMPACT}`
    : `${brief} Prior scout: ${scout.result.ref}. Prior lanes: ${liveLanes.join(" ")}. Draft synthesis: ${consolidate.result.ref}. ${reviewInstruction} Act as the Spark repair and final-verification agent. Continue with additional in-scope searches, fetches, downloads, or validation whenever needed to resolve a material review finding, replace stale current-state evidence, obtain a clearly stronger source, or complete a missing native-format sweep. Do not broaden a focused request. Stop on in-scope evidence saturation or documented external unavailability, never because an arbitrary activity counter was reached. Produce the final root manifest.json, comparison.md, handoff.md, and run_summary.json. Record scope compliance and exclusions, direct supporting dependencies, whether the lessons file was loaded, the freshness-policy disposition of every older selection, and selected/rejected media-type distributions, but never edit the lessons file. Then execute the complete WORKFLOW.md self-check using available tools: confirm every selected source is in scope, reopen selected files, recompute sha256 and sizes, perform format-appropriate validation, validate recorded counts, reconcile activity telemetry, and confirm required paths and schema fields. Write verification.md with pass/fail evidence and unresolved items. An incomplete lane, unavailable source, uneven coverage, reviewer disagreement, or research gap is a limitation rather than a failure when at least one useful validated in-scope source remains and the required final files validate. Return complete=true in that usable case and preserve every limitation honestly; return false only for a WORKFLOW.md hard gate, zero usable sources, or invalid required outputs. The selected package list lives in the final manifest.json. Return complete/evidence/unresolved plus manifest_path, handoff_path, verification_path, and selected_count. ${COMPACT}`;
  const finalize = await runStage(
    "repair-and-finalize",
    finalizeTask,
    stageSchema({ manifest_path: pathProp, handoff_path: pathProp, verification_path: pathProp, selected_count: { type: "number" } }),
    SPARK,
    `${brief} FINALIZATION RECOVERY ONLY. The prior finalizer wrote some root outputs before its turn cap. Inspect only the fixed paths ${outputDir}/manifest.json, comparison.md, handoff.md, run_summary.json, verification.md, the draft equivalents, review.json, and validation.json for selected sources. Preserve every valid existing root file byte-for-byte. By turn 2 create or repair only missing/invalid required root files, especially handoff.md and verification.md. Do not browse, search, download, revisit rejected leads, rerun discovery, or expand research. Validate that at least one selected local source exists and its recorded size/hash/scope are consistent; record all missing coverage as limitations. By turn 3 submit complete=true with manifest_path=${outputDir}/manifest.json, handoff_path=${outputDir}/handoff.md, verification_path=${outputDir}/verification.md, and selected_count from manifest.json. Return false only for zero valid selected files, fabricated evidence, wrong city/scope, or an unwritable/invalid required output. ${COMPACT}`
  );

  // 6. Wonder ranker: order the final validated documents for downstream top-N use.
  // Canonical downloads and manifest paths remain untouched; ordered copies are
  // an access layer and therefore cannot invalidate source hashes or provenance.
  let ranking = finalize.ok ? await runStage(
    "information-value-ranking",
    `${brief} Final manifest: ${finalize.data.manifest_path}. Final handoff: ${finalize.data.handoff_path}. Act as the Wonder information-value ranker. Rank every final selected source by how much useful understanding it can contribute to the requested study, not by file size, page count, format, or publisher prestige alone. Use the final manifest, handoff, comparison, lane excerpts, and validation summaries first; inspect only a document's title page, abstract/executive summary, table of contents, key tables/figures, or equivalent high-signal portions when those artifacts are insufficient. Do not reread or summarize every page, browse, download, change selections, or edit canonical files. Apply a generic evidence rubric: requested-scope relevance; density and specificity of usable measurements; vertical/depth and spatial detail where applicable; geographic coverage with its true denominator; explanatory and visual value for users; downstream extractability; authority/freshness; and unique contribution versus other selected sources. Do not reward verbosity, duplicate coverage, or PDFs as a format. Write ${outputDir}/document_ranking.json with rubric_version, ranked_count, and ranked_documents[] containing rank, source_id, original_local_path, ranked_local_path, information_value_score (0-100), criterion_scores, concise rationale, key_information, limitations, and recommended_use. Create ${outputDir}/ranked/ and place a byte-identical copy of every selected source there named with a zero-padded rank prefix, for example 01__<original-filename>; never rename, move, or modify the canonical download. Recompute each ranked copy's hash and confirm it matches the canonical source. Also write ${outputDir}/document_ranking.md as a concise human-readable table. Ties must be broken by unique downstream contribution, then scope relevance. Return complete/evidence/unresolved plus ranking_path, ranking_markdown_path, ranked_dir, and ranked_count. ${COMPACT}`,
    stageSchema({ ranking_path: pathProp, ranking_markdown_path: pathProp, ranked_dir: pathProp, ranked_count: { type: "number" } }),
    WONDER
  ) : { ok: false, data: null };
  if (finalize.ok && !ranking.ok) {
    ranking = await runStage(
      "information-value-ranking-spark-fallback",
      `${brief} Wonder ranking was unavailable. Read ${finalize.data.manifest_path}, ${finalize.data.handoff_path}, comparison.md, lane excerpts, and validation summaries. Rank every selected source by study relevance, measurement density, spatial/depth detail, explanatory value, extractability, authority/freshness, and unique contribution. Do not browse, download, or alter canonical files. Write ${outputDir}/document_ranking.json and document_ranking.md; create byte-identical ranked/ copies with zero-padded rank prefixes and verify hashes. Return complete/evidence/unresolved plus ranking_path, ranking_markdown_path, ranked_dir, and ranked_count. ${COMPACT}`,
      stageSchema({ ranking_path: pathProp, ranking_markdown_path: pathProp, ranked_dir: pathProp, ranked_count: { type: "number" } })
    );
  }

  const outputs = {
    inventory: inventory.data.inventory_path,
    evidence_map: scout.data.evidence_map_path,
    lanes: scout.data.lanes_path,
    lane_ids: scout.data.lane_ids,
    lessons_loaded: inventory.data.lessons_loaded,
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
