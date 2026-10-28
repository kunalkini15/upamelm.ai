/**
 * Map layer catalogue access.
 *
 * Thin accessor over the layer registry today; becomes the place where
 * server-published overlay manifests (tile URLs, dataset versions) are
 * resolved in Phase 3, keeping style/URL details out of `MapView`.
 */
import type { BasemapPreset, MapLayerDefinition } from '@/types';
import { ALL_LAYERS, BASEMAPS } from '@/data/mapLayers';

export function listLayers(): MapLayerDefinition[] {
  return [...ALL_LAYERS];
}

export function listBasemaps(): BasemapPreset[] {
  return [...BASEMAPS];
}

export function defaultBasemap(): BasemapPreset {
  return BASEMAPS.find((b) => b.defaultVisible) ?? BASEMAPS[0];
}

export function activeLayers(): MapLayerDefinition[] {
  return ALL_LAYERS.filter((l) => l.status === 'active');
}
