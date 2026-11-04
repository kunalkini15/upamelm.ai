/**
 * @file CorridorBrowser.tsx
 * @module ui-v2/components/evidence/CorridorBrowser
 * @description Transit and infrastructure alignment corridor inspector.
 * Calculates geodesic chainage (haversine distances in km), cumulative vertex lengths,
 * and elevation/depth metrics along linear features (e.g. BMRCL Metro Line strings).
 */

import React, { useMemo, useState } from 'react';
import { RawFeature, ScientificUIModel } from '../../types/scientific';

type Position = [number, number];

function lines(feature: RawFeature): Position[][] {
  const geometry = feature.geometry;
  if (!geometry || !/LineString$/.test(geometry.type)) return [];
  const coordinates = geometry.coordinates as unknown;
  return geometry.type === 'LineString'
    ? [coordinates as Position[]]
    : coordinates as Position[][];
}

function distanceKm(a: Position, b: Position) {
  const radians = Math.PI / 180;
  const lat1 = a[1] * radians;
  const lat2 = b[1] * radians;
  const dLat = (b[1] - a[1]) * radians;
  const dLon = (b[0] - a[0]) * radians;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function metrics(feature: RawFeature) {
  const paths = lines(feature);
  const chainages: number[] = [];
  let length = 0;
  paths.forEach((path) => path.forEach((position, index) => {
    if (index) length += distanceKm(path[index - 1], position);
    chainages.push(length);
  }));
  return { paths, chainages, length, vertices: chainages.length };
}

export function CorridorBrowser({ model, onSelectFeature }: { model: ScientificUIModel; onSelectFeature?: (id: string) => void }) {
  const corridors = useMemo(() => model.spatialFeatures.filter((feature) => /LineString$/.test(feature.geometry?.type || '')), [model.spatialFeatures]);
  const [activeId, setActiveId] = useState(corridors[0]?.id || '');
  const active = corridors.find((feature) => feature.id === activeId) || corridors[0];
  if (!active) return <div className="min-h-64 grid place-items-center text-sm text-slate-500">No grounded line or corridor geometry was supplied.</div>;
  const current = metrics(active);
  const max = Math.max(current.length, 0.001);
  const markers = current.chainages.filter((_, index) => index === 0 || index === current.chainages.length - 1 || index % Math.max(1, Math.floor(current.chainages.length / 8)) === 0);
  return <div className="max-w-7xl mx-auto grid lg:grid-cols-[20rem_minmax(0,1fr)] gap-4">
    <aside className="space-y-2">{corridors.map((corridor) => { const value = metrics(corridor); return <button key={corridor.id} onClick={() => setActiveId(corridor.id)} className={`w-full rounded-xl border p-3 text-left ${corridor.id === active.id ? 'border-cyan-400 bg-cyan-500/10' : 'border-slate-800 bg-slate-900/40'}`}><div className="text-sm font-semibold">{corridor.name}</div><div className="mt-1 text-[10px] font-mono text-slate-500">{value.length.toFixed(1)} km · {value.vertices} vertices · {corridor.geometry?.fidelity || corridor.locationFidelity || 'fidelity unspecified'}</div></button>; })}</aside>
    <section className="rounded-xl border border-slate-800 bg-slate-900/45 p-5">
      <div className="flex items-start justify-between gap-3"><div><div className="text-[10px] uppercase tracking-widest text-cyan-400 font-mono">Grounded corridor geometry</div><h3 className="mt-1 text-xl font-semibold">{active.name}</h3><p className="mt-2 text-xs text-slate-400">{active.narrative?.summary || active.location_description || 'Chainage is calculated from the supplied line vertices; no route geometry has been inferred.'}</p></div><button onClick={() => onSelectFeature?.(active.id)} className="rounded-lg border border-cyan-500/30 px-3 py-2 text-xs text-cyan-300">Show on map</button></div>
      <div className="mt-7 rounded-xl border border-slate-800 bg-slate-950 p-6">
        <div className="relative h-24"><div className="absolute left-0 right-0 top-10 h-1 rounded-full bg-gradient-to-r from-cyan-500 via-violet-400 to-amber-400"/>{markers.map((chainage, index) => <div key={`${chainage}:${index}`} className="absolute top-7 -translate-x-1/2" style={{ left: `${chainage / max * 100}%` }}><i className="block h-7 w-px bg-slate-300"/><span className="absolute top-8 -translate-x-1/2 whitespace-nowrap text-[10px] font-mono text-slate-400">{chainage.toFixed(chainage < 10 ? 1 : 0)} km</span></div>)}</div>
        <div className="grid grid-cols-3 gap-2"><Metric label="Length" value={`${current.length.toFixed(2)} km`}/><Metric label="Vertices" value={String(current.vertices)}/><Metric label="Evidence refs" value={String(active.source_refs?.length || 0)}/></div>
      </div>
      <div className="mt-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-100">Distances are geodesic calculations over source-supplied coordinates. They are analytical UI derivatives, not source-stated survey chainage.</div>
    </section>
  </div>;
}

const Metric = ({ label, value }: { label: string; value: string }) => <div className="rounded-lg border border-slate-800 bg-slate-900 p-3"><div className="text-[10px] uppercase text-slate-500">{label}</div><div className="mt-1 text-lg font-semibold text-cyan-200">{value}</div></div>;
