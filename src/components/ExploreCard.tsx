/**
 * Welcome / location-picker card shown while no location is selected.
 * Desktop: floating card, top-left. Mobile: compact bottom bar.
 */
import type { ResearchLocation } from '@/types';
import { Icon, Pill } from './ui';

interface ExploreCardProps {
  locations: ResearchLocation[];
  onSelect: (id: string) => void;
}

export default function ExploreCard({ locations, onSelect }: ExploreCardProps) {
  const featured = locations.find((l) => l.featured) ?? locations[0];
  if (!featured) return null;

  return (
    <>
      {/* Desktop card */}
      <div className="absolute left-4 top-4 z-10 hidden w-[340px] rounded-2xl border border-edge bg-panel/95 p-5 shadow-2xl backdrop-blur md:block">
        <Pill tone="ochre">
          <span className="h-1.5 w-1.5 rounded-full bg-ochre" aria-hidden="true" />
          First research location
        </Pill>
        <h1 className="mt-3 font-display text-[28px] font-semibold leading-[1.1] tracking-tight text-fog">
          What lies beneath India?
        </h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
          Decades of groundwater and geological research, made explorable. Begin with{' '}
          {featured.name} — scientific findings arrive in Phase 2.
        </p>
        <button
          type="button"
          onClick={() => onSelect(featured.id)}
          className="group mt-4 flex w-full items-center justify-between rounded-xl bg-ochre px-4 py-3 text-left text-[14px] font-semibold text-abyss transition-colors hover:bg-[#e7b45a]"
        >
          <span>
            Explore {featured.name}
            <span className="block text-[11.5px] font-medium opacity-70">
              {featured.admin.state} · {formatCoords(featured)}
            </span>
          </span>
          <Icon
            name="arrowRight"
            className="h-5 w-5 transition-transform group-hover:translate-x-0.5"
          />
        </button>
        <p className="mt-3 text-[11.5px] text-faint">
          {locations.length} location in Phase 1 · hundreds planned
        </p>
      </div>

      {/* Mobile bar */}
      <div className="absolute inset-x-3 bottom-3 z-10 md:hidden">
        <button
          type="button"
          onClick={() => onSelect(featured.id)}
          className="flex w-full items-center justify-between gap-3 rounded-2xl border border-ochre/40 bg-panel/95 px-4 py-3.5 text-left shadow-2xl backdrop-blur"
        >
          <span>
            <span className="block font-display text-[16px] font-semibold text-fog">
              Explore {featured.name}
            </span>
            <span className="block text-[11.5px] text-muted">
              {featured.admin.state} · first research location
            </span>
          </span>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ochre text-abyss">
            <Icon name="arrowRight" className="h-4.5 w-4.5" />
          </span>
        </button>
      </div>
    </>
  );
}

function formatCoords(location: ResearchLocation): string {
  const [lng, lat] = location.centroid.coordinates;
  return `${lat.toFixed(2)}° N, ${lng.toFixed(2)}° E`;
}
