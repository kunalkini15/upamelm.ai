import React, { useState } from 'react';
import {
  RenderablePointFeature,
  RenderableInterval,
  ScientificUIModel,
} from '../../types/scientific';
import {
  Layers,
  Sliders,
  FileText,
  Activity,
  CheckCircle2,
  Table,
  Droplet,
  ExternalLink,
} from 'lucide-react';

interface FeatureInspectorProps {
  feature: RenderablePointFeature;
  selectedInterval: RenderableInterval | null;
  onSelectInterval: (interval: RenderableInterval) => void;
  verticalExaggeration: number;
  onChangeExaggeration: (val: number) => void;
  explodeOffset: number;
  onChangeExplode: (val: number) => void;
  showRegionalSlabs: boolean;
  onToggleRegionalSlabs: (val: boolean) => void;
  showWaterPlane: boolean;
  onToggleWaterPlane: (val: boolean) => void;
  onClose: () => void;
  model: ScientificUIModel;
}

export const FeatureInspector: React.FC<FeatureInspectorProps> = ({
  feature,
  selectedInterval,
  onSelectInterval,
  verticalExaggeration,
  onChangeExaggeration,
  explodeOffset,
  onChangeExplode,
  showRegionalSlabs,
  onToggleRegionalSlabs,
  showWaterPlane,
  onToggleWaterPlane,
  onClose,
  model,
}) => {
  const [activeTab, setActiveTab] = useState<'strata' | 'observations' | 'datasets' | 'provenance'>('strata');

  const strata = feature.intervals || [];

  return (
    <div className="w-96 h-full flex flex-col bg-ink-900/90 backdrop-blur-xl border-l border-line/60 shadow-float text-text z-20">
      {/* Header */}
      <div className="p-4 border-b border-line/60 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 text-[10px] uppercase font-mono tracking-wider text-accent">
            <span className="w-2 h-2 rounded-full bg-accent"></span>
            <span>{feature.type.replace('_', ' ')}</span>
            {feature.studyAreaName && (
              <>
                <span className="text-muted">•</span>
                <span className="text-muted">{feature.studyAreaName}</span>
              </>
            )}
          </div>
          <h2 className="text-base font-semibold text-text mt-0.5 truncate max-w-[240px]">
            {feature.name}
          </h2>
          <div className="text-xs text-muted font-mono mt-0.5 flex gap-2">
            <span>{feature.coordinates[0].toFixed(4)}°E</span>
            <span>{feature.coordinates[1].toFixed(4)}°N</span>
            {feature.totalDepthMeters && (
              <span className="text-accent">| Depth: {feature.totalDepthMeters}m</span>
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
              checked={showRegionalSlabs}
              onChange={(e) => onToggleRegionalSlabs(e.target.checked)}
              className="accent-accent rounded"
            />
            <span>Regional Slabs</span>
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
          Obs ({feature.observations.length})
        </button>
        <button
          onClick={() => setActiveTab('datasets')}
          className={`flex-1 py-2 text-center transition ${
            activeTab === 'datasets'
              ? 'text-accent border-b-2 border-accent font-semibold'
              : 'text-muted hover:text-text'
          }`}
        >
          Tables
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
              <span>FORMATION / LITHOLOGY</span>
              <span>DEPTH (mbgl)</span>
            </div>

            {strata.map((interval, i) => {
              const isSelected = selectedInterval?.id === interval.id;

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
                      {interval.start} - {interval.end}m
                    </span>
                  </div>

                  <div className="mt-2 flex items-center justify-between text-[11px] text-muted font-mono">
                    <span className="capitalize">{interval.type}</span>
                    <span>Thick: {interval.thickness}m</span>
                  </div>

                  {interval.material && (
                    <div className="mt-1 text-[11px] text-muted font-mono">
                      Material: <span className="text-text">{interval.material}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {activeTab === 'observations' && (
          <div className="space-y-2.5">
            {feature.waterLevelMeters && (
              <div className="p-3 rounded-lg bg-ink-850/40 border border-accent/40 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Droplet className="w-4 h-4 text-accent" />
                  <div>
                    <div className="text-xs font-medium text-text">Water Table Level</div>
                    <div className="text-[10px] text-muted font-mono">
                      {feature.waterLevelDate ? `Measured: ${feature.waterLevelDate}` : 'Standing Head'}
                    </div>
                  </div>
                </div>
                <span className="text-sm font-mono font-bold text-accent">
                  {feature.waterLevelMeters} mbgl
                </span>
              </div>
            )}

            <div className="text-xs font-semibold text-text pt-2 font-mono">MEASURED ATTRIBUTES</div>
            {feature.observations.map((obs) => (
              <div
                key={obs.id}
                className="p-2.5 rounded bg-ink-800/50 border border-line/50 flex justify-between items-center text-xs"
              >
                <div className="flex flex-col">
                  <span className="font-mono text-text font-medium capitalize">{obs.label}</span>
                  {obs.date && <span className="text-[10px] text-muted font-mono">{obs.date}</span>}
                </div>
                <span className="font-mono text-accent font-semibold">
                  {String(obs.value)} {obs.unit || ''}
                </span>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'datasets' && (
          <div className="space-y-2">
            <div className="text-[11px] text-muted font-mono">SOURCE TABLES PRESERVED IN PACKAGE</div>
            {model.preservedDatasets.slice(0, 5).map((ds) => (
              <div key={ds.id} className="p-2.5 rounded bg-ink-800/40 border border-line/60 text-xs">
                <div className="font-medium text-text">{ds.title || ds.name || ds.id}</div>
                <div className="text-[11px] font-mono text-muted mt-1 flex justify-between">
                  <span>Columns: {ds.columns?.length || 0}</span>
                  <span>Rows: {ds.rows?.length || 0}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'provenance' && (
          <div className="space-y-3 text-xs">
            <div className="p-3 rounded-lg bg-ink-800/60 border border-line/70">
              <div className="flex items-center gap-2 text-accent font-mono text-[11px]">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Source Grounding Verified</span>
              </div>
              <p className="mt-2 text-text text-xs leading-relaxed">
                Extracted directly from government geological inventory. All measurements preserve exact
                source pages and record identifiers without invented approximations.
              </p>
              {feature.sourcePages.length > 0 && (
                <div className="mt-2 pt-2 border-t border-line/60 flex items-center gap-2 font-mono text-[11px] text-muted">
                  <span>CITED PAGES:</span>
                  <div className="flex gap-1.5">
                    {feature.sourcePages.map((pg, idx) => (
                      <span key={idx} className="px-1.5 py-0.5 rounded bg-ink-800 text-accent">
                        p.{pg}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="p-3 rounded-lg bg-ink-900 border border-line">
              <div className="text-[11px] font-mono text-muted">REPORT INFORMATION</div>
              <div className="font-medium text-text mt-1">{model.reportTitle}</div>
              <div className="text-[11px] text-muted font-mono mt-1">{model.studyAreaName}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
