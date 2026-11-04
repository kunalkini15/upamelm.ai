import { describe, expect, it } from 'vitest';
import fixture from '../../public/capability-envelope-fixture.json';
import { PackageIngestion } from './PackageIngestion';
import { chooseQuantitativeRenderer, quantitativeRenderers } from './RendererRegistry';

describe('generic package rendering envelope', () => {
  const model = PackageIngestion.parse(fixture, { sourceBaseUrl: 'http://localhost/' });

  it('preserves common spatial geometry without misclassifying it as unlocated', () => {
    expect(model.spatialFeatures.map((feature) => feature.geometry?.type)).toEqual(expect.arrayContaining(['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon']));
    expect(model.featuresWithoutCoords.map((feature) => feature.id)).toEqual(['feature:unlocated']);
    expect(model.capabilities.find((item) => item.id === 'line-map')?.available).toBe(true);
    expect(model.capabilities.find((item) => item.id === 'polygon-map')?.available).toBe(true);
    expect(model.capabilities.find((item) => item.id === 'raster-overlay')?.available).toBe(true);
  });

  it('adapts every major evidence family through one package boundary', () => {
    expect(model.preservedDatasets).toHaveLength(1);
    expect(model.quantitativeSeries).toHaveLength(9);
    expect(model.nativeAssets).toHaveLength(2);
    expect(model.timelineEvents).toHaveLength(3);
    expect(model.agentic?.verticalProfiles).toHaveLength(1);
    expect(model.genericExtensions).toHaveLength(2);
    expect(model.reportAnalysis?.raw.findings).toHaveLength(1);
  });

  it('dispatches quantitative evidence by reusable semantics', () => {
    const kinds = Object.fromEntries(model.quantitativeSeries.map((series) => [series.id, chooseQuantitativeRenderer(series)]));
    expect(kinds['series:time']).toBe('line');
    expect(kinds['series:range']).toBe('range');
    expect(kinds['series:bar']).toBe('bar');
    expect(kinds['series:share']).toBe('share');
    expect(kinds['series:hist']).toBe('histogram');
    expect(kinds['series:scatter']).toBe('scatter');
    expect(kinds['series:threshold']).toBe('threshold');
    expect(kinds['series:budget']).toBe('waterfall');
    expect(kinds['series:kpi']).toBe('kpi');
    expect(quantitativeRenderers.length).toBeGreaterThanOrEqual(10);
  });

  it('preserves exact-contract quantitative points and reports rejected points', () => {
    const quantitativePackage = structuredClone(fixture) as any;
    const featureId = quantitativePackage.rendering_package.features[0].id;
    quantitativePackage.rendering_package.chart_series = [{
      id: 'series:verified',
      title: 'Verified quantitative series',
      kind: 'time-series',
      unit: 'm',
      points: [
        { x: '2024-01', y: 12.5, y_low: 11, y_high: 14, feature_id: featureId, evidence_refs: ['evidence:1'] },
        { x: '2024-02', y: 'not-a-number', evidence_refs: ['evidence:2'] },
      ],
      evidence_refs: ['evidence:1', 'evidence:2'],
    }];
    const adapted = PackageIngestion.parse(quantitativePackage);
    expect(adapted.quantitativeSeries).toHaveLength(1);
    expect(adapted.quantitativeSeries[0].points).toEqual([expect.objectContaining({ x: '2024-01', y: 12.5, yLow: 11, yHigh: 14, featureId })]);
    expect(adapted.agentic?.adapterDiagnostics.some((message) => message.includes('Rejected chart point series:verified[1]'))).toBe(true);
  });

  it('keeps missing scientific relationships missing', () => {
    const unlocated = model.featuresWithoutCoords[0];
    expect(unlocated.geometry).toBeFalsy();
    expect(model.featuresWithCoords.every((feature) => feature.hasSyntheticIntervals === false)).toBe(true);
  });

  it('adapts flexible document analysis without padding empty blocks or metrics', () => {
    const packageWithAnalysis = structuredClone(fixture) as any;
    packageWithAnalysis.report = {
      schema_version: 'document-analysis.v1',
      report_id: packageWithAnalysis.study_id,
      source_title: 'Source report title',
      display_title: 'Readable report title',
      short_title: 'Readable title',
      brief_description: 'A plain-language description of the document.',
      blocks: [
        { id: 'empty', content: '', metrics: [] },
        { id: 'headline-only', headline: 'A meaningful section heading' },
        { id: 'useful', headline: 'A supported result', content: 'The document explains this result clearly.', metrics: [
          { label: 'Measured value', display_value: '20–25 m', explanation: 'The reported range.', evidence_refs: ['source:1'] },
          { label: '', display_value: '', evidence_refs: [] },
        ] },
      ],
    };
    const adapted = PackageIngestion.parse(packageWithAnalysis);
    expect(adapted.documentAnalysis?.raw.display_title).toBe('Readable report title');
    expect(adapted.documentAnalysis?.blocks.map((block) => block.id)).toEqual(['headline-only', 'useful']);
    expect(adapted.documentAnalysis?.blocks[1].metrics).toHaveLength(1);
    expect(adapted.reportAnalysis).toBeUndefined();
  });

  it('preserves authored narratives for every supported target kind', () => {
    const packageWithTargets = structuredClone(fixture) as any;
    packageWithTargets.narrative_package = {
      schema_version: 'ui-narrative.v3',
      target_insights: [
        { target_id: 'layer-target', target_kind: 'layer', object_id: 'layer:1', analysis: 'Layer analysis.', evidence_refs: ['evidence:layer'] },
        { target_id: 'profile-target', target_kind: 'vertical_profile', object_id: 'profile:1', analysis: 'Profile analysis.', evidence_refs: ['evidence:profile'] },
        { target_id: 'study-target', target_kind: 'study', object_id: packageWithTargets.study_id, analysis: 'Study analysis.', evidence_refs: ['evidence:study'] },
      ],
    };
    const adapted = PackageIngestion.parse(packageWithTargets);
    expect(adapted.agentic?.narrativeTargets.map((target) => target.targetKind)).toEqual(['layer', 'vertical_profile', 'study']);
    expect(adapted.sourcesCount).toBeGreaterThanOrEqual(3);
  });
});
