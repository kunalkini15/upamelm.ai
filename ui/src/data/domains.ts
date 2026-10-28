/**
 * Scientific domain registry.
 *
 * The single place where domains are declared. UI (badges, layer switcher,
 * exploration tabs) renders from this list, so adding a domain is a data
 * change, not a component change.
 */
import type { ScientificDomain } from '@/types';

export const DOMAINS: ScientificDomain[] = [
  {
    id: 'groundwater',
    label: 'Groundwater',
    description: 'Aquifer systems, depths, yields and groundwater conditions.',
    icon: 'droplet',
    status: 'forthcoming',
    accent: '#38bdf8',
    phase: 2,
  },
  {
    id: 'geology',
    label: 'Geology',
    description: 'Formations, stratigraphy and subsurface structure.',
    icon: 'layers',
    status: 'planned',
    accent: '#d9a441',
    phase: 4,
  },
  {
    id: 'soil',
    label: 'Soil',
    description: 'Soil characteristics and profiles.',
    icon: 'soil',
    status: 'planned',
    accent: '#a9805e',
    phase: 4,
  },
  {
    id: 'minerals',
    label: 'Minerals',
    description: 'Mineral occurrences and natural resources.',
    icon: 'gem',
    status: 'planned',
    accent: '#9fb3c8',
    phase: 4,
  },
  {
    id: 'hazards',
    label: 'Hazards',
    description: 'Geological hazards and subsidence risk.',
    icon: 'alert',
    status: 'planned',
    accent: '#e07856',
    phase: 4,
  },
  {
    id: 'seismic',
    label: 'Seismic',
    description: 'Seismic zones and earthquake history.',
    icon: 'activity',
    status: 'planned',
    accent: '#7dd3a8',
    phase: 4,
  },
];

export const domainById = (id: string): ScientificDomain | undefined =>
  DOMAINS.find((d) => d.id === id);
