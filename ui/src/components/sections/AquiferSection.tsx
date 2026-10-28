/**
 * Aquifer intelligence section (Phase 1: designed empty state).
 * Describes what will appear here without fabricating any of it.
 */
import { ConfidenceLegend, EmptyState, Icon, SectionShell } from '../ui';

const COMING_CAPABILITIES = [
  {
    title: 'Aquifer systems',
    body: 'Documented aquifers with reported type, host formation and extent.',
  },
  {
    title: 'Depths & thickness',
    body: 'Top, bottom and thickness in metres below ground level, per observation.',
  },
  {
    title: 'Yields & characteristics',
    body: 'Transmissivity, yield ranges and water-quality notes as reported.',
  },
  {
    title: 'Groundwater conditions',
    body: 'Water levels, seasonal fluctuation and CGWB categorisation.',
  },
];

export default function AquiferSection() {
  return (
    <SectionShell
      eyebrow="Groundwater"
      title="Aquifer intelligence"
      intro="Extracted aquifer observations will appear here once the Gandhinagar survey reports are processed — every value graded measured, interpreted or unknown."
    >
      <EmptyState
        icon="droplet"
        title="No aquifer observations yet"
        body="The extraction pipeline begins in Phase 2 with the Gandhinagar CGWB reports. Nothing is shown until it can be traced to a cited page."
      />
      <div className="space-y-2">
        {COMING_CAPABILITIES.map((c) => (
          <div
            key={c.title}
            className="flex items-start gap-3 rounded-xl border border-edge bg-panel-soft/60 px-3.5 py-3 opacity-75"
          >
            <span className="mt-0.5 text-faint">
              <Icon name="clock" className="h-4 w-4" />
            </span>
            <span>
              <span className="block text-[13.5px] font-semibold text-fog">{c.title}</span>
              <span className="block text-[12.5px] leading-relaxed text-muted">{c.body}</span>
            </span>
          </div>
        ))}
      </div>
      <ConfidenceLegend />
    </SectionShell>
  );
}
