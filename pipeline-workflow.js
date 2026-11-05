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

import ingestWorkflow from "./muse-source-ingestion/ingest-workflow.js";
import studyWorkflow from "./muse-document-processing/study-workflow.js";
import translateWorkflow from "./muse-translate/translate-workflow.js";

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
