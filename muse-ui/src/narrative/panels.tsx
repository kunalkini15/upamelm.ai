// Evidence-linked narrative and report surfaces. They render only typed
// scene-model content as inert text (never package HTML) and coordinate
// through the shared interaction store.

import { useInteraction } from "../interaction/store.tsx";
import type { NarrativeTarget, ReportSection } from "../scene-model/types.ts";

function FeatureChips({
  featureIds,
  labelOf,
}: {
  featureIds: string[];
  labelOf: (id: string) => string;
}) {
  const { state, dispatch } = useInteraction();
  if (featureIds.length === 0) return <span className="muted">No linked evidence.</span>;
  return (
    <span className="chips">
      {featureIds.map((id) => (
        <button
          key={id}
          type="button"
          data-testid={`evidence-${id}`}
          className={state.activeFeatureId === id ? "chip active" : "chip"}
          onClick={() => dispatch({ type: "select", featureId: id })}
          title={`Focus ${labelOf(id)} everywhere`}
        >
          {labelOf(id)}
        </button>
      ))}
    </span>
  );
}

export function NarrativePanel({
  items,
  labelOf,
}: {
  items: NarrativeTarget[];
  labelOf: (id: string) => string;
}) {
  if (items.length === 0) {
    return (
      <div className="emptypanel" data-testid="narrative-empty" role="status">
        <h2>Narrative</h2>
        <p>No narrative insights yet. Import a validated package to read evidence-linked insights here.</p>
      </div>
    );
  }
  return (
    <div className="listpanel" data-testid="narrative-list">
      <h2>Narrative</h2>
      {items.map((n) => (
        <article key={n.id} data-testid={`narrative-${n.id}`}>
          <h3>{n.title}</h3>
          <p>{n.body}</p>
          <FeatureChips featureIds={n.featureIds} labelOf={labelOf} />
        </article>
      ))}
    </div>
  );
}

export function ReportPanel({
  sections,
  labelOf,
}: {
  sections: ReportSection[];
  labelOf: (id: string) => string;
}) {
  if (sections.length === 0) {
    return (
      <div className="emptypanel" data-testid="report-empty" role="status">
        <h2>Report</h2>
        <p>No report sections yet. Import a validated package to navigate structured report content here.</p>
      </div>
    );
  }
  return (
    <div className="listpanel" data-testid="report-list">
      <h2>Report</h2>
      {sections.map((s) => (
        <article key={s.id} data-testid={`report-${s.id}`}>
          <h3>{s.title}</h3>
          <p>{s.body}</p>
          <FeatureChips featureIds={s.featureIds} labelOf={labelOf} />
        </article>
      ))}
    </div>
  );
}
