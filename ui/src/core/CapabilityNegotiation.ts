import {
  AdaptiveLayoutMode,
  CapabilityAvailability,
  NativeAsset,
  PreservedDataset,
  QuantitativeSeries,
  RawFeature,
  RenderablePointFeature,
  ReportAnalysisModel,
  DocumentAnalysisModel,
  TimelineEvent,
  GenericExtension,
} from '../types/scientific';

/**
 * Input envelope passed to the capability negotiation engine.
 * Encapsulates all normalized spatial, quantitative, and narrative artifacts
 * discovered in the ingested scientific package.
 */
interface CapabilityInput {
  spatialFeatures: RawFeature[];
  pointFeatures: RenderablePointFeature[];
  datasets: PreservedDataset[];
  assets: NativeAsset[];
  series: QuantitativeSeries[];
  timeline: TimelineEvent[];
  report?: ReportAnalysisModel | DocumentAnalysisModel;
  preferredMode?: string;
  extensions?: GenericExtension[];
  verticalProfileCount?: number;
  crossSectionCount?: number;
}

/**
 * Human-readable labels associated with each visual and analytical capability.
 */
const label: Record<CapabilityAvailability['id'], string> = {
  'point-map': 'Located points',
  'line-map': 'Lines and corridors',
  'polygon-map': 'Areas and regions',
  'raster-overlay': 'Raster overlays',
  'surface-markers': '3D surface markers',
  'vertical-profiles': 'Vertical profiles',
  'cross-sections': 'Cross-sections',
  statistics: 'Statistics',
  'time-series': 'Time series',
  comparisons: 'Comparisons',
  distributions: 'Distributions',
  'structured-tables': 'Structured tables',
  'native-assets': 'Source figures and assets',
  narratives: 'Object narratives',
  report: 'Report synthesis',
  timeline: 'Timeline and revisions',
  'unlocated-evidence': 'Unlocated evidence',
  extensions: 'Package extensions',
  provenance: 'Provenance and quality',
  'comparison-workspace': 'Comparison workspace',
};

/**
 * Evaluates the contents of a normalized scientific package and determines
 * which UI workspaces and visual modalities are supported by valid evidence.
 *
 * Enforces the clean-room rule: views are enabled ONLY when underlying evidence exists.
 * When data is absent, a descriptive fallback reason is populated.
 *
 * @param input - The extracted spatial, quantitative, and narrative entities.
 * @returns An object containing the list of capabilities and the negotiated primary layout.
 */
export function negotiateCapabilities(input: CapabilityInput): {
  capabilities: CapabilityAvailability[];
  primaryLayout: AdaptiveLayoutMode;
} {
  const geometryCount = (kinds: string[]) => input.spatialFeatures.filter((feature) =>
    feature.geometry && kinds.includes(feature.geometry.type)
  ).length;
  const depthCount = input.pointFeatures.filter((feature) =>
    feature.intervals.length > 0 ||
    (feature.totalDepthMeters != null && feature.depthFidelity !== 'illustrative_default')
  ).length;
  const observations = input.pointFeatures.flatMap((feature) => feature.observations);
  const unlocatedCount = input.spatialFeatures.filter((feature) => !feature.geometry).length;
  const values: Array<[CapabilityAvailability['id'], number]> = [
    ['point-map', geometryCount(['Point', 'MultiPoint'])],
    ['line-map', geometryCount(['LineString', 'MultiLineString'])],
    ['polygon-map', geometryCount(['Polygon', 'MultiPolygon'])],
    ['raster-overlay', input.assets.filter((asset) => asset.bounds).length],
    ['surface-markers', input.pointFeatures.length],
    ['vertical-profiles', Math.max(depthCount, input.verticalProfileCount || 0)],
    ['cross-sections', Math.max(input.crossSectionCount || 0, input.assets.filter((asset) => /section|profile|borelog/i.test(`${asset.kind} ${asset.title}`)).length)],
    ['statistics', input.report ? ('stat_callouts' in input.report.raw
      ? input.report.raw.stat_callouts.length
      : input.report.raw.blocks.reduce((count, block) => count + (block.metrics?.length || 0), 0)) || observations.length : observations.length],
    ['time-series', input.series.filter((series) => /time|line|trend/i.test(series.kind)).length],
    ['comparisons', input.series.filter((series) => /compar|scenario|before|after/i.test(series.kind)).length],
    ['distributions', input.series.filter((series) => /histogram|distribution|scatter/i.test(series.kind)).length],
    ['structured-tables', input.datasets.length],
    ['native-assets', input.assets.length],
    ['narratives', input.spatialFeatures.filter((feature) => feature.narrative).length],
    ['report', input.report ? 1 : 0],
    ['timeline', input.timeline.length],
    ['unlocated-evidence', unlocatedCount],
    ['extensions', input.extensions?.length || 0],
    ['provenance', input.spatialFeatures.filter((feature) => Boolean(feature.source_refs?.length || feature.confidence || feature.locationFidelity)).length],
    ['comparison-workspace', input.series.filter((series) => /compar|scenario|before|after|edition/i.test(`${series.kind} ${series.title}`)).length],
  ];
  const capabilities = values.map(([id, count]) => ({
    id,
    count,
    label: label[id],
    available: count > 0,
    reason: count > 0 ? undefined : `No validated ${label[id].toLowerCase()} are present in this package.`,
  }));

  const preferred = (input.preferredMode || '').toLowerCase();
  let primaryLayout: AdaptiveLayoutMode;
  if (/corridor|alignment/.test(preferred) || geometryCount(['LineString', 'MultiLineString']) > geometryCount(['Point', 'MultiPoint'])) {
    primaryLayout = 'corridor-first';
  } else if (/figure|image/.test(preferred) || (input.assets.length > 0 && input.pointFeatures.length === 0)) {
    primaryLayout = 'figure-first';
  } else if (/subsurface|profile|vertical|3d/.test(preferred) || depthCount >= 3) {
    primaryLayout = 'vertical-first';
  } else if (/dashboard|table/.test(preferred) || (input.datasets.length > 0 && input.pointFeatures.length === 0)) {
    primaryLayout = 'dashboard-first';
  } else if (input.pointFeatures.length > 0 || geometryCount(['Polygon', 'MultiPolygon', 'LineString', 'MultiLineString']) > 0) {
    primaryLayout = 'map-first';
  } else {
    primaryLayout = 'report-first';
  }
  return { capabilities, primaryLayout };
}
