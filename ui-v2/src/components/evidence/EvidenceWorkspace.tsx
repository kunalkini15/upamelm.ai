/**
 * @file EvidenceWorkspace.tsx
 * @module ui-v2/components/evidence/EvidenceWorkspace
 * @description Dynamic, capability-negotiated evidence explorer drawer.
 * Provides tabbed workspaces for data resources, quantitative charts,
 * borehole profiles, corridor chainage, figures/assets, timelines,
 * and scope/uncertainty caveats.
 */

import React, { useState } from 'react';
import { BarChart3, BookOpen, Boxes, Database, FileImage, Route, X } from 'lucide-react';
import { ScientificUIModel } from '../../types/scientific';
import { AssetBrowser, AssetComparison, DocumentAnalysisBrowser, ExtensionBrowser, ReportBrowser, ResourceBrowser } from './AdaptivePanels';
import { CorridorBrowser } from './CorridorBrowser';
import { SeriesExplorer } from './SeriesExplorer';

interface Props { model: ScientificUIModel; onClose: () => void; activeFeatureId?: string | null; onSelectFeature?: (id: string) => void; initialTab?: Tab; }
type Tab = 'report' | 'resources' | 'quantitative' | 'corridors' | 'assets' | 'extensions';

export const EvidenceWorkspace: React.FC<Props> = ({ model, onClose, activeFeatureId, onSelectFeature, initialTab }) => {
  const initial: Tab = initialTab || (model.documentAnalysis || model.reportAnalysis ? 'report' : model.primaryLayout === 'figure-first' && model.nativeAssets.length ? 'assets' : model.quantitativeSeries.length ? 'quantitative' : model.preservedDatasets.length ? 'resources' : model.primaryLayout === 'corridor-first' ? 'corridors' : 'extensions');
  const [tab, setTab] = useState<Tab>(initial);
  const corridorCount = model.spatialFeatures.filter((feature) => /LineString$/.test(feature.geometry?.type || '')).length;
  const tabs = ([
    { id: 'report', label: 'Report analysis', icon: <BookOpen className="w-4 h-4"/>, count: model.documentAnalysis?.blocks.length || model.reportAnalysis?.raw.findings.length || 0, enabled: Boolean(model.documentAnalysis || model.reportAnalysis) },
    { id: 'resources', label: 'Data resources', icon: <Database className="w-4 h-4"/>, count: model.preservedDatasets.length, enabled: model.preservedDatasets.length > 0 },
    { id: 'quantitative', label: 'Charts & comparisons', icon: <BarChart3 className="w-4 h-4"/>, count: model.quantitativeSeries.length, enabled: model.quantitativeSeries.length > 0 },
    { id: 'corridors', label: 'Corridors & chainage', icon: <Route className="w-4 h-4"/>, count: corridorCount, enabled: corridorCount > 0 },
    { id: 'assets', label: 'Figures & assets', icon: <FileImage className="w-4 h-4"/>, count: model.nativeAssets.length, enabled: model.nativeAssets.length > 0 },
    { id: 'extensions', label: 'Package extensions', icon: <Boxes className="w-4 h-4"/>, count: model.genericExtensions.length, enabled: model.genericExtensions.length > 0 },
  ] satisfies Array<{ id: Tab; label: string; icon: React.ReactNode; count: number; enabled: boolean }>).filter((item) => item.enabled);

  return <div className="absolute inset-0 z-40 bg-ink-950/96 backdrop-blur-xl text-text flex flex-col">
    <div className="h-16 border-b border-line px-6 flex items-center justify-between"><div><div className="text-[10px] uppercase tracking-[0.22em] text-accent font-mono">Adaptive evidence workspace</div><h2 className="text-lg font-semibold">{model.shortTitle}</h2></div><div className="flex items-center gap-3">{activeFeatureId && <span className="hidden md:inline text-[10px] font-mono text-amber border border-amber/25 rounded-full px-2 py-1">linked selection · {activeFeatureId}</span>}<button onClick={onClose} className="p-2 rounded-lg border border-line text-muted hover:text-text hover:bg-ink-800" aria-label="Close evidence workspace"><X className="w-4 h-4"/></button></div></div>
    <div className="flex flex-1 min-h-0"><aside className="w-64 border-r border-line p-3 bg-ink-950/70 overflow-y-auto"><div className="px-3 pb-2 text-[10px] font-mono uppercase tracking-[0.2em] text-muted">Document contents</div><div className="space-y-1">{tabs.map((item) => <button key={item.id} disabled={!item.enabled} title={!item.enabled ? `No validated ${item.label.toLowerCase()} in this package` : undefined} onClick={() => item.enabled && setTab(item.id)} className={`w-full flex items-center gap-2 rounded-lg px-3 py-2.5 text-xs font-mono transition ${tab === item.id ? 'bg-accent text-ink-950' : item.enabled ? 'text-muted hover:bg-ink-900 hover:text-text' : 'text-muted cursor-not-allowed'}`}>{item.icon}<span className="flex-1 text-left">{item.label}</span><span>{item.count}</span></button>)}</div></aside>
      <main className="flex-1 overflow-y-auto p-6">
        {tab === 'report' && (model.documentAnalysis ? <DocumentAnalysisBrowser model={model} onSelectFeature={onSelectFeature}/> : <ReportBrowser model={model} onSelectFeature={onSelectFeature}/>)} {tab === 'resources' && <ResourceBrowser model={model} onSelectFeature={onSelectFeature}/>} {tab === 'quantitative' && <SeriesExplorer model={model} onSelectFeature={onSelectFeature}/>} {tab === 'corridors' && <CorridorBrowser model={model} onSelectFeature={onSelectFeature}/>} {tab === 'assets' && <><AssetComparison model={model}/><AssetBrowser model={model} onSelectFeature={onSelectFeature}/></>} {tab === 'extensions' && <ExtensionBrowser extensions={model.genericExtensions}/>}
      </main></div>
  </div>;
};
