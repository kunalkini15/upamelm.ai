/**
 * @file FloatingHUD.tsx
 * @module ui/components/hud/FloatingHUD
 * @description Floating heads-up display card presenting quick diagnostics,
 * total borehole depth, stratigraphic interval stack, and water quality observations
 * for the currently active feature.
 */

import React, { useState } from 'react';
import {
  RenderablePointFeature,
  RenderableInterval,
  ScientificUIModel,
} from '../../types/scientific';
import {
  X,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

interface FloatingHUDProps {
  feature: RenderablePointFeature | null;
  selectedInterval?: RenderableInterval | null;
  onSelectInterval?: (iv: RenderableInterval) => void;
  onCloseFeature: () => void;
  model?: ScientificUIModel;
}

export const FloatingHUD: React.FC<FloatingHUDProps> = ({
  feature,
  onCloseFeature,
}) => {
  const [expanded, setExpanded] = useState(true);

  if (!feature) return null;

  const narrative = feature.narrative;
  const hasNarrative = Boolean(narrative?.analysis?.trim());

  return (
    <div className="absolute top-16 right-5 z-20 flex flex-col pointer-events-auto select-none transition-all duration-300 w-96 max-w-[calc(100vw-40px)] max-h-[calc(100vh-100px)]">
      <div className="bg-ink-900/95 backdrop-blur-xl border border-line rounded-xl shadow-float flex flex-col overflow-hidden">
        {/* Header Bar - Place Name Only */}
        <div className="px-4 py-3 flex items-center justify-between gap-3 border-b border-line bg-ink-950/60">
          <div className="flex items-center gap-2.5 truncate">
            <span className="w-2.5 h-2.5 rounded-full bg-accent animate-pulse flex-shrink-0" />
            <div className="truncate">
              <div className="text-xs font-bold text-text tracking-wide font-mono truncate">
                {feature.name}
              </div>
              <div className="text-[10px] text-muted capitalize font-mono">
                {feature.type.replace(/_/g, ' ')} {feature.totalDepthMeters ? `• ${feature.totalDepthMeters}m` : ''}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-1 rounded text-muted hover:text-text hover:bg-ink-800 transition"
              title={expanded ? 'Collapse panel' : 'Expand panel'}
            >
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={onCloseFeature}
              className="p-1 rounded text-muted hover:text-text hover:bg-ink-800 transition"
              title="Close panel"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {expanded && (
          <div className="flex flex-col max-h-[calc(100vh-180px)] overflow-hidden">
            {/* Scrollable Content Body */}
            <div className="overflow-y-auto p-4 text-xs font-mono">
              {hasNarrative && narrative ? (
                <p className="text-text text-[12px] leading-6 font-sans bg-ink-950/40 p-3 rounded-lg border border-line">
                  {narrative.analysis}
                </p>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
