/**
 * Location exploration panel: header, section tabs and section content.
 * Desktop: floating panel on the right. Mobile: bottom sheet with collapse.
 */
import { useState } from 'react';
import type { LocationFindings, ResearchLocation } from '@/types';
import { Icon } from './ui';
import OverviewSection from './sections/OverviewSection';
import AquiferSection from './sections/AquiferSection';
import UndergroundSection from './sections/UndergroundSection';
import ResearchSection from './sections/ResearchSection';
import AssistantSection from './sections/AssistantSection';

export type SectionId = 'overview' | 'aquifers' | 'underground' | 'research' | 'assistant';

const TABS: { id: SectionId; label: string; short: string; icon: string }[] = [
  { id: 'overview', label: 'Overview', short: 'Overview', icon: 'globe' },
  { id: 'aquifers', label: 'Aquifer intelligence', short: 'Aquifers', icon: 'droplet' },
  { id: 'underground', label: 'Underground exploration', short: 'Below', icon: 'strata' },
  { id: 'research', label: 'Research & evidence', short: 'Research', icon: 'book' },
  { id: 'assistant', label: 'AI research assistant', short: 'Assistant', icon: 'chat' },
];

interface LocationPanelProps {
  location: ResearchLocation;
  findings: LocationFindings;
  section: SectionId;
  onSectionChange: (section: SectionId) => void;
  onClose: () => void;
}

export default function LocationPanel({
  location,
  findings,
  section,
  onSectionChange,
  onClose,
}: LocationPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const activeTab = TABS.find((t) => t.id === section) ?? TABS[0];

  return (
    <aside
      className="absolute inset-x-0 bottom-0 z-10 flex max-h-[72vh] flex-col overflow-hidden rounded-t-3xl border border-edge bg-panel/97 shadow-2xl backdrop-blur md:inset-x-auto md:bottom-4 md:right-4 md:top-4 md:max-h-none md:w-[410px] md:rounded-2xl"
      aria-label={`${location.name} exploration panel`}
    >
      {/* Mobile drag handle / collapse toggle */}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex shrink-0 items-center justify-center py-2 md:hidden"
        aria-expanded={!collapsed}
        aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}
      >
        <span className="h-1 w-10 rounded-full bg-edge" aria-hidden="true" />
      </button>

      {/* Panel header */}
      <div className="shrink-0 border-b border-edge px-5 pb-3.5 pt-1 md:pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ochre">
              {breadcrumb(location)}
            </p>
            <h2 className="mt-0.5 truncate font-display text-[24px] font-semibold leading-tight tracking-tight text-fog">
              {location.name}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              className="rounded-full p-1.5 text-muted transition-colors hover:bg-panel-soft hover:text-fog md:hidden"
              aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}
            >
              <Icon name={collapsed ? 'chevronUp' : 'chevronDown'} className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-1.5 text-muted transition-colors hover:bg-panel-soft hover:text-fog"
              aria-label="Close panel"
            >
              <Icon name="x" className="h-4.5 w-4.5" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <nav
          className={`${collapsed ? 'hidden md:flex' : 'flex'} mt-3 gap-1 overflow-x-auto`}
          aria-label="Exploration sections"
        >
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                onSectionChange(tab.id);
                setCollapsed(false);
              }}
              aria-current={tab.id === section ? 'page' : undefined}
              title={tab.label}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
                tab.id === section
                  ? 'bg-ochre/15 text-ochre'
                  : 'text-muted hover:bg-panel-soft hover:text-fog'
              }`}
            >
              <Icon name={tab.icon} className="h-3.5 w-3.5" />
              {tab.short}
            </button>
          ))}
        </nav>
      </div>

      {/* Section content */}
      <div className={`${collapsed ? 'hidden md:block' : ''} slim-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4`}>
        <div key={activeTab.id}>
          {section === 'overview' && <OverviewSection location={location} findings={findings} />}
          {section === 'aquifers' && <AquiferSection />}
          {section === 'underground' && <UndergroundSection />}
          {section === 'research' && <ResearchSection />}
          {section === 'assistant' && <AssistantSection locationName={location.name} />}
        </div>
        <p className="mt-6 border-t border-edge pt-3 text-[11px] leading-relaxed text-faint">
          Basemap © OpenStreetMap contributors © CARTO. Scientific content arrives with Phase 2;
          absence of data is shown, never filled in.
        </p>
      </div>
    </aside>
  );
}

function breadcrumb(location: ResearchLocation): string {
  return [location.admin.state, location.admin.country].filter(Boolean).join(' · ');
}
