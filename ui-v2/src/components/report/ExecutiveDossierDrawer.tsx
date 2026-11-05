/**
 * @file ExecutiveDossierDrawer.tsx
 * @module ui-v2/components/report/ExecutiveDossierDrawer
 * @description Slide-out executive dossier presenting lay-accessible scientific summaries,
 * categorized key findings, risk callouts, and page-level source citations.
 *
 * Provides bidirectional focus actions:
 * - "Focus on Map": Centers the 2D GIS map on the finding's geographic coordinates.
 * - "Inspect in 3D": Tilts and flies the 3D scene camera to the specific borehole or depth horizon.
 */

import React, { useState, useMemo } from 'react';
import {
  Sparkles,
  ChevronRight,
  ChevronDown,
  Layers3,
  MapPinned,
  Info,
  Search,
  BookOpen,
  Filter,
  X,
  Compass,
  FileText,
  Activity,
  Layers,
} from 'lucide-react';
import {
  ScientificUIModel,
  ReportAnalysisModel,
  ReportFindingView,
  ReportTheme,
  RenderablePointFeature,
} from '../../types/scientific';
import { selectExecutiveCallouts } from '../../core/ReportAnalysis';

interface ExecutiveDossierDrawerProps {
  model: ScientificUIModel;
  analysis: ReportAnalysisModel;
  isOpen: boolean;
  onClose: () => void;
  onFocusOnMap: (finding: ReportFindingView) => void;
  onInspectIn3D: (finding: ReportFindingView) => void;
  currentMode: 'map' | 'subsurface';
  focusedFeature?: RenderablePointFeature | null;
}

function formatValue(value: number | null | undefined, unit?: string | null) {
  if (value === null || value === undefined) return '—';
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}${unit ? ` ${unit}` : ''}`;
}

export const ExecutiveDossierDrawer: React.FC<ExecutiveDossierDrawerProps> = ({
  model,
  analysis,
  isOpen,
  onClose,
  onFocusOnMap,
  onInspectIn3D,
  currentMode,
  focusedFeature,
}) => {
  const [selectedThemeId, setSelectedThemeId] = useState<string | null>(null);
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCaveatsModal, setShowCaveatsModal] = useState(false);
  const [activeTab, setActiveTab] = useState<'station' | 'executive'>('executive');
  const agentic = model.agentic;
  const auditContextCount = (agentic?.limitations.length || 0) + (agentic?.unresolvedItems.length || 0);
  const renderingCoverage = (agentic?.coverage.rendering || {}) as Record<string, unknown>;

  // If focusedFeature changes and has specific findings, default tab to 'station'
  const stationFindings = useMemo(() => {
    if (!focusedFeature) return [];
    return Array.from(analysis.findingsById.values()).filter((f) =>
      f.resolvedFeatureIds.includes(focusedFeature.id)
    );
  }, [focusedFeature, analysis]);

  React.useEffect(() => {
    if (focusedFeature && stationFindings.length > 0) {
      setActiveTab('station');
    } else {
      setActiveTab('executive');
    }
  }, [focusedFeature, stationFindings.length]);

  // Deterministic top executive metrics from the package
  const keyCallouts = useMemo(() => selectExecutiveCallouts(analysis, 4), [analysis]);

  // Dynamic themes from the ingested report package
  const themes = analysis.themes;

  // Active theme findings
  const activeTheme = useMemo(
    () => themes.find((t) => t.id === selectedThemeId) || null,
    [themes, selectedThemeId]
  );

  // Active findings list: either filtered by active theme or all
  const filteredFindings = useMemo(() => {
    let list: ReportFindingView[] = [];
    if (activeTheme) {
      const chapter = activeTheme.chapter_ids.map((id) => analysis.chaptersById.get(id)).find(Boolean);
      const fIds = activeTheme.finding_ids || chapter?.finding_ids || [];
      list = fIds.map((id) => analysis.findingsById.get(id)).filter(Boolean) as ReportFindingView[];
    } else {
      list = Array.from(analysis.findingsById.values());
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (f) =>
          f.title.toLowerCase().includes(q) ||
          f.statement.toLowerCase().includes(q) ||
          f.scope.toLowerCase().includes(q)
      );
    }
    return list;
  }, [activeTheme, analysis, searchQuery]);

  const activeFinding = useMemo(
    () => (selectedFindingId ? analysis.findingsById.get(selectedFindingId) || null : null),
    [selectedFindingId, analysis]
  );

  if (!isOpen) return null;

  return (
    <>
      {/* Pinned Left Intelligence Dossier (Coexists over 2D Map and 3D Scene) */}
      <div className="absolute top-16 left-5 bottom-6 z-40 w-[480px] max-w-[calc(100vw-40px)] flex flex-col pointer-events-auto select-none transition-all duration-300">
        <div className="flex-1 bg-ink-900/95 backdrop-blur-2xl border border-line/80 rounded-xl shadow-float flex flex-col overflow-hidden text-text">
          {/* Header Bar */}
          <div className="px-5 py-4 border-b border-line bg-ink-950/70 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 truncate">
              <span className="w-2.5 h-2.5 rounded-full bg-indigo-400 animate-pulse flex-shrink-0" />
              <div className="truncate">
                <div className="text-xs font-bold text-text font-mono tracking-wide uppercase">
                  {focusedFeature ? `${focusedFeature.name} • Report Dossier` : 'Executive Intelligence Dossier'}
                </div>
                <div className="text-[10px] text-muted font-mono truncate">
                  Study Area • Synthesis Engine
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button
                onClick={() => setShowCaveatsModal(true)}
                className="px-2.5 py-1 rounded-lg border border-line bg-ink-900 hover:bg-ink-800 text-muted hover:text-amber text-[11px] font-mono transition flex items-center gap-1"
                title="View Scientific Caveats"
              >
                <Info className="w-3.5 h-3.5 text-amber" />
                <span>Scientific context ({analysis.uncertainties.length})</span>
              </button>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg text-muted hover:text-text hover:bg-ink-800 transition"
                title="Close Dossier"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Tab Navigation if a feature is selected */}
          {focusedFeature && (
            <div className="flex border-b border-line bg-ink-950/40 px-5 pt-2 gap-2 text-xs font-mono">
              <button
                onClick={() => setActiveTab('station')}
                className={`pb-2.5 px-3 border-b-2 font-bold transition flex items-center gap-2 ${
                  activeTab === 'station'
                    ? 'border-indigo-400 text-indigo-300'
                    : 'border-transparent text-muted hover:text-text'
                }`}
              >
                <MapPinned className="w-3.5 h-3.5" />
                <span>Object Evidence ({stationFindings.length})</span>
              </button>
              <button
                onClick={() => setActiveTab('executive')}
                className={`pb-2.5 px-3 border-b-2 font-bold transition flex items-center gap-2 ${
                  activeTab === 'executive'
                    ? 'border-indigo-400 text-indigo-300'
                    : 'border-transparent text-muted hover:text-text'
                }`}
              >
                <Compass className="w-3.5 h-3.5" />
                <span>Overall Regional Briefing</span>
              </button>
            </div>
          )}

          {/* Dossier Body (Scrollable) */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs font-mono">
            {/* If on station tab, show station findings */}
            {focusedFeature && activeTab === 'station' ? (
              <div className="space-y-4">
                <div className="bg-ink-950/60 p-3 rounded-xl border border-line space-y-1">
                  <div className="text-[10px] uppercase text-accent font-bold tracking-wider">
                    Selected Object
                  </div>
                  <div className="text-sm font-bold text-text font-sans">{focusedFeature.name}</div>
                  <div className="text-[11px] text-muted">
                    {focusedFeature.type.replace(/_/g, ' ')} • {focusedFeature.totalDepthMeters ? `${focusedFeature.totalDepthMeters}m depth` : 'Depth unrecorded'}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-[10px] uppercase text-muted font-bold tracking-wider flex items-center justify-between">
                    <span>Direct Report Findings Referencing This Object</span>
                    <span>{stationFindings.length} found</span>
                  </div>

                  {stationFindings.length === 0 ? (
                    <div className="p-4 rounded-xl border border-line bg-ink-950/40 text-center text-muted space-y-2">
                      <p>No chapter findings explicitly cite this object ID.</p>
                      <button
                        onClick={() => setActiveTab('executive')}
                        className="text-indigo-400 underline hover:text-indigo-300 text-xs font-mono"
                      >
                        Switch to Overall Regional Briefing →
                      </button>
                    </div>
                  ) : (
                    stationFindings.map((finding) => (
                      <div
                        key={finding.id}
                        className="p-3.5 rounded-xl border border-line bg-ink-950/50 space-y-2 hover:border-line transition"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-ink-800 text-text border border-line">
                            {finding.confidence}
                          </span>
                          {finding.normalizedCategories.length > 0 && (
                            <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-indigo-950/80 text-indigo-300 border border-indigo-800/60">
                              {finding.normalizedCategories[0]}
                            </span>
                          )}
                        </div>
                        <div className="font-bold text-text font-sans text-xs">
                          {finding.title}
                        </div>
                        <p className="text-[11px] text-text font-sans leading-relaxed">
                          {finding.statement}
                        </p>
                        {finding.why_it_matters && (
                          <div className="text-[10px] text-muted bg-ink-900 p-2 rounded border border-line/80">
                            <span className="text-indigo-400 font-bold">Why it matters: </span>
                            {finding.why_it_matters}
                          </div>
                        )}
                        <div className="pt-2 flex items-center gap-2">
                          {finding.resolvedIntervalIds.length > 0 && (
                            <button
                              onClick={() => onInspectIn3D(finding)}
                              className="px-2.5 py-1 rounded bg-amber/10 hover:bg-amber/20 text-amber border border-amber/30 text-[10px] font-bold transition flex items-center gap-1"
                            >
                              <Layers className="w-3 h-3" />
                              <span>Inspect Vertical Evidence</span>
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : (
              <>
            {/* 1. EXECUTIVE HEADLINE & ABSTRACT */}
            <div className="rounded-xl border border-indigo-500/30 bg-ink-900 p-4 space-y-2.5 shadow-soft">
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-indigo-300">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Synthesis Bottom Line</span>
              </div>
              <h3 className="text-sm font-bold text-text font-sans leading-snug">
                {analysis.raw.executive_overview.headline}
              </h3>
              <p className="text-[11px] text-text font-sans leading-relaxed">
                {analysis.raw.executive_overview.abstract}
              </p>
            </div>

            {agentic && (
              <div className="rounded-xl border border-success/20 bg-ink-850/10 p-3.5 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-success">
                    <Activity className="w-3.5 h-3.5" />
                    <span>Evidence package</span>
                  </div>
                  <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[9px] text-success">
                    {agentic.status?.replace(/_/g, ' ') || 'validated'}
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div><div className="text-sm font-bold text-text">{agentic.layers.length}</div><div className="text-[9px] text-muted">Layers</div></div>
                  <div><div className="text-sm font-bold text-text">{agentic.verticalProfiles.length}</div><div className="text-[9px] text-muted">Profiles</div></div>
                  <div><div className="text-sm font-bold text-text">{agentic.structuredResources.length}</div><div className="text-[9px] text-muted">Resources</div></div>
                  <div><div className="text-sm font-bold text-text">{String(renderingCoverage.evidence_linked_to_ui ?? '—')}</div><div className="text-[9px] text-muted">Evidence linked</div></div>
                </div>
                <p className="text-[10px] leading-relaxed text-muted font-sans">
                  Geometry, native layers, depth profiles, structured tables, and evidence dispositions are retained from the source package. Approximate and narrative-only material remains explicitly qualified.
                </p>
              </div>
            )}

            {/* 2. DETERMINISTIC KEY METRICS (GROUNDED IN CALLOUTS) */}
            {keyCallouts.length > 0 && (
              <div className="space-y-2">
                <div className="text-[10px] font-mono text-muted uppercase tracking-wider font-bold">
                  Key Report Metrics
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {keyCallouts.map((stat, i) => {
                    if (!stat) return null;
                    return (
                      <div
                        key={stat.id || i}
                        className="rounded-xl border border-line/90 bg-ink-950/70 p-3 flex flex-col justify-between"
                      >
                        <div className="text-[10px] text-muted font-sans line-clamp-1">
                          {stat.label}
                        </div>
                        <div className="text-lg font-bold font-mono text-accent my-1">
                          {formatValue(stat.value, stat.unit)}
                        </div>
                        <div className="text-[9px] text-muted line-clamp-1">
                          {stat.qualifier || 'Evidence-linked report statistic'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 3. DYNAMIC THEME SELECTOR PILLS */}
            <div className="space-y-2 pt-1 border-t border-line/60">
              <div className="flex items-center justify-between text-[10px] font-mono text-muted uppercase tracking-wider font-bold">
                <span>Thematic Focus ({themes.length})</span>
                {selectedThemeId && (
                  <button
                    onClick={() => setSelectedThemeId(null)}
                    className="text-accent hover:underline capitalize"
                  >
                    View All
                  </button>
                )}
              </div>

              <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
                <button
                  onClick={() => setSelectedThemeId(null)}
                  className={`px-3 py-1.5 rounded-lg border text-[11px] font-mono whitespace-nowrap transition flex items-center gap-1.5 ${
                    selectedThemeId === null
                      ? 'border-accent bg-accent/15 text-accent font-bold'
                      : 'border-line bg-ink-950/60 text-muted hover:text-text'
                  }`}
                >
                  <span>All Findings</span>
                  <span className="text-[10px] opacity-70">({analysis.raw.findings.length})</span>
                </button>

                {themes.map((theme) => {
                  const isSel = selectedThemeId === theme.id;
                  const count =
                    theme.finding_ids?.length ||
                    theme.chapter_ids
                      .map((id) => analysis.chaptersById.get(id)?.finding_ids.length || 0)
                      .reduce((a, b) => a + b, 0);

                  return (
                    <button
                      key={theme.id}
                      onClick={() => setSelectedThemeId(isSel ? null : theme.id)}
                      className={`px-3 py-1.5 rounded-lg border text-[11px] font-mono whitespace-nowrap transition flex items-center gap-1.5 ${
                        isSel
                          ? 'border-indigo-400 bg-indigo-500/15 text-indigo-200 font-bold'
                          : 'border-line bg-ink-950/60 text-muted hover:text-text'
                      }`}
                    >
                      <span className="truncate max-w-[150px]">{theme.title}</span>
                      <span className="text-[10px] opacity-70">({count})</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 4. SEARCH / FILTER BAR */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-muted absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search statements, metrics, or scopes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-ink-950/80 border border-line rounded-lg pl-8 pr-3 py-1.5 text-xs text-text outline-none focus:border-accent font-mono"
              />
            </div>

            {/* 5. FINDINGS LIST */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-[10px] text-muted font-mono">
                <span>{filteredFindings.length} Grounded Findings</span>
                <span>Click to illuminate evidence</span>
              </div>

              {filteredFindings.map((finding) => {
                const isSel = selectedFindingId === finding.id;
                const statCallouts = (finding.stat_callout_ids || [])
                  .map((id) => analysis.calloutsById.get(id))
                  .filter(Boolean)
                  .slice(0, 3);

                return (
                  <div
                    key={finding.id}
                    onClick={() => setSelectedFindingId(isSel ? null : finding.id)}
                    className={`rounded-xl border p-3.5 text-left transition cursor-pointer ${
                      isSel
                        ? 'border-accent bg-ink-950/90 ring-1 ring-accent/30 shadow-soft'
                        : 'border-line/80 bg-ink-950/50 hover:bg-ink-950/80 hover:border-line'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-xs font-bold text-text font-sans leading-snug">
                        {finding.title}
                      </div>
                      <ChevronRight
                        className={`w-3.5 h-3.5 text-muted flex-shrink-0 mt-0.5 transition ${
                          isSel ? 'rotate-90 text-accent' : ''
                        }`}
                      />
                    </div>

                    <p className="mt-1.5 text-[11px] text-text font-sans leading-relaxed">
                      {finding.statement}
                    </p>

                    {/* Expanded details on select */}
                    {isSel && finding.why_it_matters && (
                      <div className="mt-2.5 p-2.5 rounded-lg bg-indigo-950/30 border border-indigo-500/20 text-[11px] text-indigo-200 font-sans leading-relaxed">
                        <span className="font-bold font-mono text-[10px] uppercase text-indigo-400 block mb-0.5">
                          Why It Matters:
                        </span>
                        {finding.why_it_matters}
                      </div>
                    )}

                    {/* Stat callouts attached to finding */}
                    {statCallouts.length > 0 && (
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {statCallouts.map((sc) => (
                          <div
                            key={sc!.id}
                            className="px-2 py-0.5 rounded bg-ink-900 border border-line text-[10px] font-mono flex items-center gap-1"
                          >
                            <span className="text-muted truncate max-w-[120px]">{sc!.label}:</span>
                            <span className="font-bold text-accent">
                              {formatValue(sc!.value, sc!.unit)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Interactive Spatial / Subsurface Action Buttons */}
                    <div
                      className="mt-3 pt-2 border-t border-line/60 flex items-center justify-between"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="text-[10px] text-muted capitalize">
                        {finding.basis.replace('_', ' ')}
                      </span>

                      <div className="flex items-center gap-1.5">
                        {finding.resolvedFeatureIds.length > 0 && (
                          <button
                            onClick={() => onFocusOnMap(finding)}
                            className="px-2 py-1 rounded bg-accent/20 hover:bg-accent text-accent hover:text-ink-950 border border-accent/30 text-[10px] font-mono font-bold transition flex items-center gap-1"
                            title="Highlight referenced objects on map"
                          >
                            <MapPinned className="w-3 h-3" />
                            <span>Map ({finding.resolvedFeatureIds.length})</span>
                          </button>
                        )}

                        {finding.resolvedIntervalIds.length > 0 && (
                          <button
                            onClick={() => onInspectIn3D(finding)}
                            className="px-2 py-1 rounded bg-amber/20 hover:bg-amber text-amber hover:text-ink-950 border border-amber/30 text-[10px] font-mono font-bold transition flex items-center gap-1"
                            title="Inspect depth in 3D Cutaway"
                          >
                            <Layers3 className="w-3 h-3" />
                            <span>3D Depth</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            </>
          )}
          </div>
        </div>
      </div>

      {/* SCIENTIFIC CAVEATS MODAL (UNCLUTTERED SECONDARY DRAWER) */}
      {showCaveatsModal && (
        <div
          className="fixed inset-0 z-50 bg-ink-950/70 backdrop-blur-sm flex justify-end pointer-events-auto"
          onClick={() => setShowCaveatsModal(false)}
        >
          <div
            className="w-full max-w-md bg-ink-900 border-l border-line h-full p-6 overflow-y-auto shadow-float flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-4 border-b border-line">
              <div className="flex items-center gap-2">
                <Info className="w-4 h-4 text-amber" />
                <h3 className="text-xs font-mono font-bold text-text uppercase tracking-wider">
                  Scientific Assumptions & Caveats ({analysis.uncertainties.length})
                </h3>
              </div>
              <button
                onClick={() => setShowCaveatsModal(false)}
                className="p-1 rounded text-muted hover:text-text"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="mt-4 text-xs text-muted font-sans leading-relaxed">
              Every scientific synthesis depends on source scope, extraction quality, measurement compatibility, and
              interpretation limits. Below are the report-level caveats, followed by {auditContextCount} detailed source-audit notes retained from the source package.
            </p>

            <div className="mt-5 space-y-3 flex-1">
              {analysis.uncertainties.map((u) => (
                <div
                  key={u.id}
                  className="rounded-xl border border-line bg-ink-950/70 p-3.5 text-xs text-text font-sans leading-relaxed"
                >
                  <div className="font-semibold text-amber mb-1 flex items-center gap-1.5 font-mono text-[10px]">
                    <span>•</span>
                    <span>Report Limitation</span>
                  </div>
                  {u.statement}
                </div>
              ))}
              {agentic && agentic.limitations.length > 0 && (
                <details className="rounded-xl border border-line bg-ink-950/50 p-3.5">
                  <summary className="cursor-pointer text-[10px] font-mono font-bold uppercase tracking-wider text-accent">
                    Source and rendering limitations ({agentic.limitations.length})
                  </summary>
                  <div className="mt-3 space-y-2">
                    {agentic.limitations.map((limitation, index) => <p key={`${index}:${limitation}`} className="text-xs leading-relaxed text-muted">{limitation}</p>)}
                  </div>
                </details>
              )}
              {agentic && agentic.unresolvedItems.length > 0 && (
                <details className="rounded-xl border border-line bg-ink-950/50 p-3.5">
                  <summary className="cursor-pointer text-[10px] font-mono font-bold uppercase tracking-wider text-violet-300">
                    Unresolved source items ({agentic.unresolvedItems.length})
                  </summary>
                  <div className="mt-3 space-y-2">
                    {agentic.unresolvedItems.map((item, index) => <p key={`${index}:${item}`} className="text-xs leading-relaxed text-muted">{item}</p>)}
                  </div>
                </details>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
