import { readFile, writeFile } from "node:fs/promises";

const stages = [
  ["ingestWorkflow", "muse-source-ingestion/ingest-workflow.js"],
  ["studyWorkflow", "muse-document-processing/study-workflow.js"],
  ["translateWorkflow", "muse-translate/translate-workflow.js"],
];

const wrapped = [];
for (const [binding, file] of stages) {
  const source = await readFile(file, "utf8");
  const body = source.replace("export default async function workflow", "async function workflow");
  if (body === source) throw new Error(`default workflow export not found in ${file}`);
  wrapped.push(`const ${binding} = (() => {\n${body}\nreturn workflow;\n})();`);
}

const pipelineSource = await readFile("pipeline-workflow.js", "utf8");
const pipelineBody = pipelineSource.replace(/^import .*;\n/gm, "");
if (pipelineBody === pipelineSource) throw new Error("pipeline imports were not found");

const generated = [
  "// GENERATED FILE — do not edit directly.",
  "// Run: node scripts/build-pipeline-workflow-runtime.mjs",
  "// Muse workflow scripts reject imports, so stage modules are scoped and bundled here.",
  ...wrapped,
  pipelineBody,
  "",
].join("\n\n");

await writeFile("pipeline-workflow.runtime.js", generated);
