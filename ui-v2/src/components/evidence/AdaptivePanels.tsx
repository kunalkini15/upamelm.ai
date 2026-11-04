import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, ExternalLink, Search } from 'lucide-react';
import { GenericExtension, NativeAsset, PreservedDataset, ScientificUIModel } from '../../types/scientific';
import { GenericChart } from './GenericChart';
import { extensionFallbackPolicy } from '../../core/RendererRegistry';

function safeAssetUrl(path: string | undefined, baseUrl: string | undefined): string | null {
  if (!path) return null;
  if (/^data:image\//.test(path) || /^blob:/.test(path)) return path;
  if (/^https?:\/\//.test(path)) return path;
  if (path.startsWith('/') && !path.startsWith('/Users/') && !path.startsWith('/home/')) return path;
  if (!baseUrl || path.startsWith('/Users/') || path.startsWith('/home/') || /^[A-Za-z]:\\/.test(path)) return null;
  try { return new URL(path.replace(/^\.\//, ''), baseUrl).href; } catch { return null; }
}

function extractRows(payload: unknown): Array<Record<string, unknown> | Array<unknown>> {
  if (Array.isArray(payload)) return payload as Array<Record<string, unknown> | Array<unknown>>;
  if (!payload || typeof payload !== 'object') return [];
  const record = payload as Record<string, unknown>;
  for (const key of ['rows', 'data', 'records', 'items', 'values']) if (Array.isArray(record[key])) return record[key] as Array<Record<string, unknown> | Array<unknown>>;
  return [];
}

function parseCsv(payload: string): Array<Record<string, unknown>> {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < payload.length; index += 1) {
    const character = payload[index];
    if (character === '"') {
      if (quoted && payload[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      record.push(field); field = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && payload[index + 1] === '\n') index += 1;
      record.push(field); field = '';
      if (record.some((value) => value.length > 0)) records.push(record);
      record = [];
    } else field += character;
  }
  if (field.length || record.length) { record.push(field); records.push(record); }
  const headers = records.shift()?.map((value, index) => value.trim() || `column_${index + 1}`) || [];
  return records.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

export function ResourceBrowser({ model, onSelectFeature }: { model: ScientificUIModel; onSelectFeature?: (id: string) => void }) {
  const [activeId, setActiveId] = useState(model.preservedDatasets[0]?.id || '');
  const [loadedRows, setLoadedRows] = useState<Array<Record<string, unknown> | Array<unknown>>>([]);
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'loaded' | 'unavailable' | 'error'>('idle');
  const [query, setQuery] = useState('');
  const [filterColumn, setFilterColumn] = useState('*');
  const [sort, setSort] = useState<{ column: string; direction: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0);
  const resource = model.preservedDatasets.find((item) => item.id === activeId) || model.preservedDatasets[0];
  useEffect(() => {
    setPage(0); setQuery(''); setFilterColumn('*'); setSort(null); setLoadedRows(resource?.rows || []);
    if (!resource || resource.rows?.length || !resource.path) { setLoadState(resource?.rows?.length ? 'loaded' : 'idle'); return; }
    const url = safeAssetUrl(resource.path, model.sourceBaseUrl);
    if (!url) { setLoadState('unavailable'); return; }
    const controller = new AbortController();
    setLoadState('loading');
    fetch(url, { signal: controller.signal }).then((response) => {
      if (!response.ok) throw new Error(String(response.status));
      const contentType = response.headers.get('content-type')?.toLowerCase() || '';
      const isCsv = /\.csv(?:$|[?#])/i.test(url) || contentType.includes('text/csv') || resource.kind?.toLowerCase().includes('csv');
      return isCsv ? response.text() : response.json();
    }).then((payload) => {
      if (typeof payload === 'string') {
        setLoadedRows(parseCsv(payload));
      } else setLoadedRows(extractRows(payload));
      setLoadState('loaded');
    }).catch((error) => { if (error.name !== 'AbortError') setLoadState('error'); });
    return () => controller.abort();
  }, [resource?.id, model.sourceBaseUrl]);
  if (!resource) return <Empty text="No structured resources were supplied."/>;
  const rows = loadedRows.length ? loadedRows : resource.rows || [];
  const columns = resource.columns?.length ? resource.columns : (rows[0] && !Array.isArray(rows[0]) ? Object.keys(rows[0]) : Array.isArray(rows[0]) ? rows[0].map((_, index) => `Column ${index + 1}`) : []);
  const filtered = rows.filter((row) => {
    if (!query) return true;
    if (filterColumn === '*') return JSON.stringify(row).toLowerCase().includes(query.toLowerCase());
    const index = columns.indexOf(filterColumn); const value = Array.isArray(row) ? row[index] : row[filterColumn];
    return String(value ?? '').toLowerCase().includes(query.toLowerCase());
  }).sort((a, b) => {
    if (!sort) return 0; const ai = columns.indexOf(sort.column); const av = Array.isArray(a) ? a[ai] : a[sort.column]; const bv = Array.isArray(b) ? b[ai] : b[sort.column];
    return String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true }) * sort.direction;
  });
  const pageSize = 50; const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize)); const visible = filtered.slice(page * pageSize, (page + 1) * pageSize);
  const cell = (row: Record<string, unknown> | Array<unknown>, column: string, columnIndex: number) => Array.isArray(row) ? row[columnIndex] : row[column];
  const inferFeature = (row: Record<string, unknown> | Array<unknown>) => {
    if (Array.isArray(row)) return undefined;
    return ['feature_id', 'featureId', 'station_id', 'object_id'].map((key) => row[key]).find((value) => typeof value === 'string') as string | undefined;
  };
  return <div className="max-w-[92rem] mx-auto space-y-3">
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_12rem_minmax(18rem,0.4fr)] gap-3">
      <select value={resource.id} onChange={(event) => setActiveId(event.target.value)} className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100">{model.preservedDatasets.map((item) => <option key={item.id} value={item.id}>{item.title || item.name || item.id}</option>)}</select>
      <select value={filterColumn} onChange={(event) => { setFilterColumn(event.target.value); setPage(0); }} className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-300"><option value="*">All columns</option>{columns.map((column) => <option key={column} value={column}>{column}</option>)}</select>
      <label className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3"><Search className="w-4 h-4 text-slate-500"/><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder={filterColumn === '*' ? 'Search all columns' : `Filter ${filterColumn}`} className="w-full bg-transparent py-2 text-sm outline-none"/></label>
    </div>
    <div className="rounded-xl border border-slate-800 bg-slate-900/45 p-4 flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">{resource.title || resource.name || resource.id}</h3><p className="mt-1 text-xs text-slate-400">{[resource.description, resource.kind, `${filtered.length || resource.row_count || 0} rows`, resource.path].filter(Boolean).join(' · ')}</p></div>{safeAssetUrl(resource.path, model.sourceBaseUrl) && <a href={safeAssetUrl(resource.path, model.sourceBaseUrl)!} download className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs text-cyan-300"><Download className="w-4 h-4"/>Source file</a>}</div>
    {rows.length > 0 ? <><div className="overflow-auto rounded-xl border border-slate-800 max-h-[58vh]"><table className="min-w-full text-xs"><thead className="sticky top-0 bg-slate-900 text-slate-300"><tr>{columns.map((column) => <th key={column} className="px-3 py-2 text-left font-mono whitespace-nowrap"><button onClick={() => setSort((current) => current?.column === column ? { column, direction: current.direction === 1 ? -1 : 1 } : { column, direction: 1 })}>{column}{sort?.column === column ? sort.direction === 1 ? ' ↑' : ' ↓' : ''}</button></th>)}</tr></thead><tbody>{visible.map((row, index) => <tr key={index} onClick={() => { const id = inferFeature(row); if (id && onSelectFeature) onSelectFeature(id); }} className={`border-t border-slate-800/70 ${inferFeature(row) ? 'cursor-pointer hover:bg-cyan-500/5' : ''}`}>{columns.map((column, columnIndex) => <td key={column} className="px-3 py-2 text-slate-400 whitespace-nowrap max-w-xs truncate" title={String(cell(row, column, columnIndex) ?? '')}>{String(cell(row, column, columnIndex) ?? '')}</td>)}</tr>)}</tbody></table></div><div className="flex items-center justify-between text-xs text-slate-500"><span>{filtered.length} matching rows</span><div className="flex items-center gap-2"><button disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))} className="p-1 disabled:opacity-30"><ChevronLeft className="w-4 h-4"/></button><span>{page + 1} / {pageCount}</span><button disabled={page + 1 >= pageCount} onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))} className="p-1 disabled:opacity-30"><ChevronRight className="w-4 h-4"/></button></div></div></> : <Empty text={loadState === 'loading' ? 'Loading file-backed rows…' : loadState === 'unavailable' ? 'The package preserved this resource, but its file is not exposed through the current package URL.' : loadState === 'error' ? 'The resource payload could not be read. Metadata and provenance remain available.' : 'No inline rows were supplied for this resource.'}/>}
  </div>;
}

export function SeriesBrowser({ model, onSelectFeature }: { model: ScientificUIModel; onSelectFeature?: (id: string) => void }) {
  if (!model.quantitativeSeries.length) return <Empty text="No compatible quantitative series were supplied."/>;
  return <div className="max-w-7xl mx-auto grid xl:grid-cols-2 gap-4">{model.quantitativeSeries.map((series) => <section key={series.id} className="rounded-xl border border-slate-800 bg-slate-900/45 p-4"><div className="flex justify-between gap-4"><div><h3 className="font-semibold">{series.title}</h3>{series.description && <p className="text-xs text-slate-500 mt-1">{series.description}</p>}</div><span className="text-[10px] uppercase text-cyan-400 font-mono whitespace-nowrap">{series.kind}</span></div><div className="h-64 mt-4"><GenericChart series={series} onSelectFeature={onSelectFeature}/></div><p className="text-[10px] text-slate-500 mt-2">{series.unit ? `Unit: ${series.unit} · ` : ''}{series.status ? `${series.status} · ` : ''}{series.evidenceRefs.length} evidence reference{series.evidenceRefs.length === 1 ? '' : 's'}</p></section>)}</div>;
}

export function AssetBrowser({ model, onSelectFeature }: { model: ScientificUIModel; onSelectFeature?: (id: string) => void }) {
  const [activeId, setActiveId] = useState(model.nativeAssets[0]?.id || ''); const [zoom, setZoom] = useState(1);
  const asset = model.nativeAssets.find((item) => item.id === activeId) || model.nativeAssets[0];
  if (!asset) return <Empty text="No source figures or native assets were supplied."/>;
  const url = safeAssetUrl(asset.path, model.sourceBaseUrl); const imageLike = /image|render|figure|map|png|jpe?g|webp|tiff?/i.test(`${asset.kind} ${asset.mimeType} ${asset.path}`);
  return <div className="max-w-7xl mx-auto grid lg:grid-cols-[18rem_minmax(0,1fr)] gap-4 h-full"><aside className="overflow-y-auto space-y-1">{model.nativeAssets.map((item) => <button key={item.id} onClick={() => { setActiveId(item.id); setZoom(1); }} className={`w-full rounded-lg border p-3 text-left ${item.id === asset.id ? 'border-cyan-400 bg-cyan-500/10' : 'border-slate-800 bg-slate-900/40'}`}><div className="text-xs font-semibold truncate">{item.title}</div><div className="text-[10px] text-slate-500 mt-1">{[item.kind, item.page != null ? `page ${item.page}` : undefined].filter(Boolean).join(' · ')}</div></button>)}</aside><section className="rounded-xl border border-slate-800 bg-slate-900/45 overflow-hidden flex flex-col"><header className="p-4 border-b border-slate-800 flex items-start justify-between gap-3"><div><h3 className="font-semibold">{asset.title}</h3><p className="text-xs text-slate-500 mt-1">{[asset.sourceKind || 'direct-source', asset.kind, asset.page != null ? `page ${asset.page}` : undefined, asset.extractionQuality].filter(Boolean).join(' · ')}</p></div><div className="flex gap-2"><button onClick={() => setZoom((value) => Math.max(.5, value - .25))} className="px-2 py-1 border border-slate-700 rounded text-xs">−</button><span className="text-xs py-1 tabular-nums">{Math.round(zoom * 100)}%</span><button onClick={() => setZoom((value) => Math.min(4, value + .25))} className="px-2 py-1 border border-slate-700 rounded text-xs">+</button>{url && <a href={url} target="_blank" rel="noreferrer" className="p-1 border border-slate-700 rounded"><ExternalLink className="w-4 h-4"/></a>}</div></header><div className="flex-1 min-h-[28rem] overflow-auto grid place-items-center bg-slate-950 relative">{url && imageLike ? <div className="relative" style={{ transform: `scale(${zoom})`, transformOrigin: 'center' }}><img src={url} alt={asset.title} className="max-w-full max-h-[60vh] object-contain"/>{asset.hotspots?.map((hotspot) => <button key={hotspot.id} onClick={() => hotspot.featureId && onSelectFeature?.(hotspot.featureId)} title={hotspot.label} className="absolute w-4 h-4 -ml-2 -mt-2 rounded-full bg-amber-400 ring-4 ring-amber-400/30" style={{ left: `${hotspot.x}%`, top: `${hotspot.y}%` }}/>)}</div> : <Empty text={url ? 'This native asset is preserved as a downloadable source rather than an image preview.' : 'The source asset path is not browser-accessible in this deployment. Provenance remains preserved without fabricating a preview.'}/>}</div><footer className="p-4 border-t border-slate-800 text-xs text-slate-400">{asset.caption || asset.path || 'No caption was supplied.'}{asset.legend?.length ? <div className="flex flex-wrap gap-2 mt-3">{asset.legend.map((item, index) => <span key={`${item.label}:${index}`} className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 px-2 py-1"><i className="w-2.5 h-2.5 rounded-sm" style={{ background: item.color || '#64748b' }}/>{item.label}</span>)}</div> : null}</footer></section></div>;
}

export function AssetComparison({ model }: { model: ScientificUIModel }) {
  const previewable = model.nativeAssets.filter((asset) => safeAssetUrl(asset.path, model.sourceBaseUrl) && /image|render|figure|map|png|jpe?g|webp|tiff?/i.test(`${asset.kind} ${asset.mimeType} ${asset.path}`));
  const [leftId, setLeftId] = useState(previewable[0]?.id || '');
  const [rightId, setRightId] = useState(previewable[1]?.id || previewable[0]?.id || '');
  const [open, setOpen] = useState(false);
  if (previewable.length < 2) return null;
  const left = previewable.find((asset) => asset.id === leftId) || previewable[0];
  const right = previewable.find((asset) => asset.id === rightId) || previewable[1];
  return <section className="max-w-7xl mx-auto mb-4 rounded-xl border border-slate-800 bg-slate-900/45 overflow-hidden"><button onClick={() => setOpen((value) => !value)} className="w-full p-4 flex items-center justify-between text-left"><div><div className="text-[10px] uppercase tracking-widest text-violet-300 font-mono">Source figure comparison</div><p className="mt-1 text-xs text-slate-400">Inspect two direct package assets side by side without merging their semantics.</p></div><span className="text-xs text-cyan-300">{open ? 'Hide' : 'Compare'}</span></button>{open && <div className="grid md:grid-cols-2 gap-px border-t border-slate-800 bg-slate-800">{[[left, setLeftId], [right, setRightId]].map(([asset, setter], index) => { const item = asset as NativeAsset; const set = setter as React.Dispatch<React.SetStateAction<string>>; return <div key={index} className="bg-slate-950 p-3"><select value={item.id} onChange={(event) => set(event.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs">{previewable.map((option) => <option key={option.id} value={option.id}>{option.title}</option>)}</select><div className="mt-3 h-72 grid place-items-center overflow-auto rounded-lg border border-slate-800 bg-black/30"><img src={safeAssetUrl(item.path, model.sourceBaseUrl)!} alt={item.title} className="max-h-full max-w-full object-contain"/></div><p className="mt-2 text-[10px] text-slate-500">{[item.sourceKind || 'direct-source', item.page != null ? `page ${item.page}` : undefined, item.extractionQuality].filter(Boolean).join(' · ')}</p></div>; })}</div>}</section>;
}

export function TimelineBrowser({ model, onSelectFeature }: { model: ScientificUIModel; onSelectFeature?: (id: string) => void }) {
  if (!model.timelineEvents.length) return <Empty text="No comparable observation, forecast, publication, or revision timeline was supplied."/>;
  const events = [...model.timelineEvents].sort((a, b) => String(a.date || a.period || '').localeCompare(String(b.date || b.period || '')));
  return <div className="max-w-4xl mx-auto"><div className="border-l border-cyan-500/30 ml-3 space-y-1">{events.map((event) => <article key={event.id} className="relative pl-7 py-4"><i className="absolute -left-1.5 top-6 w-3 h-3 rounded-full bg-cyan-400 ring-4 ring-slate-950"/><div className="rounded-xl border border-slate-800 bg-slate-900/45 p-4"><div className="flex items-start justify-between gap-4"><div><div className="text-[10px] uppercase tracking-widest text-cyan-400 font-mono">{event.date || event.period || 'Undated'} · {event.kind || event.status || 'event'}</div><h3 className="font-semibold mt-1">{event.title}</h3></div>{event.featureIds[0] && <button onClick={() => onSelectFeature?.(event.featureIds[0])} className="text-xs text-cyan-300 border border-cyan-500/30 rounded-lg px-2 py-1">Locate</button>}</div>{event.description && <p className="text-xs text-slate-400 mt-2 leading-relaxed">{event.description}</p>}</div></article>)}</div></div>;
}

export function ProfileBrowser({ model, onSelectFeature }: { model: ScientificUIModel; onSelectFeature?: (id: string) => void }) {
  const profiles = model.agentic?.verticalProfiles || [];
  const [activeId, setActiveId] = useState(profiles[0]?.id || ''); const profile = profiles.find((item) => item.id === activeId) || profiles[0];
  if (!profile) return <Empty text="No vertical profile or section definitions were supplied."/>;
  const intervals = model.allIntervals.filter((item) => profile.interval_ids?.includes(item.id));
  const maxDepth = Math.max(1, ...intervals.flatMap((item) => [item.start || 0, item.end || 0]));
  const color = (type?: string) => /fract|fault/i.test(type || '') ? '#fb7185' : /water/i.test(type || '') ? '#38bdf8' : /soil|weather|overburden/i.test(type || '') ? '#fbbf24' : '#a78bfa';
  return <div className="max-w-6xl mx-auto grid lg:grid-cols-[18rem_minmax(0,1fr)] gap-4"><aside className="space-y-1">{profiles.map((item) => <button key={item.id} onClick={() => setActiveId(item.id)} className={`w-full rounded-lg border p-3 text-left ${item.id === profile.id ? 'border-cyan-400 bg-cyan-500/10' : 'border-slate-800 bg-slate-900/40'}`}><div className="text-xs font-semibold">{item.name}</div><div className="text-[10px] text-slate-500 mt-1">{item.semantic_category || item.axis || 'vertical profile'}</div></button>)}</aside><section className="rounded-xl border border-slate-800 bg-slate-900/45 p-5"><div className="flex items-start justify-between"><div><div className="text-[10px] uppercase tracking-widest text-cyan-400 font-mono">{profile.axis || 'vertical axis'} · {profile.reference || 'reference unspecified'}</div><h3 className="font-semibold mt-1">{profile.name}</h3><p className="text-xs text-slate-400 mt-2">{profile.description}</p></div>{profile.feature_id && <button onClick={() => onSelectFeature?.(profile.feature_id!)} className="text-xs text-cyan-300 border border-cyan-500/30 rounded-lg px-2 py-1">Linked object</button>}</div><div className="mt-6 grid grid-cols-[5rem_8rem_minmax(0,1fr)] gap-3 min-h-[28rem]"><div className="relative border-r border-slate-700">{Array.from({ length: 6 }, (_, index) => <span key={index} className="absolute right-2 text-[10px] text-slate-500 tabular-nums" style={{ top: `${index * 20}%` }}>{Math.round(maxDepth * index / 5)} m</span>)}</div><div className="relative rounded-lg overflow-hidden bg-slate-950 border border-slate-800">{intervals.map((interval) => { const start = interval.start || 0; const end = interval.end ?? start; return <button key={interval.id} title={`${interval.name || interval.type}: ${start}–${end} ${interval.unit || 'm'}`} className="absolute left-3 right-3 rounded border border-white/20 hover:brightness-125" style={{ top: `${start / maxDepth * 100}%`, height: `${Math.max(1.5, (end - start) / maxDepth * 100)}%`, background: color(`${interval.type} ${interval.material}`) }}/>; })}</div><div className="space-y-2">{intervals.map((interval) => <div key={interval.id} className="rounded-lg border border-slate-800 p-3"><div className="flex items-center gap-2"><i className="w-2.5 h-2.5 rounded-sm" style={{ background: color(`${interval.type} ${interval.material}`) }}/><span className="text-xs font-semibold">{interval.name || interval.type || 'Interval'}</span></div><div className="text-[10px] text-slate-500 mt-1">{interval.start ?? '?'}–{interval.end ?? '?'} {interval.unit || ''} · {interval.fidelity || 'fidelity unspecified'}</div></div>)}</div></div>{!intervals.length && <Empty text="This profile is preserved, but no resolved interval boundaries are available. No strata have been manufactured."/>}</section></div>;
}

export function ProfileComparison({ model, onSelectFeature }: { model: ScientificUIModel; onSelectFeature?: (id: string) => void }) {
  const profiles = model.agentic?.verticalProfiles || [];
  const [selected, setSelected] = useState<string[]>(profiles.slice(0, 4).map((profile) => profile.id));
  if (profiles.length < 2) return null;
  const compared = profiles.filter((profile) => selected.includes(profile.id));
  const summaries = compared.map((profile) => {
    const intervals = model.allIntervals.filter((interval) => profile.interval_ids?.includes(interval.id));
    const depth = Math.max(0, ...intervals.flatMap((interval) => [interval.start || 0, interval.end || 0]));
    return { profile, intervals, depth };
  });
  const maxDepth = Math.max(1, ...summaries.map((summary) => summary.depth));
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : current.length < 6 ? [...current, id] : current);
  return <section className="max-w-6xl mx-auto mb-4 rounded-xl border border-slate-800 bg-slate-900/45 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="text-[10px] uppercase tracking-widest text-violet-300 font-mono">Cross-profile comparison</div><p className="mt-1 text-xs text-slate-400">Compare up to six package-defined profiles on one shared depth scale.</p></div><div className="text-[10px] text-slate-500">{selected.length}/6 selected</div></div>
    <div className="mt-3 flex gap-2 overflow-x-auto pb-2">{profiles.map((profile) => <button key={profile.id} onClick={() => toggle(profile.id)} className={`shrink-0 rounded-full border px-3 py-1.5 text-[10px] ${selected.includes(profile.id) ? 'border-violet-400 bg-violet-500/10 text-violet-200' : 'border-slate-700 text-slate-500'}`}>{profile.name}</button>)}</div>
    {summaries.length ? <div className="mt-4 grid gap-3" style={{ gridTemplateColumns: `repeat(${summaries.length}, minmax(8rem, 1fr))` }}>{summaries.map(({ profile, intervals, depth }) => <button key={profile.id} onClick={() => profile.feature_id && onSelectFeature?.(profile.feature_id)} className="text-left"><div className="mb-2 truncate text-xs font-semibold" title={profile.name}>{profile.name}</div><div className="relative h-52 overflow-hidden rounded-lg border border-slate-800 bg-slate-950">{intervals.map((interval) => { const start = interval.start || 0; const end = interval.end ?? start; return <i key={interval.id} title={`${interval.name || interval.type || 'Interval'}: ${start}–${end} ${interval.unit || ''}`} className="absolute left-2 right-2 rounded border border-white/20 bg-violet-400/70" style={{ top: `${start / maxDepth * 100}%`, height: `${Math.max(1.5, (end - start) / maxDepth * 100)}%` }}/>; })}{!intervals.length && <span className="absolute inset-0 grid place-items-center p-2 text-center text-[9px] text-slate-600">No resolved intervals</span>}</div><div className="mt-1 flex justify-between text-[9px] text-slate-500"><span>{intervals.length} intervals</span><span>{depth || '—'} m</span></div></button>)}</div> : <p className="mt-4 text-xs text-slate-500">Choose profiles to compare.</p>}
  </section>;
}

export function ExtensionBrowser({ extensions }: { extensions: GenericExtension[] }) {
  if (!extensions.length) return <Empty text="No package-specific extensions were supplied."/>;
  return <div className="max-w-5xl mx-auto space-y-3">{extensions.map((extension) => <details key={extension.id} className="rounded-xl border border-slate-800 bg-slate-900/45"><summary className="cursor-pointer p-4"><span className="font-semibold text-sm">{extension.title}</span><span className="ml-2 text-[10px] uppercase text-violet-300 font-mono">{extension.kind}</span>{extension.rendererHint && <span className="ml-2 text-[10px] text-slate-500">hint: {extension.rendererHint}</span>}</summary><div className="border-t border-slate-800 p-4"><p className="text-xs text-slate-400">{extension.description || extensionFallbackPolicy.note}</p><pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-slate-950 p-3 text-[10px] text-slate-400">{JSON.stringify(extension.payload, null, 2).slice(0, 20000)}</pre></div></details>)}</div>;
}

export function QualityBrowser({ model }: { model: ScientificUIModel }) {
  const facets = new Map<string, number>();
  model.spatialFeatures.forEach((feature) => [feature.evidenceStatus && `status · ${feature.evidenceStatus}`, feature.locationFidelity && `location · ${feature.locationFidelity}`, feature.confidence && `confidence · ${feature.confidence}`].filter(Boolean).forEach((value) => facets.set(value!, (facets.get(value!) || 0) + 1)));
  const limitations = model.agentic?.limitations || []; const unresolved = model.agentic?.unresolvedItems || []; const diagnostics = model.agentic?.adapterDiagnostics || [];
  return <div className="max-w-6xl mx-auto space-y-5"><section><h3 className="text-xs uppercase tracking-widest text-slate-500 font-mono mb-3">Evidence semantics</h3><div className="flex flex-wrap gap-2">{Array.from(facets.entries()).map(([label, count]) => <span key={label} className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs"><b className="text-cyan-300 mr-1">{count}</b>{label}</span>)}</div></section><QualityList title="Limitations" values={limitations} tone="amber" empty="No package-level limitations were supplied."/><QualityList title="Unresolved items" values={unresolved} tone="rose" empty="No unresolved package items were supplied."/><QualityList title="Adapter diagnostics" values={diagnostics} tone="violet" empty="All canonical references resolved through the adapter."/>{model.reportAnalysis?.uncertainties.length ? <QualityList title="Report uncertainties" values={model.reportAnalysis.uncertainties.map((item) => item.statement)} tone="cyan" empty=""/> : null}</div>;
}

export function ReportBrowser({ model, onSelectFeature }: { model: ScientificUIModel; onSelectFeature?: (id: string) => void }) {
  const analysis = model.reportAnalysis;
  const [themeId, setThemeId] = useState(analysis?.themes[0]?.id || '');
  if (!analysis) return <Empty text="No report-level synthesis was supplied."/>;
  const overview = analysis.raw.executive_overview; const theme = analysis.themes.find((item) => item.id === themeId) || analysis.themes[0]; const findings = theme ? analysis.findingsByThemeId.get(theme.id) || [] : Array.from(analysis.findingsById.values());
  const keyStats = overview.key_stat_callout_ids.map((id) => analysis.calloutsById.get(id)).filter(Boolean);
  return <div className="max-w-7xl mx-auto space-y-5"><header className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-6"><div className="text-[10px] uppercase tracking-[.2em] text-cyan-400 font-mono">Executive overview</div><h3 className="text-2xl font-semibold mt-2 max-w-4xl">{overview.headline}</h3><p className="text-sm text-slate-300 mt-3 leading-relaxed max-w-5xl">{overview.abstract}</p>{keyStats.length ? <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-2 mt-5">{keyStats.map((stat) => <div key={stat!.id} className="rounded-xl border border-slate-700 bg-slate-950/60 p-3"><div className="text-[10px] uppercase tracking-wide text-slate-500">{stat!.label}</div><div className="text-xl text-cyan-300 font-semibold tabular-nums mt-1">{stat!.value ?? stat!.category ?? [stat!.value_range?.minimum, stat!.value_range?.maximum].filter((value) => value != null).join('–')}{stat!.unit ? ` ${stat!.unit}` : ''}</div></div>)}</div> : null}</header><div className="flex gap-2 overflow-x-auto pb-1">{analysis.themes.map((item) => <button key={item.id} onClick={() => setThemeId(item.id)} className={`shrink-0 rounded-full border px-3 py-1.5 text-xs ${item.id === theme?.id ? 'border-cyan-400 bg-cyan-500/10 text-cyan-200' : 'border-slate-700 text-slate-400'}`}>{item.title}</button>)}</div>{theme && <section><h3 className="text-xl font-semibold">{theme.title}</h3><p className="text-sm text-slate-400 mt-2">{theme.summary}</p></section>}<div className="grid xl:grid-cols-2 gap-3">{findings.map((finding) => <article key={finding.id} className="rounded-xl border border-slate-800 bg-slate-900/45 p-4"><div className="flex items-start justify-between gap-3"><h4 className="font-semibold">{finding.title}</h4><div className="flex gap-1"><span className="rounded-full border border-slate-700 px-2 py-1 text-[9px] uppercase text-slate-400">{finding.basis.replace(/_/g, ' ')}</span><span className="rounded-full border border-slate-700 px-2 py-1 text-[9px] uppercase text-slate-400">{finding.confidence}</span></div></div><p className="text-xs text-slate-300 mt-3 leading-relaxed">{finding.statement}</p>{finding.why_it_matters && <p className="text-xs text-cyan-100/70 mt-3 leading-relaxed">{finding.why_it_matters}</p>}<div className="flex items-center justify-between mt-4 text-[10px] text-slate-500"><span>{finding.evidence_refs?.length || 0} evidence refs</span>{finding.resolvedFeatureIds[0] && <button onClick={() => onSelectFeature?.(finding.resolvedFeatureIds[0])} className="rounded-lg border border-cyan-500/30 px-2 py-1 text-cyan-300">Highlight object</button>}</div></article>)}</div></div>;
}

export function DocumentAnalysisBrowser({ model, onSelectFeature }: { model: ScientificUIModel; onSelectFeature?: (id: string) => void }) {
  const analysis = model.documentAnalysis;
  if (!analysis) return <Empty text="No document analysis was supplied."/>;
  return <div className="max-w-5xl mx-auto space-y-4"><header className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-6"><div className="text-[10px] uppercase tracking-[.2em] text-cyan-400 font-mono">Document analysis</div><h3 className="text-2xl font-semibold mt-2">{analysis.raw.display_title}</h3>{analysis.raw.brief_description && <p className="text-sm text-slate-300 mt-3 leading-relaxed">{analysis.raw.brief_description}</p>}</header>{analysis.blocks.map((block) => <section key={block.id} className="rounded-xl border border-slate-800 bg-slate-900/45 p-5">{block.headline && <h3 className="text-lg font-semibold">{block.headline}</h3>}{block.content && <div className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-300">{block.content}</div>}{block.metrics?.length ? <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2 mt-4">{block.metrics.map((metric, index) => <div key={index} className="rounded-lg border border-cyan-500/20 bg-slate-950/60 p-3"><div className="text-[10px] uppercase tracking-wide text-slate-500">{metric.label}</div><div className="text-xl text-cyan-300 font-semibold mt-1">{metric.display_value}</div>{metric.explanation && <p className="text-xs text-slate-400 mt-1">{metric.explanation}</p>}</div>)}</div> : null}{block.related_object_ids?.length ? <div className="mt-4 flex flex-wrap gap-2">{block.related_object_ids.map((id) => <button key={id} onClick={() => onSelectFeature?.(id)} className="rounded-lg border border-cyan-500/30 px-2 py-1 text-[10px] text-cyan-300">Highlight object</button>)}</div> : null}</section>)}</div>;
}
const QualityList = ({ title, values, empty, tone }: { title: string; values: string[]; empty: string; tone: string }) => {
  const tones: Record<string, string> = { amber: 'border-amber-500/20 bg-amber-500/5', rose: 'border-rose-500/20 bg-rose-500/5', violet: 'border-violet-500/20 bg-violet-500/5', cyan: 'border-cyan-500/20 bg-cyan-500/5' };
  return <section><h3 className="text-xs uppercase tracking-widest text-slate-500 font-mono mb-3">{title} · {values.length}</h3>{values.length ? <div className="space-y-2">{values.map((value, index) => <div key={index} className={`rounded-lg border ${tones[tone] || tones.cyan} p-3 text-xs text-slate-300`}>{value}</div>)}</div> : <p className="rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-xs text-slate-500">{empty}</p>}</section>;
};

export const Empty = ({ text }: { text: string }) => <div className="min-h-64 h-full grid place-items-center text-center text-sm text-slate-500 p-8"><p className="max-w-xl">{text}</p></div>;
