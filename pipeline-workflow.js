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
    `${BASE} Completed studies: ${studies.map((s) => `${s.id} (report: ${s.report.summary}, dir: ${s.output_dir})`).join("; ")}. For each, copy the key files that exist (study_package.json, narrative_package.json, report.json, grounding_selfcheck.json) from its study dir into ${cfg.pipeline_dir}/studies/<doc-id>/ without renaming. Make that promoted study self-contained for UI rendering: recursively inspect path/asset_path/transcription_path and other file-valued strings in the promoted packages; copy every referenced resource, image, OCR file, table, and source document that exists into the promoted study while preserving study-relative resources/ and source-cache/ paths and placing ingestion documents under source/. In promoted copies only, rebase project-relative source-run paths to those local relative paths. Never edit the original run outputs. Write asset_manifest.json containing local_path and original source_path for every copied dependency. Treat any referenced-but-missing rendering dependency as a promotion failure. Return complete/evidence/unresolved plus promoted_dirs (array of {id, dir}) and study_count.`,
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
    `${BASE} Completed translations: ${translations.map((t) => `${t.id} (report: ${t.report.summary}, dir: ${t.output_dir})`).join("; ") || "(none)"}. Failed stages (record these verbatim in the summary failure lists): ${JSON.stringify(failures)}. For each completed translation, read inventory.json/run_summary.json to enumerate its verified outputs. Copy every requested language artifact that exists—study_package_<lang>.json, narrative_package_<lang>.json, and report_<lang>.json—without renaming into BOTH ${cfg.pipeline_dir}/studies/<doc-id>/ (canonical single-folder UI serving location beside the source-language files) and ${cfg.pipeline_dir}/translations/<doc-id>/ (translation-stage mirror). In promoted copies only, apply the same study-local path rebasing recorded by ${cfg.pipeline_dir}/studies/<doc-id>/asset_manifest.json so translated packages reference local resources/, source-cache/, and source/ assets; keep the canonical study and translation mirror copies identical. Copy request.json, inventory.json, verification.md, and run_summary.json into the translation-stage mirror only. Missing an inventoried language artifact or an asset-manifest mapping needed by a translated package is a promotion failure; never silently omit it. Then write ${cfg.pipeline_dir}/pipeline_summary.json recording execution_mode (${cfg.dry_run ? "dry_run" : "live"}), the pipeline request path, resolved/reused ingestion run, selected docs with ranks, resolved/reused study and translation directories, completed/failed studies, completed/failed translations, languages, effective concurrency (study ${studyConcurrency}, translation ${translateConcurrency}), and promoted dirs. Never edit run outputs; copy only. Return complete/evidence/unresolved plus promoted_dirs (array of {id, dir}), summary_path, and translation_count.`,
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
