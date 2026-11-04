# Contributing to Subsurface India

Thank you for your interest in contributing to Subsurface India! We welcome community contributions in hydrogeology, geoinformatics, UI/UX design, full-stack engineering, and AI document extraction.

---

## 🏛 Code of Conduct

All contributors and participants are expected to adhere to our [Code of Conduct](CODE_OF_CONDUCT.md). Please maintain a welcoming, respectful, and collaborative environment.

---

## ⚖️ Core Scientific Principles

When contributing to Subsurface India, you must adhere to three foundational tenets:

1. **Evidence-First & Zero Hallucination**:
   - Never extrapolate, fabricate, or guess spatial coordinates, depths, water levels, or lithological classifications.
   - If a source document does not provide coordinates, mark the entity as unlocated (`located: false`).
2. **Confidence Annotation**:
   - Every scientific metric must retain its confidence tier (`measured`, `interpreted`, `reported`, or `unknown`).
3. **Traceable Grounding**:
   - Observations must link back to specific source files, page numbers, table cells, or annexures.

---

## 🛠 Development Workflow

### Repository Structure

- `.agents/`: Agentic workflows and skill specifications.
- `muse-source-ingestion/`: Ingestion and source discovery workflows.
- `muse-document-processing/`: Multimodal parsing, extraction, and study package compiler.
- `muse-ui/`: Adaptive visualizer testbed and capability engine.
- `ui-v2/`: Main production Subsurface Explorer web app.

### Branching and Commits

- Create feature branches from `main` (or the active feature branch):
  ```bash
  git checkout -b feat/your-feature-name
  ```
- Use Conventional Commits formatting:
  - `feat: add borehole profile inspector`
  - `fix: resolve coordinate transform in south UTM zones`
  - `docs: update contracts specification`
  - `test: add capability negotiation edge cases`

### Running Local Checks

Before opening a pull request, ensure all tests and builds pass:

```bash
# 1. UI V2 verification (Vitest + TypeScript build)
cd ui-v2
npm run verify

# 2. Muse UI tests (Vitest + Playwright)
cd ../muse-ui
npm test

# 3. Document Processing tests
cd ..
node muse-document-processing/tests/study-workflow.test.js

# 4. Source Ingestion tests
node muse-source-ingestion/tests/ingest-workflow.test.js
```

---

## 🔍 Reporting Issues and Proposing Features

- **Bugs**: When opening an issue, provide clear reproduction steps, browser version, operating system, and sample study packages if applicable.
- **Data Errors**: If you identify a discrepancy in an extracted study package versus the original government publication, please cite the exact document title, year, page number, and table reference.

---

## 📄 License Agreement

By contributing to Subsurface India, you agree that your contributions will be licensed under the Apache License 2.0.
