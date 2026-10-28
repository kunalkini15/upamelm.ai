/**
 * Overview section: neutral place facts + data-availability status.
 * Contains no scientific claims — only administrative geography and
 * honest "not yet processed" availability.
 */
import type { LocationFindings, ResearchLocation } from '@/types';
import { domainById } from '@/data/domains';
import { ConfidenceLegend, Icon, Pill, SectionShell } from '../ui';

export default function OverviewSection({
  location,
  findings,
}: {
  location: ResearchLocation;
  findings: LocationFindings;
}) {
  const [lng, lat] = location.centroid.coordinates;
  return (
    <SectionShell
      eyebrow="Overview"
      title={location.name}
      intro={location.summary}
    >
      <dl className="grid grid-cols-2 gap-2">
        <Fact label="State" value={location.admin.state ?? '—'} />
        <Fact label="District" value={location.admin.district ?? '—'} />
        <Fact label="Coordinates" value={`${lat.toFixed(4)}° N, ${lng.toFixed(4)}° E`} mono />
        <Fact
          label="Research status"
          value={location.availableDomains.length === 0 ? 'Awaiting Phase 2' : 'In progress'}
        />
      </dl>

      <div className="rounded-xl border border-edge bg-panel-soft/60 p-3.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">
            Data availability
          </p>
          <Pill tone="neutral">
            <Icon name="clock" className="h-3 w-3" />
            {findings.observationIds.length} observations
          </Pill>
        </div>
        <ul className="mt-2.5 divide-y divide-edge/70">
          {findings.availability.map((a) => {
            const domain = domainById(a.domainId);
            if (!domain) return null;
            return (
              <li key={a.domainId} className="flex items-center justify-between gap-2 py-2">
                <span className="flex items-center gap-2 text-[13px]">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: domain.accent }}
                    aria-hidden="true"
                  />
                  <span className="font-medium text-fog">{domain.label}</span>
                  <span className="text-faint">· Phase {domain.phase}</span>
                </span>
                <span className="text-[12px] text-faint">
                  {a.state === 'available' ? `${a.findingCount} findings` : 'Not yet processed'}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <ConfidenceLegend />
    </SectionShell>
  );
}

function Fact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-edge bg-panel-soft/60 px-3.5 py-2.5">
      <dt className="text-[11px] font-medium uppercase tracking-[0.12em] text-faint">{label}</dt>
      <dd className={`mt-0.5 truncate text-[13.5px] font-medium text-fog ${mono ? 'font-mono text-[12.5px]' : ''}`}>
        {value}
      </dd>
    </div>
  );
}
