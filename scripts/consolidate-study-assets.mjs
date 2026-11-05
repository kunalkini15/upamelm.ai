import { access, copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const cityDir = process.argv[2];
if (!cityDir) throw new Error("usage: node scripts/consolidate-study-assets.mjs <runs/city>");

const workspace = process.cwd();
const studiesDir = path.resolve(workspace, cityDir, "studies");
const packageNames = [
  "study_package.json", "study_package_hi.json", "study_package_kn.json",
  "narrative_package.json", "narrative_package_hi.json", "narrative_package_kn.json",
  "report.json", "report_hi.json", "report_kn.json",
];

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

async function isFile(file) {
  try { return (await stat(file)).isFile(); } catch { return false; }
}

async function rewriteValue(value, sourceDir, destinationDir, copied) {
  if (Array.isArray(value)) return Promise.all(value.map((item) => rewriteValue(item, sourceDir, destinationDir, copied)));
  if (value && typeof value === "object") {
    const result = {};
    for (const [key, item] of Object.entries(value)) result[key] = await rewriteValue(item, sourceDir, destinationDir, copied);
    return result;
  }
  if (typeof value !== "string") return value;

  let sourcePath;
  let localPath;
  const sourcePrefix = path.relative(workspace, sourceDir).split(path.sep).join("/") + "/";
  if (value.startsWith(sourcePrefix)) {
    localPath = value.slice(sourcePrefix.length);
    sourcePath = path.resolve(workspace, value);
  } else if (value.startsWith("muse-source-ingestion/") && await isFile(path.resolve(workspace, value))) {
    localPath = `source/${path.basename(value)}`;
    sourcePath = path.resolve(workspace, value);
  } else if (value && !path.isAbsolute(value) && !value.startsWith("../") && await isFile(path.resolve(sourceDir, value))) {
    localPath = value;
    sourcePath = path.resolve(sourceDir, value);
  } else {
    return value;
  }

  const destinationPath = path.resolve(destinationDir, localPath);
  if (!destinationPath.startsWith(destinationDir + path.sep)) throw new Error(`unsafe destination: ${destinationPath}`);
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await copyFile(sourcePath, destinationPath);
  copied.set(localPath, path.relative(workspace, sourcePath).split(path.sep).join("/"));
  return localPath.split(path.sep).join("/");
}

const studyEntries = await import("node:fs/promises").then(({ readdir }) => readdir(studiesDir, { withFileTypes: true }));
for (const entry of studyEntries.filter((item) => item.isDirectory())) {
  const destinationDir = path.join(studiesDir, entry.name);
  const basePackage = JSON.parse(await readFile(path.join(destinationDir, "study_package.json"), "utf8"));
  const sourceDir = path.resolve(workspace, "muse-document-processing/runs", basePackage.study_id);
  if (!await exists(sourceDir)) throw new Error(`study source not found for ${entry.name}: ${sourceDir}`);

  const copied = new Map();
  for (const name of packageNames) {
    const promotedPath = path.join(destinationDir, name);
    if (!await exists(promotedPath)) continue;
    const data = JSON.parse(await readFile(promotedPath, "utf8"));
    const rewritten = await rewriteValue(data, sourceDir, destinationDir, copied);
    await writeFile(promotedPath, `${JSON.stringify(rewritten, null, 2)}\n`);
  }

  const manifest = {
    schema_version: "city-study-assets.v1",
    source_id: entry.name,
    source_study_dir: path.relative(workspace, sourceDir).split(path.sep).join("/"),
    copied_assets: [...copied.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([local_path, source_path]) => ({ local_path, source_path })),
  };
  await writeFile(path.join(destinationDir, "asset_manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}
