/**
 * Map shell: renders the basemap, location markers and map chrome from the
 * layer registry. Knows nothing about scientific overlays beyond what the
 * registry declares — new layers plug in as data.
 *
 * Basemap styles resolve through `services/basemapStyles`: each candidate is
 * probed and must render before it is accepted, so a blocked tile CDN falls
 * through to the next source instead of leaving a black map.
 */
import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import type { BasemapPreset, ResearchLocation } from '@/types';
import { INDIA_VIEW } from '@/data/mapLayers';
import { listBasemaps } from '@/services/mapLayers';
import {
  EMPTY_STYLE,
  buildCandidates,
  fetchStyle,
  waitForSettled,
  type BasemapStatus,
} from '@/services/basemapStyles';

export type { BasemapStatus };

export interface MapViewHandle {
  flyToLocation: (location: ResearchLocation) => void;
  resetView: () => void;
}

interface MapViewProps {
  locations: ResearchLocation[];
  selectedId: string | null;
  basemap: BasemapPreset;
  markersVisible: boolean;
  /** Increment to retry style resolution after a failure. */
  retryKey: number;
  onSelect: (id: string) => void;
  onStatus: (status: BasemapStatus) => void;
  onReady?: (handle: MapViewHandle) => void;
}

export default function MapView({
  locations,
  selectedId,
  basemap,
  markersVisible,
  retryKey,
  onSelect,
  onStatus,
  onReady,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  const sessionRef = useRef(0);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const basemapRef = useRef(basemap);
  basemapRef.current = basemap;
  const retryKeyRef = useRef(retryKey);
  retryKeyRef.current = retryKey;

  // Initialise the map once with a blank style; the resolver effect below
  // applies the first working basemap candidate.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: EMPTY_STYLE,
      center: INDIA_VIEW.center,
      zoom: INDIA_VIEW.zoom,
      attributionControl: { compact: true },
      // India-first view; keep the world explorable for context.
      minZoom: 2.5,
      maxZoom: 14,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: false }), 'bottom-left');
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 110, unit: 'metric' }), 'bottom-left');
    map.on('error', (e) => {
      // Permanent diagnostic tap: tile/style failures stay visible in the console.
      console.warn('[subsurface-map]', e.error?.message ?? e.error ?? 'map error');
    });
    mapRef.current = map;

    onReadyRef.current?.({
      flyToLocation: (location) => {
        map.flyTo({ center: location.centroid.coordinates, zoom: 9, duration: 1800, essential: true });
      },
      resetView: () => {
        map.easeTo({ center: INDIA_VIEW.center, zoom: INDIA_VIEW.zoom, duration: 1200 });
      },
    });

    return () => {
      sessionRef.current += 1; // invalidate in-flight resolutions
      map.remove();
      mapRef.current = null;
      markersRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-resolve whenever the selected basemap or retry key changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    void resolveBasemap(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap, retryKey]);

  async function resolveBasemap(map: maplibregl.Map) {
    const session = ++sessionRef.current;
    const wanted = basemapRef.current;
    const attempt = retryKeyRef.current;
    const isStale = () =>
      session !== sessionRef.current ||
      basemapRef.current.id !== wanted.id ||
      retryKeyRef.current !== attempt;
    onStatusRef.current({ state: 'loading' });
    const candidates = buildCandidates(wanted, listBasemaps());
    for (let i = 0; i < candidates.length; i++) {
      if (isStale()) return;
      const candidate = candidates[i];
      try {
        const style = await fetchStyle(candidate);
        if (isStale()) return;
        map.setStyle(style);
        await waitForSettled(map);
        if (isStale()) return;
        onStatusRef.current({
          state: 'ready',
          usedFallback: i > 0,
          label: candidate.label,
        });
        return;
      } catch (err) {
        console.warn(
          `[subsurface-map] basemap candidate failed (${candidate.label}):`,
          err instanceof Error ? err.message : err,
        );
      }
    }
    if (!isStale()) onStatusRef.current({ state: 'failed' });
  }

  // Sync markers with locations / selection / visibility.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove markers for locations that no longer exist.
    for (const [id, marker] of markersRef.current) {
      if (!locations.some((l) => l.id === id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }

    for (const location of locations) {
      let marker = markersRef.current.get(location.id);
      if (!marker) {
        const el = document.createElement('button');
        el.type = 'button';
        el.setAttribute('aria-label', `Explore ${location.name}`);
        el.className = `site-marker${location.featured ? ' pulse' : ''}`;
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          onSelectRef.current(location.id);
        });
        marker = new maplibregl.Marker({ element: el })
          .setLngLat(location.centroid.coordinates)
          .setPopup(
            new maplibregl.Popup({ offset: 22, closeButton: false }).setHTML(
              `<strong style="font-size:13px">${escapeHtml(location.name)}</strong><br/>` +
                `<span style="color:#a3aba7;font-size:11px">${escapeHtml(adminLine(location))} · Select to explore</span>`,
            ),
          );
        markersRef.current.set(location.id, marker);
      }
      const el = marker.getElement();
      el.classList.toggle('selected', location.id === selectedId);
      if (markersVisible) {
        marker.addTo(map);
      } else {
        marker.remove();
      }
    }
  }, [locations, selectedId, markersVisible]);

  // Fly to a location when selection changes via the side UI.
  const lastFlownRef = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId || lastFlownRef.current === selectedId) return;
    const location = locations.find((l) => l.id === selectedId);
    if (!location) return;
    lastFlownRef.current = selectedId;
    map.flyTo({ center: location.centroid.coordinates, zoom: 9, duration: 1800, essential: true });
  }, [selectedId, locations]);

  return <div ref={containerRef} className="h-full w-full" role="application" aria-label="Interactive map of India" />;
}

function adminLine(location: ResearchLocation): string {
  return [location.admin.district, location.admin.state, location.admin.country]
    .filter(Boolean)
    .join(', ');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
