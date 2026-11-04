import { describe, it } from "node:test";
import assert from "node:assert/strict";
import workflow from "../translate-workflow.js";

const OUT = "muse-translate/runs/test-translate";
const result = (label, data) => ({ ref: `ref-${label}`, usage: { input_tokens: 100, output_tokens: 25, total_tokens: 125 }, data: { complete: true, evidence: [], unresolved: [], ...data } });

function hostFor({ laneCount = 2 } = {}) {
  const calls = [];
  const laneIds = Array.from({ length: laneCount }, (_, i) => ["kn", "hi", "ta", "te"][i]);
  const agent = async ({ label, model, input }) => {
    calls.push({ label, model, input });
    if (label === "translate-planner") {
      return result(label, { request_path: `${OUT}/request.json`, inventory_path: `${OUT}/inventory.json`, lessons_loaded: true, language_count: laneCount, lane_ids: laneIds, insight_count: 28, block_count: 8 });
    }
    if (label === "verify-and-finalize") {
      return result(label, { verification_path: `${OUT}/verification.md`, summary_path: `${OUT}/run_summary.json`, output_count: laneCount * 3, valid: true, warning_count: 0, issue_count: 0 });
    }
    throw new Error(`unexpected agent ${label}`);
  };
  const parallel = async (inputs) => inputs.map(({ label, model, input }) => {
    calls.push({ label, model, input });
    if (label.startsWith("translate-")) {
      const lang = label.replace(/^translate-/, "");
      return result(label, {
        translation_path: `${OUT}/lanes/${lang}/translation.json`,
        trace_path: `${OUT}/lanes/${lang}/trace.jsonl`,
        usage_path: `${OUT}/lanes/${lang}/usage.json`,
        output_paths: [`${OUT}/study_package_${lang}.json`, `${OUT}/narrative_package_${lang}.json`, `${OUT}/report_${lang}.json`],
        unit_count: 40,
        output_count: 3,
      });
    }
    throw new Error(`unexpected parallel ${label}`);
  });
  return { args: { request: "muse-translate/requests/example.json", output_dir: OUT }, agent, parallel, calls };
}

describe("translate workflow", () => {
  it("reuses a compatible completed translation in dry-run mode", async () => {
    const host = {
      args: { input: "study/run", output_dir: OUT, languages: ["kn", "hi"], dry_run: true },
      agent: async ({ label, input }) => {
        assert.equal(label, "dry-run-resolver");
        assert.match(input, /normalized requested language set/);
        return result(label, {
          reused_from: "", input_sha256: "abc123", request_path: `${OUT}/request.json`,
          inventory_path: `${OUT}/inventory.json`, verification_path: `${OUT}/verification.md`,
          summary_path: `${OUT}/run_summary.json`, lane_ids: ["kn", "hi"],
          output_paths: [`${OUT}/study_package_kn.json`, `${OUT}/study_package_hi.json`],
        });
      },
    };
    const report = await workflow(host);
    assert.equal(report.status, "complete_reused");
    assert.equal(report.output_dir, OUT);
    assert.deepEqual(report.outputs.lane_ids, ["kn", "hi"]);
    assert.deepEqual(report.outputs.lane_outputs.kn, [`${OUT}/study_package_kn.json`]);
  });

  it("runs planning, parallel final-package lanes, and one verification pass", async () => {
    const host = hostFor({ laneCount: 2 });
    const report = await workflow(host);
    assert.equal(report.status, "complete");
    assert.equal(host.calls.filter((c) => c.label.startsWith("translate-kn") || c.label.startsWith("translate-hi")).length, 2);
    assert.ok(report.outputs.inventory);
    assert.ok(report.outputs.verification);
    assert.ok(report.outputs.run_summary);
    assert.equal(Object.keys(report.outputs.lane_outputs).length, 2);
    assert.equal(report.outputs.language_count, 2);
    assert.deepEqual(report.outputs.lane_ids, ["kn", "hi"]);
    assert.ok(host.calls.every((call) => call.input.includes("lessons/LESSONS.md")));
    assert.match(host.calls.find((c) => c.label === "translate-planner").input, /language names case-insensitively/);
    assert.match(host.calls.find((c) => c.label === "translate-kn").input, /study_package_kn\.json/);
    assert.equal(host.calls.some((c) => c.label === "translate-consolidate"), false);
    assert.equal(host.calls.some((c) => c.label === "translate-review"), false);
  });

  it("uses Spark for every phase", async () => {
    const host = hostFor();
    const report = await workflow(host);
    assert.equal(report.status, "complete");
    assert.ok(host.calls.every((call) => call.model === "muse-spark-1.3-contributor"));
    assert.deepEqual(host.calls.map((call) => call.label), ["translate-planner", "translate-kn", "translate-hi", "verify-and-finalize"]);
  });

  it("rejects args without request or input languages", async () => {
    const report = await workflow({ args: { output_dir: OUT } });
    assert.equal(report.status, "invalid_args");
  });

  it("supports direct input/output_dir/languages args", async () => {
    const base = hostFor({ laneCount: 1 });
    const host = { ...base, args: { input: "some/dir", output_dir: OUT, languages: ["Kannada"] } };
    const report = await workflow(host);
    assert.equal(report.status, "complete");
  });

  it("supports comma-separated languages in a direct pipeline handoff", async () => {
    const base = hostFor({ laneCount: 2 });
    const host = {
      ...base,
      args: {
        input: "muse-document-processing/runs/dgwr-karnataka-2023-v1",
        output_dir: "muse-translate/runs/dgwr-karnataka-2023-v1",
        languages: "kn,hi",
      },
    };
    const report = await workflow(host);
    assert.equal(report.status, "complete");
    const planner = host.calls.find((call) => call.label === "translate-planner");
    assert.match(planner.input, /muse-document-processing\/runs\/dgwr-karnataka-2023-v1/);
    assert.match(planner.input, /Languages: kn,hi/);
  });

  it("accepts language names and normalizes them to codes", async () => {
    const base = hostFor({ laneCount: 2 });
    const host = { ...base, args: { input: "some/dir", output_dir: OUT, languages: ["Hindi", "kannada"] } };
    const report = await workflow(host);
    assert.equal(report.status, "complete");
    assert.deepEqual(report.outputs.lane_ids, ["kn", "hi"]);
  });

});
