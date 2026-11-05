// Regression test: ingest-workflow must survive spilled (>4096B) child results.
// A spilled result carries data_spilled_for_size:true with no inline data;
// the workflow recovers via a compact SPARK distiller instead of failing.
// Run: node --test muse-source-ingestion/tests/
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import workflow from '../ingest-workflow.js';

const OUT = 'muse-source-ingestion/runs/bengaluru';
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
  evidence: ['evidence map and lanes written'],
  unresolved: [],
  evidence_map_path: `${OUT}/evidence_map.md`,
  lanes_path: `${OUT}/lanes.json`,
  lane_ids: ['geology', 'boreholes'],
});

const inventoryData = () => ({
  complete: true,
  evidence: ['fresh empty inventory written'],
  unresolved: [],
  request_path: `${OUT}/request.json`,
  inventory_path: `${OUT}/inventory.json`,
  lessons_loaded: true,
  prior_source_count: 0,
});

const discoveryData = (id) => ({
  complete: true,
  evidence: [`lane ${id} candidates written`],
  unresolved: [],
  lane_dir: `${OUT}/lanes/${id}`,
  candidates_path: `${OUT}/lanes/${id}/candidates.json`,
  excerpts_path: `${OUT}/lanes/${id}/excerpts.md`,
  usage_path: `${OUT}/lanes/${id}/usage.json`,
  candidate_count: 4,
});

const acquisitionData = (id) => ({
  complete: true,
  evidence: [`lane ${id} acquired`],
  unresolved: [],
  lane_dir: `${OUT}/lanes/${id}`,
  validation_path: `${OUT}/lanes/${id}/validation.json`,
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

const rankingData = () => ({
  complete: true,
  evidence: ['ranking written'],
  unresolved: [],
  ranking_path: `${OUT}/document_ranking.json`,
  ranking_markdown_path: `${OUT}/document_ranking.md`,
  ranked_dir: `${OUT}/ranked`,
  ranked_count: 3,
});

function makeHost({ scoutResult, distillResult, interruptAcquisition = false, interruptConsolidation = false, finalizeCaps = 0 }) {
  let finalizeAttempts = 0;
  const labels = [];
  const agent = async ({ label, input }) => {
    labels.push({ label, input });
    if (label === 'run-initialization') return compact(inventoryData(), 'ref-inventory');
    if (label === 'scout') return scoutResult;
    if (label === 'scout-distill') return distillResult;
    if (label === 'consolidate') {
      if (interruptConsolidation) return { ref: 'ref-consolidate', error_kind: 'generated_child_model_step_cap', data: null };
      return compact(consolidateData(), 'ref-consolidate');
    }
    if (label === 'consolidate-resume' || label === 'consolidate-recovery') return compact(consolidateData(), `ref-${label}`);
    if (String(label).startsWith('consolidate-continuation-')) return compact(consolidateData(), `ref-${label}`);
    if (label === 'strategic-review') return compact(reviewData(), 'ref-review');
    if (label === 'repair-and-finalize' || String(label).startsWith('repair-and-finalize-continuation-')) {
      finalizeAttempts += 1;
      if (finalizeAttempts <= finalizeCaps) return { ref: `ref-${label}`, error_kind: 'generated_child_model_step_cap', data: null };
      return compact(finalizeData(), `ref-${label}`);
    }
    if (label === 'information-value-ranking') return compact(rankingData(), 'ref-ranking');
    throw new Error(`unexpected agent label: ${label}`);
  };
  const parallel = async (inputs) =>
    inputs.map((item) => {
      const allowedHostCallKeys = new Set(['input', 'schema', 'label', 'model']);
      assert.deepEqual(
        Object.keys(item).filter((key) => !allowedHostCallKeys.has(key)),
        [],
        `unsupported host.parallel fields in ${item.label}`,
      );
      if (String(item.label).startsWith('discover-')) {
        const id = String(item.label).replace(/^discover-/, '');
        return compact(discoveryData(id), `ref-${item.label}`);
      }
      if (String(item.label).startsWith('rediscover-')) {
        const id = String(item.label).replace(/^rediscover-/, '');
        return compact(discoveryData(id), `ref-${item.label}`);
      }
      if (String(item.label).startsWith('acquire-')) {
        const id = String(item.label).replace(/^acquire-/, '');
        if (interruptAcquisition) {
          return { ref: `ref-${item.label}`, error_kind: 'generated_child_model_step_cap', data: null };
        }
        return compact(acquisitionData(id), `ref-${item.label}`);
      }
      if (String(item.label).startsWith('recover-')) {
        const id = String(item.label).replace(/^recover-/, '');
        return compact(acquisitionData(id), `ref-${item.label}`);
      }
      throw new Error(`unexpected parallel label: ${item.label}`);
    });
  return { args: { ...ARGS }, agent, parallel, labels };
}

describe('ingest-workflow spill handling', () => {
  it('rejects a nested opaque run ID before launching an agent', async () => {
    let called = false;
    const report = await workflow({
      args: { ...ARGS, output_dir: 'muse-source-ingestion/runs/mumbai/random-run-id' },
      agent: async () => { called = true; throw new Error('must not run'); },
    });
    assert.equal(report.status, 'invalid_args');
    assert.equal(called, false);
    assert.match(report.unresolved[0], /<city-slug>/);
  });

  it('rejects dry-run reuse without launching an agent', async () => {
    let called = false;
    const host = { args: { ...ARGS, dry_run: true }, agent: async () => { called = true; } };
    const report = await workflow(host);
    assert.equal(report.status, 'invalid_args');
    assert.equal(called, false);
    assert.match(report.unresolved[0], /reuse is disabled/);
  });

  it('recovers from a spilled scout result via distiller and completes', async () => {
    const host = makeHost({
      scoutResult: spilled('ref-scout'),
      distillResult: compact(scoutData(), 'ref-scout-distill'),
    });
    const report = await workflow(host);
    assert.equal(report.status, 'complete');
    assert.equal(report.wonder_calls, 3);
    const scopes = report.stages.map((s) => s.scope);
    assert.ok(scopes.includes('discover-geology'));
    assert.ok(scopes.includes('discover-boreholes'));
    assert.ok(scopes.includes('acquire-geology'));
    assert.ok(scopes.includes('acquire-boreholes'));
    assert.ok(scopes.includes('information-value-ranking'));
    assert.equal(report.outputs.ranked_count, 3);
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
    assert.ok(scopes.includes('discover-geology'));
    assert.ok(scopes.includes('discover-boreholes'));
    assert.ok(scopes.includes('acquire-geology'));
    assert.ok(scopes.includes('acquire-boreholes'));
    assert.equal(report.outputs.inventory, `${OUT}/inventory.json`);
  });

  it('recovers acquisition lanes that hit the child-model step cap', async () => {
    const host = makeHost({
      scoutResult: compact(scoutData(), 'ref-scout'),
      distillResult: null,
      interruptAcquisition: true,
    });
    const report = await workflow(host);
    assert.equal(report.status, 'complete');
    const scopes = report.stages.map((s) => s.scope);
    assert.ok(scopes.includes('recover-geology'));
    assert.ok(scopes.includes('recover-boreholes'));
    assert.equal(report.outputs.selected_count, 3);
  });

  it('recovers consolidation after partial draft output hits the step cap', async () => {
    const host = makeHost({
      scoutResult: compact(scoutData(), 'ref-scout'),
      distillResult: null,
      interruptConsolidation: true,
    });
    const report = await workflow(host);
    assert.equal(report.status, 'complete');
    assert.ok(report.stages.some((stage) => stage.scope === 'consolidate' && !stage.complete));
    assert.ok(report.stages.some((stage) => stage.scope === 'consolidate-continuation-1' && stage.complete));
  });

  it('chains continuation children until finalization completes', async () => {
    const host = makeHost({
      scoutResult: compact(scoutData(), 'ref-scout'),
      distillResult: null,
      finalizeCaps: 3,
    });
    const report = await workflow(host);
    assert.equal(report.status, 'complete');
    assert.deepEqual(
      host.labels.filter(({ label }) => String(label).startsWith('repair-and-finalize')).map(({ label }) => label),
      ['repair-and-finalize', 'repair-and-finalize-continuation-1', 'repair-and-finalize-continuation-2', 'repair-and-finalize-continuation-3'],
    );
    assert.match(host.labels.find(({ label }) => label === 'repair-and-finalize-continuation-3').input, /Inspect current artifacts as the source of truth/);
  });

  it('resumes an existing failed run directly from consolidation', async () => {
    const host = makeHost({ scoutResult: compact(scoutData(), 'unused'), distillResult: null });
    host.args = { ...ARGS, resume: true, failure_report: 'runs/bengaluru/failure_report.json' };
    const baseAgent = host.agent;
    host.agent = async (call) => {
      if (call.label === 'resume-checkpoint-audit') return compact({
        complete: true,
        evidence: ['checkpoint valid'],
        unresolved: [],
        inventory_path: `${OUT}/inventory.json`,
        evidence_map_path: `${OUT}/evidence_map.md`,
        lanes_path: `${OUT}/lanes.json`,
        lane_ids: ['geology', 'boreholes'],
        live_lane_dirs: [`${OUT}/lanes/geology`, `${OUT}/lanes/boreholes`],
        lessons_loaded: true,
        resume_stage: 'consolidate',
      }, 'ref-resume-audit');
      if (call.label === 'consolidate-resume') return compact(consolidateData(), 'ref-consolidate-resume');
      return baseAgent(call);
    };
    const report = await workflow(host);
    assert.equal(report.status, 'complete');
    const scopes = report.stages.map((stage) => stage.scope);
    assert.ok(scopes.includes('resume-checkpoint-audit'));
    assert.ok(scopes.includes('consolidate-resume'));
    assert.ok(!scopes.includes('run-initialization'));
    assert.ok(!scopes.some((scope) => scope.startsWith('discover-')));
    assert.ok(!scopes.some((scope) => scope.startsWith('acquire-')));
  });

  it('uses an orchestrator-validated checkpoint without a duplicate model audit', async () => {
    const host = makeHost({ scoutResult: compact(scoutData(), 'unused'), distillResult: null });
    host.args = { ...ARGS, resume: true, checkpoint_validated: true, failure_report: 'runs/bengaluru/failure_report.json' };
    const labels = [];
    const baseAgent = host.agent;
    host.agent = async (call) => {
      labels.push(call.label);
      return baseAgent(call);
    };
    const report = await workflow(host);
    assert.equal(report.status, 'complete');
    assert.equal(labels.includes('resume-checkpoint-audit'), false);
    assert.ok(report.stages.some((stage) => stage.scope === 'resume-checkpoint-authorized'));
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
