/**
 * Map layer registry.
 *
 * Data-driven layer catalogue rendered by the map shell. Scientific overlays
 * are registered here as `forthcoming` so the layer switcher can advertise
 * the roadmap without rendering fictional data.
 */
import type { BasemapPreset, MapLayerDefinition } from '@/types';

export const BASEMAPS: BasemapPreset[] = [
  {
    id: 'basemap-dark',
    label: 'Subsurface dark',
    description: 'Dark reference basemap for low-light exploration.',
    kind: 'basemap',
    status: 'active',
    defaultVisible: true,
    group: 'basemap',
    styleUrl: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    attributions: [
      { text: '© OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright' },
      { text: '© CARTO', url: 'https://carto.com/attributions' },
    ],
  },
  {
    id: 'basemap-light',
    label: 'Survey light',
    description: 'Light reference basemap for print-like reading.',
    kind: 'basemap',
    status: 'active',
    defaultVisible: false,
    group: 'basemap',
    styleUrl: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
    attributions: [
      { text: '© OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright' },
      { text: '© CARTO', url: 'https://carto.com/attributions' },
    ],
  },
];

/** Default initial view: the Indian subcontinent. */
export const INDIA_VIEW = {
  center: [78.9629, 22.5937] as [number, number],
  zoom: 4.4,
} as const;

export const LOCATION_MARKERS_LAYER: MapLayerDefinition = {
  id: 'locations',
  label: 'Research locations',
  description: 'Selectable locations with published or planned findings.',
  kind: 'marker',
  status: 'active',
  defaultVisible: true,
  group: 'locations',
  attributions: [],
};

/**
 * Future scientific overlays. Registered, visible in the layer panel as
 * forthcoming, and never rendered until backed by processed evidence.
 */
export const FUTURE_OVERLAYS: MapLayerDefinition[] = [
  {
    id: 'overlay-aquifer-extent',
    label: 'Aquifer extents',
    description: 'Documented aquifer system boundaries (Phase 3).',
    kind: 'geojson',
    domainId: 'groundwater',
    status: 'forthcoming',
    defaultVisible: true,
    group: 'groundwater',
    attributions: [],
  },
  {
    id: 'overlay-water-level',
    label: 'Water-level contours',
    description: 'Reported depth-to-water surfaces (Phase 3).',
    kind: 'raster',
    domainId: 'groundwater',
    status: 'forthcoming',
    defaultVisible: false,
    group: 'groundwater',
    attributions: [],
  },
  {
    id: 'overlay-geology',
    label: 'Surface geology',
    description: 'GSI formation boundaries (Phase 4).',
    kind: 'vector',
    domainId: 'geology',
    status: 'forthcoming',
    defaultVisible: false,
    group: 'geology',
    attributions: [],
  },
];

export const ALL_LAYERS: MapLayerDefinition[] = [
  ...BASEMAPS,
  LOCATION_MARKERS_LAYER,
  ...FUTURE_OVERLAYS,
];
