import React from 'react';
import { UniversalSceneModel } from '../../types/schema';
import { Compass, Box, Map, Layers, ShieldCheck, Database, FileSpreadsheet } from 'lucide-react';

interface HeaderProps {
  model: UniversalSceneModel;
  mode: 'map' | 'split' | '3d';
  onChangeMode: (m: 'map' | 'split' | '3d') => void;
  onResetView: () => void;
  selectedPointName?: string;
}

export const Header: React.FC<HeaderProps> = ({
  model,
  mode,
  onChangeMode,
  onResetView,
  selectedPointName,
}) => {
  return (
    <header className="h-14 bg-slate-950/80 backdrop-blur-md border-b border-slate-800/80 px-4 flex items-center justify-between z-30 select-none">
      {/* Brand & Project Identity */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center shadow-[0_0_15px_rgba(6,182,212,0.5)]">
          <Box className="w-4 h-4 text-slate-950 stroke-[2.5]" />
        </div>

        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-bold tracking-tight text-slate-100">
              SUBSURFACE <span className="text-cyan-400">v2</span>
            </h1>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-cyan-950 text-cyan-300 border border-cyan-800/50">
              UNIVERSAL TWIN
            </span>
          </div>
          <div className="text-[11px] text-slate-400 flex items-center gap-1.5 max-w-xl truncate">
            <span className="truncate">{model.domainContext.slice(0, 48)}...</span>
            {selectedPointName && (
              <>
                <span className="text-slate-600">/</span>
                <span className="text-amber-400 font-mono font-medium shrink-0">{selectedPointName}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Mode Switcher */}
      <div className="flex items-center bg-slate-900/90 p-1 rounded-lg border border-slate-800">
        <button
          onClick={() => onChangeMode('map')}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition ${
            mode === 'map'
              ? 'bg-cyan-500 text-slate-950 shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Map className="w-3.5 h-3.5" />
          <span>Regional Map</span>
        </button>

        <button
          onClick={() => onChangeMode('split')}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition ${
            mode === 'split'
              ? 'bg-cyan-500 text-slate-950 shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>Split Dual-View</span>
        </button>

        <button
          onClick={() => onChangeMode('3d')}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition ${
            mode === '3d'
              ? 'bg-cyan-500 text-slate-950 shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Box className="w-3.5 h-3.5" />
          <span>3D Subsurface</span>
        </button>
      </div>

      {/* Status & Stats */}
      <div className="flex items-center gap-4 text-xs font-mono">
        <div className="flex items-center gap-1.5 text-slate-400">
          <Database className="w-3.5 h-3.5 text-cyan-400" />
          <span>{model.points.length} Drill-Sites</span>
        </div>

        <div className="flex items-center gap-1.5 text-slate-400">
          <Layers className="w-3.5 h-3.5 text-blue-400" />
          <span>{model.regionalStrata.length} Strata Slabs</span>
        </div>

        <div className="h-4 w-px bg-slate-800" />

        <div className="flex items-center gap-1.5 text-emerald-400">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span className="text-[11px]">Zero Domain Lock-In</span>
        </div>
      </div>
    </header>
  );
};
