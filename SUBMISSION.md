# Upamelm.ai — Hackathon Submission Draft
> Meta Global AI Hackathon (Oct) · Generic / platform framing — no specific locations, examples, or report types.
> Status: DRAFT — paste each field into the submission form. Replace [bracketed] placeholders before submitting.

---

## Project Name
Upamelm.ai

## Tagline (short description)
Maps show the world. We help you understand what's underneath.

## Elevator Pitch (1–2 sentences / ~280 characters)
Upamelm.ai is an AI-powered, multi-agent platform that transforms complex, unstructured documents into interactive, explorable 2D and 3D spatial experiences — so anyone can discover, understand, and trust what's hidden beneath the surface.

---

## Description (main project description)
We have detailed maps of the world above ground, yet much of what lies beneath remains hidden — fragmented across public reports, scientific surveys, engineering studies, and complex technical documents. This wealth of knowledge is difficult to discover, interpret, connect, and visualize. As a result, critical insight stays locked in PDFs and annexures, accessible only to specialists with weeks to spare.

**Upamelm.ai is an AI-powered, multi-agent platform that transforms complex, unstructured information into interactive, explorable 2D and 3D spatial experiences.**

Powered by Meta's Muse, our end-to-end agentic architecture operates across three interconnected stages:

1. **Autonomous Discovery** — Research agents investigate a given location, discover relevant sources across formats and repositories, evaluate their relevance, and ingest the most credible documents.

2. **Document Intelligence** — Specialized agents independently plan extraction strategies, analyze complex documents, identify spatial relationships, cross-reference findings across sources, and synthesize structured knowledge — every claim grounded in traceable source evidence.

3. **Adaptive Visualization** — AI agents transform synthesized knowledge into interactive geographic layers, 3D representations, and dynamically generated UI components, adapting the experience to the information actually available rather than relying on rigid, predefined visualizations.

**What makes Upamelm.ai different is its adaptability.** The architecture is designed to work across document formats, geographic locations, and knowledge domains. As new information becomes available, agents can extend the underlying knowledge model and adapt the visualization experience — without requiring a completely new application for every use case.

Our ambition goes beyond conventional mapping or document analysis. We envision a platform where AI continuously bridges the gap between complex information and human understanding — transforming scattered knowledge into accessible, evidence-backed, spatial experiences.

**Any city. Any domain. Any document. A world of knowledge waiting to be explored.**

---

## Inspiration
Maps transformed how we navigate the world above ground, yet our understanding of what lies beneath — and much of the knowledge that surrounds us — still lives in fragmented, unstructured documents that are hard to find, harder to read, and nearly impossible to explore spatially. Experts spend weeks manually piecing together reports; non-experts are locked out entirely. We asked: what if AI agents could do that discovery, extraction, and synthesis autonomously — and present the result not as another static report, but as a living, explorable 2D/3D experience anyone could understand and verify? That question became Upamelm.ai.

## What It Does
Given any location, Upamelm.ai:

- **Discovers** relevant public sources autonomously — searching, ranking, and ingesting documents across formats.
- **Understands** them with specialized agents that extract entities, measurements, and spatial relationships, cross-reference findings, and flag uncertainty — with every result linked to its source evidence.
- **Synthesizes** a structured, validated knowledge package from scattered documents.
- **Visualizes** that knowledge adaptively — interactive 2D maps, 3D spatial representations, timelines, charts, and plain-language summaries — generated to fit the evidence, not forced into a fixed template.
- **Explains** findings in accessible language (with optional multilingual output) while keeping page-level citations one click away, so trust is never asked for — it is shown.

Users can switch locations and topics, move seamlessly between 2D and 3D views, and click any feature to inspect the underlying evidence.

## How We Built It
Upamelm.ai is a fully agentic pipeline — there is no fixed code path from document to visualization. Autonomous agent workflows, powered by Meta's Muse, handle each stage:

- **Discovery agents** resolve a location, inventory available sources, search public repositories, audit relevance, and compile a validated source manifest with provenance and checksums.
- **Document-intelligence agents** plan per-document extraction, process multimodal content (text, tables, maps, figures, annexures), normalize and validate findings, and synthesize a structured study package under a documented schema — distinguishing *measured*, *interpreted*, and *reported* evidence and refusing to fabricate values without a source.
- **Translation agents** produce plain-language, multilingual versions of the package while preserving every ID, value, unit, and evidence reference exactly.
- **Visualization agents** negotiate capabilities against the synthesized package and generate/adapt the UI — maps, 3D scenes, charts, and narrative panels — degrading gracefully (never inventing geometry) when evidence is thin.
- A lightweight **read-only API** serves the synthesized packages to the frontend by discovery from the filesystem — no hand-maintained catalog, no database to keep in sync.
- The **frontend** is a dual-engine spatial explorer (2D map + 3D scene) that renders entirely from the evidence package, keeping the UI generic across locations and domains.

Dual-agent patterns (an authoring agent paired with a critique agent) keep quality high at every stage, and every stage is resumable, verifiable, and test-backed with offline fixtures.

## Challenges We Ran Into
- **Grounding vs. hallucination:** Getting agents to extract richly without inventing coordinates, depths, or values. We enforced an evidence-first contract — no claim renders without a citation and a confidence tier — and fail-closed validation.
- **Heterogeneous documents:** Sources vary wildly in format, structure, vocabulary, and quality. We built canonical envelopes and deterministic normalizers so agents stay domain-agnostic while preserving original payloads.
- **Incomplete runs & recovery:** Long multi-document runs fail in pieces. We designed effective-manifest assembly so retries and partial recoveries merge into one auditable, complete result instead of silently dropping evidence.
- **Honest visualization:** It is tempting to draw continuous surfaces from sparse points. We introduced explicit geometry classes (measured / interpreted / derived / blocked) so the UI only shows what the evidence supports — and says so when it cannot.
- **Keeping it generic:** Hard-coding one domain would have been faster. Keeping every layer (schema, synthesis, rendering) domain-independent required discipline, but it is what makes the platform reusable anywhere.

## Accomplishments That We're Proud Of
- A working **end-to-end agentic pipeline** — discovery → document intelligence → translation → adaptive visualization — that turns unstructured documents into an explorable spatial experience with no manual data entry.
- **Zero-hallucination by design:** every measurement carries a confidence tier and a traceable, page-level citation; unsupported geometry is blocked, not faked.
- A **truly adaptive UI** that negotiates its layout and visual primitives from the evidence package, so new locations and domains work without new frontend code.
- **Multilingual, plain-language output** that preserves scientific fidelity — values, units, and evidence refs are never altered in translation.
- A modular, open architecture with documented contracts between every stage, so each agent workflow can evolve independently.

## What We Learned
- Agentic systems are only trustworthy when the *contracts between agents* are strict — schemas, grounding gates, and deterministic validators matter as much as model capability.
- Separating authoring and critique into paired agent roles dramatically improves extraction and UI quality.
- Designing for the *absence* of evidence (graceful degradation, explicit “blocked” states) is as important as designing for rich data.
- A generic, domain-agnostic core is harder to build but unlocks reuse across geographies and fields that a bespoke app never could.
- People trust spatial AI when they can click through to the source — evidence UX is a feature, not an afterthought.

## What's Next for Upamelm.ai
- **Broaden discovery:** more source types, repositories, and languages, with continuous re-ingestion as new documents are published.
- **Deeper spatial intelligence:** richer cross-document entity resolution, temporal change detection, and uncertainty-aware interpolation — always labeled as interpretation.
- **Collaborative exploration:** shareable evidence dossiers, annotations, and Q&A grounded strictly in the synthesized package.
- **Domain packs:** reusable knowledge-model extensions so new fields can be onboarded by configuration, not code.
- **Open ecosystem:** publish the stage contracts and agent workflows so researchers and developers can plug in their own sources, extractors, and visualizations.

Our long-term vision: a living atlas of the world's hidden knowledge — continuously discovered, understood, and made explorable by AI.

## Built With
Meta Muse (multi-agent workflows) · React 19 · TypeScript · Vite · Tailwind CSS v4 · MapLibre GL · Three.js / React Three Fiber · FastAPI (Python) · Node.js · Vitest / Playwright

## Links [fill before submitting]
- GitHub / Code: [REPO_URL]
- Demo Video (≤ [length] min): [VIDEO_URL]
- Live Demo: [DEMO_URL or “run locally — see README”]
- Team: [TEAM_NAME / MEMBERS]

---

### Submission Checklist (delete before submitting)
- [ ] No specific city/region, case study, or report/publisher names anywhere in form, video, or screenshots.
- [ ] Demo video shows: discovery → synthesis → 2D/3D exploration → evidence click-through.
- [ ] All links public/accessible to judges (repo, video, demo).
- [ ] README Quick Start verified from a clean clone.
