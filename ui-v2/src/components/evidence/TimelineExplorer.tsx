import React, { useMemo, useState } from 'react';
import { MapPinned, ShieldCheck } from 'lucide-react';
import { ScientificUIModel } from '../../types/scientific';

export function TimelineExplorer({ model, onSelectFeature }: { model: ScientificUIModel; onSelectFeature?: (id: string) => void }) {
  const groups = useMemo(() => {
    const index = new Map<string, typeof model.timelineEvents>();
    model.timelineEvents.forEach((event) => { const id = event.timelineId || 'timeline'; const events = index.get(id) || []; events.push(event); index.set(id, events); });
    return Array.from(index.entries());
  }, [model.timelineEvents]);
  const [activeId, setActiveId] = useState(groups[0]?.[0] || '');
  const active = groups.find(([id]) => id === activeId) || groups[0];
  if (!active) return null;
  const events = [...active[1]].sort((a, b) => String(a.date || a.period || '').localeCompare(String(b.date || b.period || '')));
  const meta = events[0];
  return <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
    <aside className="space-y-2">{groups.map(([id, items]) => <button key={id} onClick={() => setActiveId(id)} className={`w-full rounded-xl border p-3 text-left ${id === active[0] ? 'border-cyan-400 bg-cyan-500/10' : 'border-slate-800 bg-slate-900/45'}`}><div className="text-xs font-semibold leading-relaxed">{items[0]?.timelineTitle || id}</div><div className="mt-2 text-[10px] font-mono text-slate-500">{items.length} events{items[0]?.timelineUnit ? ` · ${items[0].timelineUnit}` : ''}</div></button>)}</aside>
    <section><header className="mb-5 rounded-xl border border-slate-800 bg-slate-900/45 p-4"><h2 className="text-lg font-semibold">{meta.timelineTitle || active[0]}</h2>{meta.timelineDescription && <p className="mt-2 text-sm leading-6 text-slate-400">{meta.timelineDescription}</p>}</header><div className="ml-3 space-y-1 border-l border-cyan-500/30">{events.map((event) => <article key={event.id} className="relative py-3 pl-7"><i className="absolute -left-1.5 top-6 h-3 w-3 rounded-full bg-cyan-400 ring-4 ring-slate-950"/><div className="rounded-xl border border-slate-800 bg-slate-900/45 p-4"><div className="flex items-start justify-between gap-3"><div><div className="text-[10px] font-mono uppercase tracking-widest text-cyan-400">{event.date || event.period || 'Undated'} · {event.kind || event.status || 'event'}</div><h3 className="mt-1 font-semibold">{event.title}</h3></div>{event.featureIds[0] && <button onClick={() => onSelectFeature?.(event.featureIds[0])} className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/30 px-2 py-1 text-xs text-cyan-300"><MapPinned className="h-3 w-3"/>Locate</button>}</div>{event.description && <p className="mt-2 text-xs leading-relaxed text-slate-400">{event.description}</p>}<div className="mt-3 inline-flex items-center gap-1 text-[9px] text-emerald-400"><ShieldCheck className="h-3 w-3"/>{event.evidenceRefs.length} evidence refs</div></div></article>)}</div></section>
  </div>;
}
