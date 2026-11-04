import React, { Suspense, lazy, useState, useEffect, useRef } from 'react';
import { PackageIngestion } from './core/PackageIngestion';
import {
  ScientificUIModel,
  RenderablePointFeature,
  RenderableInterval,
  ReportFindingView,
} from './types/scientific';
import { SeamlessMap, SeamlessMapHandle } from './components/map/SeamlessMap';
import { FloatingHUD } from './components/hud/FloatingHUD';
import { ExecutiveDossierDrawer } from './components/report/ExecutiveDossierDrawer';
import {
  Box,
  RotateCcw,
  Sparkles,
  Map as MapIcon,
  Compass,
} from 'lucide-react';

const SubsurfaceExplorer = lazy(() =>
  import('./components/scene/SubsurfaceExplorer').then((module) => ({
    default: module.SubsurfaceExplorer,
  }))
);

export function App() {
  const [model, setModel] = useState<ScientificUIModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selection state
  const [selectedFeature, setSelectedFeature] = useState<RenderablePointFeature | null>(null);
  const [selectedInterval, setSelectedInterval] = useState<RenderableInterval | null>(null);
  const [reportHighlightedFeatureIds, setReportHighlightedFeatureIds] = useState<string[]>([]);
  const [subsurfaceFocusFinding, setSubsurfaceFocusFinding] = useState<{ title: string; intervalIds: string[]; featureIds: string[] } | null>(null);

  // Primary view modes: Map vs 3D Subsurface
  const [mode, setMode] = useState<'map' | 'subsurface'>('map');
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
    model?.reportAnalysis
  );

  const mapRef = useRef<SeamlessMapHandle>(null);

  // Load Consolidated UI Package (single source of truth)
  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const requestedPackage = new URLSearchParams(window.location.search).get('package');
        const candidates = uniquePackageCandidates([
          requestedPackage,
          '/study_package.json',
          '/ui_consolidated_package.json',
          '/scientific_package.json',
        ]);
        let json: unknown;
        let loadedFrom = '';
        for (const candidate of candidates) {
          const response = await fetch(candidate);
          if (!response.ok) continue;
          json = await response.json();
          loadedFrom = candidate;
          break;
        }
        if (!json) throw new Error(`Failed to load a supported package from: ${candidates.join(', ')}`);
        const parsed = PackageIngestion.parse(json);
        console.info(`Loaded ${parsed.packageFamily} package from ${loadedFrom}`);
        setModel(parsed);
      } catch (err: any) {
        console.error('Failed to parse scientific package:', err);
        setError(err.message || 'Unknown error');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

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
    setMode('subsurface');
    const params = new URLSearchParams(window.location.search);
    params.set('mode', 'subsurface');
    window.history.pushState({}, '', `${window.location.pathname}?${params.toString()}`);
  };

  const handleCloseExplorer = () => {
    setSubsurfaceFocusFinding(null);
    setMode('map');
  };

  const handleModeChange = (nextMode: 'map' | 'subsurface') => {
    if (nextMode === 'subsurface') {
      void handleOpenExplorer(selectedFeature || undefined);
      return;
    }
    setMode('map');
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
    setMode('map');
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
    setMode('subsurface');
    const params = new URLSearchParams(window.location.search);
    params.set('mode', 'subsurface');
    window.history.pushState({}, '', `${window.location.pathname}?${params.toString()}`);
  }

  const handleReturnToExplore = () => {
    setReportHighlightedFeatureIds([]);
    setSelectedFeature(null);
    setSelectedInterval(null);
    handleModeChange('map');
  };

  if (loading) {
    return (
      <div className="w-screen h-screen flex flex-col items-center justify-center bg-slate-950 text-slate-200">
        <div className="w-10 h-10 border-4 border-cyan-400 border-t-transparent rounded-full animate-spin mb-4" />
        <h2 className="text-base font-semibold tracking-wide font-mono">INITIALIZING SUBSURFACE DIGITAL TWIN</h2>
        <p className="text-xs text-slate-500 font-mono mt-1">Loading report data...</p>
      </div>
    );
  }

  if (error || !model) {
    return (
      <div className="w-screen h-screen flex flex-col items-center justify-center bg-slate-950 text-rose-400 p-8">
        <h2 className="text-xl font-bold">Failed to load scientific model</h2>
        <p className="text-xs font-mono mt-2 text-slate-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="w-screen h-screen flex flex-col bg-slate-950 overflow-hidden select-none relative">
      {/* Clean & Minimal Top Bar */}
      <header className="h-14 bg-slate-950/90 backdrop-blur-md border-b border-slate-800/80 px-5 flex items-center justify-between z-50">
        {/* Left: Branding & Report Title */}
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center shadow-[0_0_15px_rgba(6,182,212,0.4)]">
            <Box className="w-4 h-4 text-slate-950 stroke-[2.5]" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-slate-100 flex items-center gap-1.5">
              SUBSURFACE <span className="text-cyan-400">v2</span>
            </h1>
            <div className="text-[11px] text-slate-400 font-mono">Universal Spatial-Temporal Digital Twin</div>
          </div>
        </div>

        {/* Center: Primary 2-Way View Switcher + Dossier Button */}
        <div className="flex items-center gap-3">
          <div className="flex items-center bg-slate-950/90 p-1 rounded-xl border border-slate-800 shadow-inner">
            <button
              onClick={() => handleModeChange('map')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-mono font-bold transition ${
                mode === 'map'
                  ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <MapIcon className="w-3.5 h-3.5" />
              <span>Map View</span>
            </button>

            <button
              onClick={() => handleModeChange('subsurface')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-mono font-bold transition ${
                mode === 'subsurface'
                  ? 'bg-amber-400 text-slate-950 shadow-md shadow-amber-400/20'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>3D Subsurface</span>
            </button>
          </div>
        </div>

        {/* Right: Quick actions & Reset */}
        <div className="flex items-center gap-2.5">
          {mode === 'map' && (
            <button
              onClick={() => {
                mapRef.current?.resetView();
                setSelectedFeature(null);
                setReportHighlightedFeatureIds([]);
                setUserDismissedDossier(false);
                setMapZoom(5.5);
              }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-slate-400 hover:text-slate-200 transition text-xs font-mono"
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
        {/* Layer 1: Seamless Geographic Basemap */}
        <SeamlessMap
          ref={mapRef}
          features={model.featuresWithCoords}
          regionalSlabs={model.regionalSlabs}
          selectedFeatureId={selectedFeature?.id || null}
          highlightedFeatureIds={reportHighlightedFeatureIds}
          onSelectFeature={(feat) => {
            setSelectedFeature(feat);
            setSelectedInterval(null);
            mapRef.current?.flyToFeature(feat);
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
          onEnterSubsurface={handleOpenExplorer}
          center={model.bounds.center}
          bounds={model.bounds}
          studyAreaPolygon={model.studyAreaPolygon}
          studyAreaName={model.studyAreaName}
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
              <div className="absolute inset-0 z-40 grid place-items-center bg-slate-950 text-cyan-300 font-mono text-xs">
                <div className="flex items-center gap-3">
                  <span className="w-5 h-5 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
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

        {/* Floating Executive Dossier Drawer (Grounded on Map View during regional inspection) */}
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

function uniquePackageCandidates(values: Array<string | null>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

export default App;
