/**
 * Application header: brand, basemap switch, layer catalogue, view reset.
 */
import type { BasemapPreset, MapLayerDefinition } from '@/types';
import { Icon } from './ui';

interface HeaderProps {
  basemaps: BasemapPreset[];
  activeBasemapId: string;
  onBasemapChange: (id: string) => void;
  layersOpen: boolean;
  onToggleLayers: () => void;
  onResetView: () => void;
  forthcomingCount: number;
}

export default function Header({
  basemaps,
  activeBasemapId,
  onBasemapChange,
  layersOpen,
  onToggleLayers,
  onResetView,
  forthcomingCount,
}: HeaderProps) {
  return (
    <header className="relative z-20 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-edge bg-abyss/95 px-3 backdrop-blur sm:px-5">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-ochre/40 bg-ochre/10 text-ochre">
          <Icon name="strata" className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0 leading-tight">
          <p className="truncate font-display text-[17px] font-semibold tracking-tight text-fog">
            Subsurface India
          </p>
          <p className="hidden truncate text-[11px] text-faint sm:block">
            Explore the science beneath the surface
          </p>
        </div>
        <span className="ml-1 hidden shrink-0 rounded-full border border-edge bg-panel-soft px-2 py-0.5 text-[10.5px] font-medium text-muted md:inline-block">
          Phase 1 · Foundation
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        <div
          className="hidden items-center rounded-full border border-edge bg-panel p-0.5 sm:flex"
          role="group"
          aria-label="Basemap style"
        >
          {basemaps.map((b) => (
            <BasemapButton
              key={b.id}
              basemap={b}
              active={b.id === activeBasemapId}
              onClick={() => onBasemapChange(b.id)}
            />
          ))}
        </div>
        <HeaderButton
          label="Layers"
          icon="layers"
          active={layersOpen}
          onClick={onToggleLayers}
          badge={forthcomingCount > 0 ? String(forthcomingCount) : undefined}
        />
        <HeaderButton label="Reset view" icon="compass" onClick={onResetView} hideLabelOnMobile />
      </div>
    </header>
  );
}

function BasemapButton({
  basemap,
  active,
  onClick,
}: {
  basemap: BasemapPreset;
  active: boolean;
  onClick: () => void;
}) {
  const short = basemap.id === 'basemap-dark' ? 'Dark' : 'Light';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${
        active ? 'bg-ochre/15 text-ochre' : 'text-muted hover:text-fog'
      }`}
    >
      {short}
    </button>
  );
}

function HeaderButton({
  label,
  icon,
  onClick,
  active = false,
  badge,
  hideLabelOnMobile = false,
}: {
  label: string;
  icon: string;
  onClick: () => void;
  active?: boolean;
  badge?: string;
  hideLabelOnMobile?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={`relative flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[12.5px] font-medium transition-colors sm:px-3 ${
        active
          ? 'border-ochre/50 bg-ochre/10 text-ochre'
          : 'border-edge bg-panel text-muted hover:border-faint hover:text-fog'
      }`}
    >
      <Icon name={icon} className="h-4 w-4" />
      <span className={hideLabelOnMobile ? 'hidden sm:inline' : ''}>{label}</span>
      {badge ? (
        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-ochre px-1 text-[10px] font-bold text-abyss">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

export type { MapLayerDefinition };
