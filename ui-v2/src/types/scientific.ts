/**
 * Standardized Scientific Contract Schema (v1.0)
 * Source-grounded, domain-neutral scientific output from the synthesizer.
 */

export interface SourceReference {
  id?: string;
  document_id?: string;
  page?: number | string;
  locator?: string;
  table?: string;
  figure?: string;
}

export interface ReportMeta {
  id?: string;
  title?: string;
  short_title?: string;
  date?: string;
  authors?: string[];
  summary?: string;
  domain?: string;
}

export interface StudyAreaBounds {
  east: number;
  north: number;
  south: number;
  west: number;
}

export interface StudyArea {
  id: string;
  name: string;
  type?: string;
  summary?: string;
  bounds?: StudyAreaBounds;
  source_refs?: string[];
  aliases?: string[];
}

export interface FeatureProperty {
  name: string;
  value: string | number | null;
  unit?: string | null;
}

export interface FeatureGeometry {
  type: string; // 'Point'
  coordinates: [number, number]; // [lng, lat]
}

export interface NarrativeInsight {
  id: string;
  type: string;
  title: string;
  explanation: string;
  observation_ids?: string[];
  interval_ids?: string[];
  dataset_ids?: string[];
  evidence_refs?: string[];
  grounding_status?: string;
}

export interface FeatureNarrative {
  status: string;
  insight_type?: string;
  headline: string;
  summary: string;
  why_it_matters: string;
  visual_takeaway?: string;
  insights?: NarrativeInsight[];
  secondary_context?: string | null;
  evidence_refs?: string[];
}

export interface RawFeature {
  id: string;
  name: string;
  type: string;
  study_area_id?: string;
  location_description?: string;
  source_identifier?: string;
  properties?: FeatureProperty[] | Record<string, unknown>;
  source_refs?: string[];
  dataset_ids?: string[];
  aliases?: string[];
  geometry?: FeatureGeometry | null;
  narrative?: FeatureNarrative | null;
}

export interface RawObservation {
  id: string;
  type: string;
  category?: string;
  value: string | number | null;
  unit?: string | null;
  original_value?: string | number | null;
  date?: string | null;
  qualifier?: string | null;
  fidelity?: string;
  feature_id?: string;
  study_area_id?: string;
  source_refs?: string[];
}

export interface RawInterval {
  id: string;
  name?: string;
  type?: string;
  axis?: string; // 'depth' | 'elevation'
  reference?: string; // 'below_ground_level' | 'ground_surface'
  start: number | null;
  end: number | null;
  thickness?: number | null;
  unit?: string;
  material?: string;
  qualifier?: string;
  fidelity?: string;
  feature_id?: string;
  study_area_id?: string;
  source_refs?: string[];
}

export interface PreservedDataset {
  id: string;
  title?: string;
  name?: string;
  columns?: string[];
  rows?: Array<Record<string, unknown> | Array<unknown>>;
  source_refs?: string[];
}

export interface ScientificPackage {
  schema_version: string;
  report?: ReportMeta;
  study_areas: StudyArea[];
  features: RawFeature[];
  observations: RawObservation[];
  intervals: RawInterval[];
  sources: SourceReference[];
  extensions?: {
    datasets?: PreservedDataset[];
    relationships?: Array<Record<string, unknown>>;
  };
}

/**
 * Normalized UI Render-Ready Model
 */

export interface RenderablePointFeature {
  id: string;
  name: string;
  type: string; // 'tube_well' | 'piezometer' | 'monitoring_station' | 'borehole'
  studyAreaId?: string;
  studyAreaName?: string;
  coordinates: [number, number]; // [lng, lat]
  elevationMsl?: number;
  totalDepthMeters?: number;
  waterLevelMeters?: number;
  waterLevelDate?: string;
  intervals: RenderableInterval[];
  observations: RenderableObservation[];
  properties: Record<string, unknown>;
  sourcePages: Array<number | string>;
  narrative?: FeatureNarrative | null;
  evidenceRefs?: string[];
}

export interface RenderableInterval {
  id: string;
  name: string;
  type: string; // 'aquifer' | 'lithology' | 'screen' | 'aquitard'
  start: number;
  end: number;
  thickness: number;
  unit: string;
  material?: string;
  colorHex: string;
  transparency: number;
  fidelity?: string;
}

export interface RenderableObservation {
  id: string;
  type: string;
  label: string;
  value: string | number;
  unit?: string;
  date?: string;
  category?: string;
}

export interface RenderableRegionalSlab {
  id: string;
  name: string;
  type: string;
  start: number;
  end: number;
  thickness: number;
  colorHex: string;
  transparency: number;
  studyAreaId: string;
  studyAreaName: string;
}

export interface ScientificUIModel {
  reportTitle: string;
  shortTitle: string;
  studyAreaName: string;
  bounds: {
    minLng: number;
    maxLng: number;
    minLat: number;
    maxLat: number;
    center: [number, number];
  };
  studyAreaPolygon: [number, number][]; // GeoJSON closed ring [lng, lat]
  featuresWithCoords: RenderablePointFeature[];
  featuresWithoutCoords: RawFeature[];
  allFeatures: (RenderablePointFeature | RawFeature)[];
  regionalSlabs: RenderableRegionalSlab[];
  preservedDatasets: PreservedDataset[];
  allObservations: RawObservation[];
  sourcesCount: number;
}
