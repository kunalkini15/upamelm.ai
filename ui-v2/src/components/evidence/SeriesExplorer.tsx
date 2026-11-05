import React, { useMemo, useState } from 'react';
import { BarChart3, MapPinned, Search, ShieldCheck } from 'lucide-react';
import { ScientificUIModel } from '../../types/scientific';
import { chooseQuantitativeRenderer } from '../../core/RendererRegistry';
import { GenericChart } from './GenericChart';

export function SeriesExplorer({ model, onSelectFeature }: { model: ScientificUIModel; onSelectFeature?: (id: string) => void }) {
  const series = model.quantitativeSeries;
  const [activeId, setActiveId] = useState(series[0]?.id || '');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('*');
  const kinds = useMemo(() => Array.from(new Set(series.map((item) => chooseQuantitativeRenderer(item)))), [series]);
  const filtered = useMemo(() => series.filter((item) => {
    const renderer = chooseQuantitativeRenderer(item);
    return (kind === '*' || renderer === kind) && (!query || `${item.title} ${item.description || ''} ${item.status || ''}`.toLowerCase().includes(query.toLowerCase()));
  }), [series, kind, query]);
  const active = series.find((item) => item.id === activeId) || filtered[0] || series[0];
  if (!active) return null;
  const featureIds = Array.from(new Set(active.points.map((point) => point.featureId).filter(Boolean))) as string[];
  const statusTone = /derived/i.test(active.status || '') ? 'border-violet-500/30 bg-violet-500/10 text-violet-200' : /proposed|forecast/i.test(active.status || '') ? 'border-amber/30 bg-amber/10 text-amber' : 'border-success/30 bg-success/10 text-success';
  return <div className="mx-auto grid max-w-[96rem] gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
    <aside className="space-y-3 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto lg:pr-1">
      <div className="sticky top-0 z-10 space-y-2 bg-ink-950 pb-2">
        <label className="flex items-center gap-2 rounded-lg border border-line bg-ink-900 px-3"><Search className="h-4 w-4 text-muted"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${series.length} charts`} className="w-full bg-transparent py-2 text-xs outline-none"/></label>
        <select value={kind} onChange={(event) => setKind(event.target.value)} className="w-full rounded-lg border border-line bg-ink-900 px-3 py-2 text-xs text-text"><option value="*">All chart types</option>{kinds.map((item) => <option key={item} value={item}>{item.replace(/-/g, ' ')}</option>)}</select>
      </div>
      {filtered.map((item) => <button key={item.id} onClick={() => setActiveId(item.id)} className={`w-full rounded-xl border p-3 text-left transition ${item.id === active.id ? 'border-accent bg-accent/10' : 'border-line bg-ink-900/45 hover:border-line'}`}><div className="line-clamp-2 text-xs font-semibold leading-relaxed">{item.title}</div><div className="mt-2 flex items-center justify-between text-[9px] font-mono uppercase text-muted"><span>{chooseQuantitativeRenderer(item).replace(/-/g, ' ')}</span><span>{item.points.length} points</span></div></button>)}
    </aside>
    <section className="min-w-0 rounded-xl border border-line bg-ink-900/45 p-5">
      <header className="flex flex-wrap items-start justify-between gap-4"><div className="max-w-4xl"><div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest text-accent"><BarChart3 className="h-4 w-4"/>{chooseQuantitativeRenderer(active).replace(/-/g, ' ')}</div><h2 className="mt-2 text-xl font-semibold leading-snug">{active.title}</h2>{active.description && <p className="mt-2 text-sm leading-6 text-muted">{active.description}</p>}</div>{active.status && <span className={`rounded-full border px-2.5 py-1 text-[10px] font-mono uppercase ${statusTone}`}>{active.status.replace(/_/g, ' ')}</span>}</header>
      <div className="mt-5 h-[min(52vh,34rem)] min-h-80 rounded-xl border border-line bg-ink-950/55 p-3"><GenericChart series={active} onSelectFeature={onSelectFeature}/></div>
      <footer className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[10px] font-mono text-muted"><span>{active.xLabel || 'X axis'}{active.xUnit ? ` · ${active.xUnit}` : ''}</span><span>{active.yLabel || 'Value'}{active.unit ? ` · ${active.unit}` : ''}</span><span className="inline-flex items-center gap-1"><ShieldCheck className="h-3 w-3 text-success"/>{active.evidenceRefs.length} evidence refs</span>{active.threshold != null && <span className="text-amber">Threshold: {active.threshold}{active.unit ? ` ${active.unit}` : ''}</span>}</footer>
      {featureIds.length > 0 && <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">{featureIds.slice(0, 12).map((id) => <button key={id} onClick={() => onSelectFeature?.(id)} className="inline-flex items-center gap-1 rounded-full border border-accent/30 px-2.5 py-1 text-[10px] text-accent"><MapPinned className="h-3 w-3"/>Locate {id}</button>)}</div>}
    </section>
  </div>;
}
