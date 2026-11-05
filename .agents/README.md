# Shared Agent Guidance

The root `.agents` directory contains repository-wide skills and policies. It
does not contain executable UI workflows.

The previous adaptive UI bootstrap, experience, evolution, refinement, and
guardian workflows described a superseded clean-room application architecture
and have been removed. They were not invoked by the root pipeline or its tests.

The reusable evidence, capability, and browser-verification guardrails remain
in [`skills/adaptive-visualization/SKILL.md`](skills/adaptive-visualization/SKILL.md).

The replacement UI validation workflow will be owned by the `ui` module. Its
runtime, Playwright harness, Docker configuration, contracts, and verification
artifacts should live under `ui/`. The root pipeline should invoke that module
through a narrow handoff rather than embedding UI-specific behavior here.
