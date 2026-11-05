import readline from "node:readline";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const clock = () => new Date().toLocaleTimeString("en-GB", { hour12: false });
const emit = (message) => process.stdout.write(`[${clock()}] ${message}\n`);
let launcherStarted = false;
let workflowAccepted = false;
let configuredModel = "Meta model";
let metaCallCount = 0;
const metaCalls = new Map();
let workflowReportLoaded = false;
const pipelineDir = process.argv[2] ? path.resolve(process.argv[2]) : null;
const requestPath = process.argv[3] ? path.resolve(process.argv[3]) : null;
const resumeMode = process.argv[4] === "true";
let stageDirs = {};
if (requestPath) {
  try {
    const config = JSON.parse(await readFile(requestPath, "utf8"));
    stageDirs = {
      ingestion: config.ingest_run ? path.resolve(config.ingest_run) : null,
      studies: config.studies_dir ? path.resolve(config.studies_dir) : null,
      translations: config.translate_dir ? path.resolve(config.translate_dir) : null,
    };
  } catch {}
}
const milestones = new Set();

async function filesUnder(dir) {
  if (!dir) return [];
  try { return (await readdir(dir, { recursive: true })).map(String); } catch { return []; }
}

function metaPurpose() {
  if (!workflowAccepted) return "interpret launch request and invoke Muse Code";
  if (!workflowReportLoaded) return "reconcile background workflow completion";
  return "verify and present the final workflow report";
}

async function scanArtifacts() {
  if (!pipelineDir) return;
  let files;
  try { files = (await readdir(pipelineDir, { recursive: true })).map(String); } catch { files = []; }
  const [ingestionFiles, studyFiles, translationFiles] = await Promise.all([
    filesUnder(stageDirs.ingestion), filesUnder(stageDirs.studies), filesUnder(stageDirs.translations),
  ]);
  const announce = (key, message, present) => {
    if (present && !milestones.has(key)) {
      milestones.add(key);
      emit(message);
    }
  };
  announce("request", resumeMode ? "Resume configuration loaded; checkpoint validation running" : "Configuration frozen and preflight running", files.includes("pipeline_request.json"));
  announce("ingestion-start", resumeMode ? "STAGE 1 · INGESTION RESUME · continuing from preserved artifacts" : "STAGE 1 · INGESTION · Meta agents discover, validate, and rank aquifer evidence", ingestionFiles.length > 0);
  if (!resumeMode) announce("ingestion-lanes", "STAGE 1 · Parallel evidence-discovery lanes are active", ingestionFiles.some((file) => /(^|[/\\])lanes\.json$/.test(file)));
  announce("ingestion", "Ingestion complete · ranked sources promoted", files.includes(path.join("ingestion", "document_ranking.json")));
  announce("study-start", "STAGE 2 · DOCUMENT PROCESSING · Meta agents extract a grounded study package", studyFiles.length > 0);
  announce("study", "Document processing complete · study package promoted", files.some((file) => /^studies[/\\][^/\\]+[/\\]study_package\.json$/.test(file)));
  announce("translation-start", "STAGE 3 · TRANSLATION · Meta agents generate the configured language packages", translationFiles.length > 0);
  announce("translation", "Translation complete · language packages promoted", files.some((file) => /^translations[/\\][^/\\]+[/\\]study_package_[^/\\]+\.json$/.test(file)));
  announce("summary", "City bundle assembled · running final verification", files.includes("pipeline_summary.json"));
}

const artifactTimer = pipelineDir ? setInterval(() => { scanArtifacts().catch(() => {}); }, 3000) : null;
const heartbeatTimer = setInterval(() => emit("Pipeline active · waiting for next stage milestone"), 30000);
await scanArtifacts();

function terminalSummary(text) {
  if (!text) return null;
  const status = text.match(/"status"\s*:\s*"([^"]+)"/)?.[1];
  const failedStage = text.match(/"failed_stage"\s*:\s*"([^"]+)"/)?.[1];
  if (status === "partial") return `FAILED · stage=${failedStage || "unknown"} · downstream work stopped`;
  if (status?.startsWith("complete")) return `COMPLETE · status=${status}`;
  return null;
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  let event;
  try { event = JSON.parse(line); } catch { continue; }
  const type = event.payload_type;
  const payload = event.payload || {};

  if (type === "run.lifecycle.started" && !launcherStarted) {
    launcherStarted = true;
    emit("Starting end-to-end pipeline");
    continue;
  }

  if (type === "run.model.configured" && payload.model_id) {
    configuredModel = payload.display_label || payload.model_id;
    continue;
  }

  if (type === "task.lifecycle.proposed" && payload.event?.task_kind === "model.meta.response") {
    const taskId = payload.task_id || payload.event.task_id;
    const callNumber = ++metaCallCount;
    const purpose = metaPurpose();
    if (taskId) metaCalls.set(taskId, { callNumber, startedAt: Date.now(), model: configuredModel, purpose });
    emit(`META MODEL CALL ${callNumber} · ${configuredModel} · ${purpose}`);
    continue;
  }

  if (type === "task.lifecycle.completed") {
    const taskId = payload.task_id || payload.event?.task_id;
    const call = taskId ? metaCalls.get(taskId) : null;
    if (call) {
      const seconds = Math.max(0.1, (Date.now() - call.startedAt) / 1000).toFixed(1);
      emit(`META MODEL CALL ${call.callNumber} · completed in ${seconds}s · purpose=${call.purpose}`);
      metaCalls.delete(taskId);
    }
    continue;
  }

  if (type === "tool.result" && payload.correlation_facts?.tool_name === "workflow" && !workflowAccepted) {
    workflowAccepted = true;
    let detail = {};
    try { detail = JSON.parse(payload.text || "{}"); } catch {}
    const script = detail.scriptPath ? path.basename(detail.scriptPath) : "workflow script";
    const shortHash = typeof detail.scriptHash === "string" ? detail.scriptHash.replace(/^sha256:/, "").slice(0, 10) : null;
    emit(`MUSE CODE · ${script} launched${shortHash ? ` · sha256=${shortHash}` : ""}${detail.maxParallelAgents ? ` · capacity=${detail.maxParallelAgents} agents` : ""}`);
    continue;
  }

  if (type === "task.lifecycle.status") {
    const message = payload.event?.message || payload.message || "";
    if (/error|fail|retry|timed?\s*out|step cap/i.test(message)) emit(`Runtime notice · ${message}`);
    continue;
  }

  if (type === "tool.result" && payload.correlation_facts?.tool_name === "read_file" && /Complete Workflow final report/.test(payload.text || "")) {
    workflowReportLoaded = true;
    emit("MUSE TRACE · background workflow report loaded for final verification");
    continue;
  }

  if (type === "run.usage" && Array.isArray(payload.models)) {
    for (const usage of payload.models) {
      emit(`META USAGE · ${usage.model} · calls=${usage.calls ?? payload.calls ?? 0} · input=${usage.input_tokens ?? 0} · output=${usage.output_tokens ?? 0} · cached=${usage.cached_tokens ?? 0}${payload.children_included === false ? " · launcher scope" : ""}`);
    }
    continue;
  }

  if (type === "run.terminal.completed") {
    const summary = terminalSummary(payload.text);
    if (summary) emit(summary);
  }
}
if (artifactTimer) clearInterval(artifactTimer);
clearInterval(heartbeatTimer);
await scanArtifacts();
