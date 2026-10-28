/**
 * Scientific domains.
 *
 * A domain is an independent scientific subject area (groundwater, geology,
 * soils, …). Domains are the primary extension point: adding a new domain
 * must not require changes to the map shell, navigation, or other domains.
 * See `src/data/domains.ts` for the registry.
 */

/** Stable domain identifiers. New domains extend this union. */
export type ScientificDomainId =
  | 'groundwater'
  | 'geology'
  | 'soil'
  | 'minerals'
  | 'hazards'
  | 'seismic';

export type DomainStatus = 'available' | 'forthcoming' | 'planned';

export interface ScientificDomain {
  id: ScientificDomainId;
  /** Short display label, e.g. "Groundwater". */
  label: string;
  /** One-line description of what the domain covers. */
  description: string;
  /** Icon key resolved by the UI icon set (no emoji; keeps domains themeable). */
  icon: string;
  status: DomainStatus;
  /** Accent colour (hex) used for domain badges and layer styling. */
  accent: string;
  /** Pipeline phase that introduces this domain, for roadmap display. */
  phase: number;
}
