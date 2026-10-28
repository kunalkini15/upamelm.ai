/**
 * Location data access.
 *
 * Repository interface + local seed provider. Components depend only on the
 * `LocationRepository` interface, so Phase 2/3 can swap the local seed for a
 * server-backed implementation without touching the UI.
 */
import type {
  DomainAvailability,
  LocationFindings,
  ResearchLocation,
} from '@/types';
import { LOCATIONS } from '@/data/locations';

export interface LocationRepository {
  listLocations(): Promise<ResearchLocation[]>;
  getLocation(id: string): Promise<ResearchLocation | undefined>;
  getFindings(locationId: string): Promise<LocationFindings | undefined>;
}

/**
 * Phase 1 provider: static seed data, zero findings.
 * Every (location, domain) pair reports `not-started`, which the UI renders
 * as designed empty states — never as zeros or fictional findings.
 */
export class LocalLocationRepository implements LocationRepository {
  async listLocations(): Promise<ResearchLocation[]> {
    return [...LOCATIONS];
  }

  async getLocation(id: string): Promise<ResearchLocation | undefined> {
    return LOCATIONS.find((l) => l.id === id);
  }

  async getFindings(locationId: string): Promise<LocationFindings | undefined> {
    const location = LOCATIONS.find((l) => l.id === locationId);
    if (!location) return undefined;
    const availability: DomainAvailability[] = [
      ...location.availableDomains.map((domainId) => ({
        locationId,
        domainId,
        state: 'available' as const,
        findingCount: 0,
        documentCount: 0,
      })),
      ...location.forthcomingDomains.map((domainId) => ({
        locationId,
        domainId,
        state: 'not-started' as const,
        findingCount: 0,
        documentCount: 0,
      })),
    ];
    return {
      locationId,
      availability,
      aquiferIds: [],
      geologicalUnitIds: [],
      observationIds: [],
      documentIds: [],
    };
  }
}

/** Shared repository instance used by the app shell. */
export const locationRepository: LocationRepository = new LocalLocationRepository();
