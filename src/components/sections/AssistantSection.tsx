/**
 * AI research assistant section (Phase 1: honest non-operational placeholder).
 * The input is disabled and labelled; example questions are marked forthcoming.
 */
import { Icon, Pill, SectionShell } from '../ui';

const EXAMPLE_QUESTIONS = [
  'Which aquifers are documented beneath Gandhinagar?',
  'What depths do the CGWB reports give for the confined aquifer?',
  'Show me every observation cited from page 40–60.',
];

export default function AssistantSection({ locationName }: { locationName: string }) {
  return (
    <SectionShell
      eyebrow="Assistant"
      title="AI research assistant"
      intro={`Ask questions about ${locationName}'s subsurface science and get answers grounded in cited report pages. The assistant activates once findings exist to reason over.`}
    >
      <div className="flex items-center gap-2">
        <Pill tone="ochre">
          <Icon name="clock" className="h-3 w-3" />
          Forthcoming · Phase 2
        </Pill>
        <Pill tone="neutral">Not connected</Pill>
      </div>

      <div className="space-y-2.5 rounded-2xl border border-edge bg-panel-soft/40 p-4">
        <div className="rounded-xl border border-edge bg-panel px-3.5 py-3 text-[13px] leading-relaxed text-muted">
          I will answer from processed observations only — each claim carrying its page citation
          and evidence grade. Until the first report is validated, I stay silent rather than guess.
        </div>
        <p className="pt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">
          Example questions
        </p>
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLE_QUESTIONS.map((q) => (
            <span
              key={q}
              className="cursor-not-allowed rounded-full border border-dashed border-edge px-3 py-1.5 text-[12px] text-faint"
              title="Available once the assistant is connected"
            >
              {q}
            </span>
          ))}
        </div>
      </div>

      <form onSubmit={(e) => e.preventDefault()} aria-label="Research assistant (disabled)">
        <div className="flex items-center gap-2 rounded-xl border border-edge bg-panel-soft/60 px-3.5 py-1 opacity-60">
          <input
            type="text"
            disabled
            placeholder="The assistant arrives with Phase 2…"
            className="w-full bg-transparent py-2.5 text-[13.5px] text-fog placeholder:text-faint focus:outline-none"
            aria-disabled="true"
          />
          <span className="text-faint" aria-hidden="true">
            <Icon name="send" className="h-4 w-4" />
          </span>
        </div>
      </form>
    </SectionShell>
  );
}
