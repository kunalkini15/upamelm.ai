import React, { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { ArrowRight, Box, MapPin } from 'lucide-react';
import { CitySummary } from '../../api/backend';

if (typeof window !== 'undefined' && (maplibregl as any).setWorkerUrl) {
  (maplibregl as any).setWorkerUrl('/maplibre-gl-worker.mjs');
}

interface CityOverviewProps {
  cities: CitySummary[];
  loading?: boolean;
  error?: string | null;
  onSelectCity: (cityId: string) => void;
  onRetry: () => void;
  onDismissError: () => void;
}

export function CityOverview({ cities, loading, error, onSelectCity, onRetry, onDismissError }: CityOverviewProps) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container.current) return;
    const map = new maplibregl.Map({
      container: container.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [{
          id: 'city-overview-basemap',
          type: 'raster',
          source: 'osm',
          paint: {
            'raster-brightness-max': 0.32,
            'raster-contrast': 0.48,
            'raster-saturation': -0.95,
          },
        }],
      },
      center: [82.5, 22],
      zoom: 3.4,
      pitch: 0,
      bearing: 0,
      minZoom: 2.8,
      maxZoom: 12,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    const markers: maplibregl.Marker[] = [];
    for (const city of cities) {
      if (!city.geometry) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'city-beacon';
      button.setAttribute('aria-label', `Open ${city.label}, ${city.studyCount} studies available`);
      const dot = document.createElement('span');
      dot.className = 'city-beacon__dot';
      const card = document.createElement('span');
      card.className = 'city-beacon__card';
      const label = document.createElement('strong');
      label.textContent = city.label;
      const count = document.createElement('small');
      count.textContent = `${city.studyCount} ${city.studyCount === 1 ? 'study' : 'studies'} available`;
      card.append(label, count);
      button.append(dot, card);
      button.addEventListener('click', () => onSelectCity(city.id));
      markers.push(new maplibregl.Marker({ element: button, anchor: 'center' }).setLngLat(city.geometry.coordinates).addTo(map));
    }
    map.once('load', () => map.fitBounds([[67, 6], [98, 38]], { padding: 48, duration: 0 }));
    return () => {
      markers.forEach((marker) => marker.remove());
      map.remove();
    };
  }, [cities, onSelectCity]);

  const locatedCities = cities.filter((city) => city.geometry);

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-ink-950 text-text">
      <div ref={container} className="absolute inset-0" />
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(circle_at_60%_45%,transparent_0%,rgba(7,9,11,0.08)_48%,rgba(7,9,11,0.72)_100%)]" />
      <header className="absolute inset-x-0 top-0 z-20 h-16 border-b border-line bg-ink-950/88 px-6 flex items-center justify-between backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center shadow-soft"><Box className="w-4 h-4 text-ink-950" /></div>
          <div><h1 className="text-sm font-bold">Upamelm.ai</h1><p className="text-[10px] font-mono text-muted">Maps to What's Underneath</p></div>
        </div>
        <div className="flex items-center gap-4 text-[11px] font-mono text-muted"><a href="/about" className="transition hover:text-accent">Our story</a><span>{cities.length} {cities.length === 1 ? 'city' : 'cities'} · {cities.reduce((sum, city) => sum + city.studyCount, 0)} studies</span></div>
      </header>
      <section className="absolute left-6 top-24 z-20 w-[23rem] max-w-[calc(100vw-3rem)] rounded-2xl border border-line bg-ink-950/92 p-6 shadow-float backdrop-blur-md">
        <div className="text-[10px] uppercase tracking-[0.28em] text-accent font-mono">Study atlas</div>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight">Choose a city to explore its scientific evidence</h2>
        <p className="mt-3 text-sm leading-relaxed text-muted">Each location opens with its default study. You can then move between every available report and language without leaving the city workspace.</p>
        <div className="mt-5 space-y-2">
          {cities.map((city) => (
            <button key={city.id} disabled={loading} onClick={() => onSelectCity(city.id)} className="group w-full flex items-center justify-between rounded-xl border border-line bg-ink-900/80 p-3 text-left transition hover:border-accent/40 hover:bg-ink-850 disabled:cursor-not-allowed disabled:opacity-45">
              <span className="flex items-center gap-3"><span className="grid place-items-center w-9 h-9 rounded-lg bg-accent/10 text-accent"><MapPin className="w-4 h-4" /></span><span><strong className="block text-sm">{city.label}</strong><small className="text-[11px] text-muted">{city.studyCount} {city.studyCount === 1 ? 'study' : 'studies'} available{city.geometry ? '' : ' · map location unavailable'}</small></span></span>
              <ArrowRight className="w-4 h-4 text-muted transition group-hover:translate-x-0.5 group-hover:text-accent" />
            </button>
          ))}
          {!locatedCities.length && <p className="rounded-lg border border-line p-3 text-xs text-muted">No city in this catalog has validated map geometry yet.</p>}
        </div>
      </section>
      {loading && <div className="absolute inset-0 z-40 grid place-items-center bg-ink-950/35 backdrop-blur-[2px]"><div className="flex items-center gap-3 rounded-full border border-accent/30 bg-ink-950 px-5 py-3 text-xs font-mono text-accent"><span className="w-4 h-4 rounded-full border-2 border-accent border-t-transparent animate-spin" />Opening city workspace…</div></div>}
      {error && !loading && <div className="absolute bottom-6 left-1/2 z-40 w-[32rem] max-w-[calc(100vw-3rem)] -translate-x-1/2 rounded-xl border border-danger/40 bg-ink-950/95 p-4 shadow-float"><div className="text-xs font-semibold text-danger">Unable to open the selected city</div><p className="mt-1 text-[11px] text-muted">{error}</p><div className="mt-3 flex gap-2"><button onClick={onRetry} className="rounded-lg bg-accent px-3 py-1.5 text-[11px] font-semibold text-ink-950">Retry</button><button onClick={onDismissError} className="rounded-lg border border-line px-3 py-1.5 text-[11px] text-muted">Dismiss</button></div></div>}
    </main>
  );
}
