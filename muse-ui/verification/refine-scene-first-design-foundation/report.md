# Report — refine-scene-first-design-foundation (writer stage)

## Input and decision

- Requirement: `muse-ui/requirements/scene-first-design-foundation.md` (scene-first landing + reusable component foundation).
- Direction review: `direction-review.md` — seven `must_fix` items incorporated as plan text below; no scope expansion.
- Capability decision: **supported**. No new capability, no registry delta, no package-schema/adapter/geometry change. The work composes existing capabilities behind new chrome. `blocked=false`; no evolve handoff needed.
- Frozen boundary held: `capability-registry.json` and `package-registry.json` are byte-equal to `registry-snapshot/` at run end (checked twice). No fixture-name branches in `src/` (grep: only test-data ids in `validate.test.ts`).

## What changed (one coherent experience change)

- `src/app/App.tsx` — scene-first shell: 52px dark command bar (identity, package status, five modes, Layers/Import/Limits(count)/Tour/Help triggers); no rail, no reason strip, no footer. Layers+selection live in an on-demand popover, import in a modal dialog, limitations in a badge-anchored popover, help in a dialog. Inspector and narrative/report drawers mount via Motion with the map staying mounted behind. Disabled 3D/Split use the focusable-wrapper disclosure pattern.
- `src/design/ui.tsx` (new) — locally owned variants: Button (5), Tooltip, DisabledReason, Popover, Dialog, StatusBadge, Notice, LayerRow, EmptyState, MountMotion. Screens never touch Radix directly (only the `Tooltip.Provider` mount).
- `src/design/components.tsx` — Lucide-only icons (`MODE_ICONS`), kept camera/motion helpers with the two-gate contract documented.
- `src/styles.css` — Tailwind v4 `@import` + `@theme` mapping of every semantic token; flat chrome, opaque overlays, compact bottom-toolbar row with the scale/attribution dock lifted above it, split reduced-motion gates.
- `vite.config.ts`, `package.json`/`package-lock.json` — Tailwind v4 (+Vite plugin), `lucide-react@1.68.0`, `motion@14.9.1`, `@radix-ui/react-{tooltip@1.4.1,popover@1.3.1,dialog@1.3.1}`. Nothing else installed.
- `src/map/MapView.tsx` — legend dock renders only with study layers (quiet empty landing); all testids kept.
- `DESIGN_SYSTEM.md` — new §8: architecture, luminance decision, token-mapping table, variants, icon/motion rules, chrome/renderer boundary, per-state budgets, disclosure pattern, 3D overlay budget.
- Tests: `shell.test.tsx` (on-demand composition), `src/design/ui.test.tsx` (variant token-gating), five updated browser specs, new `tests/browser/scene-first.spec.ts` (8 required states + budgets).

## must_fix dispositions

- MF-1 luminance/hierarchy: dark bar + canvas vs measured light surfaces, mapping table in DESIGN_SYSTEM §8.1–8.2, `ui.test.ts` bans default-palette leakage. Seen in after-01/04/05.
- MF-2 map dominance: 52px bar, stage fraction **0.928** measured in all five desktop states (closed, import open, spatial open, populated, inspector open; deltas <0.02). Before/after pair: rail + strips + footer gone, fraction 0.928.
- MF-3 disclosure: focusable wrapper with `aria-label` + persistent `sr-only` describedby node; tooltip is pointer-only; tap focuses on touch. Spec sf-07 tabs to `mode-3d-reason-disclosure` and reads the reason.
- MF-4 3D budget: §8.6 overlay allow-list, all opaque; sf-05 asserts exaggeration label, orientation cue, depth rail, attribution visible; §6 viz rules untouched.
- MF-5 compact: closed-state triggers named in the bar (sf-06), sheets ≤62% with scene peek, modes one full row (fixed `flex-1`-overrides-`w-full` wrap bug found by probe), 44px targets asserted, toolbar/attribution overlap fixed by lifting the bottom-right dock.
- MF-6 motion gates: `MotionConfig reducedMotion="user"` + CSS block (UI) vs `cameraDuration()` (camera); sf-07 exercises both under emulated reduced motion.
- MF-7 evidence: six retained finals + two diagnostics bitmaps (import-failure, basemap-failure) under `diagnostics/`; source grep (all shell buttons use shared variants; Radix only in `ui.tsx` + provider mount); execution path recorded below.

## Commands run (all observed)

- `npm run build` — pass (tsc + vite).
- `npm run test` — 11 files / 51 tests pass.
- `npm run test:browser` — **22/22 pass** in the repo-pinned image `mcr.microsoft.com/playwright:v1.64.1-noble` serving `dist/` via `python3 -m http.server` on 127.0.0.1:5210 with `MUSE_NO_SERVER=1`. Host-direct run fails at connection (`vite preview` binds a host the specs refuse — same as plan appendix); per `lessons/shared.md` no browser cycling was attempted. Container and server stopped after each run; `docker ps` shows no run servers.
- Rebuilt + reran after every fix; final full pass 22/22 on the shipped `dist/`.

## Browser states inspected (pixels read by the writer)

| Shot | State | Verdict |
|---|---|---|
| `after-01-landing.png` | Desktop empty landing, all closed | Map dominant, one world view, quiet bar; no rail/strip/footer/legend noise |
| `after-02-import.png` | Import dialog open | Opaque dialog, validated-local copy, stage unchanged behind |
| `after-03-spatial.png` | Layers/selection popover open | One component language, stage unchanged |
| `after-04-inspector.png` | Populated map + BH-03 inspector | Legend + study bar + inspector coherent; selection coordinated |
| `after-05-3d.png` | 3D overview | Legend, depth rail, provenance, exaggeration label, cue, toolbar all visible, none translucent |
| `after-06-compact.png` | 390×700 populated | Modes one row, triggers reachable, scene first, no toolbar/attribution overlap |
| `diagnostics/import-failure.png` | Outdated schema import | Actionable error; last valid package preserved |
| `diagnostics/basemap-failure.png` | Tiles blocked | Fallback style + notice; controls/attribution usable |

Evidence tiers: retained shots above were visually inspected; stage fractions/keyboard/reduced-motion/import-failure/basemap-failure additionally carry automated assertions; nothing is claimed from uninspected artifacts.

## Issues fixed during the run

1. Duplicate disclosure ids (`mode-3d-reason` used by both 3D and Split wrappers) — now per-mode (`mode-3d-reason`, `mode-split-reason`).
2. Stale split-banner assertion (`limitations` must not contain the unknown-capability name) — single surface now carries each limitation exactly once; assertion updated to the honest text.
3. Compact nav never wrapped (`flex-1` basis overrode `w-full`) — `basis-full` own-row fix, verified by probe.
4. Compact toolbar/scale overlap — bottom-right dock lifted above the toolbar row.
5. Empty-landing legend noise — dock renders only with study layers.

## Limitations and notes

- Remote-tile hosts were reachable from the container, so after-01 shows live OpenFreeMap tiles; the fallback path is proven by the blocked-host spec + retained diagnostic bitmap, not by the finals.
- `dist/` is rebuilt from the final source; the six screenshots were captured from that build.
- The repo working tree contains concurrent unrelated modifications outside `muse-ui/verification/refine-scene-first-design-foundation/`; this run touched only the files listed above plus `package.json`/`package-lock.json` (deps). No server process started by this run remains.
- Screenshots retained: 6 in `screenshots/` (cap met); failure bitmaps in `diagnostics/` (not counted as finals).
