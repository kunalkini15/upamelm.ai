/**
 * Universal Scientific Data Schema for Subsurface v2
 * Zero domain lock-in: works across Hydrogeology, Soil Science, Urban Planning, Mining, and Civil Geotechnics.
 */

export type FidelityLevel = 'reported' | 'derived' | 'figure-only' | 'estimated' | 'unknown';
export type ReadinessLevel = 'ready' | 'partial' | 'reference_only' | 'blocked';

export interface AttributeRecord {
  field_id: string;
  value: string | number | null;
  unit?: string | null;
  original_value?: string | number | null;
  fidelity?: FidelityLevel;
  evidence_refs?: string[];
}

export interface GenericEntity {
  id: string;
  type: string;
  name: string;
  description?: string;
  readiness?: ReadinessLevel;
  fidelity?: FidelityLevel;
  evidence_refs?: string[];
  dataset_ids?: string[];
  observation_ids?: string[];
  geometry_ids?: string[];
  attributes: AttributeRecord[];
  data_json?: string;
}

export interface GenericGeometry {
  id: string;
  type: string;
  name: string;
  description?: string;
  readiness?: ReadinessLevel;
  fidelity?: FidelityLevel;
  entity_ids?: string[];
  dataset_ids?: string[];
  observation_ids?: string[];
  attributes: AttributeRecord[];
  data_json?: string;
}

export interface GenericObservation {
  id: string;
  type: string;
  name: string;
  description?: string;
  readiness?: ReadinessLevel;
  fidelity?: FidelityLevel;
  evidence_refs?: string[];
  entity_ids?: string[];
  dataset_ids?: string[];
  geometry_ids?: string[];
  attributes: AttributeRecord[];
  data_json?: string;
}

export interface GenericView {
  id: string;
  type: string;
  name: string;
  description?: string;
  readiness?: ReadinessLevel;
  fidelity?: FidelityLevel;
  evidence_refs?: string[];
  dataset_ids?: string[];
  entity_ids?: string[];
  observation_ids?: string[];
  geometry_ids?: string[];
  attributes: AttributeRecord[];
  data_json?: string;
}

export interface GenericDataset {
  id: string;
  type: string;
  name: string;
  description?: string;
  fidelity?: FidelityLevel;
  attributes: AttributeRecord[];
}

export interface GenericEvidence {
  id: string;
  name: string;
  description?: string;
  fidelity?: FidelityLevel;
  attributes: AttributeRecord[];
}

export interface ResearchMeta {
  research_id: string;
  objective: string;
  domain_context: string;
  summary: string;
  limitations?: string[];
}

export interface UniversalRenderingPackage {
  schema_version: string;
  research: ResearchMeta;
  sources: unknown[];
  datasets: GenericDataset[];
  entities: GenericEntity[];
  relationships: unknown[];
  observations: GenericObservation[];
  geometries: GenericGeometry[];
  views: GenericView[];
  evidence: GenericEvidence[];
  limitations: string[];
  unresolved_questions: string[];
  generation?: Record<string, unknown>;
}

/**
 * Normalized 3D / Spatial Primitives for Universal Visual Engine
 */

export interface NormalizedSpatialPoint {
  id: string;
  name: string;
  entityId?: string;
  geometryId: string;
  coordinates: [number, number]; // [lng, lat]
  elevationMeters?: number;
  totalDepthMeters?: number;
  standingWaterLevelMeters?: number;
  fidelity: FidelityLevel;
  readiness: ReadinessLevel;
  strataIntervals: NormalizedStrataInterval[];
  scalarObservations: Record<string, { value: number | string; unit?: string }>;
  evidenceRefs: string[];
  rawAttributes: Record<string, unknown>;
}

export interface NormalizedStrataInterval {
  id: string;
  name: string;
  depthTopMeters: number;
  depthBottomMeters: number;
  thicknessMeters: number;
  materialType: 'permeable_aquifer' | 'impermeable_clay' | 'consolidated_rock' | 'alluvium' | 'unknown';
  colorHex: string;
  transparency: number;
  fidelity: FidelityLevel;
  notes?: string;
}

export interface NormalizedTransectCurtain {
  id: string;
  name: string;
  points: [number, number][]; // Line coordinates [lng, lat]
  topElevationMeters: number;
  bottomDepthMeters: number;
  description?: string;
}

export interface UniversalSceneModel {
  domainContext: string;
  summary: string;
  bounds: {
    minLng: number;
    maxLng: number;
    minLat: number;
    maxLat: number;
    center: [number, number];
  };
  points: NormalizedSpatialPoint[];
  transects: NormalizedTransectCurtain[];
  regionalStrata: NormalizedStrataInterval[];
  availableViews: GenericView[];
  limitations: string[];
}
