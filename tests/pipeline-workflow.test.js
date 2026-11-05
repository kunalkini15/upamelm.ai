import { describe, it } from "node:test";
import assert from "node:assert/strict";
import workflow from "../pipeline-workflow.js";

const CFG = {
  pipeline_request_path: "runs/test-pipeline/pipeline_request.json",
  ingest_request: "muse-source-ingestion/requests/bengaluru.json",
  ingest_run: "muse-source-ingestion/runs/test-pipe",
  studies_dir: "muse-document-processing/runs/test-pipe",
  translate_dir: "muse-translate/runs/test-pipe",
  pipeline_dir: "runs/test-pipeline",
  dry_run: false,
  max_docs: 3,
  languages: ["kn", "hi"],
  doc_ids: [],
  study_fanout: "sequential",
  translate_fanout: "parallel",
  study_concurrency: 3,
  translate_concurrency: 3,
  fanout: { study: "sequential", translate: "parallel" },
};

const DOCS = [
  { id: "doc-a", rank: 1, source_path: "muse-source-ingestion/runs/test-pipe/ranked/01__a.pdf" },
  { id: "doc-b", rank: 2, source_path: "muse-source-ingestion/runs/test-pipe/ranked/02__b.pdf" },
  { id: "doc-c", rank: 3, source_path: "muse-source-ingestion/runs/test-pipe/ranked/03__c.pdf" },
];

const okReport = (extra) => ({ status: "complete", summary: JSON.stringify({ status: "complete", ...extra }), outputs: {}, ...(extra || {}) });
const agentResult = (label, data) => ({ ref: `ref-${label}`, usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }, data: { complete: true, evidence: [], unresolved: [], ...data } });

function hostFor({ planner = CFG, docs = DOCS, failStudy = null, preflightComplete = true, bundleValid = true } = {}) {
  const calls = [];
  const runnerCalls = [];
  const completedDocs = docs.filter((doc) => doc.id !== failStudy);
  const agent = async ({ label, input }) => {
    calls.push({ label, input });
    if (label === "pipeline-planner") return agentResult(label, planner);
    if (label === "pipeline-preflight") return preflightComplete
      ? agentResult(label, { checked_paths: [CFG.pipeline_dir, CFG.ingest_run, CFG.studies_dir, CFG.translate_dir], distinct_path_count: 4, existing_stage_destination_count: 0, pipeline_entry_count: 1 })
      : { ref: "ref-pipeline-preflight", data: { complete: false, evidence: [], unresolved: ["destination exists"], checked_paths: [], distinct_path_count: 4, existing_stage_destination_count: 1, pipeline_entry_count: 2 } };
    if (label === "pipeline-resume-preflight") return agentResult(label, { failure_report_path: `${CFG.pipeline_dir}/failure_report.json`, child_failed_stage: "consolidate", checkpoint_path_count: 8 });
    if (label === "record-pipeline-failure") return agentResult(label, { failure_report_path: `${CFG.pipeline_dir}/failure_report.json` });
    if (label === "promote-ingestion") {
      return agentResult(label, { promoted_dir: `${CFG.pipeline_dir}/ingestion`, promoted_paths: [`${CFG.pipeline_dir}/ingestion/manifest.json`], selected_docs: docs });
    }
    if (label === "promote-studies") {
      return agentResult(label, { promoted_dirs: completedDocs.map((d) => ({ id: d.id, dir: `${CFG.pipeline_dir}/studies/${d.id}` })), promoted_ids: completedDocs.map((d) => d.id), study_count: completedDocs.length, asset_count: completedDocs.length });
    }
    if (label === "promote-translations") {
      return agentResult(label, { promoted_dirs: completedDocs.map((d) => ({ id: d.id, dir: `${CFG.pipeline_dir}/translations/${d.id}` })), promoted_ids: completedDocs.map((d) => d.id), summary_path: `${CFG.pipeline_dir}/pipeline_summary.json`, translation_count: completedDocs.length, language_artifact_count: completedDocs.length * CFG.languages.length * 3 });
    }
    if (label === "verify-city-bundle") return agentResult(label, { valid: bundleValid, audit_path: `${CFG.pipeline_dir}/bundle_verification.json`, study_count: completedDocs.length, translation_count: completedDocs.length, language_artifact_count: completedDocs.length * CFG.languages.length * 3, asset_count: completedDocs.length, missing_paths: bundleValid ? [] : ["studies/doc-a/resources/missing.json"], external_reference_count: 0 });
    throw new Error(`unexpected agent ${label}`);
  };
  const runners = {
    ingest: async (h) => { runnerCalls.push({ stage: "ingest", args: h.args }); return okReport({ outputs: { document_ranking: `${CFG.ingest_run}/document_ranking.json`, ranked_dir: `${CFG.ingest_run}/ranked` } }); },
    study: async (h) => {
      runnerCalls.push({ stage: "study", args: h.args });
      const id = h.args.output_dir.split("/").pop();
      if (id === failStudy) return { status: "partial", summary: JSON.stringify({ status: "partial" }), outputs: {} };
      return okReport({});
    },
    translate: async (h) => { runnerCalls.push({ stage: "translate", args: h.args }); return okReport({}); },
  };
  return { args: { request: "pipeline-requests/bengaluru.json" }, agent, runners, calls, runnerCalls };
}

describe("pipeline orchestrator", () => {
  it("runs ingest, top-N study fan-out, and per-study translate with root promotion", async () => {
    const host = hostFor();
    const report = await workflow(host);
    assert.equal(report.status, "complete");
    assert.deepEqual(host.calls.map((c) => c.label), ["pipeline-planner", "pipeline-preflight", "promote-ingestion", "promote-studies", "promote-translations", "verify-city-bundle"]);
    const translationPromotion = host.calls.find((c) => c.label === "promote-translations").input;
    assert.match(translationPromotion, /narrative_package_<lang>\.json/);
    assert.match(translationPromotion, /report_<lang>\.json/);
    assert.match(translationPromotion, /into BOTH .*\/studies\/<doc-id>\//);
    assert.match(translationPromotion, /asset_manifest\.json/);
    const studyPromotion = host.calls.find((c) => c.label === "promote-studies").input;
    assert.match(studyPromotion, /self-contained for UI rendering/);
    assert.match(studyPromotion, /asset_manifest\.json/);
    const ingest = host.runnerCalls.find((c) => c.stage === "ingest");
    assert.equal(ingest.args.request, CFG.ingest_request);
    assert.equal(ingest.args.output_dir, CFG.ingest_run);
    const studies = host.runnerCalls.filter((c) => c.stage === "study");
    assert.equal(studies.length, 3);
    assert.deepEqual(studies.map((c) => c.args.document), DOCS.map((d) => d.source_path));
    assert.deepEqual(studies.map((c) => c.args.output_dir), DOCS.map((d) => `${CFG.studies_dir}/${d.id}`));
    const translates = host.runnerCalls.filter((c) => c.stage === "translate");
    assert.equal(translates.length, 3);
    assert.deepEqual(translates.map((c) => c.args.input), DOCS.map((d) => `${CFG.studies_dir}/${d.id}`));
    assert.ok(translates.every((c) => c.args.output_dir.startsWith(CFG.translate_dir)));
    assert.deepEqual(translates[0].args.languages, ["kn", "hi"]);
    assert.equal(report.outputs.pipeline_summary, `${CFG.pipeline_dir}/pipeline_summary.json`);
    assert.equal(report.outputs.selected_docs.length, 3);
  });

  it("keeps siblings on a single study failure and reports partial", async () => {
    const host = hostFor({ failStudy: "doc-b" });
    const report = await workflow(host);
    assert.equal(report.status, "partial");
    const translates = host.runnerCalls.filter((c) => c.stage === "translate");
    assert.deepEqual(translates.map((c) => c.args.input), [`${CFG.studies_dir}/doc-a`, `${CFG.studies_dir}/doc-c`]);
    assert.ok(report.failures.some((f) => f.stage === "study:doc-b"));
    assert.equal(report.outputs.studies.length, 2);
  });

  it("stops after ingestion when ingestion fails", async () => {
    const host = hostFor();
    host.runners.ingest = async () => ({ status: "partial", summary: "{}", outputs: {} });
    const report = await workflow(host);
    assert.equal(report.status, "partial");
    assert.equal(report.failed_stage, "ingestion");
    assert.equal(host.runnerCalls.filter((c) => c.stage === "study").length, 0);
    assert.equal(report.outputs.failure_report, `${CFG.pipeline_dir}/failure_report.json`);
    assert.ok(host.calls.some((call) => call.label === "record-pipeline-failure"));
  });

  it("returns a structured partial report when ingestion throws", async () => {
    const host = hostFor();
    host.runners.ingest = async () => { throw new Error("boom"); };
    const report = await workflow(host);
    assert.equal(report.status, "partial");
    assert.equal(report.failed_stage, "ingestion");
    assert.ok(report.failures.some((failure) => failure.status === "workflow_exception"));
    assert.equal(report.outputs.failure_report, `${CFG.pipeline_dir}/failure_report.json`);
  });

  it("stops before ingestion when live destinations are not fresh", async () => {
    const host = hostFor({ preflightComplete: false });
    const report = await workflow(host);
    assert.equal(report.status, "partial");
    assert.equal(report.failed_stage, "pipeline-preflight");
    assert.equal(host.runnerCalls.length, 0);
  });

  it("resumes a validated partial ingestion without fresh-run preflight", async () => {
    const host = hostFor({ planner: { ...CFG, resume: false } });
    host.args.resume = true;
    const report = await workflow(host);
    assert.equal(report.status, "complete");
    assert.ok(host.calls.some((call) => call.label === "pipeline-resume-preflight"));
    assert.ok(!host.calls.some((call) => call.label === "pipeline-preflight"));
    const ingest = host.runnerCalls.find((call) => call.stage === "ingest");
    assert.equal(ingest.args.resume, true);
    assert.equal(ingest.args.failure_report, `${CFG.pipeline_dir}/failure_report.json`);
  });

  it("accepts a completed resume audit even when advisory checkpoint count is zero", async () => {
    const host = hostFor({ planner: { ...CFG, resume: false } });
    host.args.resume = true;
    const baseAgent = host.agent;
    host.agent = async (call) => {
      if (call.label === "pipeline-resume-preflight") return agentResult(call.label, { failure_report_path: "", child_failed_stage: "", checkpoint_path_count: 0 });
      return baseAgent(call);
    };
    const report = await workflow(host);
    assert.equal(report.status, "complete");
    assert.ok(host.runnerCalls.some((call) => call.stage === "ingest"));
  });

  it("accepts a validated resume config even when planner calls the prior run incomplete", async () => {
    const host = hostFor({ planner: { ...CFG, complete: false, resume: true } });
    host.args = { request: "pipeline-requests/bengaluru.json", resume: true };
    const baseAgent = host.agent;
    host.agent = async (call) => {
      if (call.label === "pipeline-planner") {
        return { ref: "ref-pipeline-planner", data: { complete: false, evidence: ["validated partial checkpoint"], unresolved: ["prior ingestion incomplete"], ...CFG, resume: true } };
      }
      return baseAgent(call);
    };
    const report = await workflow(host);
    assert.equal(report.status, "complete");
    assert.ok(host.runnerCalls.some((call) => call.stage === "ingest"));
  });

  it("keeps authoritative invocation scope when planner output drifts", async () => {
    const host = hostFor({ planner: { ...CFG, max_docs: 5, languages: ["kn"], fanout: { study: "parallel", translate: "parallel" } } });
    host.args = {
      request: "pipeline-requests/mumbai.json",
      ingest_request: CFG.ingest_request,
      ingest_run: CFG.ingest_run,
      studies_dir: CFG.studies_dir,
      translate_dir: CFG.translate_dir,
      pipeline_dir: CFG.pipeline_dir,
      max_docs: 1,
      doc_ids: [],
      languages: ["mr", "hi"],
      study_fanout: "sequential",
      translate_fanout: "sequential",
      study_concurrency: 1,
      translate_concurrency: 1,
    };
    const report = await workflow(host);
    // The generic mock promotion still reports all three docs, so the real
    // orchestrator correctly rejects that broadened promotion as partial.
    assert.equal(report.status, "partial");
    assert.equal(host.runnerCalls.filter((call) => call.stage === "study").length, 1);
    assert.match(host.calls.find((call) => call.label === "promote-ingestion").input, /top 1 by rank/);
  });

  it("reports partial when the final city bundle audit fails", async () => {
    const host = hostFor({ bundleValid: false });
    const report = await workflow(host);
    assert.equal(report.status, "partial");
    assert.ok(report.failures.some((failure) => failure.stage === "verify-city-bundle"));
  });

  it("rejects configs without languages", async () => {
    const host = hostFor({ planner: { ...CFG, languages: [] } });
    const report = await workflow(host);
    assert.equal(report.status, "partial");
    assert.match(report.unresolved[0], /languages/);
  });

  it("limits study and translation fan-out to the configured concurrency", async () => {
    const docs = Array.from({ length: 7 }, (_, index) => ({
      id: `doc-${index + 1}`,
      rank: index + 1,
      source_path: `${CFG.ingest_run}/ranked/${index + 1}.pdf`,
    }));
    const host = hostFor({
      docs,
      planner: { ...CFG, max_docs: 7, fanout: { study: "parallel", translate: "parallel" }, study_concurrency: 3, translate_concurrency: 3 },
    });
    let activeStudies = 0;
    let activeTranslations = 0;
    let maxActiveStudies = 0;
    let maxActiveTranslations = 0;
    host.runners.study = async () => {
      activeStudies += 1;
      maxActiveStudies = Math.max(maxActiveStudies, activeStudies);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeStudies -= 1;
      return okReport({});
    };
    host.runners.translate = async () => {
      activeTranslations += 1;
      maxActiveTranslations = Math.max(maxActiveTranslations, activeTranslations);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activeTranslations -= 1;
      return okReport({});
    };

    const report = await workflow(host);

    assert.equal(report.status, "complete");
    assert.equal(maxActiveStudies, 3);
    assert.equal(maxActiveTranslations, 3);
  });

  it("threads dry-run reuse through all stages and uses resolved cached directories", async () => {
    const host = hostFor({ planner: { ...CFG, dry_run: false } });
    host.args.dry_run = true;
    host.runners.ingest = async (h) => {
      host.runnerCalls.push({ stage: "ingest", args: h.args });
      return okReport({ status: "complete_reused", output_dir: "cached/ingestion", outputs: { document_ranking: "cached/ingestion/document_ranking.json", ranked_dir: "cached/ingestion/ranked" } });
    };
    host.runners.study = async (h) => {
      host.runnerCalls.push({ stage: "study", args: h.args });
      const id = h.args.output_dir.split("/").pop();
      return okReport({ status: "complete_reused", output_dir: "", reused_from: "", outputs: { study_package: `cached/studies/${id}/study_package.json` } });
    };
    host.runners.translate = async (h) => {
      host.runnerCalls.push({ stage: "translate", args: h.args });
      const id = h.args.output_dir.split("/").pop();
      return okReport({ status: "complete_reused", output_dir: `cached/translations/${id}` });
    };

    const report = await workflow(host);

    assert.equal(report.status, "complete");
    assert.equal(report.dry_run, true);
    assert.ok(host.runnerCalls.every((call) => call.args.dry_run === true));
    assert.deepEqual(host.runnerCalls.filter((call) => call.stage === "translate").map((call) => call.args.input), DOCS.map((doc) => `cached/studies/${doc.id}`));
    assert.deepEqual(report.outputs.translations.map((item) => item.output_dir), DOCS.map((doc) => `cached/translations/${doc.id}`));
    assert.match(host.calls.find((call) => call.label === "promote-ingestion").input, /cached\/ingestion/);
  });
});
