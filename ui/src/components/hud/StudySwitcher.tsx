import React from 'react';
import { ChevronDown, Files } from 'lucide-react';
import { BootstrapResponse, SelectionParams } from '../../api/backend';

/**
 * Metadata descriptor for an entry in the study catalog.
 */
interface StudySwitcherProps {
  bootstrap: BootstrapResponse;
  disabled?: boolean;
  onChange: (selection: SelectionParams) => void;
}

export function StudySwitcher({ bootstrap, disabled, onChange }: StudySwitcherProps) {
  const { cities, studies, selection, availableLanguages } = bootstrap;

  return (
    <div className="relative hidden lg:flex items-center gap-2 rounded-lg border border-line bg-ink-900 px-2.5 py-1.5 text-xs text-text">
      <Files className="w-3.5 h-3.5 text-accent shrink-0" />
      {cities.length > 1 && <select
        aria-label="Select city"
        disabled={disabled}
        value={selection.city}
        onChange={(event) => onChange({ city: event.target.value })}
        className="appearance-none bg-transparent outline-none max-w-32 truncate cursor-pointer disabled:opacity-50"
      >
        {cities.map((city) => <option key={city.id} value={city.id}>{city.label}</option>)}
      </select>}
      <select
        aria-label="Select study"
        disabled={disabled}
        value={selection.study}
        onChange={(event) => {
          const study = studies.find((item) => item.id === event.target.value);
          if (!study) return;
          const language = study.languages.includes(selection.language)
            ? selection.language
            : study.defaultLanguage;
          onChange({ city: selection.city, study: study.id, language });
        }}
        className="appearance-none bg-transparent pr-3 outline-none max-w-64 truncate cursor-pointer disabled:opacity-50"
      >
        {studies.map((study) => (
          <option key={study.id} value={study.id}>
            {study.title}
          </option>
        ))}
      </select>
      {availableLanguages.length > 1 && <select
        aria-label="Select language"
        disabled={disabled}
        value={selection.language}
        onChange={(event) => onChange({ city: selection.city, study: selection.study, language: event.target.value })}
        className="appearance-none bg-transparent pr-4 outline-none max-w-28 cursor-pointer border-l border-line pl-2 disabled:opacity-50"
      >
        {availableLanguages.map((language) => (
          <option key={language.code} value={language.code} title={language.label}>{language.nativeLabel}</option>
        ))}
      </select>}
      <ChevronDown className="pointer-events-none absolute right-2 w-3 h-3 text-muted" />
    </div>
  );
}
