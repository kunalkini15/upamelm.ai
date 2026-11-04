// Regression test: ingest-workflow must survive spilled (>4096B) child results.
// A spilled result carries data_spilled_for_size:true with no inline data;
// the workflow recovers via a compact SPARK distiller instead of failing.
// Run: node --test muse-source-ingestion/tests/
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import workflow from '../ingest-workflow.js';

const OUT = 'muse-source-ingestion/runs/bengaluru-test';
const ARGS = {
  request: 'muse-source-ingestion/requests/bengaluru.json',
  output_dir: OUT,
};

const compact = (data, ref) => ({ ref, data, error_kind: null, notes: null, text: null });
const spilled = (ref, bytes = 6563) => ({
  ref,
  data_spilled_for_size: true,
  submitted_payload_bytes: bytes,
  submitted_payload_chars: bytes,
});

const scoutData = () => ({
  complete: true,
  evidence: ['inventory.json written, 0 held sources'],
  unresolved: [],
  inventory_path: `${OUT}/inventory.json`,
  evidence_map_path: `${OUT}/evidence_map.md`,
  lessons_loaded: true,
  lanes_path: `${OUT}/lanes.json`,
  lane_ids: ['geology', 'boreholes'],
});

const laneData = (id) => ({
  complete: true,
  evidence: [`lane ${id} done`],
  unresolved: [],
  lane_dir: `${OUT}/lanes/${id}`,
  download_count: 2,
  usage_path: `${OUT}/lanes/${id}/usage.json`,
});

const consolidateData = () => ({
  complete: true,
  evidence: ['draft written'],
  unresolved: [],
  manifest_path: `${OUT}/draft/manifest.json`,
  handoff_path: `${OUT}/draft/handoff.md`,
  selected_count: 3,
});

const reviewData = () => ({
  complete: true,
  evidence: ['review written'],
  unresolved: [],
  approved: true,
  review_path: `${OUT}/review.json`,
  must_fix: [],
  risk_count: 1,
});

const finalizeData = () => ({
  complete: true,
  evidence: ['finalized'],
  unresolved: [],
  manifest_path: `${OUT}/manifest.json`,
  handoff_path: `${OUT}/handoff.md`,
  verification_path: `${OUT}/verification.md`,
  selected_count: 3,
});

function makeHost({ scoutResult, distillResult }) {
  const agent = async ({ label }) => {
    if (label === 'scout') return scoutResult;
    if (label === 'scout-distill') return distillResult;
    if (label === 'consolidate') return compact(consolidateData(), 'ref-consolidate');
    if (label === 'strategic-review') return compact(reviewData(), 'ref-review');
    if (label === 'repair-and-finalize') return compact(finalizeData(), 'ref-finalize');
    throw new Error(`unexpected agent label: ${label}`);
  };
  const parallel = async (inputs) =>
    inputs.map((item) => {
      const id = String(item.label).replace(/^lane-/, '');
      return compact(laneData(id), `ref-${item.label}`);
    });
  return { args: { ...ARGS }, agent, parallel };
}

describe('ingest-workflow spill handling', () => {
  it('recovers from a spilled scout result via distiller and completes', async () => {
    const host = makeHost({
      scoutResult: spilled('ref-scout'),
      distillResult: compact(scoutData(), 'ref-scout-distill'),
    });
    const report = await workflow(host);
    assert.equal(report.status, 'complete');
    assert.equal(report.wonder_calls, 2);
    const scopes = report.stages.map((s) => s.scope);
    assert.ok(scopes.includes('lane-geology'));
    assert.ok(scopes.includes('lane-boreholes'));
    assert.ok(report.stages.every((s) => s.complete));
  });

  it('completes on the compact happy path with lane fan-out from lane_ids', async () => {
    const host = makeHost({
      scoutResult: compact(scoutData(), 'ref-scout'),
      distillResult: null,
    });
    const report = await workflow(host);
    assert.equal(report.status, 'complete');
    const scopes = report.stages.map((s) => s.scope);
    assert.ok(scopes.includes('lane-geology'));
    assert.ok(scopes.includes('lane-boreholes'));
  });

  it('reports partial with spill cause when distillation also fails', async () => {
    const host = makeHost({
      scoutResult: spilled('ref-scout'),
      distillResult: null,
    });
    const report = await workflow(host);
    assert.equal(report.status, 'partial');
    assert.equal(report.failed_stage, 'scout');
  });
});
