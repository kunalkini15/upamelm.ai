/**
 * @file scientific.ts
 * @module ui-v2/types/scientific
 * @description Canonical domain interfaces and data models for Subsurface UI V2.
 *
 * Defines the standardized schema contracts for scientific features, spatial geometries,
 * depth intervals, hydrogeological observations, quantitative series, and executive synthesis.
 *
 * Core Guarantees:
 * - Evidence Grounding: Every measurement links to a `SourceReference` (document, page, table/figure).
 * - Confidence Typing: Explicit tiers (`measured` | `interpreted` | `reported` | `unknown`).
 * - Spatial Integrity: Strict distinction between located WGS84 coordinates and unlocated features.
 * - Subsurface Stratigraphy: Top/bottom intervals measured in meters below ground level (mbgl)
 *   or meters above mean sea level (m amsl).
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

export type GeometryKind =
  | 'Point' | 'MultiPoint'
  | 'LineString' | 'MultiLineString'
  | 'Polygon' | 'MultiPolygon';

export interface FeatureGeometry {
  type: GeometryKind;
  coordinates: unknown;
  crs?: string;
  fidelity?: string;
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
  analysis: string;
  evidence_refs?: string[];
  /** Legacy ui-narrative.v2 fields retained for package compatibility. */
  status?: string;
  insight_type?: string;
  headline?: string;
  summary?: string;
  why_it_matters?: string;
  visual_takeaway?: string;
  insights?: NarrativeInsight[];
  secondary_context?: string | null;
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
  evidenceStatus?: 'observed' | 'reported' | 'derived' | 'figure-derived' | 'proposed' | 'external-context' | string;
  locationFidelity?: 'exact' | 'approximate' | 'unlocated' | string;
  confidence?: 'high' | 'medium' | 'low' | string;
  observedAt?: string;
  publishedAt?: string;
  layerIds?: string[];
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
  path?: string;
  kind?: string;
  ui_role?: string;
  row_count?: number;
  description?: string;
}

export interface NativeAsset {
  id: string;
  title: string;
  kind: string;
  path?: string;
  page?: number | string;
  caption?: string;
  mimeType?: string;
  bounds?: [number, number, number, number];
  fidelity?: string;
  evidenceRefs: string[];
  controlPoints?: Array<{ pixel: [number, number]; coordinate: [number, number] }>;
  legend?: Array<{ label: string; color?: string; value?: string | number }>;
  extractionQuality?: string;
  sourceKind?: 'direct-source' | 'model-generated' | string;
  hotspots?: Array<{ id: string; label: string; x: number; y: number; featureId?: string }>;
}

export interface QuantitativeSeries {
  id: string;
  title: string;
  kind: string;
  xLabel?: string;
  yLabel?: string;
  unit?: string;
  points: Array<{
    x: string | number;
    y: number;
    yLow?: number;
    yHigh?: number;
    group?: string;
    category?: string;
    threshold?: number;
    uncertainty?: number;
    featureId?: string;
    observationId?: string;
    datasetId?: string;
    evidenceRefs?: string[];
  }>;
  evidenceRefs: string[];
  xUnit?: string;
  threshold?: number;
  thresholdLabel?: string;
  stackMode?: 'grouped' | 'stacked' | 'normalized';
  status?: 'historical' | 'current' | 'forecast' | 'proposed' | string;
  description?: string;
}

export interface TimelineEvent {
  id: string;
  title: string;
  timelineId?: string;
  timelineTitle?: string;
  timelineDescription?: string;
  timelineUnit?: string;
  date?: string;
  period?: string;
  status?: string;
  description?: string;
  featureIds: string[];
  evidenceRefs: string[];
  kind?: 'observation' | 'publication' | 'forecast' | 'revision' | 'proposal' | string;
  datasetIds?: string[];
  assetIds?: string[];
}

export interface GenericExtension {
  id: string;
  kind: string;
  title: string;
  description?: string;
  rendererHint?: string;
  payload: unknown;
  evidenceRefs: string[];
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
    agentic?: AgenticPackageMetadata;
    nativeAssets?: NativeAsset[];
    quantitativeSeries?: QuantitativeSeries[];
    timelineEvents?: TimelineEvent[];
    genericExtensions?: GenericExtension[];
  };
  analysis_schema_version?: string;
  report_synthesis?: ReportSynthesisPackage;
  document_analysis?: DocumentAnalysisPackage;
}

export interface AgenticLayer {
  id: string;
  name: string;
  kind?: string;
  description?: string;
  representation?: string;
  semantic_category?: string;
  default_visible?: boolean;
  feature_ids?: string[];
  profile_ids?: string[];
  resource_ids?: string[];
  source_asset_ids?: string[];
  evidence_refs?: string[];
}

export interface AgenticVerticalProfile {
  id: string;
  name: string;
  axis?: string;
  reference?: string;
  description?: string;
  feature_id?: string;
  interval_ids?: string[];
  semantic_category?: string;
  evidence_refs?: string[];
}

export interface AgenticStructuredResource {
  id: string;
  name: string;
  kind?: string;
  ui_role?: string;
  path?: string;
  source_asset_id?: string;
  row_count?: number;
  columns?: string[];
  evidence_refs?: string[];
}

export interface AgenticNarrativeTarget {
  targetId: string;
  targetKind: 'feature' | 'layer' | 'vertical_profile' | 'study';
  objectId: string;
  analysis: string;
  evidenceRefs: string[];
}

export interface AgenticPackageMetadata {
  sourceSchemaVersion: string;
  renderingSchemaVersion?: string;
  studyId: string;
  documentId?: string;
  status?: string;
  primaryRenderingMode?: string;
  capabilities: Record<string, boolean>;
  layers: AgenticLayer[];
  verticalProfiles: AgenticVerticalProfile[];
  structuredResources: AgenticStructuredResource[];
  narrativeTargets: AgenticNarrativeTarget[];
  nativeAssets: Array<Record<string, unknown>>;
  evidenceDispositions: Array<Record<string, unknown>>;
  coverage: Record<string, unknown>;
  limitations: string[];
  unresolvedItems: string[];
  validation?: Record<string, unknown>;
  adapterDiagnostics: string[];
  quantitativeSeries: QuantitativeSeries[];
  timelineEvents: TimelineEvent[];
}

export type GenericCapabilityId =
  | 'point-map' | 'line-map' | 'polygon-map' | 'raster-overlay'
  | 'surface-markers' | 'vertical-profiles' | 'cross-sections'
  | 'statistics' | 'time-series' | 'comparisons' | 'distributions'
  | 'structured-tables' | 'native-assets'
  | 'narratives' | 'report' | 'timeline' | 'unlocated-evidence'
  | 'extensions' | 'provenance' | 'comparison-workspace';

export interface CapabilityAvailability {
  id: GenericCapabilityId;
  available: boolean;
  count: number;
  label: string;
  reason?: string;
}

export type AdaptiveLayoutMode =
  | 'map-first' | 'vertical-first' | 'corridor-first'
  | 'dashboard-first' | 'figure-first' | 'report-first';

export type ReportFindingBasis = 'source_stated' | 'synthesized_pattern' | 'deterministic_derived' | string;
export type ReportFindingConfidence = 'high' | 'medium' | 'low' | string;

export interface ReportStatCallout {
  id: string;
  label: string;
  kind?: string | null;
  value?: number | null;
  value_range?: { minimum?: number | null; maximum?: number | null } | null;
  category?: string | null;
  unit?: string | null;
  qualifier?: string | null;
  evidence_refs?: string[];
}

export interface ReportFinding {
  id: string;
  title: string;
  statement: string;
  why_it_matters: string;
  scope: string;
  pattern_type: string;
  basis: ReportFindingBasis;
  confidence: ReportFindingConfidence;
  feature_ids?: string[];
  study_area_ids?: string[];
  observation_ids?: string[];
  interval_ids?: string[];
  dataset_ids?: string[];
  evidence_refs?: string[];
  stat_callout_ids?: string[];
}

export interface ReportTheme {
  id: string;
  title: string;
  summary: string;
  chapter_ids: string[];
  finding_ids?: string[];
}

export interface ReportChapter {
  id: string;
  theme_id: string;
  title: string;
  summary: string;
  narrative: string;
  finding_ids: string[];
  evidence_refs?: string[];
  focal_feature_ids?: string[];
  focal_study_area_ids?: string[];
  focal_observation_ids?: string[];
  focal_interval_ids?: string[];
  focal_dataset_ids?: string[];
}

export interface ReportUncertainty {
  id: string;
  statement: string;
  theme_id?: string;
}

export interface ReportSynthesisPackage {
  schema_version: string;
  report_id: string;
  audience?: string;
  themes: ReportTheme[];
  chapters: ReportChapter[];
  findings: ReportFinding[];
  stat_callouts: ReportStatCallout[];
  uncertainties: ReportUncertainty[];
  coverage?: Record<string, unknown>;
  executive_overview: {
    headline: string;
    abstract: string;
    key_finding_ids: string[];
    key_stat_callout_ids: string[];
    generation_mode?: string;
  };
}

export type NormalizedPatternCategory =
  | 'Status & Inventory'
  | 'Spatial Contrast'
  | 'Temporal Change'
  | 'Vertical Stratigraphy'
  | 'Process & Mechanism'
  | 'Scenarios & Interventions'
  | 'Data & Caveats';

export type VisualizationCapability =
  | 'spatial'
  | 'temporal-series'
  | 'vertical-profile'
  | 'scenario-comparison'
  | 'categorical-matrix'
  | 'entity-matrix'
  | 'statistical-summary'
  | 'narrative-evidence';

export interface ReportFindingView extends ReportFinding {
  normalizedCategories: NormalizedPatternCategory[];
  capabilities: VisualizationCapability[];
  resolvedFeatureIds: string[];
  resolvedStudyAreaIds: string[];
  resolvedObservationIds: string[];
  resolvedIntervalIds: string[];
  resolvedDatasetIds: string[];
  unresolvedReferences: string[];
}

export interface ReportAnalysisModel {
  raw: ReportSynthesisPackage;
  themes: ReportTheme[];
  chaptersById: Map<string, ReportChapter>;
  findingsById: Map<string, ReportFindingView>;
  calloutsById: Map<string, ReportStatCallout>;
  uncertainties: ReportUncertainty[];
  uncertaintiesByThemeId: Map<string, ReportUncertainty[]>;
  findingsByThemeId: Map<string, ReportFindingView[]>;
  findingsByChapterId: Map<string, ReportFindingView[]>;
  findingsByFeatureId: Map<string, ReportFindingView[]>;
  findingsByStudyAreaId: Map<string, ReportFindingView[]>;
  findingsByObservationId: Map<string, ReportFindingView[]>;
  findingsByIntervalId: Map<string, ReportFindingView[]>;
  findingsByDatasetId: Map<string, ReportFindingView[]>;
  unresolvedUncertaintyCount: number;
  diagnostics: string[];
}

export interface DocumentAnalysisMetric {
  label: string;
  display_value: string;
  explanation?: string;
  evidence_refs: string[];
}

export interface DocumentAnalysisBlock {
  id: string;
  headline?: string;
  content?: string;
  metrics?: DocumentAnalysisMetric[];
  evidence_refs?: string[];
  related_object_ids?: string[];
}

export interface DocumentAnalysisPackage {
  schema_version: string;
  report_id: string;
  source_title: string;
  display_title: string;
  short_title: string;
  brief_description: string;
  blocks: DocumentAnalysisBlock[];
}

export interface DocumentAnalysisModel {
  raw: DocumentAnalysisPackage;
  blocks: DocumentAnalysisBlock[];
  diagnostics: string[];
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
  coordinateFidelity: 'reported' | 'property' | 'parsed_dms';
  depthFidelity: 'reported' | 'interval_derived' | 'illustrative_default';
  hasSyntheticIntervals: boolean;
  isSpatialOutlier: boolean;
  layerIds?: string[];
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
  spatialFeatures: RawFeature[];
  nativeAssets: NativeAsset[];
  quantitativeSeries: QuantitativeSeries[];
  timelineEvents: TimelineEvent[];
  allIntervals: RawInterval[];
  genericExtensions: GenericExtension[];
  capabilities: CapabilityAvailability[];
  primaryLayout: AdaptiveLayoutMode;
  allObservations: RawObservation[];
  sourcesCount: number;
  renderingNotes: {
    studyAreaBoundary: 'station_hull' | 'reported_bounds' | 'fallback_bounds';
    hiddenFeatureCount: number;
  };
  reportAnalysis?: ReportAnalysisModel;
  documentAnalysis?: DocumentAnalysisModel;
  packageFamily: 'research-engine' | 'agentic-flow';
  sourceBaseUrl?: string;
  agentic?: AgenticPackageMetadata;
}
