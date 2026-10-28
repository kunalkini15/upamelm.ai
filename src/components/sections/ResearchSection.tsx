/**
 * Research & evidence section (Phase 1: empty source list + pipeline map).
 * No report is named until it is registered for processing.
 */
import { EmptyState, Icon, SectionShell } from '../ui';

const PIPELINE_STAGES = [
  { stage: 'Registered', body: 'Report catalogued with agency, year and provenance.' },
  { stage: 'Queued', body: 'Scheduled for AI-assisted extraction.' },
  { stage: 'Extracting', body: 'Muse Spark reads pages; observations take shape.' },
  { stage: 'Validating', body: 'Citation coverage and schema checks must pass.' },
  { stage: 'Published', body: 'Findings appear across maps, panels and visuals.' },
];

export default function ResearchSection() {
  return (
    <SectionShell
      eyebrow="Evidence"
      title="Research & evidence"
      intro="Every future finding links to the exact report pages behind it. Sources will be listed here with page-level citations, figures and tables."
    >
      <EmptyState
        icon="book"
        title="No source reports yet"
        body="Gandhinagar's CGWB survey reports enter the pipeline in Phase 2. Until then, this shelf stays honestly empty."
      />
      <div className="rounded-xl border border-edge bg-panel-soft/60 p-3.5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">
          From report to evidence
        </p>
        <ol className="mt-2.5 space-y-0">
          {PIPELINE_STAGES.map((s, i) => (
            <li key={s.stage} className="flex gap-3">
              <span className="flex flex-col items-center">
                <span className="flex h-5 w-5 items-center justify-center rounded-full border border-edge bg-panel font-mono text-[10px] text-faint">
                  {i + 1}
                </span>
                {i < PIPELINE_STAGES.length - 1 ? (
                  <span className="my-1 w-px flex-1 bg-edge" aria-hidden="true" />
                ) : null}
              </span>
              <span className="pb-3.5">
                <span className="block text-[13px] font-semibold text-fog">{s.stage}</span>
                <span className="block text-[12.5px] text-muted">{s.body}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="flex items-start gap-1.5 border-t border-edge pt-2.5 text-[11.5px] leading-relaxed text-faint">
          <Icon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Anticipated publishers include the Central Ground Water Board (CGWB) and the Geological
          Survey of India (GSI). Documents are cited, never paraphrased without a reference.
        </p>
      </div>
    </SectionShell>
  );
}
