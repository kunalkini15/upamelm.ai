import { describe, it } from "node:test";
import assert from "node:assert/strict";
import workflow from "../backend-workflow.js";

const OUT = "backend/runs/test-validation";
const PIPELINE = "runs/bengaluru";
const SPARK = "muse-spark-1.3-contributor";
const WONDER = "muse-wonder-1.0";

const result = (label, data) => ({
  ref: `ref-${label}`,
  usage: { input_tokens: 100, output_tokens: 25, total_tokens: 125 },
  data: { complete: true, evidence: [], unresolved: [], ...data },
});

function validationData(overrides = {}) {
  return {
    valid: true,
    report_json_path: `${OUT}/backend_validation.json`,
    report_markdown_path: `${OUT}/backend_validation.md`,
    raw_results_path: `${OUT}/raw_results.json`,
    server_log_path: `${OUT}/server.log`,
    city_count: 1,
    study_count: 5,
    language_count: 3,
    package_combination_count: 15,
    test_passed_count: 80,
    test_failed_count: 0,
    live_probe_passed_count: 60,
    live_probe_failed_count: 0,
    warning_count: 0,
    issue_count: 0,
    ...overrides,
  };
}

describe("backend verification workflow", () => {
  it("runs one Spark validator and skips Wonder for a clean result", async () => {
    const calls = [];
    const host = {
      args: { pipeline_dir: PIPELINE, output_dir: OUT },
      agent: async ({ label, model, input }) => {
        calls.push({ label, model, input });
        return result(label, validationData());
      },
    };
    const report = await workflow(host);
    assert.equal(report.status, "complete");
    assert.equal(report.outputs.valid, true);
    assert.equal(report.wonder_calls, 0);
    assert.deepEqual(calls.map((call) => call.label), ["backend-exhaustive-validator"]);
    assert.equal(calls[0].model, SPARK);
    assert.match(calls[0].input, /ephemeral port/);
    assert.match(calls[0].input, /finally-style cleanup/);
    assert.match(calls[0].input, /pytest-xdist/);
  });

  it("uses Wonder and Spark finalization when findings exist", async () => {
    const calls = [];
    const host = {
      args: { pipeline_dir: PIPELINE, output_dir: OUT, test_workers: 3, probe_concurrency: 6 },
      agent: async ({ label, model, input }) => {
        calls.push({ label, model, input });
        if (label === "backend-exhaustive-validator") return result(label, validationData({ valid: false, issue_count: 2, live_probe_failed_count: 2 }));
        if (label === "wonder-backend-findings-review") return result(label, { decision: "approved_with_findings", review_path: `${OUT}/wonder_review.md`, confirmed_issue_count: 2, ownership_changes: 1 });
        if (label === "spark-backend-report-finalizer") return result(label, { valid: false, report_json_path: `${OUT}/backend_validation.json`, report_markdown_path: `${OUT}/backend_validation.md`, issue_count: 2, warning_count: 0, review_decision: "approved_with_findings" });
        throw new Error(`unexpected stage ${label}`);
      },
    };
    const report = await workflow(host);
    assert.equal(report.status, "complete_with_findings");
    assert.equal(report.wonder_calls, 1);
    assert.equal(report.outputs.review, `${OUT}/wonder_review.md`);
    assert.deepEqual(calls.map((call) => call.model), [SPARK, WONDER, SPARK]);
    assert.match(calls[0].input, /exactly 3 workers/);
    assert.match(calls[0].input, /concurrency at most 6/);
    assert.match(calls[1].input, /read-only senior reviewer/);
    assert.match(calls[2].input, /do not edit backend or pipeline files/);
  });

  it("preserves deterministic reports when Wonder is unavailable", async () => {
    const calls = [];
    const host = {
      args: { pipeline_dir: PIPELINE, output_dir: OUT },
      agent: async ({ label, model }) => {
        calls.push({ label, model });
        if (label === "backend-exhaustive-validator") return result(label, validationData({ valid: false, warning_count: 1 }));
        throw new Error("review unavailable");
      },
    };
    const report = await workflow(host);
    assert.equal(report.status, "complete_with_findings");
    assert.equal(report.outputs.report_json, `${OUT}/backend_validation.json`);
    assert.equal(calls.length, 2);
    assert.equal(report.stages[1].error_kind, "agent_exception");
  });

  it("returns partial when the exhaustive audit cannot complete", async () => {
    const report = await workflow({
      args: { pipeline_dir: PIPELINE, output_dir: OUT },
      agent: async () => result("validator", { complete: false, evidence: [], unresolved: ["server did not stop"] }),
    });
    assert.equal(report.status, "partial");
    assert.equal(report.failed_stage, "backend-exhaustive-validator");
  });

  it("rejects missing pipeline or output arguments", async () => {
    const report = await workflow({ args: { pipeline_dir: PIPELINE } });
    assert.equal(report.status, "invalid_args");
  });

  it("accepts JSON-string arguments and clamps excessive concurrency", async () => {
    let validatorInput = "";
    const report = await workflow({
      args: JSON.stringify({ pipeline_dir: PIPELINE, output_dir: OUT, test_workers: 99, probe_concurrency: 99 }),
      agent: async ({ input, label }) => { validatorInput = input; return result(label, validationData()); },
    });
    assert.equal(report.status, "complete");
    assert.match(validatorInput, /exactly 8 workers/);
    assert.match(validatorInput, /concurrency at most 16/);
  });

  it("never mentions or imports the global orchestrator", async () => {
    let input = "";
    await workflow({
      args: { pipeline_dir: PIPELINE, output_dir: OUT },
      agent: async (call) => { input = call.input; return result(call.label, validationData()); },
    });
    assert.doesNotMatch(input, /pipeline-workflow\.js/);
    assert.doesNotMatch(input, /global orchestrator/i);
  });
});
