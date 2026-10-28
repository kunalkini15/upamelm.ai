/**
 * Application shell: owns selection, basemap and layer-visibility state,
 * and composes the map with the exploration UI. Data flows exclusively
 * through the repository layer (`services/`).
 */
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LocationFindings, ResearchLocation } from '@/types';
import { locationRepository } from '@/services/locations';
import { defaultBasemap, listBasemaps, listLayers } from '@/services/mapLayers';
import Header from '@/components/Header';
import type { BasemapStatus, MapViewHandle } from '@/components/MapView';
import LayerPanel from '@/components/LayerPanel';
import ExploreCard from '@/components/ExploreCard';
import LocationPanel, { type SectionId } from '@/components/LocationPanel';
import { Icon } from '@/components/ui';

// MapLibre GL is the heaviest dependency; split it into its own chunk so the
// app shell paints before the mapping engine finishes loading.
const MapView = lazy(() => import('@/components/MapView'));

export default function App() {
  const [locations, setLocations] = useState<ResearchLocation[]>([]);
  const [findings, setFindings] = useState<Map<string, LocationFindings>>(new Map());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [section, setSection] = useState<SectionId>('overview');
  const [basemapId, setBasemapId] = useState<string>(() => defaultBasemap().id);
  const [markersVisible, setMarkersVisible] = useState(true);
  const [layersOpen, setLayersOpen] = useState(false);
  const [mapStatus, setMapStatus] = useState<BasemapStatus>({ state: 'loading' });
  const [retryKey, setRetryKey] = useState(0);
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  const mapHandle = useRef<MapViewHandle | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await locationRepository.listLocations();
        if (cancelled) return;
        setLocations(list);
        const entries = await Promise.all(
          list.map(async (l) => [l.id, await locationRepository.getFindings(l.id)] as const),
        );
        if (cancelled) return;
        setFindings(new Map(entries.filter(([, f]) => f !== undefined) as [string, LocationFindings][]));
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load locations.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const basemaps = useMemo(() => listBasemaps(), []);
  const layers = useMemo(() => listLayers(), []);
  const basemap = basemaps.find((b) => b.id === basemapId) ?? basemaps[0];
  const selected = selectedId ? locations.find((l) => l.id === selectedId) : undefined;
  const selectedFindings = selectedId ? findings.get(selectedId) : undefined;
  const forthcomingCount = layers.filter((l) => l.status === 'forthcoming').length;

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
    setSection('overview');
    setLayersOpen(false);
  }, []);

  const handleClose = useCallback(() => setSelectedId(null), []);
  const handleResetView = useCallback(() => mapHandle.current?.resetView(), []);
  const handleMapStatus = useCallback((status: BasemapStatus) => {
    if (status.state === 'loading') setNoticeDismissed(false);
    setMapStatus(status);
  }, []);
  const handleRetryBasemap = useCallback(() => {
    setMapStatus({ state: 'loading' });
    setRetryKey((k) => k + 1);
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-abyss text-fog">
      <Header
        basemaps={basemaps}
        activeBasemapId={basemap.id}
        onBasemapChange={setBasemapId}
        layersOpen={layersOpen}
        onToggleLayers={() => setLayersOpen((o) => !o)}
        onResetView={handleResetView}
        forthcomingCount={forthcomingCount}
      />

      <main className="relative min-h-0 flex-1">
        {loadError ? (
          <LoadError message={loadError} />
        ) : (
          <Suspense fallback={<MapLoading />}>
            <MapView
              locations={locations}
              selectedId={selectedId}
              basemap={basemap}
              markersVisible={markersVisible}
              retryKey={retryKey}
              onSelect={handleSelect}
              onStatus={handleMapStatus}
              onReady={(handle) => {
                mapHandle.current = handle;
              }}
            />
          </Suspense>
        )}

        {!loadError && <MapStatusOverlay status={mapStatus} dismissed={noticeDismissed} onDismiss={() => setNoticeDismissed(true)} onRetry={handleRetryBasemap} />}

        {layersOpen && !loadError && (
          <LayerPanel
            layers={layers}
            activeBasemapId={basemap.id}
            onBasemapChange={setBasemapId}
            markersVisible={markersVisible}
            onToggleMarkers={() => setMarkersVisible((v) => !v)}
            onClose={() => setLayersOpen(false)}
          />
        )}

        {!loadError && !selected && <ExploreCard locations={locations} onSelect={handleSelect} />}

        {!loadError && selected && selectedFindings && (
          <LocationPanel
            location={selected}
            findings={selectedFindings}
            section={section}
            onSectionChange={setSection}
            onClose={handleClose}
          />
        )}
      </main>
    </div>
  );
}

function MapLoading() {
  return (
    <div className="flex h-full items-center justify-center" role="status" aria-label="Loading map">
      <div className="text-center">
        <p className="font-display text-xl text-fog">Preparing the subcontinent…</p>
        <p className="mt-1 text-[12.5px] text-faint">Loading the mapping engine</p>
      </div>
    </div>
  );
}

/**
 * Non-blocking basemap status: a quiet loader while resolving, a dismissible
 * notice when a fallback source is in use, and a blocking retry card only
 * when every candidate failed.
 */
function MapStatusOverlay({
  status,
  dismissed,
  onDismiss,
  onRetry,
}: {
  status: BasemapStatus;
  dismissed: boolean;
  onDismiss: () => void;
  onRetry: () => void;
}) {
  if (status.state === 'loading') {
    return (
      <div className="pointer-events-none absolute inset-x-0 top-3 z-[5] flex justify-center">
        <p className="rounded-full border border-edge bg-panel/90 px-3.5 py-1.5 text-[12px] text-muted backdrop-blur">
          Loading basemap…
        </p>
      </div>
    );
  }
  if (status.state === 'ready' && status.usedFallback && !dismissed) {
    return (
      <div className="absolute inset-x-0 top-3 z-[5] flex justify-center px-3">
        <div className="flex items-center gap-2.5 rounded-full border border-ochre/40 bg-panel/95 py-1.5 pl-3.5 pr-1.5 text-[12px] text-muted shadow-xl backdrop-blur">
          <span>
            Primary basemap unreachable — showing <span className="text-fog">{status.label}</span>
          </span>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss notice"
            className="rounded-full p-1 text-faint transition-colors hover:text-fog"
          >
            <Icon name="x" className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  }
  if (status.state === 'failed') {
    return (
      <div className="absolute inset-0 z-[5] flex items-center justify-center bg-abyss/70 p-4 backdrop-blur-[1px]">
        <div className="w-full max-w-sm rounded-2xl border border-edge bg-panel p-6 text-center shadow-2xl">
          <p className="font-display text-xl text-fog">The map could not load</p>
          <p className="mt-2 text-[13px] leading-relaxed text-muted">
            Every basemap source failed — check your connection, VPN, or ad-blocker, then retry.
            Details are in the browser console.
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-4 rounded-full bg-ochre px-5 py-2 text-[13px] font-semibold text-abyss transition-colors hover:bg-[#e7b45a]"
          >
            Retry basemap
          </button>
        </div>
      </div>
    );
  }
  return null;
}

function LoadError({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-sm rounded-2xl border border-ember/40 bg-panel p-6 text-center">
        <p className="font-display text-xl text-fog">Could not load locations</p>
        <p className="mt-2 text-[13px] text-muted">{message}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 rounded-full bg-ochre px-4 py-2 text-[13px] font-semibold text-abyss"
        >
          Reload
        </button>
      </div>
    </div>
  );
}
