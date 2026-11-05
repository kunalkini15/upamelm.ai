import React, { useState } from 'react';
import {
  NormalizedSpatialPoint,
  NormalizedStrataInterval,
  UniversalSceneModel,
} from '../../types/schema';
import {
  Layers,
  Sliders,
  Maximize2,
  FileText,
  Activity,
  CheckCircle2,
  AlertTriangle,
  ChevronRight,
  TrendingDown,
  Droplet,
  Compass,
} from 'lucide-react';

interface InspectorPanelProps {
  selectedPoint: NormalizedSpatialPoint;
  selectedInterval: NormalizedStrataInterval | null;
  onSelectInterval: (interval: NormalizedStrataInterval) => void;
  verticalExaggeration: number;
  onChangeExaggeration: (val: number) => void;
  explodeOffset: number;
  onChangeExplode: (val: number) => void;
  showTransects: boolean;
  onToggleTransects: (val: boolean) => void;
  showWaterPlane: boolean;
  onToggleWaterPlane: (val: boolean) => void;
  onClose: () => void;
  model: UniversalSceneModel;
}

export const InspectorPanel: React.FC<InspectorPanelProps> = ({
  selectedPoint,
  selectedInterval,
  onSelectInterval,
  verticalExaggeration,
  onChangeExaggeration,
  explodeOffset,
  onChangeExplode,
  showTransects,
  onToggleTransects,
  showWaterPlane,
  onToggleWaterPlane,
  onClose,
  model,
}) => {
  const [activeTab, setActiveTab] = useState<'strata' | 'observations' | 'provenance'>('strata');

  const strata = selectedPoint.strataIntervals || [];

  return (
    <div className="w-96 h-full flex flex-col bg-ink-900/90 backdrop-blur-xl border-l border-line/60 shadow-float text-text z-20">
      {/* Header */}
      <div className="p-4 border-b border-line/60 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 text-[10px] uppercase font-mono tracking-wider text-accent">
            <span className="w-2 h-2 rounded-full bg-accent"></span>
            <span>Feature Focus</span>
            <span className="text-muted">•</span>
            <span className="text-muted">{selectedPoint.fidelity}</span>
          </div>
          <h2 className="text-base font-semibold text-text mt-0.5 truncate max-w-[240px]">
            {selectedPoint.name}
          </h2>
          <div className="text-xs text-muted font-mono mt-0.5 flex gap-2">
            <span>{selectedPoint.coordinates[0].toFixed(4)}°E</span>
            <span>{selectedPoint.coordinates[1].toFixed(4)}°N</span>
            {selectedPoint.totalDepthMeters && (
              <span className="text-accent">| Depth: {selectedPoint.totalDepthMeters}m</span>
            )}
          </div>
        </div>

        <button
          onClick={onClose}
          className="p-1 rounded-md text-muted hover:text-text hover:bg-ink-800 transition"
        >
          ✕
        </button>
      </div>

      {/* 3D Physical Adjustments HUD */}
      <div className="p-3 bg-ink-950/60 border-b border-line/80 flex flex-col gap-2.5 text-xs">
        <div className="flex items-center justify-between font-mono text-text">
          <div className="flex items-center gap-1.5">
            <Sliders className="w-3.5 h-3.5 text-accent" />
            <span>Vertical Exaggeration</span>
          </div>
          <span className="text-accent font-semibold">{verticalExaggeration}x</span>
        </div>
        <input
          type="range"
          min="1"
          max="25"
          value={verticalExaggeration}
          onChange={(e) => onChangeExaggeration(Number(e.target.value))}
          className="w-full accent-accent h-1.5 bg-ink-800 rounded-lg cursor-pointer"
        />

        <div className="flex items-center justify-between font-mono text-text mt-1">
          <div className="flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-amber" />
            <span>Exploded Strata Offset</span>
          </div>
          <span className="text-amber font-semibold">{(explodeOffset * 100).toFixed(0)}%</span>
        </div>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={explodeOffset}
          onChange={(e) => onChangeExplode(Number(e.target.value))}
          className="w-full accent-amber h-1.5 bg-ink-800 rounded-lg cursor-pointer"
        />

        {/* Layer Toggles */}
        <div className="flex items-center justify-between pt-1 border-t border-line/60 font-mono text-[11px]">
          <label className="flex items-center gap-1.5 cursor-pointer text-text">
            <input
              type="checkbox"
              checked={showWaterPlane}
              onChange={(e) => onToggleWaterPlane(e.target.checked)}
              className="accent-accent rounded"
            />
            <span>Water Table Plane</span>
          </label>

          <label className="flex items-center gap-1.5 cursor-pointer text-text">
            <input
              type="checkbox"
              checked={showTransects}
              onChange={(e) => onToggleTransects(e.target.checked)}
              className="accent-accent rounded"
            />
            <span>Transect Curtains</span>
          </label>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-line/60 text-xs font-medium">
        <button
          onClick={() => setActiveTab('strata')}
          className={`flex-1 py-2 text-center transition ${
            activeTab === 'strata'
              ? 'text-accent border-b-2 border-accent font-semibold'
              : 'text-muted hover:text-text'
          }`}
        >
          Strata ({strata.length})
        </button>
        <button
          onClick={() => setActiveTab('observations')}
          className={`flex-1 py-2 text-center transition ${
            activeTab === 'observations'
              ? 'text-accent border-b-2 border-accent font-semibold'
              : 'text-muted hover:text-text'
          }`}
        >
          Metrics & Obs
        </button>
        <button
          onClick={() => setActiveTab('provenance')}
          className={`flex-1 py-2 text-center transition ${
            activeTab === 'provenance'
              ? 'text-accent border-b-2 border-accent font-semibold'
              : 'text-muted hover:text-text'
          }`}
        >
          Evidence
        </button>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {activeTab === 'strata' && (
          <div className="space-y-2">
            <div className="text-[11px] text-muted font-mono flex justify-between">
              <span>INTERVAL / FORMATION</span>
              <span>DEPTH (mbgl)</span>
            </div>

            {strata.map((interval, i) => {
              const isSelected = selectedInterval?.id === interval.id;
              const isClay = interval.materialType === 'impermeable_clay';

              return (
                <div
                  key={interval.id || i}
                  onClick={() => onSelectInterval(interval)}
                  className={`p-3 rounded-lg border transition cursor-pointer ${
                    isSelected
                      ? 'bg-ink-850/60 border-accent shadow-soft'
                      : 'bg-ink-800/40 border-line/60 hover:bg-ink-800/80 hover:border-line'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-3 h-3 rounded-sm shadow-soft"
                        style={{ backgroundColor: interval.colorHex }}
                      />
                      <span className="text-xs font-medium text-text">{interval.name}</span>
                    </div>
                    <span className="text-xs font-mono text-accent font-semibold">
                      {interval.depthTopMeters} - {interval.depthBottomMeters}m
                    </span>
                  </div>

                  <div className="mt-2 flex items-center justify-between text-[11px] text-muted font-mono">
                    <span className="capitalize">{interval.materialType.replace('_', ' ')}</span>
                    <span>Thick: {interval.thicknessMeters}m</span>
                  </div>

                  {interval.notes && (
                    <div className="mt-1.5 text-[11px] text-muted bg-ink-900/50 p-1.5 rounded">
                      {interval.notes}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {activeTab === 'observations' && (
          <div className="space-y-2.5">
            {selectedPoint.standingWaterLevelMeters && (
              <div className="p-3 rounded-lg bg-ink-850/40 border border-accent/40 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Droplet className="w-4 h-4 text-accent" />
                  <div>
                    <div className="text-xs font-medium text-text">Standing Water Level (SWL)</div>
                    <div className="text-[10px] text-muted font-mono">Piezometric Head</div>
                  </div>
                </div>
                <span className="text-sm font-mono font-bold text-accent">
                  {selectedPoint.standingWaterLevelMeters} m bmp
                </span>
              </div>
            )}

            <div className="text-xs font-semibold text-text pt-2 font-mono">RAW RECORD ATTRIBUTES</div>
            {Object.entries(selectedPoint.rawAttributes).map(([k, v]) => (
              <div
                key={k}
                className="p-2.5 rounded bg-ink-800/50 border border-line/50 flex justify-between items-center text-xs"
              >
                <span className="font-mono text-muted">{k}</span>
                <span className="font-mono text-text font-medium">{String(v)}</span>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'provenance' && (
          <div className="space-y-3 text-xs">
            <div className="p-3 rounded-lg bg-ink-800/60 border border-line/70">
              <div className="flex items-center gap-2 text-accent font-mono text-[11px]">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Epistemic Fidelity: {selectedPoint.fidelity}</span>
              </div>
              <p className="mt-2 text-text text-xs leading-relaxed">
                Directly referenced from government NAQUIM ground-truth borehole inventory. All vertical
                intervals preserved with exact field measurements.
              </p>
            </div>

            <div className="p-3 rounded-lg bg-ink-900 border border-line">
              <div className="text-[11px] font-mono text-muted">RESEARCH OBJECTIVE</div>
              <p className="mt-1 text-text text-[11px] leading-relaxed line-clamp-4">
                {model.summary}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
