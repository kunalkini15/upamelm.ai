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

async function workflow(host) {
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
 * @param {boolean} [host.args.resume=false] - Resume a validated partial run from fixed durable artifacts.
 * @param {string} [host.args.runs_dir=muse-document-processing/runs] - Dry-run search root when output_dir is omitted.
 * @returns {Promise<Object>} Execution report containing status, artifact paths, and token telemetry.
 */
const SPARK = "muse-spark-1.3-contributor";
const WONDER = "muse-wonder-1.0";
const MAX_WONDER_CALLS = 2;
const MAX_CONTINUATION_CHILDREN = 10;

async function workflow(host) {
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
 * @param {boolean} [host.args.resume=false] - Resume the same run from validated durable artifacts.
 * @param {string} [host.args.failure_report] - Failure report to audit (defaults to output_dir/failure_report.json).
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
 * @param {boolean} [host.args.resume=false] - Continue a validated partial live run from its durable checkpoint.
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
  const forcedResume = args.resume === true;

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
    if (result && (result.error_kind === "generated_child_model_step_cap" || result.data_spilled_for_size === true)) {
      try {
        result = await host.agent({
          input: `${input} RECOVERY: A prior agent was interrupted after writing durable artifacts. Inspect and reuse those artifacts; do not repeat completed work. Finish only missing checks/writes, keep the response compact, and reserve the final turn for the schema submission.`,
          schema: stageSchema,
          label: `${scope}-recovery`,
          model: SPARK,
        });
      } catch { result = null; }
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

  async function persistFailure(cfg, failedStage, message, report, safeRetryPoint = "ingestion") {
    const childSummary = report && typeof report.summary === "string" ? report.summary : JSON.stringify(report || {});
    const recorded = await run(
      "record-pipeline-failure",
      `Write or replace ${cfg.pipeline_dir}/failure_report.json as concise valid JSON for the latest aborted pipeline. Do not modify or remove any other file. Record status="partial", failed_stage=${JSON.stringify(failedStage)}, message=${JSON.stringify(message)}, safe_retry_point=${JSON.stringify(safeRetryPoint)}, and the current ISO timestamp. Set downstream_stages_skipped according to the failed stage. From the child workflow report below, preserve child_failed_stage, failed lanes/stages with their error_kind, unresolved items, and completed artifact paths explicitly present. Do not preserve stale failure fields from an earlier attempt. Do not invent details. Child workflow report: ${childSummary}. Return complete/evidence/unresolved plus failure_report_path. ${COMPACT}`,
      schema({ failure_report_path: path })
    );
    return recorded.ok ? recorded.data.failure_report_path : null;
  }

  // 0. Freeze the pipeline request and normalize config. File reads happen
  // here inside the agent because the orchestrator script itself does no I/O.
  const requestLine = args.request
    ? `Pipeline request file: ${args.request}. Read it completely. Inline overrides (authoritative when present): ${JSON.stringify(args)}.`
    : `No request file; use these inline args as the request: ${JSON.stringify(args)}.`;
  const plan = await run(
    "pipeline-planner",
    `${requestLine} Normalize resume and dry_run (both default false and cannot both be true), max_docs defaults to 5 (positive integer), languages per muse-translate/contracts.md, doc_ids defaults [], fanout defaults parallel, and concurrency defaults 3. For a fresh run, create <pipeline_dir> and freeze the effective config as <pipeline_dir>/pipeline_request.json. For resume=true, do not overwrite anything: read the existing <pipeline_dir>/pipeline_request.json and failure_report.json, require the requested paths/city/scope/languages to match the frozen config, and return that frozen config with resume=true. In dry_run mode, stage dirs identify compatible completed caches. Write nothing outside <pipeline_dir> except creating stage output dirs in fresh live mode. ${COMPACT} Return complete/evidence/unresolved plus ingest_request, ingest_run, studies_dir, translate_dir, pipeline_dir, dry_run, resume, max_docs, languages, doc_ids, study_concurrency, translate_concurrency, and fanout={study,translate}.`,
    schema(
      { ingest_request: path, ingest_run: path, studies_dir: path, translate_dir: path, pipeline_dir: path, dry_run: { type: "boolean" }, resume: { type: "boolean" }, max_docs: { type: "integer" }, languages: { type: "array", items: path }, doc_ids: { type: "array", items: path }, study_concurrency: { type: "integer" }, translate_concurrency: { type: "integer" }, fanout: { type: "object", required: ["study", "translate"], properties: { study: { type: "string", enum: ["sequential", "parallel"] }, translate: { type: "string", enum: ["sequential", "parallel"] } } } },
      ["ingest_request", "ingest_run", "studies_dir", "translate_dir", "pipeline_dir", "dry_run", "resume", "max_docs", "languages", "doc_ids", "fanout"]
    )
  );
  // During resume, the planner may truthfully describe the *prior pipeline*
  // as incomplete while still returning a fully validated resume config. The
  // dedicated resume preflight below owns checkpoint acceptance; do not turn
  // that expected prior-run state into a circular planner failure.
  const plannerAccepted = plan.ok || (forcedResume && plan.data && plan.data.resume === true);
  if (!plannerAccepted) return partial("pipeline-planner", "pipeline request was not frozen or config is invalid");
  const cfg = plan.data;
  // Invocation/request fields are authoritative. Planner output is useful for
  // validation and freezing, but must never silently change execution scope.
  for (const key of ["ingest_request", "ingest_run", "studies_dir", "translate_dir", "pipeline_dir", "max_docs", "doc_ids", "languages", "study_concurrency", "translate_concurrency"]) {
    if (args[key] !== undefined) cfg[key] = args[key];
  }
  if (args.study_fanout !== undefined) cfg.study_fanout = args.study_fanout;
  if (args.translate_fanout !== undefined) cfg.translate_fanout = args.translate_fanout;
  cfg.pipeline_request_path = `${cfg.pipeline_dir}/pipeline_request.json`;
  if (forcedDryRun) cfg.dry_run = true;
  if (forcedResume) cfg.resume = true;
  if (cfg.dry_run && cfg.resume) return partial("pipeline-planner", "dry_run and resume cannot both be true");
  cfg.study_fanout = args.study_fanout || cfg.fanout?.study || cfg.study_fanout || "parallel";
  cfg.translate_fanout = args.translate_fanout || cfg.fanout?.translate || cfg.translate_fanout || "parallel";
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

  // Live runs are write-once. Stop before model work if any stage destination
  // already exists or aliases another configured root. The planner may create
  // pipeline_dir only to freeze pipeline_request.json.
  if (!cfg.dry_run && !cfg.resume) {
    const preflight = await run(
      "pipeline-preflight",
      `Read-only preflight for a new live run. Configured paths: pipeline_dir=${cfg.pipeline_dir}, ingest_run=${cfg.ingest_run}, studies_dir=${cfg.studies_dir}, translate_dir=${cfg.translate_dir}. Confirm all four normalized paths are distinct and none is nested inside another. Confirm ingest_run, studies_dir, and translate_dir do not exist. Confirm pipeline_dir contains exactly pipeline_request.json and no other entry. Confirm ${cfg.pipeline_request_path} exists, parses as JSON, and its effective pipeline_dir is ${cfg.pipeline_dir}. Return distinct_path_count=4, existing_stage_destination_count=0, and pipeline_entry_count=1 only when those facts were directly verified. Do not create, edit, delete, move, or rename anything. Return complete=false on any collision, prior output, unexpected entry, invalid request, or ambiguous path.`,
      schema({
        checked_paths: { type: "array", items: path },
        distinct_path_count: { type: "integer" },
        existing_stage_destination_count: { type: "integer" },
        pipeline_entry_count: { type: "integer" },
      })
    );
    const safeDestination = preflight.ok
      && preflight.data.distinct_path_count === 4
      && preflight.data.existing_stage_destination_count === 0
      && preflight.data.pipeline_entry_count === 1;
    if (!safeDestination) {
      failures.push({ stage: "pipeline-preflight", status: "unsafe_destination" });
      return partial("pipeline-preflight", "live run destinations are not fresh, distinct, and write-safe", { outputs: { pipeline_request: cfg.pipeline_request_path } });
    }
  }
  if (cfg.resume) {
    const resumePreflight = await run(
      "pipeline-resume-preflight",
      `Read-only resume preflight. Require ${cfg.pipeline_dir}/failure_report.json with status=partial and safe_retry_point equal to ingestion or study-fanout. Require ${cfg.pipeline_request_path} and the fixed artifacts appropriate to that retry point. For ingestion require the ingestion request/inventory/evidence map/lanes. For study-fanout require completed ingestion manifest/ranking plus at least one study failure_report.json and matching frozen study request/checkpoint. Confirm all configured roots and source identities match and no completed pipeline_summary.json or bundle_verification.json marks this run complete. Do not create, edit, delete, move, rename, extract, or rehash valid recorded artifacts. Return complete=true only when intentional resume is safe.`,
      schema({ failure_report_path: path, child_failed_stage: path, checkpoint_path_count: { type: "integer" } })
    );
    // `complete=true` is the contract decision. The ingestion workflow performs
    // its own independent artifact audit next; do not override a passed audit
    // using advisory counters that a model may conservatively leave at zero.
    if (!resumePreflight.ok) {
      failures.push({ stage: "pipeline-resume-preflight", status: "unsafe_resume" });
      return partial("pipeline-resume-preflight", "partial run checkpoint is missing or incompatible", { outputs: { pipeline_request: cfg.pipeline_request_path } });
    }
  }

  // 1. Document ingestion: city request -> manifest + ranked documents.
  let ingest;
  try {
    ingest = await runners.ingest({ ...host, args: { request: cfg.ingest_request, output_dir: cfg.ingest_run, dry_run: cfg.dry_run, resume: cfg.resume === true, checkpoint_validated: cfg.resume === true, failure_report: `${cfg.pipeline_dir}/failure_report.json` } });
  } catch {
    failures.push({ stage: "ingestion", status: "workflow_exception" });
    const failureReport = await persistFailure(cfg, "ingestion", "ingestion workflow raised an exception; downstream stages skipped", null);
    return partial("ingestion", "ingestion workflow raised an exception; downstream stages skipped", { outputs: { pipeline_request: cfg.pipeline_request_path, failure_report: failureReport } });
  }
  track("ingestion", ingest);
  if (!okStatus(ingest)) {
    failures.push({ stage: "ingestion", status: ingest ? ingest.status : "no_report" });
    const failureReport = await persistFailure(cfg, "ingestion", "ingestion did not complete; downstream stages skipped", ingest);
    return partial("ingestion", "ingestion did not complete; downstream stages skipped", { outputs: { pipeline_request: cfg.pipeline_request_path, failure_report: failureReport } });
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
  const promotedDocs = promoteIngest.data.selected_docs;
  // Enforce selection cardinality in code as well as in the agent prompt. A
  // promotion agent may return extra valid rows; that must not broaden work.
  const selectedDocs = Array.isArray(cfg.doc_ids) && cfg.doc_ids.length > 0
    ? cfg.doc_ids.map((id) => promotedDocs.find((doc) => doc.id === id)).filter(Boolean)
    : promotedDocs.slice(0, maxDocs);
  if (selectedDocs.length < 1 || (cfg.doc_ids?.length && selectedDocs.length !== cfg.doc_ids.length)) {
    failures.push({ stage: "promote-ingestion", status: "selection_scope_mismatch" });
    return partial("promote-ingestion", "promoted document selection does not match the authoritative request", { outputs: { pipeline_request: cfg.pipeline_request_path, ingestion: promoteIngest.data.promoted_dir } });
  }

  // 3. Study fan-out: one document-processing run per selected document.
  // A failed document never blocks its siblings; downstream stages process
  // exactly the completed subset.
  const runStudy = (doc) => runners.study({ ...host, args: { document: doc.source_path, output_dir: `${cfg.studies_dir}/${doc.id}`, runs_dir: cfg.studies_dir, dry_run: cfg.dry_run, resume: cfg.resume === true } });
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
  if (studies.length < 1) {
    const studyFailure = studyReports.find((report) => !okStatus(report)) || null;
    const failureReport = await persistFailure(cfg, "study-fanout", "no study completed; translation skipped", studyFailure, "study-fanout");
    return partial("study-fanout", "no study completed; translation skipped", { outputs: { pipeline_request: cfg.pipeline_request_path, ingestion: promoteIngest.data.promoted_dir, selected_docs: selectedDocs, failure_report: failureReport } });
  }

  // 4. Promote-studies: key study files per document into the root folder.
  const promoteStudies = await run(
    "promote-studies",
    `${BASE} Completed studies: ${studies.map((s) => `${s.id} (report: ${s.report.summary}, dir: ${s.output_dir})`).join("; ")}. For each, copy the key files that exist (study_package.json, narrative_package.json, report.json, grounding_selfcheck.json) from its study dir into ${cfg.pipeline_dir}/studies/<doc-id>/ without renaming. Make that promoted study self-contained for UI rendering: recursively inspect path/asset_path/transcription_path and other file-valued strings in the promoted packages; copy every referenced resource, image, OCR file, table, and source document that exists into the promoted study while preserving study-relative resources/ and source-cache/ paths and placing ingestion documents under source/. In promoted copies only, rebase project-relative source-run paths to those local relative paths. Never edit the original run outputs. Write asset_manifest.json containing local_path and original source_path for every copied dependency. Treat any referenced-but-missing rendering dependency as a promotion failure. Return complete/evidence/unresolved plus promoted_dirs (array of {id, dir}), promoted_ids, study_count, and total asset_count.`,
    schema({ promoted_dirs: { type: "array", items: { type: "object", required: ["id", "dir"], properties: { id: path, dir: path } } }, promoted_ids: { type: "array", items: path }, study_count: { type: "integer" }, asset_count: { type: "integer" } })
  );
  const expectedStudyIds = studies.map((study) => study.id).sort();
  const promotedStudyIds = (promoteStudies.data?.promoted_ids || []).slice().sort();
  const studiesPromotedExactly = promoteStudies.ok
    && promoteStudies.data.study_count === studies.length
    && promoteStudies.data.promoted_dirs.length === studies.length
    && JSON.stringify(promotedStudyIds) === JSON.stringify(expectedStudyIds);
  if (!studiesPromotedExactly) {
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
    `${BASE} Completed translations: ${translations.map((t) => `${t.id} (report: ${t.report.summary}, dir: ${t.output_dir})`).join("; ") || "(none)"}. Failed stages (record these verbatim in the summary failure lists): ${JSON.stringify(failures)}. For each completed translation, read inventory.json/run_summary.json to enumerate its verified outputs. Copy every requested language artifact that exists—study_package_<lang>.json, narrative_package_<lang>.json, and report_<lang>.json—without renaming into BOTH ${cfg.pipeline_dir}/studies/<doc-id>/ (canonical single-folder UI serving location beside the source-language files) and ${cfg.pipeline_dir}/translations/<doc-id>/ (translation-stage mirror). In promoted copies only, apply the same study-local path rebasing recorded by ${cfg.pipeline_dir}/studies/<doc-id>/asset_manifest.json so translated packages reference local resources/, source-cache/, and source/ assets; keep the canonical study and translation mirror copies identical. Copy request.json, inventory.json, verification.md, and run_summary.json into the translation-stage mirror only. Missing an inventoried language artifact or an asset-manifest mapping needed by a translated package is a promotion failure; never silently omit it. Then write ${cfg.pipeline_dir}/pipeline_summary.json recording execution_mode (${cfg.dry_run ? "dry_run" : "live"}), the pipeline request path, resolved/reused ingestion run, selected docs with ranks, resolved/reused study and translation directories, completed/failed studies, completed/failed translations, languages, effective concurrency (study ${studyConcurrency}, translation ${translateConcurrency}), and promoted dirs. Never edit run outputs; copy only. Return complete/evidence/unresolved plus promoted_dirs (array of {id, dir}), promoted_ids, summary_path, translation_count, and language_artifact_count (three package files per completed document per requested language).`,
    schema({ promoted_dirs: { type: "array", items: { type: "object", required: ["id", "dir"], properties: { id: path, dir: path } } }, promoted_ids: { type: "array", items: path }, summary_path: path, translation_count: { type: "integer" }, language_artifact_count: { type: "integer" } })
  );
  const expectedTranslationIds = translations.map((translation) => translation.id).sort();
  const promotedTranslationIds = (promoteTranslations.data?.promoted_ids || []).slice().sort();
  const expectedLanguageArtifactCount = translations.length * cfg.languages.length * 3;
  const translationsPromotedExactly = promoteTranslations.ok
    && promoteTranslations.data.translation_count === translations.length
    && promoteTranslations.data.promoted_dirs.length === translations.length
    && promoteTranslations.data.language_artifact_count === expectedLanguageArtifactCount
    && JSON.stringify(promotedTranslationIds) === JSON.stringify(expectedTranslationIds);
  if (!translationsPromotedExactly) failures.push({ stage: "promote-translations", status: "promotion_failed_or_incomplete" });

  // One decisive release gate reads the consolidated city folder, not child
  // reports. A run cannot be complete while the backend bundle is incomplete.
  const bundleAudit = await run(
    "verify-city-bundle",
    `${BASE} Final audit. Expected selected IDs: ${selectedDocs.map((doc) => doc.id).join(",")}. Expected completed study IDs: ${studies.map((study) => study.id).join(",")}. Expected completed translation IDs: ${translations.map((translation) => translation.id).join(",")}. Expected languages: ${cfg.languages.join(",")}. Inspect the actual filesystem under ${cfg.pipeline_dir}. Require pipeline_request.json and pipeline_summary.json; all promoted ingestion metadata; one studies/<id>/ per completed study with source-language study/narrative/report/grounding files, asset_manifest.json, every requested translated study/narrative/report package, and every resources/, source-cache/, or source/ dependency referenced by any promoted package; one translations/<id>/ per completed translation with request, inventory, verification, run_summary, and every requested translated package. Parse every JSON. Reject any package path that points to muse-document-processing/runs or muse-source-ingestion/runs. Confirm pipeline summary counts, IDs, languages, and paths match this bundle. Write the complete audit result to ${cfg.pipeline_dir}/bundle_verification.json even when invalid; this is the only file this audit may write. Return complete=true only if the bundle is backend-ready and internally self-contained.`,
    schema({ valid: { type: "boolean" }, audit_path: path, study_count: { type: "integer" }, translation_count: { type: "integer" }, language_artifact_count: { type: "integer" }, asset_count: { type: "integer" }, missing_paths: { type: "array", items: path }, external_reference_count: { type: "integer" } })
  );
  const bundleValid = bundleAudit.ok
    && bundleAudit.data.valid === true
    && bundleAudit.data.audit_path === `${cfg.pipeline_dir}/bundle_verification.json`
    && bundleAudit.data.study_count === studies.length
    && bundleAudit.data.translation_count === translations.length
    && bundleAudit.data.language_artifact_count === expectedLanguageArtifactCount
    && bundleAudit.data.external_reference_count === 0
    && bundleAudit.data.missing_paths.length === 0;
  if (!bundleValid) failures.push({ stage: "verify-city-bundle", status: "bundle_invalid" });

  const outputs = {
    pipeline_request: cfg.pipeline_request_path,
    pipeline_dir: cfg.pipeline_dir,
    ingestion: promoteIngest.data.promoted_dir,
    ingestion_promoted_paths: promoteIngest.data.promoted_paths,
    selected_docs: selectedDocs,
    studies: studies.map((s) => ({ id: s.id, output_dir: s.output_dir })),
    studies_dir: promoteStudies.data ? promoteStudies.data.promoted_dirs : [],
    translations: translations.map((t) => ({ id: t.id, output_dir: t.output_dir })),
    translations_dir: translationsPromotedExactly ? promoteTranslations.data.promoted_dirs : [],
    pipeline_summary: translationsPromotedExactly ? promoteTranslations.data.summary_path : null,
    bundle_audit: bundleAudit.data || null,
  };
  if (failures.length > 0) return partial("pipeline", `${failures.length} stage(s) did not complete but siblings were preserved`, { outputs });
  return finish({ status: "complete", dry_run: cfg.dry_run, outputs, stages, failures, unresolved: [], notes });
}


