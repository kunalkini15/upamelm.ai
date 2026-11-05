import React from 'react';
import { ArrowRight, FileText, X } from 'lucide-react';
import { DocumentAnalysisModel } from '../../types/scientific';

interface Props { analysis: DocumentAnalysisModel; isOpen: boolean; onClose: () => void; onReadMore: () => void; }

export const DocumentAnalysisDrawer: React.FC<Props> = ({ analysis, isOpen, onClose, onReadMore }) => {
  if (!isOpen) return null;
  const report = analysis.raw;
  return <aside className="absolute left-5 top-28 z-30 w-[min(34rem,calc(100vw-2.5rem))] rounded-xl border border-line bg-ink-950/95 text-text shadow-float backdrop-blur-xl">
    <header className="relative rounded-xl bg-ink-950 px-5 pb-5 pt-4">
      <div className="flex items-start gap-3">
        <FileText className="mt-1 h-5 w-5 shrink-0 text-accent"/>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-accent">Document analysis</div>
          <h2 className="mt-2 text-lg font-semibold leading-snug sm:text-xl">{report.display_title}</h2>
          {report.brief_description && <p className="mt-3 text-[13px] leading-6 text-text">{report.brief_description}</p>}
          <button onClick={onReadMore} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-2 text-xs font-mono font-bold text-ink-950 transition hover:bg-accent">Read full analysis<ArrowRight className="h-3.5 w-3.5"/></button>
        </div>
        <button onClick={onClose} aria-label="Close document analysis" className="shrink-0 rounded-lg p-2 text-muted hover:bg-ink-800 hover:text-text"><X className="h-5 w-5"/></button>
      </div>
    </header>
  </aside>;
};
