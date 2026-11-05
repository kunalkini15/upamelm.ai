import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowRight,
  BookOpen,
  ChevronRight,
  ExternalLink,
  Layers3,
  MapPinned,
  Search,
  Sparkles,
  ShieldAlert,
  Droplets,
  TrendingDown,
  Info,
  CheckCircle2,
  X,
  Compass,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
} from 'recharts';
import {
  ReportAnalysisModel,
  ReportFindingView,
  ReportTheme,
  ScientificUIModel,
  VisualizationCapability,
} from '../../types/scientific';
import { selectExecutiveCallouts } from '../../core/ReportAnalysis';

interface ReportInsightsProps {
  model: ScientificUIModel;
  analysis: ReportAnalysisModel;
  onShowMap: (finding: ReportFindingView) => void;
  onShow3D: (finding: ReportFindingView) => void;
  onReturnToExplore: () => void;
}

type ReportView = 'executive' | 'theme' | 'finding' | 'all-findings';

const THEME_ACCENTS = [
  { border: 'hover:border-accent/60', badge: 'bg-accent/10 text-accent border-accent/30', bar: '#35C4B5' },
  { border: 'hover:border-violet-500/60', badge: 'bg-violet-500/10 text-violet-300 border-violet-500/30', bar: '#C2A15C' },
  { border: 'hover:border-sky-500/60', badge: 'bg-sky-500/10 text-sky-300 border-sky-500/30', bar: '#2F82AD' },
  { border: 'hover:border-danger/60', badge: 'bg-danger/10 text-danger border-danger/30', bar: '#E06C5F' },
  { border: 'hover:border-amber/60', badge: 'bg-amber/10 text-amber border-amber/30', bar: '#E3B34E' },
  { border: 'hover:border-success/60', badge: 'bg-success/10 text-success border-success/30', bar: '#4CC38A' },
];

function formatValue(value: number | null | undefined, unit?: string | null) {
  if (value === null || value === undefined) return '—';
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}${unit ? ` ${unit}` : ''}`;
}

export const ReportInsights: React.FC<ReportInsightsProps> = ({
  model,
  analysis,
  onShowMap,
  onShow3D,
  onReturnToExplore,
}) => {
  const initialParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const initialThemeId = initialParams.get('theme') || undefined;
  const initialFindingId = initialParams.get('finding') || undefined;
  const initialView = (initialParams.get('view') as ReportView | null) || (initialFindingId ? 'finding' : initialThemeId ? 'theme' : 'executive');

  const [view, setView] = useState<ReportView>(['executive', 'theme', 'finding', 'all-findings'].includes(initialView) ? initialView : 'executive');
  const [selectedThemeId, setSelectedThemeId] = useState<string | undefined>(
    initialThemeId && analysis.themes.some((t) => t.id === initialThemeId) ? initialThemeId : undefined
  );
  const [selectedFindingId, setSelectedFindingId] = useState<string | undefined>(
    initialFindingId && analysis.findingsById.has(initialFindingId) ? initialFindingId : undefined
  );
  const [showCaveatsDrawer, setShowCaveatsDrawer] = useState(false);
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');

  const selectedFinding = selectedFindingId ? analysis.findingsById.get(selectedFindingId) || null : null;
  const selectedTheme = selectedThemeId ? analysis.themes.find((t) => t.id === selectedThemeId) : undefined;
  const selectedChapter = selectedTheme?.chapter_ids.map((id) => analysis.chaptersById.get(id)).find(Boolean);
  const themeFindings = useMemo(() => {
    if (!selectedTheme) return [];
    const fIds = selectedTheme.finding_ids || selectedChapter?.finding_ids || [];
    return fIds.map((id) => analysis.findingsById.get(id)).filter(Boolean) as ReportFindingView[];
  }, [selectedTheme, selectedChapter, analysis]);

  const executiveStats = useMemo(() => selectExecutiveCallouts(analysis, 4), [analysis]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set('mode', 'report');
    params.set('view', view);
    if (selectedThemeId) params.set('theme', selectedThemeId);
    else params.delete('theme');
    if (selectedFindingId) params.set('finding', selectedFindingId);
    else params.delete('finding');
    window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
  }, [view, selectedThemeId, selectedFindingId]);

  const selectTheme = (theme: ReportTheme) => {
    setSelectedThemeId(theme.id);
    setSelectedFindingId(undefined);
    setView('theme');
  };

  const openFinding = (finding: ReportFindingView) => {
    setSelectedFindingId(finding.id);
    setView('finding');
  };

  return (
    <div className="absolute inset-0 z-30 overflow-y-auto bg-ink-950 text-text flex flex-col">
      {/* Ambient gradient top glow for investor-grade polish */}
      <div className="pointer-events-none fixed inset-0 bg-transparent z-0" />

      {/* Main container */}
      <div className="relative z-10 mx-auto w-full max-w-7xl px-6 py-8 flex-1 flex flex-col">
        {/* Navigation Breadcrumb & Back bar */}
        <div className="flex items-center justify-between mb-6 pb-4 border-b border-line/80">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                if (view === 'finding') setView('theme');
                else if (view === 'theme' || view === 'all-findings') setView('executive');
                else onReturnToExplore();
              }}
              className="text-xs font-mono font-medium text-muted hover:text-accent transition flex items-center gap-1.5"
            >
              <span>←</span>
              <span>
                {view === 'finding'
                  ? 'Back to Theme'
                  : view === 'theme' || view === 'all-findings'
                  ? 'Back to Executive Overview'
                  : 'Return to District Map'}
              </span>
            </button>

            {selectedTheme && view !== 'executive' && (
              <>
                <span className="text-muted font-mono">/</span>
                <span className="text-xs font-mono text-accent font-bold truncate max-w-xs">
                  {selectedTheme.title}
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowCaveatsDrawer(true)}
              className="flex items-center gap-1.5 text-xs font-mono text-muted hover:text-amber bg-ink-900/80 hover:bg-ink-900 border border-line px-3 py-1.5 rounded-lg transition"
            >
              <Info className="w-3.5 h-3.5 text-amber" />
              <span>Scientific Caveats ({analysis.uncertainties.length})</span>
            </button>
            <button
              onClick={onReturnToExplore}
              className="flex items-center gap-1.5 text-xs font-mono font-bold text-ink-950 bg-accent hover:bg-accent px-3.5 py-1.5 rounded-lg transition shadow-soft"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Explore Geospatial Map</span>
            </button>
          </div>
        </div>

        {/* VIEW 1: EXECUTIVE BRIEFING (INVESTOR / DECISION-MAKER DECK) */}
        {view === 'executive' && (
          <div className="space-y-8 flex-1">
            {/* HERO BRIEFING BANNER */}
            <div className="relative rounded-3xl border border-line bg-ink-900 p-8 sm:p-10 shadow-float backdrop-blur-xl overflow-hidden">
              <div className="hidden" />

              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-indigo-400/30 bg-indigo-500/10 text-indigo-300 text-xs font-mono font-bold tracking-wide uppercase mb-4">
                <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                <span>Executive Synthesis • Gandhinagar NAQUIM</span>
              </div>

              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-text tracking-tight leading-tight max-w-4xl">
                {analysis.raw.executive_overview.headline}
              </h1>

              <p className="mt-4 text-base sm:text-lg text-text font-sans leading-relaxed max-w-4xl">
                {analysis.raw.executive_overview.abstract}
              </p>
            </div>

            {/* 4 HIGH-IMPACT METRIC TILES */}
            <div>
              <div className="text-xs font-mono uppercase tracking-widest text-muted mb-3 flex items-center gap-2">
                <Activity className="w-4 h-4 text-accent" />
                <span>Critical District Water Stress Indicators</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {executiveStats.map((stat, i) => {
                  if (!stat) return null;
                  const isCritical = typeof stat.value === 'number' && stat.value > 100;
                  const isSolution = String(stat.label).toLowerCase().includes('saving') || String(stat.label).toLowerCase().includes('post');
                  return (
                    <div
                      key={stat.id || i}
                      className="rounded-xl border border-line/90 bg-ink-900/80 p-5 shadow-soft flex flex-col justify-between"
                    >
                      <div className="text-[11px] font-mono text-muted font-semibold uppercase tracking-wider line-clamp-2">
                        {stat.label}
                      </div>

                      <div className="my-3">
                        <div
                          className={`text-3xl sm:text-4xl font-extrabold font-mono tracking-tight ${
                            isCritical
                              ? 'text-danger'
                              : isSolution
                              ? 'text-success'
                              : 'text-accent'
                          }`}
                        >
                          {formatValue(stat.value, stat.unit)}
                        </div>
                      </div>

                      <div className="text-[11px] font-sans text-muted leading-snug">
                        {stat.qualifier || (isCritical ? 'Exceeds sustainable extraction threshold' : 'Authoritative NAQUIM benchmark')}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 6 THEMATIC WORKSPACE DOSSIERS */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="text-xs font-mono uppercase tracking-widest text-muted flex items-center gap-2">
                  <Compass className="w-4 h-4 text-indigo-400" />
                  <span>Thematic Investigation Chapters (Select to Inspect)</span>
                </div>
                <button
                  onClick={() => setView('all-findings')}
                  className="text-xs font-mono text-accent hover:text-accent transition flex items-center gap-1"
                >
                  <span>Search All 121 Findings</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {analysis.themes.map((theme, idx) => {
                  const style = THEME_ACCENTS[idx % THEME_ACCENTS.length];
                  const findingCount =
                    theme.finding_ids?.length ||
                    theme.chapter_ids
                      .map((id) => analysis.chaptersById.get(id)?.finding_ids.length || 0)
                      .reduce((a, b) => a + b, 0);

                  return (
                    <button
                      key={theme.id}
                      onClick={() => selectTheme(theme)}
                      className={`group rounded-xl border border-line/90 bg-ink-900/60 hover:bg-ink-900/95 p-6 text-left transition-all duration-200 hover:-translate-y-1 shadow-soft ${style.border}`}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <span className={`text-[10px] font-mono font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border ${style.badge}`}>
                          Chapter {idx + 1}
                        </span>
                        <div className="text-xs font-mono text-muted group-hover:text-accent transition flex items-center gap-1">
                          <span>{findingCount} Insights</span>
                          <ChevronRight className="w-4 h-4" />
                        </div>
                      </div>

                      <h3 className="text-base font-bold text-text group-hover:text-accent transition line-clamp-2">
                        {theme.title}
                      </h3>

                      <p className="mt-2.5 text-xs text-muted font-sans leading-relaxed line-clamp-3">
                        {theme.summary}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* VIEW 2: THEME INTELLIGENCE (55/45 BALANCED WORKSPACE) */}
        {view === 'theme' && selectedTheme && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 flex-1">
            {/* LEFT 55%: NARRATIVE & PRIORITIZED FINDINGS */}
            <div className="lg:col-span-7 space-y-6">
              {/* Chapter Header Card */}
              <div className="rounded-xl border border-line bg-ink-900/90 p-6 shadow-panel">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-accent/10 border border-accent/20 text-accent text-[10px] font-mono font-bold uppercase tracking-wider mb-2">
                  Theme Investigation
                </div>
                <h2 className="text-2xl font-bold text-text">{selectedTheme.title}</h2>
                <p className="mt-3 text-sm text-text font-sans leading-relaxed">
                  {selectedChapter?.summary || selectedTheme.summary}
                </p>

                {selectedChapter?.narrative && (
                  <details className="mt-4 rounded-xl border border-line/80 bg-ink-950/60 p-3.5 group">
                    <summary className="cursor-pointer text-xs font-mono font-bold text-text hover:text-accent transition flex items-center justify-between">
                      <span>Detailed Scientific Narrative</span>
                      <span className="text-[10px] text-muted group-open:rotate-90 transition">▶</span>
                    </summary>
                    <p className="mt-3 text-xs text-muted font-sans leading-relaxed whitespace-pre-line border-t border-line/60 pt-3">
                      {selectedChapter.narrative}
                    </p>
                  </details>
                )}
              </div>

              {/* Finding Cards Header */}
              <div className="flex items-center justify-between pt-2">
                <div className="text-xs font-mono uppercase tracking-wider text-muted font-bold">
                  Core Scientific Findings ({themeFindings.length})
                </div>
                <button
                  onClick={() => setView('all-findings')}
                  className="text-xs font-mono text-accent hover:underline"
                >
                  View in search table →
                </button>
              </div>

              {/* Finding Cards List */}
              <div className="space-y-3.5">
                {themeFindings.map((finding) => {
                  const isSel = selectedFindingId === finding.id;
                  const statCallouts = (finding.stat_callout_ids || [])
                    .map((id) => analysis.calloutsById.get(id))
                    .filter(Boolean)
                    .slice(0, 2);

                  return (
                    <div
                      key={finding.id}
                      onClick={() => openFinding(finding)}
                      className={`rounded-xl border p-5 text-left transition-all cursor-pointer ${
                        isSel
                          ? 'border-accent bg-ink-900 shadow-soft ring-1 ring-accent/30'
                          : 'border-line bg-ink-900/60 hover:bg-ink-900/90 hover:border-line'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <h4 className="text-base font-bold text-text leading-snug">{finding.title}</h4>
                        <ChevronRight className="w-4 h-4 text-muted flex-shrink-0 mt-1" />
                      </div>

                      <p className="mt-2 text-xs text-text font-sans leading-relaxed line-clamp-2">
                        {finding.statement}
                      </p>

                      {/* Stat callout pills inside card */}
                      {statCallouts.length > 0 && (
                        <div className="mt-3.5 flex flex-wrap gap-2">
                          {statCallouts.map((sc) => (
                            <div
                              key={sc!.id}
                              className="px-2.5 py-1 rounded-lg bg-ink-950/80 border border-line text-[11px] font-mono flex items-center gap-1.5"
                            >
                              <span className="text-muted">{sc!.label}:</span>
                              <span className="font-bold text-accent">
                                {formatValue(sc!.value, sc!.unit)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Action buttons */}
                      <div className="mt-4 pt-3 border-t border-line/60 flex items-center justify-between text-xs font-mono">
                        <span className="text-[10px] text-muted capitalize">{finding.basis.replace('_', ' ')}</span>
                        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                          {finding.resolvedFeatureIds.length > 0 && (
                            <button
                              onClick={() => onShowMap(finding)}
                              className="px-2.5 py-1 rounded-md bg-ink-800 hover:bg-accent hover:text-ink-950 text-text text-[11px] font-mono font-medium transition flex items-center gap-1"
                            >
                              <MapPinned className="w-3 h-3" />
                              <span>Map ({finding.resolvedFeatureIds.length})</span>
                            </button>
                          )}
                          {finding.resolvedIntervalIds.length > 0 && (
                            <button
                              onClick={() => onShow3D(finding)}
                              className="px-2.5 py-1 rounded-md bg-ink-800 hover:bg-amber hover:text-ink-950 text-text text-[11px] font-mono font-medium transition flex items-center gap-1"
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
            </div>

            {/* RIGHT 45%: THEME DYNAMIC VISUAL STAGE */}
            <div className="lg:col-span-5 space-y-6">
              <div className="sticky top-6">
                <ThemeVisualStage
                  theme={selectedTheme}
                  finding={selectedFinding || themeFindings[0] || null}
                  analysis={analysis}
                  model={model}
                  onShowMap={onShowMap}
                  onShow3D={onShow3D}
                />
              </div>
            </div>
          </div>
        )}

        {/* VIEW 3: SINGLE FINDING DEEP-DIVE */}
        {view === 'finding' && selectedFinding && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 flex-1">
            <div className="lg:col-span-7 space-y-6">
              <div className="rounded-xl border border-line bg-ink-900/90 p-7 shadow-panel">
                <div className="flex items-center gap-2 text-[10px] font-mono font-bold uppercase tracking-wider text-muted mb-3">
                  <span className="px-2.5 py-0.5 rounded-full bg-accent/10 border border-accent/20 text-accent">
                    {selectedFinding.basis.replace('_', ' ')}
                  </span>
                  <span>•</span>
                  <span>{selectedFinding.confidence} confidence</span>
                </div>

                <h2 className="text-2xl sm:text-3xl font-extrabold text-text tracking-tight leading-snug">
                  {selectedFinding.title}
                </h2>

                <p className="mt-4 text-base text-text font-sans leading-relaxed">
                  {selectedFinding.statement}
                </p>

                {/* Why It Matters Callout Box */}
                {selectedFinding.why_it_matters && (
                  <div className="mt-6 rounded-xl border border-indigo-500/30 bg-indigo-950/20 p-5">
                    <div className="text-xs font-mono font-bold uppercase tracking-wider text-indigo-300 flex items-center gap-1.5 mb-2">
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Executive Significance & Impact</span>
                    </div>
                    <p className="text-xs sm:text-sm text-text font-sans leading-relaxed">
                      {selectedFinding.why_it_matters}
                    </p>
                  </div>
                )}

                {/* Quantitative statistics linked to this finding */}
                {selectedFinding.stat_callout_ids && selectedFinding.stat_callout_ids.length > 0 && (
                  <div className="mt-6 space-y-2">
                    <div className="text-xs font-mono uppercase tracking-wider text-muted font-bold">
                      Supporting Quantitative Metrics
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {(selectedFinding.stat_callout_ids || []).map((id) => {
                        const callout = analysis.calloutsById.get(id);
                        if (!callout) return null;
                        return (
                          <div
                            key={id}
                            className="rounded-xl border border-line bg-ink-950/80 p-4 flex flex-col justify-between"
                          >
                            <div className="text-[10px] font-mono text-muted uppercase tracking-wider font-semibold">
                              {callout.label}
                            </div>
                            <div className="text-xl font-bold font-mono text-accent my-1">
                              {formatValue(callout.value, callout.unit)}
                            </div>
                            {callout.qualifier && (
                              <div className="text-[10px] text-muted">{callout.qualifier}</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Direct Action Handoffs */}
                <div className="mt-8 pt-5 border-t border-line flex flex-wrap gap-3">
                  {selectedFinding.resolvedFeatureIds.length > 0 && (
                    <button
                      onClick={() => onShowMap(selectedFinding)}
                      className="px-4 py-2.5 rounded-xl bg-accent hover:bg-accent text-ink-950 text-xs font-mono font-bold transition flex items-center gap-2 shadow-soft"
                    >
                      <MapPinned className="w-4 h-4" />
                      <span>Isolate On Map ({selectedFinding.resolvedFeatureIds.length} Stations)</span>
                    </button>
                  )}
                  {selectedFinding.resolvedIntervalIds.length > 0 && (
                    <button
                      onClick={() => onShow3D(selectedFinding)}
                      className="px-4 py-2.5 rounded-xl bg-amber hover:bg-amber text-ink-950 text-xs font-mono font-bold transition flex items-center gap-2 shadow-soft"
                    >
                      <Layers3 className="w-4 h-4" />
                      <span>Inspect 3D Underground Horizon</span>
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Right side: visual context for this finding */}
            <div className="lg:col-span-5 space-y-6">
              <ThemeVisualStage
                theme={selectedTheme}
                finding={selectedFinding}
                analysis={analysis}
                model={model}
                onShowMap={onShowMap}
                onShow3D={onShow3D}
              />
            </div>
          </div>
        )}

        {/* VIEW 4: SEARCHABLE ALL-FINDINGS MATRIX */}
        {view === 'all-findings' && (
          <div className="rounded-xl border border-line bg-ink-900/90 p-6 shadow-panel flex-1">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-line">
              <div>
                <h3 className="text-xl font-bold text-text">All 121 Report Findings & Evidence Matrix</h3>
                <p className="text-xs text-muted mt-1">
                  Searchable, filterable scientific database with direct cross-references.
                </p>
              </div>

              <div className="w-full sm:w-72 relative">
                <Search className="w-4 h-4 text-muted absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Filter findings by text..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="w-full bg-ink-950 border border-line rounded-lg pl-9 pr-3 py-1.5 text-xs text-text outline-none focus:border-accent font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 mt-6">
              {Array.from(analysis.findingsById.values())
                .filter((f) => {
                  if (!query) return true;
                  const q = query.toLowerCase();
                  return (
                    f.title.toLowerCase().includes(q) ||
                    f.statement.toLowerCase().includes(q) ||
                    f.scope.toLowerCase().includes(q)
                  );
                })
                .map((f) => (
                  <div
                    key={f.id}
                    onClick={() => openFinding(f)}
                    className="rounded-xl border border-line/80 bg-ink-950/60 hover:bg-ink-950 p-4 text-left transition cursor-pointer hover:border-line"
                  >
                    <div className="text-sm font-bold text-text line-clamp-1">{f.title}</div>
                    <div className="text-xs text-muted line-clamp-2 mt-1.5 font-sans leading-relaxed">
                      {f.statement}
                    </div>
                    <div className="mt-3 flex items-center justify-between text-[11px] font-mono text-muted">
                      <span className="capitalize">{f.basis.replace('_', ' ')}</span>
                      <span className="text-accent hover:underline">Inspect →</span>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>

      {/* SCIENTIFIC CAVEATS & ASSUMPTIONS DRAWER */}
      {showCaveatsDrawer && (
        <div
          className="fixed inset-0 z-50 bg-ink-950/70 backdrop-blur-sm flex justify-end"
          onClick={() => setShowCaveatsDrawer(false)}
        >
          <div
            className="w-full max-w-lg bg-ink-900 border-l border-line h-full p-6 overflow-y-auto shadow-float flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-4 border-b border-line">
              <div className="flex items-center gap-2">
                <Info className="w-4 h-4 text-amber" />
                <h3 className="text-sm font-mono font-bold text-text uppercase tracking-wider">
                  Scientific Assumptions & Caveats
                </h3>
              </div>
              <button
                onClick={() => setShowCaveatsDrawer(false)}
                className="p-1 rounded text-muted hover:text-text"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="mt-4 text-xs text-muted font-sans leading-relaxed">
              In hydrogeology, field observations rely on boundary conditions, unmonitored extraction estimates, and
              geological modeling approximations. Below are the {analysis.uncertainties.length} explicit caveats
              identified across the NAQUIM report.
            </p>

            <div className="mt-5 space-y-3 flex-1">
              {analysis.uncertainties.map((u) => (
                <div
                  key={u.id}
                  className="rounded-xl border border-line bg-ink-950/70 p-3.5 text-xs text-text font-sans leading-relaxed"
                >
                  <div className="font-semibold text-amber/90 mb-1 flex items-center gap-1.5 font-mono text-[11px]">
                    <span>•</span>
                    <span>Domain Caveat</span>
                  </div>
                  {u.statement}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * THEME DYNAMIC VISUAL STAGE
 * Guarantees a polished, relevant visual is ALWAYS mounted on the right stage.
 */
function ThemeVisualStage({
  theme,
  finding,
  analysis,
  model,
  onShowMap,
  onShow3D,
}: {
  theme?: ReportTheme;
  finding: ReportFindingView | null;
  analysis: ReportAnalysisModel;
  model: ScientificUIModel;
  onShowMap: (f: ReportFindingView) => void;
  onShow3D: (f: ReportFindingView) => void;
}) {
  const title = (theme?.title || '').toLowerCase();

  // 1. WATER BUDGET & SCENARIOS (Waterfall / Comparison Bar)
  if (title.includes('supply') || title.includes('demand') || title.includes('balance') || title.includes('care')) {
    const budgetData = [
      { name: 'Irrigation Draft', value: 511.1, type: 'drain' },
      { name: 'Domestic / Ind.', value: 21.4, type: 'drain' },
      { name: 'Natural Recharge', value: 345.2, type: 'source' },
      { name: 'MIS Water Saving', value: 70.1, type: 'saving' },
    ];

    return (
      <div className="rounded-xl border border-line bg-ink-900/90 p-6 shadow-panel space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-line">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-amber font-bold">
              Quantitative Water Ledger
            </div>
            <h4 className="text-base font-bold text-text mt-1">Groundwater Draft vs Recharge Stress</h4>
          </div>
          <span className="px-2 py-0.5 rounded bg-danger/10 border border-danger/30 text-danger text-[10px] font-mono font-bold">
            113.5% Over-Draft
          </span>
        </div>

        <p className="text-xs text-muted font-sans leading-relaxed">
          Agricultural irrigation represents ~96% of total draft. Micro-irrigation on 46,726 ha is the single viable
          lever to bring extraction down to sustainable levels.
        </p>

        <div className="h-60 w-full pt-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={budgetData} margin={{ top: 10, right: 10, left: -20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1C262C" />
              <XAxis dataKey="name" tick={{ fill: '#7E8F89', fontSize: 10 }} />
              <YAxis tick={{ fill: '#7E8F89', fontSize: 10 }} unit=" MCM" />
              <Tooltip
                contentStyle={{ backgroundColor: '#0C1114', borderColor: '#1C262C', borderRadius: 8 }}
                itemStyle={{ color: '#5FB8D6' }}
              />
              <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                {budgetData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.type === 'drain' ? '#E06C5F' : entry.type === 'saving' ? '#4CC38A' : '#2F82AD'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="grid grid-cols-2 gap-2 text-center text-xs font-mono pt-2">
          <div className="p-2.5 rounded-xl bg-ink-950/70 border border-line">
            <div className="text-[10px] text-muted">Current Stage</div>
            <div className="text-sm font-bold text-danger">113.55%</div>
          </div>
          <div className="p-2.5 rounded-xl bg-ink-950/70 border border-line">
            <div className="text-[10px] text-muted">Projected Post-MIS</div>
            <div className="text-sm font-bold text-success">97.29%</div>
          </div>
        </div>
      </div>
    );
  }

  // 2. UNDERGROUND & STRATIGRAPHY (Interactive Depth Stack)
  if (title.includes('underground') || title.includes('layers') || title.includes('aquifer')) {
    const strata = [
      { name: 'Unconfined Aquifer (0–90m)', depth: '0–90m', color: 'border-accent/50 bg-accent/10 text-accent' },
      { name: 'Regional Aquitard I (Clay Seal)', depth: '90–120m', color: 'border-amber/50 bg-ink-850/30 text-amber' },
      { name: 'Confined Aquifer Group I', depth: '120–180m', color: 'border-blue-500/50 bg-blue-500/10 text-blue-300' },
      { name: 'Regional Aquitard II', depth: '180–210m', color: 'border-amber/50 bg-ink-850/30 text-amber' },
      { name: 'Deep Confined Aquifer Group II', depth: '210–300m+', color: 'border-indigo-500/50 bg-indigo-500/10 text-indigo-300' },
    ];

    return (
      <div className="rounded-xl border border-line bg-ink-900/90 p-6 shadow-panel space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-line">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-indigo-400 font-bold">
              Subterranean Architecture
            </div>
            <h4 className="text-base font-bold text-text mt-1">Stratigraphic Hydrogeological Profile</h4>
          </div>
          <button
            onClick={() => finding && onShow3D(finding)}
            className="px-3 py-1.5 rounded-lg bg-amber hover:bg-amber text-ink-950 font-mono text-xs font-bold transition flex items-center gap-1.5"
          >
            <Layers3 className="w-3.5 h-3.5" />
            <span>Launch 3D</span>
          </button>
        </div>

        <p className="text-xs text-muted font-sans leading-relaxed">
          Deep sedimentary alluvium thickening westward from 50m to over 400m, yielding major confined water below the
          protective regional clay caps.
        </p>

        <div className="space-y-2 pt-2">
          {strata.map((s, i) => (
            <div
              key={i}
              className={`p-3 rounded-xl border flex items-center justify-between font-mono text-xs ${s.color}`}
            >
              <span className="font-bold">{s.name}</span>
              <span className="text-[11px] opacity-80">{s.depth}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 3. WATER QUALITY & STRESS (Fluoride & Salinity Thresholds)
  if (title.includes('quality') || title.includes('usability')) {
    return (
      <div className="rounded-xl border border-line bg-ink-900/90 p-6 shadow-panel space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-line">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-danger font-bold">
              Chemical & Potability Profiling
            </div>
            <h4 className="text-base font-bold text-text mt-1">Water Usability Constraints</h4>
          </div>
        </div>

        <div className="space-y-3 pt-2">
          <div className="p-4 rounded-xl border border-line bg-ink-950/70 space-y-1.5">
            <div className="flex items-center justify-between text-xs font-mono font-bold">
              <span className="text-text">Fluoride Stress (High in localized pockets)</span>
              <span className="text-danger">&gt; 1.5 mg/L</span>
            </div>
            <p className="text-xs text-muted font-sans leading-relaxed">
              Specific villages in northern and eastern belts exceed permissible drinking limits, requiring deep
              casing isolation.
            </p>
          </div>

          <div className="p-4 rounded-xl border border-line bg-ink-950/70 space-y-1.5">
            <div className="flex items-center justify-between text-xs font-mono font-bold">
              <span className="text-text">Salinity Gradient (Westward Increase)</span>
              <span className="text-amber">EC &gt; 2000 µS/cm</span>
            </div>
            <p className="text-xs text-muted font-sans leading-relaxed">
              Electrical conductivity rises towards the western alluvial margins, constraining irrigation for
              salt-sensitive crops.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // 4. DEFAULT CONTEXTUAL STAGE (Referenced Stations & Evidence)
  const features = finding
    ? finding.resolvedFeatureIds.map((id) => model.featuresWithCoords.find((f) => f.id === id)).filter(Boolean)
    : [];

  return (
    <div className="rounded-xl border border-line bg-ink-900/90 p-6 shadow-panel space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-line">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-accent font-bold">
            Geographic Evidence
          </div>
          <h4 className="text-base font-bold text-text mt-1">Connected Field Stations</h4>
        </div>
        {features.length > 0 && finding && (
          <button
            onClick={() => onShowMap(finding)}
            className="px-3 py-1.5 rounded-lg bg-accent hover:bg-accent text-ink-950 font-mono text-xs font-bold transition flex items-center gap-1.5"
          >
            <MapPinned className="w-3.5 h-3.5" />
            <span>Map View</span>
          </button>
        )}
      </div>

      {features.length > 0 ? (
        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {features.map((f) => (
            <div
              key={f!.id}
              className="p-3 rounded-xl border border-line bg-ink-950/80 flex items-center justify-between text-xs font-mono"
            >
              <div className="truncate mr-2">
                <div className="font-bold text-text truncate">{f!.name}</div>
                <div className="text-[10px] text-muted capitalize">{f!.type.replace('_', ' ')}</div>
              </div>
              <span className="text-accent font-bold">{f!.totalDepthMeters ? `${f!.totalDepthMeters}m` : ''}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="p-6 rounded-xl border border-line/80 bg-ink-950/50 text-center space-y-2">
          <BookOpen className="w-6 h-6 text-muted mx-auto" />
          <div className="text-xs text-text font-bold">District-Wide Synthesis Finding</div>
          <p className="text-[11px] text-muted font-sans leading-relaxed">
            This finding represents a regional synthesis across all 4 talukas rather than a single borehole station.
          </p>
        </div>
      )}
    </div>
  );
}
