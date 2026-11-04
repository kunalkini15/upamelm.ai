import React, { useEffect, useState } from 'react';
import { ChevronDown, Files } from 'lucide-react';

/**
 * Metadata descriptor for an entry in the study catalog.
 */
interface StudyEntry {
  id: string;
  title: string;
  package: string;
  family?: string;
}

/**
 * Dropdown switcher mounted in the scientific header.
 * Allows users to hot-switch between ingested scientific studies
 * declared in `/study-catalog.json`.
 */
export function StudySwitcher({ activePackage }: { activePackage?: string }) {
  const [studies, setStudies] = useState<StudyEntry[]>([]);
  const current = activePackage || new URLSearchParams(window.location.search).get('package') || '';

  useEffect(() => {
    const controller = new AbortController();
    fetch('/study-catalog.json', { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error(String(response.status))))
      .then((catalog) => setStudies(Array.isArray(catalog.studies) ? catalog.studies : []))
      .catch((error) => {
        if (error.name !== 'AbortError') console.warn('Study catalog unavailable', error);
      });
    return () => controller.abort();
  }, []);

  if (!studies.length) return null;

  return (
    <label className="relative hidden lg:flex items-center gap-2 rounded-lg border border-slate-700/80 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-300">
      <Files className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
      <select
        aria-label="Select study"
        value={studies.some((study) => study.package === current) ? current : ''}
        onChange={(event) => {
          if (!event.target.value) return;
          const url = new URL(window.location.href);
          url.searchParams.set('package', event.target.value);
          url.searchParams.delete('mode');
          window.location.assign(url.toString());
        }}
        className="appearance-none bg-transparent pr-5 outline-none max-w-64 truncate cursor-pointer"
      >
        <option value="" disabled>Select study</option>
        {studies.map((study) => (
          <option key={study.id} value={study.package}>
            {study.title}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 w-3 h-3 text-slate-500" />
    </label>
  );
}
