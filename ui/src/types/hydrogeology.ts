/**
 * Hydrogeology and geology value types.
 *
 * Depth convention (project-wide, do not change casually):
 * - `depthBelowGroundLevelM`: metres below ground level (bgl), positive down.
 * - `elevationMAMSL`: metres above mean sea level, for water levels / datums.
 * A measurement always carries its confidence; a bare number is never shown
 * as a fact without its evidence tier.
 */
import type { Confidence } from './evidence';

export interface DepthRange {
  /** Top of interval in metres below ground level. */
  topM: number;
  /** Bottom of interval in metres below ground level. */
  bottomM: number;
}

/** A depth measurement with evidence attached. */
export interface DepthMeasurement {
  value: DepthRange | number;
  unit: 'm_bgl';
  confidence: Confidence;
  /** Observation IDs supporting this measurement. */
  observationIds: string[];
}

/** Thickness of a unit in metres. */
export interface ThicknessMeasurement {
  valueM: number;
  /** True when the reported value is a range/estimate rather than exact. */
  isRange?: boolean;
  maxM?: number;
  confidence: Confidence;
  observationIds: string[];
}

export type AquiferType =
  | 'unconfined'
  | 'confined'
  | 'semi-confined'
  | 'perched'
  | 'fractured-rock'
  | 'unknown';

/** A documented aquifer system (Phase 2+ entity; Phase 1 ships no instances). */
export interface AquiferSystem {
  id: string;
  name: string;
  locationId: string;
  aquiferType: AquiferType;
  depth?: DepthMeasurement;
  thickness?: ThicknessMeasurement;
  /** Lithology / formation the aquifer occurs in, as reported. */
  hostFormation?: string;
  yieldRangeLps?: { min: number; max: number };
  transmissivityM2PerDay?: { min: number; max: number };
  waterQualitySummary?: string;
  observationIds: string[];
  confidence: Confidence;
}

/** A geological unit / formation (Phase 2+ entity). */
export interface GeologicalUnit {
  id: string;
  name: string;
  locationId: string;
  /** Stratigraphic age as reported, e.g. "Quaternary", "Deccan Trap (Cretaceous–Paleogene)". */
  geologicAge?: string;
  lithology?: string;
  depth?: DepthMeasurement;
  thickness?: ThicknessMeasurement;
  observationIds: string[];
  confidence: Confidence;
}

/** Groundwater conditions summary for a location (Phase 2+ entity). */
export interface GroundwaterConditions {
  locationId: string;
  /** Depth to water level in m bgl, with season if reported. */
  waterLevelMBgl?: { preMonsoon?: number; postMonsoon?: number };
  waterLevelYear?: number;
  stageOfDevelopmentPercent?: number;
  categorisation?: 'safe' | 'semi-critical' | 'critical' | 'over-exploited' | 'not-assessed';
  observationIds: string[];
  confidence: Confidence;
}
