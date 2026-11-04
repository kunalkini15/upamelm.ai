import { describe, it } from "node:test";
import assert from "node:assert/strict";
import workflow from "../study-workflow.js";

const OUT = "muse-document-processing/runs/test-study";
const result = (label, data) => ({ ref: `ref-${label}`, usage: { input_tokens: 100, output_tokens: 25, total_tokens: 125 }, data: { complete: true, evidence: [], unresolved: [], ...data } });

function hostFor({ warnings = 0, authorWarnings = 0, compilerFallbacks = 0, compilerBlocking = 0, finalizerBlocking = 0, wonderFails = false, visualWonderFails = false } = {}) {
  const calls = [];
  const agent = async ({ label, model, input }) => {
    calls.push({ label, model, input });
    const rows = {
      "source-cartographer": { source_map_path: `${OUT}/source_map.json`, source_cache_path: `${OUT}/source_cache.json`, extraction_plan_path: `${OUT}/extraction_plan.json`, ocr_plan_path: `${OUT}/ocr_plan.json`, document_shape: "mixed", lessons_loaded: true, lane_ids: ["spatial", "measurements", "visual"], page_count: 10, region_count: 20, large_table_range_count: 1, ocr_required_page_count: 2 },
      "evidence-reconciler": { inventory_path: `${OUT}/evidence_inventory.json`, coverage_path: `${OUT}/coverage_audit.json`, evidence_count: 100, render_candidate_count: 80, deferred_count: 1 },
      "rendering-author": { rendering_path: `${OUT}/rendering_package.json`, mapped_count: 50, profile_count: 8, resource_count: 3, visible_object_count: 70 },
      "wonder-visual-director": { audit_path: `${OUT}/renderability_audit.json`, newly_added_count: 12, final_visible_object_count: 82, final_mapped_count: 60 },
      "spark-visual-director": { audit_path: `${OUT}/renderability_audit.json`, newly_added_count: 9, final_visible_object_count: 79, final_mapped_count: 58 },
      "spark-integrated-author": { narrative_path: `${OUT}/narrative_package.json`, report_path: `${OUT}/report.json`, selfcheck_path: `${OUT}/authoring_selfcheck.json`, insight_count: 82, finding_count: 12, warning_count: authorWarnings },
      "wonder-integrated-finalizer": { finalization_path: `${OUT}/finalization_record.json`, checkpoint_path: `${OUT}/checkpoint.json`, usable: finalizerBlocking === 0, blocking_issue_count: finalizerBlocking, warning_count: 0, changed_object_count: 9, newly_extracted_count: 2 },
      "spark-integrated-finalizer": { finalization_path: `${OUT}/finalization_record.json`, checkpoint_path: `${OUT}/checkpoint.json`, usable: true, blocking_issue_count: 0, warning_count: 1, changed_object_count: 7, newly_extracted_count: 1 },
      "ui-contract-compiler": { compilation_path: `${OUT}/contract_compilation.json`, usable: compilerBlocking === 0, blocking_issue_count: compilerBlocking, warning_count: compilerFallbacks, normalized_object_count: 40, fallback_count: compilerFallbacks, empty_content_count: 0, adapter_diagnostic_count: 0 },
      "validate-and-assemble": { study_path: `${OUT}/study_package.json`, selfcheck_path: `${OUT}/grounding_selfcheck.json`, valid: true, warning_count: warnings, issue_count: 0 },
    };
    if (label === "wonder-visual-director" && visualWonderFails) return { ref: `ref-${label}`, error_kind: "agent_unavailable" };
    if (label === "wonder-integrated-finalizer" && wonderFails) return { ref: `ref-${label}`, error_kind: "agent_unavailable" };
    if (!rows[label]) throw new Error(`unexpected agent ${label}`);
    return result(label, rows[label]);
  };
  const parallel = async (inputs) => inputs.map(({ label, model, input }) => {
    calls.push({ label, model, input });
    if (label.startsWith("extract-")) return result(label, { evidence_path: `${OUT}/evidence/${label}.json`, asset_index_path: `${OUT}/evidence/${label}-assets.json`, item_count: 25, candidate_count: 20, ocr_completed_page_count: label === "extract-visual" ? 2 : 0 });
    throw new Error(`unexpected parallel ${label}`);
  });
  return { args: { document: "source.pdf", output_dir: OUT }, agent, parallel, calls };
}

describe("deep study workflow", () => {
  it("runs dynamic extraction, Wonder visual direction, Spark authoring, and Wonder finalization", async () => {
    const host = hostFor();
    const report = await workflow(host);
    assert.equal(report.status, "complete");
    assert.equal(report.wonder_calls, 2);
    assert.equal(host.calls.filter((c) => c.label.startsWith("extract-")).length, 3);
    assert.equal(host.calls.filter((c) => c.label === "spark-integrated-author").length, 1);
    assert.equal(host.calls.filter((c) => c.label.startsWith("review-")).length, 0);
    assert.ok(report.outputs.coverage_audit);
    assert.ok(report.outputs.renderability_audit);
    assert.ok(report.outputs.authoring_selfcheck);
    assert.ok(report.outputs.contract_compilation);
    assert.ok(report.outputs.source_cache);
    assert.ok(report.outputs.ocr_plan);
    assert.equal(report.outputs.document_shape, "mixed");
    assert.ok(report.outputs.checkpoint);
    assert.ok(report.outputs.finalization_record);
    assert.equal(report.finalized_by, "wonder");
    assert.equal(report.rendering_finalized_by, "wonder");
    assert.equal(report.token_usage.available, true);
    assert.equal(report.token_usage.fully_metered, true);
    assert.equal(report.token_usage.total_tokens, report.stages.length * 125);
    assert.ok(report.stages.every((stage) => stage.token_usage.total_tokens === 125));
    assert.equal(report.outputs.lessons_loaded, true);
    assert.ok(host.calls.every((call) => call.input.includes("lessons/LESSONS.md")));
    assert.match(host.calls.find((c) => c.label === "spark-integrated-author").input, /ui-output-contracts\.json/);
    assert.match(host.calls.find((c) => c.label === "spark-integrated-author").input, /analysis as an empty string/);
    assert.match(host.calls.find((c) => c.label === "spark-integrated-author").input, /absolute beginner/);
    assert.match(host.calls.find((c) => c.label === "wonder-integrated-finalizer").input, /Clear the analysis/);
    assert.match(host.calls.find((c) => c.label === "wonder-integrated-finalizer").input, /Spark's .*narrative_package\.json/);
    assert.match(host.calls.find((c) => c.label === "extract-visual").input, /visually read the rendered page image with Spark/);
    assert.match(host.calls.find((c) => c.label === "source-cartographer").input, /never row-level scientific extraction/);
    assert.match(host.calls.find((c) => c.label === "source-cartographer").input, /Do NOT parse every row/);
  });

  it("falls back to one integrated Spark finalization when Wonder is unavailable", async () => {
    const host = hostFor({ wonderFails: true });
    const report = await workflow(host);
    assert.equal(report.status, "complete_with_limitations");
    assert.equal(report.wonder_calls, 2);
    assert.equal(report.finalized_by, "spark-fallback");
    assert.equal(host.calls.filter((c) => c.label.includes("integrated-finalizer")).length, 2);
  });

  it("falls back to Spark visual direction while preserving Wonder finalization", async () => {
    const host = hostFor({ visualWonderFails: true });
    const report = await workflow(host);
    assert.equal(report.status, "complete");
    assert.equal(report.wonder_calls, 2);
    assert.equal(report.rendering_finalized_by, "spark-fallback");
    assert.equal(report.finalized_by, "wonder");
    assert.equal(host.calls.some((c) => c.label === "spark-visual-director"), true);
  });

  it("keeps a valid package limited when warnings remain", async () => {
    const report = await workflow(hostFor({ warnings: 2 }));
    assert.equal(report.status, "complete_with_limitations");
  });

  it("keeps authoring self-check warnings without blocking the package", async () => {
    const report = await workflow(hostFor({ authorWarnings: 1 }));
    assert.equal(report.status, "complete_with_limitations");
    assert.equal(report.warning_count, 1);
  });

  it("keeps an isolated adapted fallback as a warning instead of failing the package", async () => {
    const host = hostFor({ compilerFallbacks: 2 });
    const report = await workflow(host);
    assert.equal(report.status, "complete_with_limitations");
    assert.equal(report.warning_count, 2);
    assert.equal(host.calls.some((call) => call.label === "validate-and-assemble"), true);
  });

  it("fails only when contract compilation reports a package-wide blocking issue", async () => {
    const host = hostFor({ compilerBlocking: 1 });
    const report = await workflow(host);
    assert.equal(report.status, "partial");
    assert.equal(report.failed_stage, "ui-contract-compiler");
  });

  it("fails when integrated finalization reports a package-wide blocker", async () => {
    const report = await workflow(hostFor({ finalizerBlocking: 1 }));
    assert.equal(report.status, "partial");
    assert.equal(report.failed_stage, "integrated-finalizer");
  });

  it("accepts JSON-string arguments", async () => {
    const host = hostFor();
    host.args = JSON.stringify(host.args);
    assert.equal((await workflow(host)).status, "complete");
  });
});
