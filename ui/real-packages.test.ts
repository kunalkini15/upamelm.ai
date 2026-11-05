import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PackageIngestion } from './src/core/PackageIngestion';

function loadPackage(relativePath: string) {
  const raw = JSON.parse(readFileSync(resolve(process.cwd(), '..', relativePath), 'utf8'));
  return PackageIngestion.parse(raw, { sourceBaseUrl: 'http://localhost/' });
}

describe('current Agentic study batch', () => {
  it('renders the NAQUIM Bangalore North aquifer plan from the final contracts', () => {
    const model = loadPackage('muse-document-processing/runs/naquim-bangalore-north-v1/study_package.json');
    expect(model.packageFamily).toBe('agentic-flow');
    expect(model.reportTitle).toBe('Bangalore North Aquifer Plan: Thin Rock, Heavy Pumping, a Way Back');
    expect(model.spatialFeatures).toHaveLength(360);
    expect(model.featuresWithCoords).toHaveLength(12);
    expect(model.preservedDatasets).toHaveLength(12);
    expect(model.quantitativeSeries).toHaveLength(19);
    expect(model.timelineEvents).toHaveLength(7);
    expect(new Set(model.timelineEvents.map((event) => event.timelineId)).size).toBe(2);
    expect(model.agentic?.verticalProfiles).toHaveLength(3);
    expect(model.allIntervals).toHaveLength(8);
    expect(model.documentAnalysis?.blocks).toHaveLength(8);
    expect(model.reportAnalysis).toBeUndefined();
    expect(model.capabilities.find((capability) => capability.id === 'point-map')?.available).toBe(true);
    expect(model.capabilities.find((capability) => capability.id === 'vertical-profiles')?.available).toBe(true);
  });

  const additionalStudies = [
    {
      name: 'Karnataka Ground Water Year Book 2022–23',
      path: 'muse-document-processing/runs/gw-yearbook-karnataka-2022-23-v1/study_package.json',
      title: 'Karnataka’s groundwater in a wet year: the 2022-23 year book',
      datasets: 12,
      series: 21,
      hasProfiles: false,
    },
    {
      name: 'NAQUIM Bangalore East',
      path: 'muse-document-processing/runs/naquim-bangalore-east-v1/study_package.json',
      title: 'Bangalore East: a thin rocky water reserve under a growing city',
      datasets: 14,
      series: 11,
      hasProfiles: true,
    },
    {
      name: 'Karnataka Groundwater Resources & Quality 2024',
      path: 'muse-document-processing/runs/dgwr-karnataka-2024-v1/study_package.json',
      title: "Karnataka's groundwater paradox: Safe on average, failing at the tap",
      datasets: 6,
      series: 11,
      hasProfiles: false,
    },
    {
      name: 'Karnataka Groundwater Resources 2023',
      path: 'muse-document-processing/runs/dgwr-karnataka-2023-v1/study_package.json',
      title: "Karnataka's 2023 groundwater account: Safe on average, stressed around Bengaluru",
      datasets: 4,
      series: 10,
      hasProfiles: false,
    },
  ];

  it.each(additionalStudies)('renders $name through the generic Agentic adapter', (study) => {
    const model = loadPackage(study.path);
    expect(model.packageFamily).toBe('agentic-flow');
    expect(model.reportTitle).toBe(study.title);
    expect(model.spatialFeatures.length).toBeGreaterThan(0);
    expect(model.preservedDatasets).toHaveLength(study.datasets);
    expect(model.quantitativeSeries).toHaveLength(study.series);
    expect(model.documentAnalysis?.blocks.length).toBeGreaterThan(0);
    expect((model.agentic?.verticalProfiles.length ?? 0) > 0).toBe(study.hasProfiles);
    expect(model.reportAnalysis).toBeUndefined();
  });
});
