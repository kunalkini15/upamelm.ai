/**
 * Shared UI primitives: icon set, badges, empty states, section shells.
 */
import type { ReactNode } from 'react';
import type { ConfidenceLevel } from '@/types';

/* ---------- Minimal stroke icon set (24x24, currentColor) ---------- */

const PATHS: Record<string, ReactNode> = {
  droplet: <path d="M12 3.5c3.2 4.1 6 7.4 6 10.6a6 6 0 1 1-12 0C6 10.9 8.8 7.6 12 3.5Z" />,
  layers: <path d="m12 3 9 5-9 5-9-5 9-5Z M3 12.5l9 5 9-5 M3 17.5l9 5 9-5" />,
  book: <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15.5H6.7A1.7 1.7 0 0 0 5 20.2V4.5Z M5 20.2A1.7 1.7 0 0 1 6.7 18.5H19 M9 7.5h6" />,
  chat: <path d="M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v7a1.5 1.5 0 0 1-1.5 1.5H9l-5 4V6.5Z" />,
  pin: <path d="M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11Z M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />,
  globe: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M3 12h18 M12 3c2.5 2.4 3.8 5.6 3.8 9S14.5 18.6 12 21c-2.5-2.4-3.8-5.6-3.8-9S9.5 5.4 12 3Z" />,
  compass: <path d="m15.5 8.5-2 5-5 2 2-5 5-2Z M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />,
  x: <path d="M6 6l12 12 M18 6 6 18" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronUp: <path d="m6 15 6-6 6 6" />,
  arrowRight: <path d="M4 12h15 m-6-7 7 7-7 7" />,
  info: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M12 11v5 M12 7.6v.4" />,
  clock: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M12 7v5.5l3.5 2" />,
  eye: <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />,
  eyeOff: <path d="M4 4l16 16 M9.9 6A9.8 9.8 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.3 4M6 8.2A16 16 0 0 0 2.5 12S6 18.5 12 18.5c1.2 0 2.3-.3 3.3-.7 M9.5 9.5a3 3 0 0 0 4.2 4.2" />,
  strata: <path d="M3 7h18 M3 12h18 M3 17h12 M3 22h7" />,
  flask: <path d="M9.5 3h5 M10.5 3v5.2L5.4 17a2.4 2.4 0 0 0 2.1 3.5h9a2.4 2.4 0 0 0 2.1-3.5L13.5 8.2V3 M7.5 14.5h9" />,
  send: <path d="M20 4 10.5 13.5 M20 4 13.5 20l-3-6.5L4 10.5 20 4Z" />,
};

export function Icon({
  name,
  className = 'h-4 w-4',
}: {
  name: keyof typeof PATHS | string;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PATHS[name] ?? PATHS.info}
    </svg>
  );
}

/* ---------- Badges ---------- */

export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'ochre' | 'aqua' | 'green' | 'ember' }) {
  const tones: Record<string, string> = {
    neutral: 'border-edge bg-panel-soft text-muted',
    ochre: 'border-ochre/40 bg-ochre/10 text-ochre',
    aqua: 'border-aqua/40 bg-aqua/10 text-aqua',
    green: 'border-spring/40 bg-spring/10 text-spring',
    ember: 'border-ember/40 bg-ember/10 text-ember',
  };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium tracking-wide ${tones[tone]}`}>
      {children}
    </span>
  );
}

const CONFIDENCE_META: Record<ConfidenceLevel, { label: string; tone: 'green' | 'ochre' | 'neutral'; blurb: string }> = {
  measured: { label: 'Measured', tone: 'green', blurb: 'Directly supported by a source observation.' },
  interpreted: { label: 'Interpreted', tone: 'ochre', blurb: 'Derived through interpretation or modelling.' },
  unknown: { label: 'Unknown', tone: 'neutral', blurb: 'Insufficient evidence exists.' },
};

export function ConfidenceDot({ level, className = 'h-2 w-2' }: { level: ConfidenceLevel; className?: string }) {
  const colours: Record<ConfidenceLevel, string> = {
    measured: 'bg-spring',
    interpreted: 'bg-ochre',
    unknown: 'bg-faint',
  };
  return <span className={`inline-block rounded-full ${colours[level]} ${className}`} aria-hidden="true" />;
}

/** Legend explaining the three evidence tiers. Rendered wherever findings will appear. */
export function ConfidenceLegend() {
  return (
    <div className="rounded-xl border border-edge bg-panel-soft/60 p-3.5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">How evidence is graded</p>
      <ul className="mt-2.5 space-y-2">
        {(Object.keys(CONFIDENCE_META) as ConfidenceLevel[]).map((level) => (
          <li key={level} className="flex items-start gap-2.5 text-[13px] leading-snug">
            <ConfidenceDot level={level} className="mt-1 h-2 w-2 shrink-0" />
            <span>
              <span className="font-semibold text-fog">{CONFIDENCE_META[level].label}</span>
              <span className="text-muted"> — {CONFIDENCE_META[level].blurb}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- Empty state ---------- */

export function EmptyState({
  icon,
  title,
  body,
  children,
}: {
  icon: string;
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-edge bg-panel-soft/40 px-6 py-10 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full border border-edge bg-panel text-ochre">
        <Icon name={icon} className="h-5 w-5" />
      </span>
      <h3 className="mt-4 font-display text-xl text-fog">{title}</h3>
      <p className="mt-2 max-w-sm text-[13px] leading-relaxed text-muted">{body}</p>
      {children ? <div className="mt-4 w-full">{children}</div> : null}
    </div>
  );
}

/* ---------- Section shell ---------- */

export function SectionShell({
  eyebrow,
  title,
  intro,
  children,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ochre">{eyebrow}</p>
        <h2 className="mt-1 font-display text-[26px] leading-tight text-fog">{title}</h2>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{intro}</p>
      </div>
      {children}
    </div>
  );
}
