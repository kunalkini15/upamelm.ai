/**
 * Map layer architecture.
 *
 * Layers are data-driven definitions, not hardcoded map code. The map shell
 * renders whatever the layer registry provides, so new scientific overlays
 * (groundwater, geology, soil, …) plug in without touching `MapView`.
 * Phase 1 registers basemaps + location markers; scientific overlays arrive
 * with Phase 3+ data.
 */
import type { ScientificDomainId } from './domains';

export type LayerKind = 'basemap' | 'marker' | 'geojson' | 'raster' | 'vector';

export type LayerStatus = 'active' | 'forthcoming';

export interface Attribution {
  /** Short attribution text shown on the map control. */
  text: string;
  /** Link target for the attribution. */
  url?: string;
}

export interface MapLayerDefinition {
  id: string;
  label: string;
  description: string;
  kind: LayerKind;
  /** Scientific domain this layer belongs to, if any. Basemaps use none. */
  domainId?: ScientificDomainId;
  status: LayerStatus;
  /** Default visibility when the layer becomes available. */
  defaultVisible: boolean;
  /** Grouping key for the layer switcher UI. */
  group: LayerGroup;
  attributions: Attribution[];
}

export type LayerGroup = 'basemap' | 'locations' | 'groundwater' | 'geology' | 'environment';

/** A selectable basemap style. */
export interface BasemapPreset extends MapLayerDefinition {
  kind: 'basemap';
  /** MapLibre style URL (open, keyless). */
  styleUrl: string;
}

/** Runtime toggle state for one layer. */
export interface LayerVisibility {
  layerId: string;
  visible: boolean;
}
