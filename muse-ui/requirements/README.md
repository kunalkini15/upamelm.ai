# UI refinement requirements

Create one focused Markdown file per visual or interaction improvement. These
requirements are executed by `adaptive-ui-refine.js` after the experience
foundation exists.

Describe the user outcome and observable experience, not a predetermined code
implementation. Keep one coherent problem per file so Muse can compare the
rendered result before and after. Package/schema/capability changes belong to
the evolution workflow, not refinement.

Invoke a requirement from the repository root:

```text
Use a workflow with the saved script .agents/workflows/adaptive-ui-refine.js,
with requirement_path muse-ui/requirements/<requirement>.md.
```
