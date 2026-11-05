/**
 * @file AgenticStudyAdapter.ts
 * @module ui/core/AgenticStudyAdapter
 * @description Bridges the agentic extraction pipeline output (`document-study.v2` and
 * `study-rendering.v2` contracts) to the UI's canonical `ScientificPackage` representation.
 *
 * Capabilities:
 * - Detects agentic package structure via `isAgenticPackage()`.
 * - Normalizes features, layers, structured resources, vertical profiles, and transects.
 * - Ingests native figures, charts, and report synthesis chapters while preserving
 *   exact source grounding references and confidence tiers.
 */

import {
  AgenticLayer,
  AgenticPackageMetadata,
  AgenticStructuredResource,
  AgenticVerticalProfile,
  FeatureNarrative,
  FeatureProperty,
  PreservedDataset,
  RawFeature,
  RawInterval,
  RawObservation,
  ReportChapter,
  ReportFinding,
  ReportSynthesisPackage,
  ReportTheme,
  ScientificPackage,
  SourceReference,
  StudyArea,
  FeatureGeometry,
  NativeAsset,
  QuantitativeSeries,
  TimelineEvent,
  GenericExtension,
  DocumentAnalysisPackage,
  AgenticNarrativeTarget,
} from '../types/scientific';

type JsonRecord = Record<string, any>;

const asArray = <T = JsonRecord>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

function unique(values: Array<string | undefined | null>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function normalizePropertyName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function normalizeProperties(properties: unknown): FeatureProperty[] {
  const result: FeatureProperty[] = [];
  for (const property of asArray<JsonRecord>(properties)) {
    if (!property?.name) continue;
    result.push({ name: property.name, value: property.value ?? null, unit: property.unit ?? null });
    const normalized = normalizePropertyName(String(property.name));
    const canonical = /depth.*drill|drill.*depth|total.*depth/.test(normalized)
      ? 'drilled_depth_m'
      : /^(swl|static_water_level|standing_water_level)$/.test(normalized)
        ? 'water_level_meters'
        : undefined;
    if (canonical && !result.some((item) => item.name === canonical)) {
      result.push({ name: canonical, value: property.value ?? null, unit: property.unit ?? null });
    }
  }
  return result;
}

function normalizeGeometry(value: unknown): FeatureGeometry | null {
  const geometry = value as JsonRecord | null;
  const supported = new Set(['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon']);
  if (!geometry || !supported.has(geometry.type) || !Array.isArray(geometry.coordinates)) return null;
  return {
    type: geometry.type,
    coordinates: geometry.coordinates,
    crs: geometry.crs,
    fidelity: geometry.fidelity,
  } as FeatureGeometry;
}

function normalizeNarrative(raw: JsonRecord | undefined, fallbackId: string, allowLegacyV2 = false): FeatureNarrative | null {
  if (!raw) return null;
  // ui-narrative.v3 deliberately has one user-facing field. Never promote
  // legacy summaries or other metadata into authored analysis. The explicit
  // v2 branch keeps already-materialized demo packages readable during migration.
  const analysis = typeof raw.analysis === 'string'
    ? raw.analysis.trim()
    : allowLegacyV2 ? String(raw.summary || '').trim() : '';
  if (!analysis) return null;
  return {
    analysis,
    status: raw.status || 'complete',
    headline: raw.headline,
    summary: raw.summary,
    why_it_matters: raw.why_it_matters,
    visual_takeaway: raw.visual_takeaway,
    secondary_context: raw.secondary_context ?? null,
    evidence_refs: unique(asArray<string>(raw.evidence_refs)),
    insights: asArray<JsonRecord>(raw.insights).map((insight, index) => ({
      id: insight.id || `${fallbackId}:insight:${index + 1}`,
      type: insight.type || 'interpretation',
      title: insight.title || `Insight ${index + 1}`,
      explanation: insight.explanation || '',
      observation_ids: asArray<string>(insight.observation_ids),
      interval_ids: asArray<string>(insight.interval_ids),
      dataset_ids: asArray<string>(insight.dataset_ids),
      evidence_refs: unique(asArray<string>(insight.evidence_refs)),
      grounding_status: insight.grounding_status,
    })),
  };
}

function buildAliasIndex(features: JsonRecord[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const feature of features) {
    if (!feature?.id) continue;
    const aliases = unique([
      feature.id,
      ...asArray<string>(feature.source_object_ids),
      ...asArray<string>(feature.aliases),
    ]);
    aliases.forEach((alias) => index.set(alias, feature.id));
  }
  return index;
}

function adaptReport(
  rawReport: JsonRecord | undefined,
  studyId: string,
  featureAliases: Map<string, string>,
  studyAreaId: string,
  resourceAliases: Map<string, string>,
  diagnostics: string[],
): ReportSynthesisPackage | undefined {
  if (!rawReport?.executive_overview || !Array.isArray(rawReport.findings)) return undefined;

  const resolveFeatures = (ids: unknown): string[] => asArray<string>(ids).flatMap((id) => {
    const resolved = featureAliases.get(id);
    if (!resolved) diagnostics.push(`Unresolved Agentic report feature reference: ${id}`);
    return resolved ? [resolved] : [];
  });
  const resolveResources = (ids: unknown): string[] => asArray<string>(ids).map((id) => resourceAliases.get(id) || id);

  const findings: ReportFinding[] = rawReport.findings.map((finding: JsonRecord) => ({
    id: finding.id,
    title: finding.title || 'Untitled finding',
    statement: finding.statement || '',
    why_it_matters: finding.why_it_matters || '',
    scope: finding.scope || 'report',
    pattern_type: finding.pattern_type || 'descriptive',
    basis: finding.basis === 'direct' ? 'source_stated' : finding.basis === 'derived' ? 'deterministic_derived' : 'synthesized_pattern',
    confidence: finding.confidence || 'medium',
    feature_ids: resolveFeatures(finding.feature_ids),
    study_area_ids: asArray<string>(finding.study_area_ids).length ? [studyAreaId] : [],
    observation_ids: asArray<string>(finding.observation_ids),
    interval_ids: asArray<string>(finding.interval_ids),
    dataset_ids: resolveResources(finding.dataset_ids),
    evidence_refs: unique(asArray<string>(finding.evidence_refs)),
    stat_callout_ids: asArray<string>(finding.stat_callout_ids),
  }));

  const themes: ReportTheme[] = asArray<JsonRecord>(rawReport.themes).map((theme) => ({
    id: theme.id,
    title: theme.title || 'Untitled theme',
    summary: theme.summary || '',
    chapter_ids: asArray<string>(theme.chapter_ids),
    finding_ids: asArray<string>(theme.finding_ids),
  }));

  const chapters: ReportChapter[] = asArray<JsonRecord>(rawReport.chapters).map((chapter) => ({
    id: chapter.id,
    theme_id: chapter.theme_id,
    title: chapter.title || 'Untitled chapter',
    summary: chapter.summary || '',
    narrative: chapter.narrative || '',
    finding_ids: asArray<string>(chapter.finding_ids),
    evidence_refs: unique(asArray<string>(chapter.evidence_refs)),
    focal_feature_ids: resolveFeatures(chapter.focal_feature_ids),
    focal_study_area_ids: asArray<string>(chapter.focal_study_area_ids).length ? [studyAreaId] : [],
    focal_observation_ids: asArray<string>(chapter.focal_observation_ids),
    focal_interval_ids: asArray<string>(chapter.focal_interval_ids),
    focal_dataset_ids: resolveResources(chapter.focal_dataset_ids),
  }));

  return {
    schema_version: 'report-synthesis.v1',
    report_id: studyId,
    themes,
    chapters,
    findings,
    stat_callouts: asArray<JsonRecord>(rawReport.stat_callouts).map((callout) => ({
      id: callout.id,
      label: callout.label || 'Statistic',
      kind: callout.kind,
      value: typeof callout.value === 'number' ? callout.value : null,
      value_range: callout.minimum != null || callout.maximum != null
        ? { minimum: callout.minimum ?? null, maximum: callout.maximum ?? null }
        : callout.value_range,
      category: callout.category,
      unit: callout.unit,
      qualifier: callout.qualifier,
      evidence_refs: unique(asArray<string>(callout.evidence_refs)),
    })),
    uncertainties: asArray<JsonRecord>(rawReport.uncertainties).map((uncertainty) => ({
      id: uncertainty.id,
      statement: uncertainty.statement || '',
      theme_id: uncertainty.theme_id,
    })),
    coverage: rawReport.coverage || {},
    executive_overview: {
      headline: rawReport.executive_overview.headline || 'Study synthesis',
      abstract: rawReport.executive_overview.abstract || '',
      key_finding_ids: asArray<string>(rawReport.executive_overview.key_finding_ids),
      key_stat_callout_ids: asArray<string>(rawReport.executive_overview.key_stat_callout_ids),
      generation_mode: rawReport.executive_overview.generation_mode,
    },
  };
}

function adaptDocumentAnalysis(
  rawReport: JsonRecord | undefined,
  studyId: string,
  featureAliases: Map<string, string>,
  diagnostics: string[],
): DocumentAnalysisPackage | undefined {
  if (rawReport?.schema_version !== 'document-analysis.v1' || !Array.isArray(rawReport.blocks)) return undefined;

  const blocks = asArray<JsonRecord>(rawReport.blocks).flatMap((block, index) => {
    const metrics = asArray<JsonRecord>(block.metrics).flatMap((metric) => {
      const label = String(metric.label || '').trim();
      const displayValue = String(metric.display_value || '').trim();
      if (!label || !displayValue) return [];
      return [{
        label,
        display_value: displayValue,
        ...(String(metric.explanation || '').trim() ? { explanation: String(metric.explanation).trim() } : {}),
        evidence_refs: unique(asArray<string>(metric.evidence_refs)),
      }];
    });
    const content = String(block.content || '').trim();
    const headline = String(block.headline || '').trim();
    const relatedObjectIds = unique(asArray<string>(block.related_object_ids).flatMap((id) => {
      const resolved = featureAliases.get(id);
      if (!resolved) diagnostics.push(`Unresolved document analysis object reference: ${id}`);
      return resolved ? [resolved] : [];
    }));
    const blockEvidenceRefs = unique(asArray<string>(block.evidence_refs));
    if (!headline && !content && metrics.length === 0 && relatedObjectIds.length === 0 && blockEvidenceRefs.length === 0) return [];
    return [{
      id: String(block.id || `block-${index + 1}`),
      ...(headline ? { headline } : {}),
      ...(content ? { content } : {}),
      ...(metrics.length ? { metrics } : {}),
      ...(blockEvidenceRefs.length ? { evidence_refs: blockEvidenceRefs } : {}),
      ...(relatedObjectIds.length ? { related_object_ids: relatedObjectIds } : {}),
    }];
  });

  return {
    schema_version: 'document-analysis.v1',
    report_id: rawReport.report_id || studyId,
    source_title: String(rawReport.source_title || '').trim(),
    display_title: String(rawReport.display_title || rawReport.source_title || '').trim(),
    short_title: String(rawReport.short_title || rawReport.display_title || rawReport.source_title || '').trim(),
    brief_description: String(rawReport.brief_description || '').trim(),
    blocks,
  };
}

export class AgenticStudyAdapter {
  static isAgenticPackage(value: unknown): boolean {
    const raw = value as JsonRecord | null;
    return raw?.schema_version === 'document-study.v2' && raw?.rendering_package?.schema_version === 'study-rendering.v2';
  }

  static adapt(value: unknown): ScientificPackage {
    if (!this.isAgenticPackage(value)) throw new Error('Unsupported Agentic package: expected document-study.v2 / study-rendering.v2');
    const raw = value as JsonRecord;
    const rendering = raw.rendering_package as JsonRecord;
    const study = rendering.study || raw.scientific_rendering_package?.study || {};
    const studyId = study.id || raw.study_id;
    const studyAreaId = `${studyId}:area`;
    const diagnostics: string[] = [];
    const rawFeatures = asArray<JsonRecord>(rendering.features);
    const rawLayers = asArray<JsonRecord>(rendering.layers);
    const layerIdsByFeature = new Map<string, string[]>();
    rawLayers.forEach((layer) => asArray<string>(layer.feature_ids).forEach((featureId) => {
      const current = layerIdsByFeature.get(featureId) || []; current.push(layer.id); layerIdsByFeature.set(featureId, current);
    }));
    const featureAliases = buildAliasIndex(rawFeatures);
    const resources = asArray<JsonRecord>(rendering.structured_resources);
    const narrativeSchemaVersion = String(raw.narrative_package?.schema_version || '');
    const allowLegacyNarrativeV2 = narrativeSchemaVersion === 'ui-narrative.v2';
    const resourceAliases = new Map<string, string>();
    resources.forEach((resource) => {
      if (resource.id) resourceAliases.set(resource.id, resource.id);
      if (resource.source_asset_id) resourceAliases.set(resource.source_asset_id, resource.id);
    });

    const narrativeTargets: AgenticNarrativeTarget[] = asArray<JsonRecord>(raw.narrative_package?.target_insights).flatMap((target, index) => {
      const targetKind = target.target_kind;
      const objectId = String(target.object_id || '').trim();
      const analysis = typeof target.analysis === 'string'
        ? target.analysis.trim()
        : allowLegacyNarrativeV2 ? String(target.summary || '').trim() : '';
      if (!['feature', 'layer', 'vertical_profile', 'study'].includes(targetKind) || !objectId || !analysis) return [];
      return [{
        targetId: String(target.target_id || `narrative-target:${index + 1}`),
        targetKind,
        objectId,
        analysis,
        evidenceRefs: unique(asArray<string>(target.evidence_refs)),
      } as AgenticNarrativeTarget];
    });
    const featureNarrativeByObjectId = new Map<string, JsonRecord>();
    asArray<JsonRecord>(raw.narrative_package?.target_insights).forEach((target) => {
      if (target.target_kind === 'feature' && target.object_id) featureNarrativeByObjectId.set(target.object_id, target);
    });

    const features: RawFeature[] = rawFeatures.map((feature) => ({
      id: feature.id,
      name: feature.name || feature.id,
      type: feature.type || 'scientific_feature',
      study_area_id: studyAreaId,
      location_description: feature.location_description,
      properties: normalizeProperties(feature.properties),
      source_refs: unique([...asArray<string>(feature.source_refs), ...asArray<string>(feature.evidence_refs)]),
      dataset_ids: asArray<string>(feature.dataset_ids).map((id) => resourceAliases.get(id) || id),
      aliases: unique(asArray<string>(feature.source_object_ids)),
      geometry: normalizeGeometry(feature.geometry),
      narrative: normalizeNarrative(featureNarrativeByObjectId.get(feature.id), feature.id, allowLegacyNarrativeV2),
      evidenceStatus: feature.evidence_status || feature.status || feature.provenance?.basis,
      locationFidelity: feature.location_fidelity || feature.geometry?.fidelity || (feature.geometry ? 'exact' : 'unlocated'),
      confidence: feature.confidence,
      observedAt: feature.observed_at || feature.observation_time,
      publishedAt: feature.published_at || raw.source?.publication_date,
      layerIds: unique(layerIdsByFeature.get(feature.id) || []),
    }));

    const observations: RawObservation[] = asArray<JsonRecord>(rendering.observations).map((observation) => {
      const featureId = observation.feature_id || featureAliases.get(observation.subject_id);
      return {
        id: observation.id,
        type: observation.type || 'observation',
        category: observation.category,
        value: observation.value ?? observation.statement ?? null,
        unit: observation.unit,
        original_value: observation.original_value,
        date: observation.date,
        qualifier: observation.qualifier || observation.statement,
        fidelity: observation.fidelity,
        feature_id: featureId,
        study_area_id: featureId ? undefined : studyAreaId,
        source_refs: unique([...asArray<string>(observation.source_refs), ...asArray<string>(observation.evidence_refs)]),
      };
    });

    const intervals: RawInterval[] = asArray<JsonRecord>(rendering.intervals).map((interval) => ({
      id: interval.id,
      name: interval.name,
      type: interval.type,
      axis: interval.axis,
      reference: interval.reference,
      start: typeof interval.start === 'number' ? interval.start : null,
      end: typeof interval.end === 'number' ? interval.end : null,
      thickness: typeof interval.thickness === 'number' ? interval.thickness : null,
      unit: interval.unit,
      material: interval.material,
      qualifier: interval.qualifier,
      fidelity: interval.fidelity,
      feature_id: featureAliases.get(interval.feature_id) || interval.feature_id,
      study_area_id: interval.feature_id ? undefined : studyAreaId,
      source_refs: unique([...asArray<string>(interval.source_refs), ...asArray<string>(interval.evidence_refs)]),
    }));

    const evidenceRefs = new Set<string>();
    for (const item of [...features, ...observations, ...intervals]) {
      item.source_refs?.forEach((id) => evidenceRefs.add(id));
    }
    asArray<JsonRecord>(raw.report?.findings).forEach((finding) => asArray<string>(finding.evidence_refs).forEach((id) => evidenceRefs.add(id)));
    asArray<JsonRecord>(raw.report?.blocks).forEach((block) => {
      asArray<string>(block.evidence_refs).forEach((id) => evidenceRefs.add(id));
      asArray<JsonRecord>(block.metrics).forEach((metric) => asArray<string>(metric.evidence_refs).forEach((id) => evidenceRefs.add(id)));
    });
    narrativeTargets.forEach((target) => target.evidenceRefs.forEach((id) => evidenceRefs.add(id)));
    rawLayers.forEach((layer) => asArray<string>(layer.evidence_refs).forEach((id) => evidenceRefs.add(id)));
    asArray<JsonRecord>(rendering.vertical_profiles).forEach((profile) => asArray<string>(profile.evidence_refs).forEach((id) => evidenceRefs.add(id)));
    resources.forEach((resource) => {
      asArray<string>(resource.source_refs).forEach((id) => evidenceRefs.add(id));
      asArray<string>(resource.evidence_refs).forEach((id) => evidenceRefs.add(id));
    });
    asArray<JsonRecord>(rendering.chart_series).forEach((series) => {
      asArray<string>(series.evidence_refs).forEach((id) => evidenceRefs.add(id));
      asArray<JsonRecord>(series.points).forEach((point) => asArray<string>(point.evidence_refs).forEach((id) => evidenceRefs.add(id)));
    });
    const pageByAssetId = new Map<string, number | string>();
    asArray<JsonRecord>(raw.native_assets).forEach((asset) => {
      if (asset.asset_id && asset.page != null) pageByAssetId.set(asset.asset_id, asset.page);
    });
    const sources: SourceReference[] = Array.from(evidenceRefs).map((id) => ({ id, page: pageByAssetId.get(id) }));

    const structuredResources: AgenticStructuredResource[] = resources.map((resource) => ({
      id: resource.id,
      name: resource.name || resource.id,
      kind: resource.kind,
      ui_role: resource.ui_role,
      path: resource.path,
      source_asset_id: resource.source_asset_id,
      row_count: resource.row_count,
      columns: asArray<string>(resource.columns),
      evidence_refs: unique([...asArray<string>(resource.source_refs), ...asArray<string>(resource.evidence_refs)]),
    }));
    const datasets: PreservedDataset[] = structuredResources.map((resource) => ({
      id: resource.id,
      title: resource.name,
      name: resource.name,
      columns: resource.columns,
      source_refs: resource.evidence_refs,
      path: resource.path,
      kind: resource.kind,
      ui_role: resource.ui_role,
      row_count: resource.row_count,
      rows: asArray<JsonRecord>(resources.find((candidate) => candidate.id === resource.id)?.rows),
    }));

    const nativeAssets: NativeAsset[] = asArray<JsonRecord>(raw.native_assets).map((asset, index) => ({
      id: asset.id || asset.asset_id || `asset:${index + 1}`,
      title: asset.title || asset.name || asset.caption || `Source asset ${index + 1}`,
      kind: asset.kind || asset.asset_type || asset.type || 'source_asset',
      path: asset.path || asset.uri,
      page: asset.page,
      caption: asset.caption || asset.description,
      mimeType: asset.mime_type,
      bounds: Array.isArray(asset.bounds) && asset.bounds.length === 4
        ? asset.bounds as [number, number, number, number]
        : undefined,
      fidelity: asset.fidelity,
      evidenceRefs: unique([...asArray<string>(asset.source_refs), ...asArray<string>(asset.evidence_refs)]),
      controlPoints: asArray(asset.control_points),
      legend: asArray(asset.legend),
      extractionQuality: asset.extraction_quality || asset.quality,
      sourceKind: asset.source_kind || (asset.model_generated ? 'model-generated' : 'direct-source'),
      hotspots: asArray(asset.hotspots),
    }));
    const quantitativeSeries: QuantitativeSeries[] = asArray<JsonRecord>(rendering.chart_series || raw.chart_series).flatMap((series, index) => {
      const rawPoints = asArray<JsonRecord>(series.points);
      if (!series.id || !series.title || !series.kind || !Array.isArray(series.points)) {
        diagnostics.push(`Invalid chart series contract at index ${index}: id, title, kind, and points are required`);
        return [];
      }
      const points = rawPoints.flatMap((point, pointIndex) => {
        const x = point.x ?? point.date ?? point.category ?? point.label;
        const y = Number(point.y ?? point.value);
        const optionalNumber = (value: unknown) => value == null || !Number.isFinite(Number(value)) ? undefined : Number(value);
        if (x == null || !Number.isFinite(y)) {
          diagnostics.push(`Rejected chart point ${series.id}[${pointIndex}]: x and numeric y are required`);
          return [];
        }
        const sourceFeatureId = point.feature_id;
        const resolvedFeatureId = sourceFeatureId ? featureAliases.get(sourceFeatureId) : undefined;
        if (sourceFeatureId && !resolvedFeatureId) diagnostics.push(`Unresolved chart feature reference: ${sourceFeatureId}`);
        return [{
          x, y,
          yLow: optionalNumber(point.y_low ?? point.minimum ?? point.low),
          yHigh: optionalNumber(point.y_high ?? point.maximum ?? point.high),
          group: point.group ?? point.series,
          category: point.category,
          threshold: optionalNumber(point.threshold),
          uncertainty: optionalNumber(point.uncertainty),
          featureId: resolvedFeatureId,
          observationId: point.observation_id,
          datasetId: point.dataset_id,
          evidenceRefs: unique([...asArray<string>(point.source_refs), ...asArray<string>(point.evidence_refs)]),
        }];
      });
      if (!points.length) {
        diagnostics.push(`Rejected chart series ${series.id}: no valid points survived adaptation`);
        return [];
      }
      return [{
        id: series.id,
        title: series.title,
        kind: series.kind,
        xLabel: series.x_label,
        yLabel: series.y_label,
        unit: series.unit,
        points,
        evidenceRefs: unique(asArray<string>(series.evidence_refs)),
        xUnit: series.x_unit,
        threshold: series.threshold,
        thresholdLabel: series.threshold_label,
        stackMode: series.stack_mode,
        status: series.status,
        description: series.description,
      }];
    });
    const timelineEvents: TimelineEvent[] = asArray<JsonRecord>(rendering.timelines || raw.timelines).flatMap((timeline, timelineIndex) =>
      asArray<JsonRecord>(timeline.events || timeline.items || [timeline]).map((event, eventIndex) => ({
        id: event.id || `timeline:${timelineIndex + 1}:${eventIndex + 1}`,
        title: event.title || event.label || 'Timeline event',
        timelineId: timeline.id || `timeline:${timelineIndex + 1}`,
        timelineTitle: timeline.title,
        timelineDescription: timeline.description,
        timelineUnit: timeline.unit,
        date: event.date,
        period: event.period,
        status: event.status,
        description: event.description || event.summary,
        featureIds: asArray<string>(event.feature_ids).map((id) => featureAliases.get(id) || id),
        evidenceRefs: unique([...asArray<string>(event.source_refs), ...asArray<string>(event.evidence_refs)]),
        kind: event.kind || timeline.kind,
        datasetIds: asArray<string>(event.dataset_ids),
        assetIds: asArray<string>(event.asset_ids),
      }))
    );

    const knownExtensionKeys = new Set(['datasets', 'relationships', 'agentic', 'nativeAssets', 'quantitativeSeries', 'timelineEvents']);
    const genericExtensions: GenericExtension[] = [
      ...asArray<JsonRecord>(rendering.extensions),
      ...asArray<JsonRecord>(raw.extensions),
    ].map((extension, index) => ({
      id: extension.id || `extension:${index + 1}`,
      kind: extension.kind || extension.type || 'package-extension',
      title: extension.title || extension.name || `Package extension ${index + 1}`,
      description: extension.description || extension.summary,
      rendererHint: extension.renderer_hint || extension.renderer,
      payload: extension.payload ?? extension.data ?? extension,
      evidenceRefs: unique([...asArray<string>(extension.source_refs), ...asArray<string>(extension.evidence_refs)]),
    }));
    if (raw.extensions && !Array.isArray(raw.extensions)) {
      Object.entries(raw.extensions as JsonRecord).forEach(([key, payload]) => {
        if (knownExtensionKeys.has(key)) return;
        genericExtensions.push({ id: `extension:${key}`, kind: key, title: key.replace(/[_-]+/g, ' '), payload, evidenceRefs: [] });
      });
    }

    const agentic: AgenticPackageMetadata = {
      sourceSchemaVersion: raw.schema_version,
      renderingSchemaVersion: rendering.schema_version,
      studyId,
      documentId: raw.document_id || study.document_id,
      status: raw.status,
      primaryRenderingMode: raw.primary_rendering_mode || rendering.primary_rendering_mode,
      capabilities: { ...(raw.capabilities || rendering.capabilities || {}) },
      layers: rawLayers as AgenticLayer[],
      verticalProfiles: asArray<AgenticVerticalProfile>(rendering.vertical_profiles),
      structuredResources,
      narrativeTargets,
      nativeAssets: asArray<Record<string, unknown>>(raw.native_assets),
      evidenceDispositions: asArray<Record<string, unknown>>(rendering.evidence_sidecar?.dispositions),
      coverage: { rendering: rendering.coverage || {}, narrative: raw.narrative_package?.coverage || {}, report: raw.report?.coverage || {} },
      limitations: unique([...asArray<string>(raw.limitations), ...asArray<string>(rendering.limitations)]),
      unresolvedItems: unique(asArray<string>(raw.unresolved_items)),
      validation: raw.validation,
      adapterDiagnostics: diagnostics,
      quantitativeSeries,
      timelineEvents,
    };

    const documentAnalysis = adaptDocumentAnalysis(raw.report, studyId, featureAliases, diagnostics);
    const reportSynthesis = documentAnalysis ? undefined : adaptReport(raw.report, studyId, featureAliases, studyAreaId, resourceAliases, diagnostics);
    const studyArea: StudyArea = {
      id: studyAreaId,
      name: study.short_title || study.title || 'Study region',
      type: 'agentic_study_extent',
      summary: study.summary,
    };

    return {
      schema_version: 'scientific-ui-adapter.v1',
      report: {
        id: studyId,
        title: documentAnalysis?.display_title || study.title,
        short_title: documentAnalysis?.short_title || study.short_title,
        summary: documentAnalysis?.brief_description || study.summary,
        domain: study.domain,
      },
      study_areas: [studyArea],
      features,
      observations,
      intervals,
      sources,
      extensions: { datasets, nativeAssets, quantitativeSeries, timelineEvents, genericExtensions, agentic },
      analysis_schema_version: documentAnalysis ? 'document-analysis.v1' : reportSynthesis ? 'report-synthesis.v1' : undefined,
      report_synthesis: reportSynthesis,
      document_analysis: documentAnalysis,
    };
  }
}
