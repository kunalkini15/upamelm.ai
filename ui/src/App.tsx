import React, { Suspense, lazy, useState, useEffect, useRef, useCallback } from 'react';
import { PackageIngestion } from './core/PackageIngestion';
import {
  BootstrapResponse,
  SelectionParams,
  fetchBootstrap,
  resolveApiUrl,
} from './api/backend';
import {
  ScientificUIModel,
  RenderablePointFeature,
  RenderableInterval,
  ReportFindingView,
} from './types/scientific';
import { SeamlessMap, SeamlessMapHandle } from './components/map/SeamlessMap';
import { CityOverview } from './components/map/CityOverview';
import { FloatingHUD } from './components/hud/FloatingHUD';
import { ExecutiveDossierDrawer } from './components/report/ExecutiveDossierDrawer';
import { DocumentAnalysisDrawer } from './components/report/DocumentAnalysisDrawer';
import { StudySwitcher } from './components/hud/StudySwitcher';
import {
  Box,
  RotateCcw,
  Sparkles,
  Map as MapIcon,
  Compass,
  BookOpen,
  ArrowLeft,
} from 'lucide-react';

const SubsurfaceExplorer = lazy(() =>
  import('./components/scene/SubsurfaceExplorer').then((module) => ({
    default: module.SubsurfaceExplorer,
  }))
);
const EvidenceWorkspace = lazy(() =>
  import('./components/evidence/EvidenceWorkspace').then((module) => ({
    default: module.EvidenceWorkspace,
  }))
);

export function App() {
  const [model, setModel] = useState<ScientificUIModel | null>(null);
  const modelRef = useRef<ScientificUIModel | null>(null);
  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [cityOverview, setCityOverview] = useState(() => !new URLSearchParams(window.location.search).has('city'));
  const requestController = useRef<AbortController | null>(null);
  const retrySelection = useRef<SelectionParams>({});

  // Selection state
  const [selectedFeature, setSelectedFeature] = useState<RenderablePointFeature | null>(null);
  const [selectedInterval, setSelectedInterval] = useState<RenderableInterval | null>(null);
  const [reportHighlightedFeatureIds, setReportHighlightedFeatureIds] = useState<string[]>([]);
  const [subsurfaceFocusFinding, setSubsurfaceFocusFinding] = useState<{ title: string; intervalIds: string[]; featureIds: string[] } | null>(null);

  // Primary view modes: Map vs 3D Subsurface
  const [mode, setMode] = useState<'map' | 'subsurface' | 'analysis'>('map');
  const modeRef = useRef<'map' | 'subsurface' | 'analysis'>('map');
  const [activeLayerIds, setActiveLayerIds] = useState<string[]>([]);
  const explorerOpen = mode === 'subsurface';

  // Map zoom level tracking to drive macro vs regional analysis visibility
  const [mapZoom, setMapZoom] = useState<number>(5.5);

  // Floating Executive Dossier Drawer manual toggle / override
  const [userDismissedDossier, setUserDismissedDossier] = useState(false);

  // Dossier visibility rule:
  // Visible in 2D Map mode when zoomed into the regional study area (zoom >= 7.5),
  // as long as the user hasn't explicitly clicked close on the drawer,
  // and no single station HUD is active.
  const isDossierOpen = Boolean(
    mode === 'map' &&
    mapZoom >= 7.5 &&
    !selectedFeature &&
    !userDismissedDossier &&
    (model?.documentAnalysis || model?.reportAnalysis)
  );

  const mapRef = useRef<SeamlessMapHandle>(null);

  const loadSelection = useCallback(async (
    requested: SelectionParams,
    historyMode: 'push' | 'replace' | 'none' = 'none',
  ) => {
      const overviewRequested = !requested.city;
      requestController.current?.abort();
      const controller = new AbortController();
      requestController.current = controller;
      retrySelection.current = requested;
      const hasExistingModel = Boolean(modelRef.current);
      if (historyMode !== 'none') updateSemanticUrl(requested, historyMode);
      try {
        if (hasExistingModel) setSwitching(true);
        else setLoading(true);
        setSwitchError(null);
        setError(null);
        const payload = await fetchBootstrap(requested, controller.signal);
        const parsed = PackageIngestion.parse(payload.package, {
          sourceBaseUrl: resolveApiUrl(payload.assetBaseUrl),
        });
        if (controller.signal.aborted) return;
        console.info(`Loaded ${parsed.packageFamily} package for ${payload.selection.study} (${payload.selection.language})`);
        modelRef.current = parsed;
        setModel(parsed);
        setBootstrap(payload);
        setCityOverview(overviewRequested);
        setActiveLayerIds((parsed.agentic?.layers || []).filter((layer) => layer.default_visible !== false).map((layer) => layer.id));
        setSelectedFeature(null);
        setSelectedInterval(null);
        setReportHighlightedFeatureIds([]);
        setSubsurfaceFocusFinding(null);
        setCapturedSurfaceCanvas(null);
        setUserDismissedDossier(false);
        setMapZoom(5.5);
        const hasSpatial = parsed.capabilities.some((item) => ['point-map', 'line-map', 'polygon-map', 'raster-overlay'].includes(item.id) && item.available);
        // On the initial load, honor a deep-linked view. During an in-app study or
        // language switch, preserve the view the user is actually looking at. The
        // URL can otherwise contain a stale 3D mode from an earlier navigation.
        const requestedMode = hasExistingModel && historyMode !== 'none'
          ? modeRef.current
          : new URLSearchParams(window.location.search).get('mode');
        const has3D = parsed.capabilities.some((item) => ['surface-markers', 'vertical-profiles', 'cross-sections'].includes(item.id) && item.available);
        const hasAnalysis = Boolean(parsed.documentAnalysis || parsed.reportAnalysis);
        const nextMode = requestedMode === 'subsurface' && has3D
          ? 'subsurface'
          : requestedMode === 'analysis' && hasAnalysis
            ? 'analysis'
            : hasSpatial
              ? 'map'
              : 'analysis';
        modeRef.current = nextMode;
        setMode(nextMode);
        updateViewModeInUrl(nextMode, 'replace');
        updateSemanticUrl(overviewRequested ? {} : payload.selection, 'replace');
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        console.error('Failed to parse scientific package:', err);
        const message = err?.message || 'Unknown backend error';
        if (modelRef.current) setSwitchError(message);
        else setError(message);
      } finally {
        if (requestController.current === controller) {
          setLoading(false);
          setSwitching(false);
        }
      }
  }, []);

  const handleSelectCity = useCallback((city: string) => {
    void loadSelection({ city }, 'push');
  }, [loadSelection]);

  // The API is the single runtime source for catalog metadata and scientific packages.
  useEffect(() => {
    void loadSelection(selectionFromUrl(), 'none');
    const handlePopState = () => void loadSelection(selectionFromUrl(), 'none');
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      requestController.current?.abort();
    };
  }, [loadSelection]);

  // Captured map canvas for continuous 3D world terrain
  const [capturedSurfaceCanvas, setCapturedSurfaceCanvas] = useState<HTMLCanvasElement | null>(null);

  const handleOpenExplorer = async (feature?: RenderablePointFeature) => {
    // A direct Map → 3D transition is not a report handoff.
    setSubsurfaceFocusFinding(null);
    if (feature) setSelectedFeature(feature);
    if (model && mapRef.current) {
      try {
        const cropped = await mapRef.current.captureAlignedCrop(model.studyAreaPolygon, 700, 200);
        if (cropped) {
          setCapturedSurfaceCanvas(cropped);
        }
      } catch (e) {
        console.warn('Map capture failed, using fallback grid:', e);
      }
    }
    modeRef.current = 'subsurface';
    setMode('subsurface');
    updateViewModeInUrl('subsurface', 'push');
  };

  const handleCloseExplorer = () => {
    setSubsurfaceFocusFinding(null);
    modeRef.current = 'map';
    setMode('map');
    updateViewModeInUrl('map', 'push');
  };

  const handleModeChange = (nextMode: 'map' | 'subsurface' | 'analysis') => {
    if (nextMode === 'subsurface') {
      void handleOpenExplorer(selectedFeature || undefined);
      return;
    }
    modeRef.current = nextMode;
    setMode(nextMode);
    updateViewModeInUrl(nextMode, 'push');
  };

  const handleReportMap = (finding: ReportFindingView) => {
    setReportHighlightedFeatureIds(finding.resolvedFeatureIds);
    const target = finding.resolvedFeatureIds.length === 1
      ? model?.featuresWithCoords.find((feature) => feature.id === finding.resolvedFeatureIds[0])
      : undefined;
    if (target) {
      setSelectedFeature(target);
      window.setTimeout(() => mapRef.current?.flyToFeature(target), 0);
    } else {
      window.setTimeout(() => mapRef.current?.fitToFeatures(finding.resolvedFeatureIds), 0);
    }
    modeRef.current = 'map';
    setMode('map');
    updateViewModeInUrl('map', 'push');
  };

  const handleReport3D = (finding: ReportFindingView) => {
    setSubsurfaceFocusFinding({ title: finding.title, intervalIds: finding.resolvedIntervalIds, featureIds: finding.resolvedFeatureIds });
    const target = finding.resolvedFeatureIds.length > 0
      ? model?.featuresWithCoords.find((feature) => feature.id === finding.resolvedFeatureIds[0])
      : undefined;
    void openFocusedExplorer(target);
  };

  async function openFocusedExplorer(feature?: RenderablePointFeature) {
    if (feature) setSelectedFeature(feature);
    if (model && mapRef.current) {
      try {
        const cropped = await mapRef.current.captureAlignedCrop(model.studyAreaPolygon, 700, 200);
        if (cropped) setCapturedSurfaceCanvas(cropped);
      } catch (e) {
        console.warn('Map capture failed, using fallback grid:', e);
      }
    }
    modeRef.current = 'subsurface';
    setMode('subsurface');
    updateViewModeInUrl('subsurface', 'push');
  }

  const handleReturnToExplore = () => {
    setReportHighlightedFeatureIds([]);
    setSelectedFeature(null);
    setSelectedInterval(null);
    handleModeChange('map');
  };

  if (loading) {
    return (
      <div className="w-screen h-screen flex flex-col items-center justify-center bg-ink-950 text-text">
        <div className="w-10 h-10 border-4 border-accent border-t-transparent rounded-full animate-spin mb-4" />
        <h2 className="text-base font-semibold tracking-wide font-mono">INITIALIZING EVIDENCE WORKSPACE</h2>
        <p className="text-xs text-muted font-mono mt-1">Negotiating package capabilities...</p>
      </div>
    );
  }

  if (error || !model) {
    return (
      <div className="w-screen h-screen flex flex-col items-center justify-center bg-ink-950 text-danger p-8">
        <h2 className="text-xl font-bold">Failed to load scientific model</h2>
        <p className="text-xs font-mono mt-2 text-muted">{error}</p>
      </div>
    );
  }

  if (cityOverview && bootstrap) {
    return (
      <CityOverview
        cities={bootstrap.cities}
        loading={switching}
        error={switchError}
        onSelectCity={handleSelectCity}
        onRetry={() => void loadSelection(retrySelection.current, 'none')}
        onDismissError={() => setSwitchError(null)}
      />
    );
  }

  const hasSpatial = model.capabilities.some((item) => ['point-map', 'line-map', 'polygon-map', 'raster-overlay'].includes(item.id) && item.available);
  const has3D = model.capabilities.some((item) => ['surface-markers', 'vertical-profiles', 'cross-sections'].includes(item.id) && item.available);
  const hasAnalysis = Boolean(model.documentAnalysis || model.reportAnalysis);

  return (
    <div className="w-screen h-screen flex flex-col bg-ink-950 overflow-hidden select-none relative">
      {/* Clean & Minimal Top Bar */}
      <header className="h-14 bg-ink-950/90 backdrop-blur-md border-b border-line px-5 flex items-center justify-between z-50">
        {/* Left: Branding & Report Title */}
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-accent flex items-center justify-center shadow-soft">
            <Box className="w-4 h-4 text-ink-950 stroke-[2.5]" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-text flex items-center gap-1.5">
              Upamelm.ai
            </h1>
            <div className="text-[11px] text-muted font-mono">Maps to What's Underneath</div>
          </div>
        </div>

        {/* Center: Primary 2-Way View Switcher + Dossier Button */}
        <div className="flex items-center gap-3">
          <div className="flex items-center bg-ink-950/90 p-1 rounded-xl border border-line shadow-inner">
            <button
              disabled={!hasSpatial}
              title={!hasSpatial ? 'No validated spatial evidence is available in this package.' : undefined}
              onClick={() => handleModeChange('map')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-mono font-bold transition ${
                mode === 'map'
                  ? 'bg-accent text-ink-950 shadow-soft'
                  : hasSpatial ? 'text-muted hover:text-text' : 'text-slate-700 cursor-not-allowed'
              }`}
            >
              <MapIcon className="w-3.5 h-3.5" />
              <span>Map View</span>
            </button>

            {has3D && <button
              onClick={() => handleModeChange('subsurface')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-mono font-bold transition ${
                mode === 'subsurface'
                  ? 'bg-amber text-ink-950 shadow-soft'
                  : 'text-muted hover:text-text'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{model.capabilities.some((item) => item.id === 'vertical-profiles' && item.available) ? '3D Profiles' : 'Spatial 3D'}</span>
            </button>}

            <button
              disabled={!hasAnalysis}
              title={!hasAnalysis ? 'No report-level analysis is available in this package.' : undefined}
              onClick={() => handleModeChange('analysis')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-mono font-bold transition ${
                mode === 'analysis'
                  ? 'bg-accent-strong text-ink-950 shadow-soft'
                  : hasAnalysis ? 'text-muted hover:text-text' : 'text-slate-700 cursor-not-allowed'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>Analysis</span>
            </button>

          </div>
        </div>

        {/* Right: Quick actions & Reset */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => {
              setCityOverview(true);
              setSwitchError(null);
              updateSemanticUrl({}, 'push');
            }}
            className="hidden xl:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-line bg-ink-900 text-[11px] font-mono text-muted transition hover:text-text"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            All cities
          </button>
          <a href="/about" className="hidden xl:flex items-center px-2.5 py-1.5 text-[11px] font-mono text-muted transition hover:text-accent">Our story</a>
          {bootstrap && <StudySwitcher
            bootstrap={bootstrap}
            disabled={switching}
            onChange={(selection) => void loadSelection(selection, 'push')}
          />}
          {mode === 'map' && (
            <button
              onClick={() => {
                mapRef.current?.resetView();
                setSelectedFeature(null);
                setReportHighlightedFeatureIds([]);
                setUserDismissedDossier(false);
                setMapZoom(5.5);
              }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-ink-900 hover:bg-ink-800 border border-line text-muted hover:text-text transition text-xs font-mono"
              title="Reset Map View"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Viewport */}
      <div className="flex-1 w-full h-full relative overflow-hidden">
        {switching && (
          <div className="absolute inset-x-0 top-0 z-[70] flex justify-center pointer-events-none">
            <div className="mt-3 flex items-center gap-2 rounded-full border border-accent/30 bg-ink-950/90 px-4 py-2 text-[11px] font-mono text-accent shadow-soft backdrop-blur-md">
              <span className="w-3 h-3 rounded-full border-2 border-accent border-t-transparent animate-spin" />
              Loading selected study…
            </div>
          </div>
        )}
        {switchError && !switching && (
          <div className="absolute right-4 top-4 z-[70] max-w-md rounded-xl border border-danger/40 bg-ink-950/95 p-4 shadow-soft backdrop-blur-md">
            <div className="text-xs font-semibold text-danger">Unable to load the selected study</div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted">{switchError}</p>
            <div className="mt-3 flex gap-2">
              <button onClick={() => void loadSelection(retrySelection.current, 'none')} className="rounded-lg bg-accent px-3 py-1.5 text-[11px] font-semibold text-ink-950">Retry</button>
              <button onClick={() => setSwitchError(null)} className="rounded-lg border border-line px-3 py-1.5 text-[11px] text-muted">Dismiss</button>
            </div>
          </div>
        )}
        {/* Layer 1: Seamless Geographic Basemap */}
        <SeamlessMap
          ref={mapRef}
          features={model.featuresWithCoords}
          spatialFeatures={model.spatialFeatures}
          regionalSlabs={model.regionalSlabs}
          selectedFeatureId={selectedFeature?.id || null}
          highlightedFeatureIds={reportHighlightedFeatureIds}
          onSelectFeature={(feat) => {
            setSelectedFeature(feat);
            setSelectedInterval(null);
            mapRef.current?.flyToFeature(feat);
          }}
          onSelectSpatialFeature={(feature) => {
            setReportHighlightedFeatureIds([feature.id]);
            mapRef.current?.fitToFeatures([feature.id]);
          }}
          onSelectInterval={setSelectedInterval}
          onZoomChange={(z) => {
            setMapZoom(z);
            if (z < 7.5) {
              setUserDismissedDossier(false);
            }
          }}
          onExitLocalView={() => {
            setSelectedFeature(null);
            setSelectedInterval(null);
          }}
          onEnterSubsurface={has3D ? handleOpenExplorer : undefined}
          center={model.bounds.center}
          bounds={model.bounds}
          studyAreaPolygon={model.studyAreaPolygon}
          studyAreaName={model.studyAreaName}
          nativeAssets={model.nativeAssets}
          sourceBaseUrl={model.sourceBaseUrl}
          activeLayerIds={activeLayerIds}
        />

        {/* Floating HUD Tray (When on Map View with selected station) */}
        {mode === 'map' && (
          <FloatingHUD
            feature={selectedFeature}
            selectedInterval={selectedInterval}
            onSelectInterval={setSelectedInterval}
            onCloseFeature={() => {
              setSelectedFeature(null);
            }}
            model={model}
          />
        )}

        {/* Dedicated 3D Subsurface Cutaway Explorer */}
        {explorerOpen && (
          <Suspense
            fallback={
              <div className="absolute inset-0 z-40 grid place-items-center bg-ink-950 text-accent font-mono text-xs">
                <div className="flex items-center gap-3">
                  <span className="w-5 h-5 rounded-full border-2 border-accent border-t-transparent animate-spin" />
                  Preparing 3D cutaway…
                </div>
              </div>
            }
          >
            <SubsurfaceExplorer
              model={model}
              selectedFeature={selectedFeature}
              onSelectFeature={setSelectedFeature}
              onClose={handleCloseExplorer}
              surfaceCanvas={capturedSurfaceCanvas}
              focusFinding={subsurfaceFocusFinding}
            />
          </Suspense>
        )}

        {mode === 'analysis' && (
          <Suspense fallback={<div className="absolute inset-0 z-40 grid place-items-center bg-ink-950 text-accent font-mono text-xs">Preparing evidence workspace…</div>}>
            <EvidenceWorkspace
              model={model}
              initialTab={(model.documentAnalysis || model.reportAnalysis) ? 'report' : model.quantitativeSeries.length ? 'quantitative' : model.preservedDatasets.length ? 'resources' : model.nativeAssets.length ? 'assets' : 'extensions'}
              activeFeatureId={selectedFeature?.id || null}
              onSelectFeature={(id) => {
                setReportHighlightedFeatureIds([id]);
                const feature = model.featuresWithCoords.find((item) => item.id === id);
                if (feature) {
                  setSelectedFeature(feature);
                  handleModeChange('map');
                  window.setTimeout(() => mapRef.current?.flyToFeature(feature), 0);
                } else {
                  handleModeChange('map');
                  window.setTimeout(() => mapRef.current?.fitToFeatures([id]), 0);
                }
              }}
              onClose={() => handleModeChange('map')}
            />
          </Suspense>
        )}

        {/* Floating Executive Dossier Drawer (Grounded on Map View during regional inspection) */}
        {model.documentAnalysis && mode === 'map' && (
          <DocumentAnalysisDrawer
            analysis={model.documentAnalysis}
            isOpen={isDossierOpen}
            onClose={() => setUserDismissedDossier(true)}
            onReadMore={() => handleModeChange('analysis')}
          />
        )}
        {model.reportAnalysis && mode === 'map' && (
          <ExecutiveDossierDrawer
            model={model}
            analysis={model.reportAnalysis}
            isOpen={isDossierOpen}
            onClose={() => setUserDismissedDossier(true)}
            onFocusOnMap={handleReportMap}
            onInspectIn3D={handleReport3D}
            currentMode={mode}
            focusedFeature={null}
          />
        )}
      </div>
    </div>
  );
}

function selectionFromUrl(): SelectionParams {
  const params = new URLSearchParams(window.location.search);
  return {
    city: params.get('city') || undefined,
    study: params.get('study') || undefined,
    language: params.get('language') || undefined,
  };
}

function updateSemanticUrl(selection: SelectionParams, mode: 'push' | 'replace') {
  const url = new URL(window.location.href);
  url.searchParams.delete('package');
  for (const key of ['city', 'study', 'language'] as const) {
    const value = selection[key];
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  if (!selection.city) url.searchParams.delete('mode');
  window.history[mode === 'push' ? 'pushState' : 'replaceState']({}, '', url);
}

function updateViewModeInUrl(viewMode: 'map' | 'subsurface' | 'analysis', historyMode: 'push' | 'replace') {
  const url = new URL(window.location.href);
  if (viewMode === 'map') url.searchParams.delete('mode');
  else url.searchParams.set('mode', viewMode);
  window.history[historyMode === 'push' ? 'pushState' : 'replaceState']({}, '', url);
}

export default App;
