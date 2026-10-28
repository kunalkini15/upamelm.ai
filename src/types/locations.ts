/**
 * Research locations and per-location findings.
 *
 * Locations are the unit of exploration: anything selectable on the map.
 * Findings attach to (location, domain) pairs. Phase 1 ships exactly one
 * location (Gandhinagar) with zero findings — the empty states are the point.
 */
import type { AdminContext, AdminLevel, GeoBounds, GeoPoint } from './geo';
import type { ScientificDomainId } from './domains';

export type LocationStatus = 'explorable' | 'forthcoming';

export interface ResearchLocation {
  id: string;
  name: string;
  adminLevel: AdminLevel;
  admin: AdminContext;
  centroid: GeoPoint;
  bounds?: GeoBounds;
  /** Short neutral geographic description (no scientific claims). */
  summary: string;
  status: LocationStatus;
  /** Domains with published findings at this location. */
  availableDomains: ScientificDomainId[];
  /** Domains queued for future processing at this location. */
  forthcomingDomains: ScientificDomainId[];
  featured?: boolean;
}

/** Availability of research data for one (location, domain) pair. */
export interface DomainAvailability {
  locationId: string;
  domainId: ScientificDomainId;
  state: AvailabilityState;
  findingCount: number;
  documentCount: number;
  updatedAt?: string;
}

export type AvailabilityState =
  | 'available'
  | 'processing'
  | 'registered'
  | 'not-started';

/**
 * Aggregated, UI-ready research bundle for a location.
 * Phase 2+ populates the entity arrays; Phase 1 always returns empty arrays
 * with `not-started` availability, which the UI renders as empty states.
 */
export interface LocationFindings {
  locationId: string;
  availability: DomainAvailability[];
  aquiferIds: string[];
  geologicalUnitIds: string[];
  observationIds: string[];
  documentIds: string[];
}
