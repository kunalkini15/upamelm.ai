import React, { useState, useEffect, useRef } from 'react';
import { ScientificPackageLoader } from './core/ScientificPackageLoader';
import {
  ScientificUIModel,
  RenderablePointFeature,
  RenderableInterval,
} from './types/scientific';
import { SeamlessMap, SeamlessMapHandle } from './components/map/SeamlessMap';
import { SubsurfaceExplorer } from './components/scene/SubsurfaceExplorer';
import { FloatingHUD } from './components/hud/FloatingHUD';
import {
  Box,
  RotateCcw,
  Sparkles,
  Map as MapIcon,
} from 'lucide-react';

export function App() {
  const [model, setModel] = useState<ScientificUIModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selection state
  const [selectedFeature, setSelectedFeature] = useState<RenderablePointFeature | null>(null);
  const [selectedInterval, setSelectedInterval] = useState<RenderableInterval | null>(null);

  // Subsurface Mode: true = 3D subterranean cutaway, false = 2D cartography
  const [explorerOpen, setExplorerOpen] = useState(false);

  // Map state
  const [zoomLevel, setZoomLevel] = useState(10.2);
  const [pitchAngle, setPitchAngle] = useState(0);

  const mapRef = useRef<SeamlessMapHandle>(null);

  // Load Consolidated UI Package (single source of truth)
  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        // Load ui_consolidated_package.json with fallback to scientific_package.json
        let res = await fetch('/ui_consolidated_package.json');
        if (!res.ok) {
          res = await fetch('/scientific_package.json');
        }
        if (!res.ok) throw new Error(`HTTP Error ${res.status}: Failed to load package`);
        const json = await res.json();
        const parsed = ScientificPackageLoader.parse(json);
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
    setExplorerOpen(true);
  };

  const handleCloseExplorer = () => {
    setExplorerOpen(false);
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
            <div className="text-[11px] text-slate-400 font-mono">{model.shortTitle}</div>
          </div>
        </div>

        {/* Center: Clean Mode Indicator Pill */}
        <div className="flex items-center gap-2 bg-slate-900/80 px-3 py-1 rounded-full border border-slate-800 text-xs font-mono">
          <span
            className={`w-2 h-2 rounded-full ${
              explorerOpen
                ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]'
                : 'bg-cyan-400'
            }`}
          />
          <span className="text-slate-300">
            {explorerOpen ? '3D Subsurface Cutaway' : 'District Map'}
          </span>
          <span className="text-slate-600">•</span>
          <span className="text-slate-400">{model.featuresWithCoords.length} Stations</span>
        </div>

        {/* Right: Primary View Switcher & Reset */}
        <div className="flex items-center gap-2.5">
          {explorerOpen ? (
            <button
              onClick={handleCloseExplorer}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-mono font-medium transition"
            >
              <MapIcon className="w-3.5 h-3.5 text-cyan-400" />
              <span>Return to Map</span>
            </button>
          ) : (
            <button
              onClick={() => handleOpenExplorer(selectedFeature || undefined)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 text-xs font-mono font-bold transition shadow-md shadow-cyan-600/20"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>3D Subsurface</span>
            </button>
          )}

          {!explorerOpen && (
            <button
              onClick={() => {
                mapRef.current?.resetView();
                setSelectedFeature(null);
              }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-slate-400 hover:text-slate-200 transition text-xs font-mono"
              title="Reset View"
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
          onSelectFeature={(feat) => {
            setSelectedFeature(feat);
            setSelectedInterval(null);
            mapRef.current?.flyToFeature(feat);
          }}
          onSelectInterval={setSelectedInterval}
          onZoomChange={(zoom, pitch) => {
            setZoomLevel(zoom);
            setPitchAngle(pitch);
          }}
          onEnterSubsurface={handleOpenExplorer}
          center={model.bounds.center}
          bounds={model.bounds}
          studyAreaPolygon={model.studyAreaPolygon}
          studyAreaName={model.studyAreaName}
        />

        {/* Floating HUD Tray (When on Map View with selected station) */}
        {!explorerOpen && (
          <FloatingHUD
            feature={selectedFeature}
            selectedInterval={selectedInterval}
            onSelectInterval={setSelectedInterval}
            onCloseFeature={() => setSelectedFeature(null)}
            model={model}
          />
        )}

        {/* Dedicated 3D Subsurface Cutaway Explorer */}
        {explorerOpen && (
          <SubsurfaceExplorer
            model={model}
            selectedFeature={selectedFeature}
            onSelectFeature={setSelectedFeature}
            onClose={handleCloseExplorer}
            surfaceCanvas={capturedSurfaceCanvas}
          />
        )}
      </div>
    </div>
  );
}

export default App;
