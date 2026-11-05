import { describe, it } from "node:test";
import assert from "node:assert/strict";
import workflow from "../ui-workflow.js";

const OUT = "ui/runs/test-validation";
const PIPELINE = "runs/bengaluru";
const WORKHORSE = "muse-spark-1.3-contributor";
const REVIEWER = "muse-wonder-1.0";

const result = (label, data) => ({
  ref: `ref-${label}`,
  usage: { input_tokens: 100, output_tokens: 25, total_tokens: 125 },
  data: { complete: true, evidence: [], unresolved: [], ...data },
});

function validationData(overrides = {}) {
  return {
    valid: true,
    report_json_path: `${OUT}/ui_validation.json`,
    report_markdown_path: `${OUT}/ui_validation.md`,
    raw_results_path: `${OUT}/raw_results.json`,
    playwright_results_path: `${OUT}/playwright-results.json`,
    console_log_path: `${OUT}/browser-console.log`,
    screenshot_paths: [`${OUT}/screenshots/analysis.png`],
    city_count: 1,
    study_count: 5,
    language_count: 3,
    combination_count: 15,
    test_passed_count: 19,
    test_failed_count: 0,
    browser_passed_count: 15,
    browser_failed_count: 0,
    warning_count: 0,
    issue_count: 0,
    cleanup_confirmed: true,
    ...overrides,
  };
}

describe("UI verification workflow", () => {
  it("runs one workhorse audit and skips review when clean", async () => {
    const calls = [];
    const report = await workflow({
      args: { pipeline_dir: PIPELINE, output_dir: OUT },
      agent: async (call) => { calls.push(call); return result(call.label, validationData()); },
    });
    assert.equal(report.status, "complete");
    assert.equal(report.outputs.valid, true);
    assert.equal(report.reviewer_calls, 0);
    assert.deepEqual(calls.map((call) => call.label), ["ui-exhaustive-validator"]);
    assert.equal(calls[0].model, WORKHORSE);
    assert.match(calls[0].input, /Docker-based Playwright/);
    assert.match(calls[0].input, /finally-style cleanup/);
    assert.match(calls[0].input, /every backend-discovered city, study, and language/);
  });

  it("uses the reviewer and workhorse finalizer when findings exist", async () => {
    const calls = [];
    const report = await workflow({
      args: { pipeline_dir: PIPELINE, output_dir: OUT, browser_workers: 4 },
      agent: async (call) => {
        calls.push(call);
        if (call.label === "ui-exhaustive-validator") return result(call.label, validationData({ valid: false, issue_count: 2, browser_failed_count: 2 }));
        if (call.label === "ui-findings-review") return result(call.label, { decision: "approved_with_findings", review_path: `${OUT}/review.md`, confirmed_issue_count: 2, ownership_changes: 1 });
        if (call.label === "ui-report-finalizer") return result(call.label, { valid: false, report_json_path: `${OUT}/ui_validation.json`, report_markdown_path: `${OUT}/ui_validation.md`, issue_count: 2, warning_count: 0, review_decision: "approved_with_findings" });
        throw new Error(`unexpected stage ${call.label}`);
      },
    });
    assert.equal(report.status, "complete_with_findings");
    assert.equal(report.reviewer_calls, 1);
    assert.deepEqual(calls.map((call) => call.model), [WORKHORSE, REVIEWER, WORKHORSE]);
    assert.match(calls[0].input, /exactly 4 Playwright workers/);
    assert.match(calls[1].input, /read-only flagship reviewer/);
    assert.match(calls[2].input, /Do not repair or rerun/);
  });

  it("supports invoker-provided model identifiers", async () => {
    const models = [];
    const report = await workflow({
      args: { pipeline_dir: PIPELINE, output_dir: OUT, workhorse_model: "mulespark-1.3", reviewer_model: "muse-1" },
      agent: async (call) => { models.push(call.model); return result(call.label, validationData()); },
    });
    assert.equal(report.status, "complete");
    assert.deepEqual(models, ["mulespark-1.3"]);
  });

  it("preserves deterministic findings if review is unavailable", async () => {
    const report = await workflow({
      args: { pipeline_dir: PIPELINE, output_dir: OUT },
      agent: async (call) => {
        if (call.label === "ui-exhaustive-validator") return result(call.label, validationData({ valid: false, warning_count: 1 }));
        throw new Error("review unavailable");
      },
    });
    assert.equal(report.status, "complete_with_findings");
    assert.equal(report.outputs.report_json, `${OUT}/ui_validation.json`);
    assert.equal(report.stages[1].error_kind, "agent_exception");
  });

  it("returns partial when the audit cannot complete", async () => {
    const report = await workflow({
      args: { pipeline_dir: PIPELINE, output_dir: OUT },
      agent: async () => result("validator", { complete: false, unresolved: ["containers did not stop"] }),
    });
    assert.equal(report.status, "partial");
    assert.equal(report.failed_stage, "ui-exhaustive-validator");
  });

  it("rejects missing required arguments", async () => {
    const report = await workflow({ args: { pipeline_dir: PIPELINE } });
    assert.equal(report.status, "invalid_args");
  });

  it("accepts JSON arguments and clamps browser concurrency", async () => {
    let input = "";
    const report = await workflow({
      args: JSON.stringify({ pipeline_dir: PIPELINE, output_dir: OUT, browser_workers: 99 }),
      agent: async (call) => { input = call.input; return result(call.label, validationData()); },
    });
    assert.equal(report.status, "complete");
    assert.match(input, /exactly 4 Playwright workers/);
  });
});

