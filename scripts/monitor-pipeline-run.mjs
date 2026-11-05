import { appendFile, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const pipelineDir = path.resolve(process.argv[2] || "");
const progressLog = path.resolve(process.argv[3] || path.join(pipelineDir, "console-progress.log"));
const timeoutMinutes = Number(process.env.PIPELINE_MONITOR_TIMEOUT_MINUTES || 360);
const ignoredFailureTimestamp = process.env.PIPELINE_MONITOR_IGNORE_FAILURE_TIMESTAMP || "";
if (!process.argv[2]) throw new Error("usage: node scripts/monitor-pipeline-run.mjs <pipeline_dir> <progress_log>");

const startedAt = Date.now();
const seen = new Set();
let lastHeartbeat = 0;

async function listFiles(dir, prefix = "") {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return []; }
  const files = [];
  for (const entry of entries) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path.join(dir, entry.name), relative));
    else if (entry.isFile()) files.push(relative.split(path.sep).join("/"));
  }
  return files.sort();
}

async function emit(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  process.stdout.write(`${line}\n`);
  await appendFile(progressLog, `${line}\n`);
}

await emit(`monitoring ${path.relative(process.cwd(), pipelineDir)}`);
while (true) {
  const files = await listFiles(pipelineDir);
  for (const file of files) {
    if (!seen.has(file)) {
      seen.add(file);
      await emit(`created ${file}`);
    }
  }

  const auditPath = path.join(pipelineDir, "bundle_verification.json");
  try {
    const audit = JSON.parse(await readFile(auditPath, "utf8"));
    await emit(`terminal bundle audit: valid=${audit.valid} studies=${audit.study_count} translations=${audit.translation_count} assets=${audit.asset_count} external_refs=${audit.external_reference_count}`);
    process.exit(audit.valid === true ? 0 : 2);
  } catch {}

  const failurePath = path.join(pipelineDir, "failure_report.json");
  try {
    const failure = JSON.parse(await readFile(failurePath, "utf8"));
    if (ignoredFailureTimestamp && failure.timestamp === ignoredFailureTimestamp) {
      if (!seen.has("__ignored_stale_failure__")) {
        seen.add("__ignored_stale_failure__");
        await emit(`ignoring preserved checkpoint failure timestamp=${ignoredFailureTimestamp}; waiting for resumed workflow`);
      }
      throw new Error("preserved checkpoint failure");
    }
    await emit(`terminal pipeline failure: stage=${failure.failed_stage || "unknown"} child_stage=${failure.child_failed_stage || "unknown"} retry=${failure.safe_retry_point || "unknown"}`);
    process.exit(2);
  } catch {}

  if (Date.now() - lastHeartbeat >= 30000) {
    lastHeartbeat = Date.now();
    await emit(`active files=${files.length} elapsed_minutes=${Math.floor((Date.now() - startedAt) / 60000)}`);
  }
  if (Date.now() - startedAt > timeoutMinutes * 60000) {
    await emit(`timeout after ${timeoutMinutes} minutes; workflow was not relaunched`);
    process.exit(3);
  }
  await new Promise((resolve) => setTimeout(resolve, 3000));
}
