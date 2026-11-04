import React, { useState } from 'react';
import { ChevronDown, Layers3 } from 'lucide-react';
import { AgenticLayer } from '../../types/scientific';

/**
 * Props for the Map Layer Control widget.
 */
interface LayerControlProps {
  layers: AgenticLayer[];
  activeIds: string[];
  onChange: (ids: string[]) => void;
}

/**
 * Interactive overlay control for toggling visibility of geospatial layers,
 * contours, corridors, and observation groups on the MapLibre map.
 */
export function LayerControl({ layers, activeIds, onChange }: LayerControlProps) {
  const [open, setOpen] = useState(false);

  if (!layers.length) return null;

  const toggle = (id: string) => {
    onChange(activeIds.includes(id) ? activeIds.filter((item) => item !== id) : [...activeIds, id]);
  };

  return (
    <div className="absolute left-4 top-4 z-30 w-72 text-slate-100">
      <button
        onClick={() => setOpen((value) => !value)}
        className="w-full flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/90 px-3 py-2 text-xs font-mono shadow-xl backdrop-blur"
      >
        <Layers3 className="w-4 h-4 text-cyan-400" />
        <span className="flex-1 text-left">Map content · {activeIds.length}/{layers.length}</span>
        <ChevronDown className={`w-4 h-4 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="mt-2 max-h-[55vh] overflow-y-auto rounded-xl border border-slate-700 bg-slate-950/95 p-2 shadow-2xl backdrop-blur">
          {layers.map((layer) => (
            <button
              key={layer.id}
              onClick={() => toggle(layer.id)}
              className={`flex w-full gap-3 rounded-lg p-2 text-left transition ${activeIds.includes(layer.id) ? 'bg-cyan-500/10' : 'hover:bg-slate-900'}`}
            >
              <span className={`mt-0.5 h-4 w-7 rounded-full p-0.5 transition ${activeIds.includes(layer.id) ? 'bg-cyan-400' : 'bg-slate-700'}`}><span className={`block h-3 w-3 rounded-full bg-slate-950 transition ${activeIds.includes(layer.id) ? 'translate-x-3' : ''}`}/></span>
              <span>
                <span className="block text-xs font-semibold">{layer.name}</span>
                <span className="block text-[10px] text-slate-500 mt-0.5">
                  {[
                    layer.representation,
                    layer.semantic_category,
                    layer.feature_ids?.length ? `${layer.feature_ids.length} objects` : undefined,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
