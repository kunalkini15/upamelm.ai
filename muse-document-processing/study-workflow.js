// Agentic subsurface study: one document -> UI study package.
// Run via muse.workflow with scriptPath "muse-document-processing/study-workflow.js"
// and args { document: "<path>", output_dir: "muse-document-processing/runs/<study-id>" }.

export default async function workflow(host) {
  const args = host.args || {};
  const document = args.document;
  const outputDir = args.output_dir;
  if (!document || !outputDir) {
    const report = {
      status: "invalid_args",
      unresolved: ["args must include document and output_dir"],
      evidence: [],
      notes: [],
    };
    return { ...report, summary: JSON.stringify(report) };
  }

  const stageSchema = (extra) => ({
    type: "object",
    required: ["complete", "evidence", "unresolved", ...Object.keys(extra)],
    properties: {
      complete: { type: "boolean" },
      evidence: { type: "array", items: { type: "string" } },
      unresolved: { type: "array", items: { type: "string" } },
      ...extra,
    },
  });
  const pathProp = { type: "string" };

  const brief = [
    `Study one document: ${document}.`,
    `Write outputs only under: ${outputDir}/.`,
    "First read muse-document-processing/WORKFLOW.md and muse-document-processing/contracts.md and follow them.",
    "Match the live UI sample at ui-v2/dist/study_package.json; never invent coordinates, depths, geometry, or values.",
  ].join(" ");

  const stages = [];
  const notes = [];
  const collectNotes = (result, scope) => {
    if (result && typeof result.notes === "string" && result.notes.trim()) {
      notes.push({ source: scope, ref: result.ref, value: result.notes });
    }
  };

  const runStage = async (scope, input, schema) => {
    const result = await host.agent({ input, schema, label: scope });
    collectNotes(result, scope);
    const failed = result === null || result.error_kind;
    const data = !failed && result.data && typeof result.data === "object" ? result.data : null;
    const ok = !failed && data && data.complete === true;
    stages.push({ scope, ref: result ? result.ref : null, complete: !!ok, error_kind: result ? result.error_kind || null : "null_result" });
    return { result, data, ok };
  };

  // 1. Scout: native read + grounded inventory.
  const scout = await runStage(
    "scout",
    `${brief} Step 1 only: read the document natively and write ${outputDir}/evidence_inventory.json. Return complete/evidence/unresolved plus inventory_path and source_summary.`,
    stageSchema({ inventory_path: pathProp, source_summary: { type: "string" } })
  );
  if (!scout.ok) {
    const report = { status: "partial", failed_stage: "scout", stages, unresolved: ["scout did not complete; no outputs ready"], notes };
    return { ...report, summary: JSON.stringify(report) };
  }

  // 2. Renderer: Output 1.
  const renderer = await runStage(
    "renderer",
    `${brief} Prior scout result: ${scout.result.ref}. Step 2 only: build ${outputDir}/rendering_package.json (study-rendering.v2) strictly from the inventory. Return complete/evidence/unresolved plus rendering_path.`,
    stageSchema({ rendering_path: pathProp })
  );
  if (!renderer.ok) {
    const report = { status: "partial", failed_stage: "renderer", stages, unresolved: ["rendering package not built"], notes };
    return { ...report, summary: JSON.stringify(report) };
  }

  // 3. Pointers: Output 2 (non-technical).
  const pointers = await runStage(
    "pointers",
    `${brief} Prior results: ${scout.result.ref} ${renderer.result.ref}. Step 3 only: build ${outputDir}/narrative_package.json (ui-narrative.v2), one plain-language entry per rendered feature with valid geometry. Return complete/evidence/unresolved plus narrative_path.`,
    stageSchema({ narrative_path: pathProp })
  );
  if (!pointers.ok) {
    const report = { status: "partial", failed_stage: "pointers", stages, unresolved: ["narrative package not built"], notes };
    return { ...report, summary: JSON.stringify(report) };
  }

  // 4. Reporter: Output 3 (non-technical).
  const reporter = await runStage(
    "reporter",
    `${brief} Prior results: ${scout.result.ref} ${renderer.result.ref} ${pointers.result.ref}. Step 4 only: build ${outputDir}/report.json (report-synthesis.v1), a plain-language whole-document analysis. Return complete/evidence/unresolved plus report_path.`,
    stageSchema({ report_path: pathProp })
  );
  if (!reporter.ok) {
    const report = { status: "partial", failed_stage: "reporter", stages, unresolved: ["report not built"], notes };
    return { ...report, summary: JSON.stringify(report) };
  }

  // 5. Assembler: validate + final study_package.json.
  const assembler = await runStage(
    "assembler",
    `${brief} Prior results: ${scout.result.ref} ${renderer.result.ref} ${pointers.result.ref} ${reporter.result.ref}. Step 5 only: run the WORKFLOW.md self-check, fix what you can without inventing facts, then build ${outputDir}/study_package.json (document-study.v2). Return complete/evidence/unresolved plus study_path and issue_count.`,
    stageSchema({ study_path: pathProp, issue_count: { type: "integer" } })
  );

  const outputs = {
    evidence_inventory: scout.data.inventory_path,
    rendering_package: renderer.data.rendering_path,
    narrative_package: pointers.data.narrative_path,
    report: reporter.data.report_path,
    study_package: assembler.ok ? assembler.data.study_path : null,
  };
  const unresolved = assembler.ok ? [] : ["final assembly did not complete"];
  const report = {
    status: assembler.ok ? "complete" : "partial",
    document,
    output_dir: outputDir,
    outputs,
    stages,
    unresolved,
    notes,
  };
  return { ...report, summary: JSON.stringify(report) };
}
