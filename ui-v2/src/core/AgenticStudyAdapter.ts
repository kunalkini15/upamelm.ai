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

function normalizeNarrative(raw: JsonRecord | undefined, fallbackId: string): FeatureNarrative | null {
  if (!raw) return null;
  return {
    status: raw.status || 'complete',
    headline: raw.headline || 'Scientific feature narrative',
    summary: raw.summary || '',
    why_it_matters: raw.why_it_matters || '',
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
    const featureAliases = buildAliasIndex(rawFeatures);
    const resources = asArray<JsonRecord>(rendering.structured_resources);
    const resourceAliases = new Map<string, string>();
    resources.forEach((resource) => {
      if (resource.id) resourceAliases.set(resource.id, resource.id);
      if (resource.source_asset_id) resourceAliases.set(resource.source_asset_id, resource.id);
    });

    const narrativeByObjectId = new Map<string, JsonRecord>();
    asArray<JsonRecord>(raw.narrative_package?.target_insights).forEach((target) => {
      if (target.object_id) narrativeByObjectId.set(target.object_id, target);
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
      geometry: feature.geometry?.type === 'Point' && Array.isArray(feature.geometry.coordinates)
        ? { type: 'Point', coordinates: feature.geometry.coordinates }
        : null,
      narrative: normalizeNarrative(feature.narrative || narrativeByObjectId.get(feature.id), feature.id),
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
    }));

    const agentic: AgenticPackageMetadata = {
      sourceSchemaVersion: raw.schema_version,
      renderingSchemaVersion: rendering.schema_version,
      studyId,
      documentId: raw.document_id || study.document_id,
      status: raw.status,
      primaryRenderingMode: raw.primary_rendering_mode || rendering.primary_rendering_mode,
      capabilities: { ...(raw.capabilities || rendering.capabilities || {}) },
      layers: asArray<AgenticLayer>(rendering.layers),
      verticalProfiles: asArray<AgenticVerticalProfile>(rendering.vertical_profiles),
      structuredResources,
      nativeAssets: asArray<Record<string, unknown>>(raw.native_assets),
      evidenceDispositions: asArray<Record<string, unknown>>(rendering.evidence_sidecar?.dispositions),
      coverage: { rendering: rendering.coverage || {}, narrative: raw.narrative_package?.coverage || {}, report: raw.report?.coverage || {} },
      limitations: unique([...asArray<string>(raw.limitations), ...asArray<string>(rendering.limitations)]),
      unresolvedItems: unique(asArray<string>(raw.unresolved_items)),
      validation: raw.validation,
      adapterDiagnostics: diagnostics,
    };

    const reportSynthesis = adaptReport(raw.report, studyId, featureAliases, studyAreaId, resourceAliases, diagnostics);
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
        title: study.title,
        short_title: study.short_title,
        summary: study.summary,
        domain: study.domain,
      },
      study_areas: [studyArea],
      features,
      observations,
      intervals,
      sources,
      extensions: { datasets, agentic },
      analysis_schema_version: reportSynthesis ? 'report-synthesis.v1' : undefined,
      report_synthesis: reportSynthesis,
    };
  }
}
