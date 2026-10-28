/**
 * Layer catalogue popover: renders the layer registry grouped by purpose.
 * Forthcoming overlays are shown locked — advertised, never rendered.
 */
import type { BasemapPreset, MapLayerDefinition } from '@/types';
import { domainById } from '@/data/domains';
import { Icon, Pill } from './ui';

interface LayerPanelProps {
  layers: MapLayerDefinition[];
  activeBasemapId: string;
  onBasemapChange: (id: string) => void;
  markersVisible: boolean;
  onToggleMarkers: () => void;
  onClose: () => void;
}

const GROUP_LABELS: Record<string, string> = {
  basemap: 'Basemap',
  locations: 'Locations',
  groundwater: 'Groundwater overlays',
  geology: 'Geology overlays',
  environment: 'Environment overlays',
};

export default function LayerPanel({
  layers,
  activeBasemapId,
  onBasemapChange,
  markersVisible,
  onToggleMarkers,
  onClose,
}: LayerPanelProps) {
  const groups = groupLayers(layers);
  return (
    <div className="absolute right-3 top-3 z-30 w-[300px] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl border border-edge bg-panel/97 shadow-2xl backdrop-blur sm:right-4 sm:top-4">
      <div className="flex items-center justify-between border-b border-edge px-4 py-3">
        <p className="font-display text-[15px] font-semibold text-fog">Map layers</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close layers"
          className="rounded-full p-1.5 text-muted transition-colors hover:bg-panel-soft hover:text-fog"
        >
          <Icon name="x" className="h-4 w-4" />
        </button>
      </div>
      <div className="slim-scroll max-h-[60vh] space-y-4 overflow-y-auto px-4 py-3.5">
        {groups.map(([group, items]) => (
          <div key={group}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-faint">
              {GROUP_LABELS[group] ?? group}
            </p>
            <ul className="mt-2 space-y-1.5">
              {items.map((layer) =>
                layer.kind === 'basemap' ? (
                  <BasemapRow
                    key={layer.id}
                    layer={layer as BasemapPreset}
                    active={layer.id === activeBasemapId}
                    onSelect={() => onBasemapChange(layer.id)}
                  />
                ) : layer.id === 'locations' ? (
                  <ToggleRow
                    key={layer.id}
                    label={layer.label}
                    hint={layer.description}
                    on={markersVisible}
                    onToggle={onToggleMarkers}
                  />
                ) : (
                  <ForthcomingRow key={layer.id} layer={layer} />
                ),
              )}
            </ul>
          </div>
        ))}
        <p className="border-t border-edge pt-3 text-[11.5px] leading-relaxed text-faint">
          Scientific overlays unlock as reports are processed and validated. No layer renders
          without supporting evidence.
        </p>
      </div>
    </div>
  );
}

function groupLayers(layers: MapLayerDefinition[]): [string, MapLayerDefinition[]][] {
  const order = ['basemap', 'locations', 'groundwater', 'geology', 'environment'];
  const map = new Map<string, MapLayerDefinition[]>();
  for (const layer of layers) {
    const list = map.get(layer.group) ?? [];
    list.push(layer);
    map.set(layer.group, list);
  }
  return order.filter((g) => map.has(g)).map((g) => [g, map.get(g)!]);
}

function BasemapRow({
  layer,
  active,
  onSelect,
}: {
  layer: BasemapPreset;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={active}
        className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left transition-colors ${
          active ? 'border-ochre/50 bg-ochre/10' : 'border-edge bg-panel-soft/50 hover:border-faint'
        }`}
      >
        <span>
          <span className={`block text-[13px] font-medium ${active ? 'text-ochre' : 'text-fog'}`}>
            {layer.label}
          </span>
          <span className="block text-[11.5px] text-faint">{layer.description}</span>
        </span>
        <span
          className={`h-2.5 w-2.5 shrink-0 rounded-full ${active ? 'bg-ochre' : 'bg-edge'}`}
          aria-hidden="true"
        />
      </button>
    </li>
  );
}

function ToggleRow({
  label,
  hint,
  on,
  onToggle,
}: {
  label: string;
  hint: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={on}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-edge bg-panel-soft/50 px-3 py-2 text-left transition-colors hover:border-faint"
      >
        <span>
          <span className="block text-[13px] font-medium text-fog">{label}</span>
          <span className="block text-[11.5px] text-faint">{hint}</span>
        </span>
        <span className={on ? 'text-spring' : 'text-faint'}>
          <Icon name={on ? 'eye' : 'eyeOff'} className="h-4.5 w-4.5" />
        </span>
      </button>
    </li>
  );
}

function ForthcomingRow({ layer }: { layer: MapLayerDefinition }) {
  const domain = layer.domainId ? domainById(layer.domainId) : undefined;
  return (
    <li className="flex items-start justify-between gap-2 rounded-xl border border-dashed border-edge bg-transparent px-3 py-2 opacity-80">
      <span>
        <span className="block text-[13px] font-medium text-muted">{layer.label}</span>
        <span className="block text-[11.5px] text-faint">{layer.description}</span>
        {domain ? (
          <span
            className="mt-1 inline-block text-[11px] font-medium"
            style={{ color: domain.accent }}
          >
            {domain.label} · Phase {domain.phase}
          </span>
        ) : null}
      </span>
      <span className="mt-0.5 shrink-0">
        <Pill tone="neutral">
          <Icon name="clock" className="h-3 w-3" />
          Soon
        </Pill>
      </span>
    </li>
  );
}
