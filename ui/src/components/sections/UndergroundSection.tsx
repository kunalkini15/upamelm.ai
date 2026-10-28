/**
 * Underground exploration section (Phase 1: empty state + schematic frame).
 * The SVG below is a deliberately abstract placeholder frame — dashed axes
 * and no strata — so it cannot be mistaken for a geological model.
 */
import { EmptyState, Pill, SectionShell } from '../ui';

export default function UndergroundSection() {
  return (
    <SectionShell
      eyebrow="Visualisation"
      title="Underground exploration"
      intro="Interactive cross-sections and 3D reconstructions will be generated here from validated findings — never hand-drawn, never guessed."
    >
      <div className="overflow-hidden rounded-2xl border border-edge bg-panel-soft/40">
        <div className="flex items-center justify-between border-b border-edge px-4 py-2.5">
          <p className="font-mono text-[11.5px] text-faint">CROSS-SECTION · A — A′</p>
          <Pill tone="neutral">No geometry</Pill>
        </div>
        <SchematicFrame />
        <p className="border-t border-edge px-4 py-2.5 text-[11.5px] text-faint">
          Placeholder frame. Strata appear only after Phase 2 observations are validated.
        </p>
      </div>
      <EmptyState
        icon="strata"
        title="No models yet"
        body="Cross-sections and 3D scenes are built from measured depths and interpreted boundaries, each linked to its evidence. Gandhinagar is first in line."
      />
    </SectionShell>
  );
}

/** Abstract dashed frame: axes, depth ticks, and an explicit void — not a model. */
function SchematicFrame() {
  return (
    <svg viewBox="0 0 360 180" className="block w-full" role="img" aria-label="Empty cross-section placeholder">
      {/* ground surface */}
      <line x1="16" y1="34" x2="344" y2="34" stroke="#6b7471" strokeWidth="1.5" />
      <text x="20" y="26" fill="#6b7471" fontSize="9" fontFamily="monospace">GROUND SURFACE · 0 m</text>
      {/* depth axis */}
      <line x1="16" y1="34" x2="16" y2="164" stroke="#3a4340" strokeWidth="1" strokeDasharray="3 3" />
      {[40, 80, 120, 160].map((y, i) => (
        <g key={y}>
          <line x1="12" y1={y} x2="20" y2={y} stroke="#3a4340" strokeWidth="1" />
          <text x="24" y={y + 3} fill="#3a4340" fontSize="8" fontFamily="monospace">
            −{(i + 1) * 25} m
          </text>
        </g>
      ))}
      {/* void */}
      <rect x="60" y="52" width="240" height="96" fill="none" stroke="#3a4340" strokeWidth="1" strokeDasharray="6 5" rx="6" />
      <text x="180" y="96" textAnchor="middle" fill="#6b7471" fontSize="11" fontFamily="Inter, sans-serif">
        Awaiting validated findings
      </text>
      <text x="180" y="112" textAnchor="middle" fill="#3a4340" fontSize="9" fontFamily="monospace">
        PHASE 2 · GANDHINAGAR
      </text>
    </svg>
  );
}
