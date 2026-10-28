/**
 * Resilient basemap style resolution.
 *
 * The map must never sit on a black void without explanation. Styles are
 * probed (fetched) before being applied, and candidates are tried in order
 * until one renders. The last-resort candidate is an inline raster style with
 * no style-JSON dependency at all.
 */
import type maplibregl from 'maplibre-gl';
import type { StyleSpecification } from 'maplibre-gl';
import type { BasemapPreset } from '@/types';

export type BasemapStatus =
  | { state: 'loading' }
  | { state: 'ready'; usedFallback: boolean; label: string }
  | { state: 'failed' };

/** Blank style used at map construction; replaced once a candidate resolves. */
export const EMPTY_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [],
};

export const OPENFREEMAP_LIBERTY_URL = 'https://tiles.openfreemap.org/styles/liberty';

/** Last-resort inline style: OSM raster tiles, no style-JSON fetch required. */
export const OSM_RASTER_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [
    {
      id: 'osm-raster',
      type: 'raster',
      source: 'osm',
      minzoom: 0,
      maxzoom: 22,
    },
  ],
};

export interface StyleCandidate {
  label: string;
  style: string | StyleSpecification;
}

/**
 * Candidate chain: selected basemap first, then the other preset, then
 * independent fallbacks on different infrastructure.
 */
export function buildCandidates(
  selected: BasemapPreset,
  all: BasemapPreset[],
): StyleCandidate[] {
  const others = all.filter((b) => b.id !== selected.id);
  return [
    { label: selected.label, style: selected.styleUrl },
    ...others.map((b) => ({ label: b.label, style: b.styleUrl })),
    { label: 'OpenFreeMap Liberty (fallback)', style: OPENFREEMAP_LIBERTY_URL },
    { label: 'OpenStreetMap raster (fallback)', style: OSM_RASTER_STYLE },
  ];
}

/**
 * Fetch a style candidate. Inline styles resolve immediately; URLs must
 * return parseable JSON within the timeout.
 */
export async function fetchStyle(
  candidate: StyleCandidate,
  timeoutMs = 10000,
): Promise<StyleSpecification> {
  if (typeof candidate.style !== 'string') return candidate.style;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(candidate.style, { signal: controller.signal });
    if (!res.ok) throw new Error(`Style request failed with HTTP ${res.status}`);
    return (await res.json()) as StyleSpecification;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Wait until the map goes idle after a setStyle (tiles for the current view
 * rendered). Rejects on timeout or when tile errors pile up, so the caller
 * can advance to the next candidate instead of showing a broken map.
 */
export function waitForSettled(
  map: maplibregl.Map,
  timeoutMs = 12000,
  maxErrors = 8,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let errors = 0;
    const onIdle = () => cleanup(null);
    const onError = () => {
      errors += 1;
      if (errors >= maxErrors) cleanup(new Error('Too many tile errors'));
    };
    const timer = setTimeout(() => cleanup(new Error('Timed out waiting for tiles')), timeoutMs);
    function cleanup(err: Error | null) {
      clearTimeout(timer);
      map.off('idle', onIdle);
      map.off('error', onError);
      if (err) reject(err);
      else resolve();
    }
    map.on('idle', onIdle);
    map.on('error', onError);
  });
}
