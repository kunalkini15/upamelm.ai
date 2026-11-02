import {
  NormalizedPatternCategory,
  ReportAnalysisModel,
  ReportFinding,
  ReportFindingView,
  ReportSynthesisPackage,
  ReportUncertainty,
  ReportStatCallout,
  VisualizationCapability,
} from '../types/scientific';

export interface ReportReferenceSets {
  featureIds: Set<string>;
  studyAreaIds: Set<string>;
  observationIds: Set<string>;
  intervalIds: Set<string>;
  datasetIds: Set<string>;
  datedObservationIds: Set<string>;
}

// Report-specific semantics are selectors, not generated artifact IDs. The
// generic heuristics remain the fallback for every other report.
const REPORT_PROFILES: Record<string, { executiveRoles: RegExp[] }> = {
  rep_gandhinagar_naquim_2021: {
    executiveRoles: [
      /district.*stage|stage.*district|overall.*extract/i,
      /highest|most stressed|critical.*taluka|worst/i,
      /future.*availability|net.*availability|deficit|balance/i,
      /projected|post.?mis|saving|micro.?irrigation|intervention/i,
    ],
  },
};

const CATEGORY_RULES: Array<[NormalizedPatternCategory, RegExp[]]> = [
  ['Status & Inventory', [/status/i, /inventory/i, /count/i, /setting/i, /availability/i, /balance/i]],
  ['Spatial Contrast', [/spatial/i, /gradient/i, /westward/i, /taluka/i, /village/i, /distribution/i]],
  ['Temporal Change', [/trend/i, /season/i, /annual/i, /decadal/i, /monsoon/i, /year/i, /decline/i, /fluctuation/i]],
  ['Vertical Stratigraphy', [/aquifer/i, /strat/i, /depth/i, /litholog/i, /confined/i, /unconfined/i, /basement/i]],
  ['Process & Mechanism', [/recharge/i, /extraction/i, /pumping/i, /salinity/i, /quality/i, /mechanism/i, /flow/i]],
  ['Scenarios & Interventions', [/project/i, /future/i, /intervention/i, /micro.?irrigation/i, /management/i, /recommend/i, /saving/i]],
  ['Data & Caveats', [/uncertain/i, /limitation/i, /gap/i, /missing/i, /monitor/i, /data quality/i]],
];

function normalizeUnit(unit?: string | null): string | undefined {
  if (!unit) return undefined;
  return unit.toLowerCase().replace(/\s+/g, '').replace(/perlitre/g, '/l');
}

function categoriesFor(finding: ReportFinding): NormalizedPatternCategory[] {
  const text = [finding.pattern_type, finding.title, finding.statement, finding.why_it_matters, finding.scope].join(' ');
  const categories = CATEGORY_RULES.filter(([, rules]) => rules.some((rule) => rule.test(text))).map(([category]) => category);
  return categories.length ? categories : ['Status & Inventory'];
}

function hasScenarioPair(callouts: ReportStatCallout[]): boolean {
  // A pair is valid only when both sides share a measurement concept and unit.
  // Labels are used solely to identify temporal/scenario roles; they never make
  // otherwise incompatible scalars comparable.
  const groups = new Map<string, { current: boolean; projected: boolean }>();
  for (const callout of callouts) {
    const label = `${callout.label} ${callout.qualifier || ''}`.toLowerCase();
    const role = /projected|future|after|post.?mis|scenario|target/.test(label)
      ? 'projected'
      : /current|present|existing|before|baseline|2017/.test(label)
        ? 'current'
        : undefined;
    if (!role) continue;
    const concept = (callout.kind || callout.label).toLowerCase().replace(/[^a-z0-9]+/g, '');
    const key = `${concept}|${normalizeUnit(callout.unit) || ''}`;
    const group = groups.get(key) || { current: false, projected: false };
    group[role] = true;
    groups.set(key, group);
  }
  return Array.from(groups.values()).some((group) => group.current && group.projected);
}

export function buildReportAnalysis(
  pkg: ReportSynthesisPackage,
  refs: ReportReferenceSets,
): ReportAnalysisModel {
  const diagnostics: string[] = [];
  const chaptersById = new Map(pkg.chapters.map((chapter) => [chapter.id, chapter]));
  const calloutsById = new Map(pkg.stat_callouts.map((callout) => [callout.id, callout]));
  const findingsById = new Map<string, ReportFindingView>();
  const uncertaintiesByThemeId = new Map<string, ReportUncertainty[]>();
  const reverse = {
    findingsByThemeId: new Map<string, ReportFindingView[]>(),
    findingsByChapterId: new Map<string, ReportFindingView[]>(),
    findingsByFeatureId: new Map<string, ReportFindingView[]>(),
    findingsByStudyAreaId: new Map<string, ReportFindingView[]>(),
    findingsByObservationId: new Map<string, ReportFindingView[]>(),
    findingsByIntervalId: new Map<string, ReportFindingView[]>(),
    findingsByDatasetId: new Map<string, ReportFindingView[]>(),
  };

  const resolve = (ids: string[] | undefined, available: Set<string>, label: string) => {
    const resolved: string[] = [];
    for (const id of ids || []) {
      if (available.has(id)) resolved.push(id);
      else diagnostics.push(`Unresolved ${label} reference: ${id}`);
    }
    return resolved;
  };

  for (const finding of pkg.findings) {
    const resolvedFeatureIds = resolve(finding.feature_ids, refs.featureIds, 'feature');
    const resolvedStudyAreaIds = resolve(finding.study_area_ids, refs.studyAreaIds, 'study area');
    const resolvedObservationIds = resolve(finding.observation_ids, refs.observationIds, 'observation');
    const resolvedIntervalIds = resolve(finding.interval_ids, refs.intervalIds, 'interval');
    const resolvedDatasetIds = resolve(finding.dataset_ids, refs.datasetIds, 'dataset');
    const callouts = (finding.stat_callout_ids || []).map((id) => calloutsById.get(id)).filter(Boolean) as ReportStatCallout[];
    const capabilities: VisualizationCapability[] = [];
    if (resolvedFeatureIds.length > 0 || resolvedStudyAreaIds.length > 0) capabilities.push('spatial');
    if (resolvedIntervalIds.length > 0) capabilities.push('vertical-profile');
    if (resolvedObservationIds.filter((id) => refs.datedObservationIds.has(id)).length >= 2) capabilities.push('temporal-series');
    if (hasScenarioPair(callouts)) capabilities.push('scenario-comparison');
    if (resolvedFeatureIds.length + resolvedStudyAreaIds.length >= 2) capabilities.push('entity-matrix');
    if (callouts.length >= 2 && categoriesFor(finding).includes('Process & Mechanism')) capabilities.push('categorical-matrix');
    if (callouts.length >= 1) capabilities.push('statistical-summary');
    capabilities.push('narrative-evidence');

    const unresolvedReferences = [
      ...(finding.feature_ids || []).filter((id) => !resolvedFeatureIds.includes(id)),
      ...(finding.study_area_ids || []).filter((id) => !resolvedStudyAreaIds.includes(id)),
      ...(finding.observation_ids || []).filter((id) => !resolvedObservationIds.includes(id)),
      ...(finding.interval_ids || []).filter((id) => !resolvedIntervalIds.includes(id)),
      ...(finding.dataset_ids || []).filter((id) => !resolvedDatasetIds.includes(id)),
    ];

    const findingView: ReportFindingView = {
      ...finding,
      normalizedCategories: categoriesFor(finding),
      capabilities,
      resolvedFeatureIds,
      resolvedStudyAreaIds,
      resolvedObservationIds,
      resolvedIntervalIds,
      resolvedDatasetIds,
      unresolvedReferences,
    };
    findingsById.set(finding.id, findingView);
    const add = (map: Map<string, ReportFindingView[]>, ids: string[]) => ids.forEach((id) => map.set(id, [...(map.get(id) || []), findingView]));
    for (const theme of pkg.themes) {
      if ((theme.finding_ids || []).includes(finding.id)) add(reverse.findingsByThemeId, [theme.id]);
      for (const chapterId of theme.chapter_ids || []) {
        const chapter = chaptersById.get(chapterId);
        if (chapter?.finding_ids.includes(finding.id)) add(reverse.findingsByChapterId, [chapterId]);
      }
    }
    add(reverse.findingsByFeatureId, resolvedFeatureIds);
    add(reverse.findingsByStudyAreaId, resolvedStudyAreaIds);
    add(reverse.findingsByObservationId, resolvedObservationIds);
    add(reverse.findingsByIntervalId, resolvedIntervalIds);
    add(reverse.findingsByDatasetId, resolvedDatasetIds);
  }

  for (const uncertainty of pkg.uncertainties || []) {
    const list = uncertaintiesByThemeId.get(uncertainty.theme_id || '__unresolved__') || [];
    list.push(uncertainty);
    uncertaintiesByThemeId.set(uncertainty.theme_id || '__unresolved__', list);
  }
  const unresolvedUncertaintyCount = (pkg.uncertainties || []).filter((item) => !item.theme_id || !chaptersById.has(item.theme_id)).length;
  if (unresolvedUncertaintyCount > 0) {
    diagnostics.push(`${unresolvedUncertaintyCount} uncertainty records do not resolve to published chapters`);
  }

  return {
    raw: pkg,
    themes: pkg.themes,
    chaptersById,
    findingsById,
    calloutsById,
    uncertainties: pkg.uncertainties || [],
    uncertaintiesByThemeId,
    ...reverse,
    unresolvedUncertaintyCount,
    diagnostics,
  };
}

export function selectExecutiveCallouts(analysis: ReportAnalysisModel, limit = 4): ReportStatCallout[] {
  const ordered = analysis.raw.executive_overview.key_stat_callout_ids
    .map((id) => analysis.calloutsById.get(id))
    .filter(Boolean) as ReportStatCallout[];
  const roles = REPORT_PROFILES[analysis.raw.report_id]?.executiveRoles || [
    /district.*stage|stage.*district|overall.*extract/i,
    /highest|most stressed|critical.*taluka|worst/i,
    /future.*availability|net.*availability|deficit|balance/i,
    /projected|post.?mis|saving|micro.?irrigation|intervention/i,
  ];
  const selected: ReportStatCallout[] = [];
  for (const role of roles) {
    const match = ordered.find((callout) => role.test(`${callout.label} ${callout.qualifier || ''}`) && !selected.includes(callout));
    if (match) selected.push(match);
  }
  for (const callout of ordered) {
    if (selected.length >= limit) break;
    if (!selected.includes(callout)) selected.push(callout);
  }
  return selected.slice(0, limit);
}
