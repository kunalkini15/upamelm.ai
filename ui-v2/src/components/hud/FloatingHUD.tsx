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
  const hasNarrative = Boolean(narrative && narrative.headline);

  return (
    <div className="absolute top-16 right-5 z-20 flex flex-col pointer-events-auto select-none transition-all duration-300 w-96 max-w-[calc(100vw-40px)] max-h-[calc(100vh-100px)]">
      <div className="bg-slate-900/95 backdrop-blur-xl border border-slate-700/80 rounded-xl shadow-[0_16px_50px_rgba(0,0,0,0.7)] flex flex-col overflow-hidden">
        {/* Header Bar - Place Name Only */}
        <div className="px-4 py-3 flex items-center justify-between gap-3 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-2.5 truncate">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse flex-shrink-0" />
            <div className="truncate">
              <div className="text-xs font-bold text-slate-100 tracking-wide font-mono truncate">
                {feature.name}
              </div>
              <div className="text-[10px] text-slate-400 capitalize font-mono">
                {feature.type.replace(/_/g, ' ')} {feature.totalDepthMeters ? `• ${feature.totalDepthMeters}m` : ''}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
              title={expanded ? 'Collapse panel' : 'Expand panel'}
            >
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={onCloseFeature}
              className="p-1 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition"
              title="Close panel"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {expanded && (
          <div className="flex flex-col max-h-[calc(100vh-180px)] overflow-hidden">
            {/* Scrollable Content Body */}
            <div className="overflow-y-auto p-4 space-y-3.5 text-xs font-mono">
              {hasNarrative && narrative ? (
                <div className="space-y-3">
                  {/* Headline */}
                  <div className="p-2.5 rounded-lg bg-cyan-950/40 border border-cyan-800/40 text-cyan-200 font-semibold leading-relaxed">
                    {narrative.headline}
                  </div>

                  {/* Summary */}
                  {narrative.summary && (
                    <div className="space-y-1">
                      <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                        Summary
                      </div>
                      <p className="text-slate-300 text-[11px] leading-relaxed font-sans bg-slate-950/40 p-2.5 rounded-lg border border-slate-800/60">
                        {narrative.summary}
                      </p>
                    </div>
                  )}

                  {/* Key Insights List */}
                  {narrative.insights && narrative.insights.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                        Key Insights ({narrative.insights.length})
                      </div>
                      <div className="space-y-2">
                        {narrative.insights.map((ins) => (
                          <div
                            key={ins.id}
                            className="bg-slate-950/60 p-2.5 rounded-lg border border-slate-800 space-y-1"
                          >
                            <div className="font-bold text-slate-200 text-[11px] flex items-center justify-between">
                              <span>{ins.title}</span>
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-cyan-400 uppercase">
                                {ins.type}
                              </span>
                            </div>
                            <p className="text-slate-400 text-[10px] leading-relaxed font-sans">
                              {ins.explanation}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-4 text-slate-500 text-xs">
                  No synthesis summary available for this station.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
