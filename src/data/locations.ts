/**
 * Location seed data (Phase 1).
 *
 * Exactly one location: Gandhinagar, Gujarat — a navigation entry only.
 * Coordinates: Gandhinagar city centre (approx. 23.2239° N, 72.6500° E).
 * No scientific claims are stored here; findings arrive via the Phase 2
 * extraction pipeline and are served through the repository layer.
 */
import type { ResearchLocation } from '@/types';

export const GANDHINAGAR_ID = 'gandhinagar-gj';

export const LOCATIONS: ResearchLocation[] = [
  {
    id: GANDHINAGAR_ID,
    name: 'Gandhinagar',
    adminLevel: 'city',
    admin: {
      country: 'India',
      state: 'Gujarat',
      district: 'Gandhinagar',
    },
    centroid: {
      coordinates: [72.65, 23.2239],
    },
    bounds: {
      bbox: [72.45, 23.05, 72.85, 23.4],
    },
    summary:
      'Capital city of Gujarat, on the west bank of the Sabarmati river. First research location for Subsurface India; scientific processing begins in Phase 2.',
    status: 'explorable',
    availableDomains: [],
    forthcomingDomains: ['groundwater', 'geology', 'soil', 'minerals', 'hazards', 'seismic'],
    featured: true,
  },
];

export const locationById = (id: string): ResearchLocation | undefined =>
  LOCATIONS.find((l) => l.id === id);
