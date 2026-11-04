import React from 'react';
import { ArrowRight, FileText, X } from 'lucide-react';
import { DocumentAnalysisModel } from '../../types/scientific';

interface Props { analysis: DocumentAnalysisModel; isOpen: boolean; onClose: () => void; onReadMore: () => void; }

export const DocumentAnalysisDrawer: React.FC<Props> = ({ analysis, isOpen, onClose, onReadMore }) => {
  if (!isOpen) return null;
  const report = analysis.raw;
  return <aside className="absolute left-5 top-28 z-30 w-[min(34rem,calc(100vw-2.5rem))] rounded-2xl border border-slate-700 bg-slate-950/95 text-slate-100 shadow-2xl backdrop-blur-xl">
    <header className="relative rounded-2xl bg-gradient-to-b from-slate-950 to-slate-950/80 px-5 pb-5 pt-4">
      <div className="flex items-start gap-3">
        <FileText className="mt-1 h-5 w-5 shrink-0 text-cyan-400"/>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-mono uppercase tracking-[0.22em] text-cyan-400">Document analysis</div>
          <h2 className="mt-2 text-lg font-semibold leading-snug sm:text-xl">{report.display_title}</h2>
          {report.brief_description && <p className="mt-3 text-[13px] leading-6 text-slate-300">{report.brief_description}</p>}
          <button onClick={onReadMore} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-cyan-500 px-3.5 py-2 text-xs font-mono font-bold text-slate-950 transition hover:bg-cyan-400">Read full analysis<ArrowRight className="h-3.5 w-3.5"/></button>
        </div>
        <button onClick={onClose} aria-label="Close document analysis" className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-5 w-5"/></button>
      </div>
    </header>
  </aside>;
};
