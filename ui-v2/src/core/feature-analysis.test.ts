import { describe, expect, it } from 'vitest';
import { PackageIngestion } from './PackageIngestion';

describe('feature-specific analysis eligibility', () => {
  it('keeps empty-analysis geometry for coverage but hides it from map and 3D interaction', () => {
    const feature = (id: string, longitude: number) => ({
      id,
      name: id,
      type: 'monitoring_station',
      geometry: { type: 'Point', coordinates: [longitude, 12.9] },
      properties: [],
      source_refs: [`evidence:${id}`],
      dataset_ids: [],
      source_object_ids: [],
    });
    const raw = {
      schema_version: 'document-study.v2',
      study_id: 'analysis-test',
      rendering_package: {
        schema_version: 'study-rendering.v2',
        study: { id: 'analysis-test', title: 'Analysis test' },
        layers: [],
        features: [feature('useful', 77.5), feature('coverage-only', 77.6)],
        observations: [],
        intervals: [],
        structured_resources: [],
      },
      narrative_package: {
        schema_version: 'ui-narrative.v3',
        target_insights: [
          { target_id: 'target:useful', target_kind: 'feature', object_id: 'useful', analysis: 'Water quality was measured here and remained within the report benchmark.', evidence_refs: ['evidence:useful'] },
          { target_id: 'target:coverage-only', target_kind: 'feature', object_id: 'coverage-only', analysis: '', evidence_refs: [] },
        ],
      },
    };

    const model = PackageIngestion.parse(raw);

    expect(model.spatialFeatures).toHaveLength(2);
    expect(model.featuresWithCoords.map((item) => item.id)).toEqual(['useful']);
    expect(model.featuresWithCoords[0].narrative?.analysis).toContain('Water quality');
    expect(model.renderingNotes.hiddenFeatureCount).toBe(1);
  });

  it('does not promote legacy narrative fields into ui-narrative.v3 analysis', () => {
    const raw = {
      schema_version: 'document-study.v2',
      study_id: 'strict-narrative-test',
      rendering_package: {
        schema_version: 'study-rendering.v2',
        study: { id: 'strict-narrative-test', title: 'Strict narrative test' },
        layers: [],
        features: [{
          id: 'coverage-only', name: 'Coverage only', type: 'station',
          geometry: { type: 'Point', coordinates: [77.5, 12.9] },
          narrative: { summary: 'Legacy text must not be shown.' },
          properties: [], source_refs: [], dataset_ids: [], source_object_ids: [],
        }],
        observations: [{ id: 'obs-1', type: 'level', value: 10, unit: 'm', feature_id: 'coverage-only' }],
        intervals: [], structured_resources: [],
      },
      narrative_package: {
        schema_version: 'ui-narrative.v3',
        target_insights: [{ target_id: 'target-1', target_kind: 'feature', object_id: 'coverage-only', analysis: '' }],
      },
    };

    const model = PackageIngestion.parse(raw);
    expect(model.featuresWithCoords).toHaveLength(0);
    expect(model.quantitativeSeries).toHaveLength(0);
    expect(model.renderingNotes.hiddenFeatureCount).toBe(1);
  });
});
