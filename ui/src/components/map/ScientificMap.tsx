import React, { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import { RenderablePointFeature } from '../../types/scientific';
import { Layers, Database, Compass, Eye, Filter } from 'lucide-react';

interface ScientificMapProps {
  features: RenderablePointFeature[];
  selectedFeatureId: string | null;
  onSelectFeature: (feature: RenderablePointFeature) => void;
  center: [number, number];
  bounds: { minLng: number; maxLng: number; minLat: number; maxLat: number };
}

export const ScientificMap: React.FC<ScientificMapProps> = ({
  features,
  selectedFeatureId,
  onSelectFeature,
  center,
  bounds,
}) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);

  useEffect(() => {
    if (!mapContainer.current) return;

    // High-contrast scientific dark theme cartography
    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [
          {
            id: 'osm-tiles',
            type: 'raster',
            source: 'osm',
            minzoom: 0,
            maxzoom: 19,
            paint: {
              'raster-brightness-max': 0.35,
              'raster-contrast': 0.4,
              'raster-saturation': -0.9,
            },
          },
        ],
      },
      center: center,
      zoom: 10.5,
      pitch: 30, // Architectural perspective angle
      bearing: -10,
    });

    mapRef.current = map;

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'bottom-right');

    map.on('load', () => {
      // Fit to data bounds with comfortable padding
      map.fitBounds(
        [
          [bounds.minLng - 0.04, bounds.minLat - 0.04],
          [bounds.maxLng + 0.04, bounds.maxLat + 0.04],
        ],
        { padding: 60, duration: 1200 }
      );
    });

    return () => {
      map.remove();
    };
  }, []);

  // Update Markers when features or selection changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear old markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    features.forEach((feature) => {
      const isSelected = feature.id === selectedFeatureId;
      const hasDeepData = (feature.totalDepthMeters || 0) > 50 || feature.intervals.length > 0;

      // Create Custom DOM Element for the Beacon
      const el = document.createElement('div');
      el.className = 'group cursor-pointer relative';

      const typeBadgeColor =
        feature.type === 'tube_well'
          ? 'bg-accent'
          : feature.type === 'piezometer'
          ? 'bg-success'
          : feature.type === 'borehole'
          ? 'bg-amber'
          : 'bg-[#335E8C]';

      el.innerHTML = `
        <div class="relative flex items-center justify-center">
          ${
            hasDeepData
              ? `<div class="absolute w-9 h-9 rounded-full bg-accent/20 beacon-ring"></div>`
              : ''
          }
          <div class="w-6 h-6 rounded-full flex items-center justify-center transition-transform duration-300 group-hover:scale-125 ${
            isSelected
              ? 'bg-amber text-ink-950 ring-4 ring-amber/30 shadow-[0_0_18px_rgba(227,179,78,0.45)]'
              : hasDeepData
              ? `${typeBadgeColor} text-ink-950 ring-2 ring-accent-strong`
              : 'bg-ink-800 text-muted border border-line'
          }">
            <div class="w-2.5 h-2.5 rounded-full ${isSelected ? 'bg-ink-950' : 'bg-ink-950/80'}"></div>
          </div>
          <div class="absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap px-2 py-0.5 rounded bg-ink-900/90 border border-line/80 text-[10px] font-mono text-muted shadow-lg pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-30">
            ${feature.name} ${feature.totalDepthMeters ? `(${feature.totalDepthMeters}m)` : ''}
          </div>
        </div>
      `;

      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onSelectFeature(feature);

        // Cinematic Fly-To
        map.flyTo({
          center: feature.coordinates,
          zoom: 13.5,
          pitch: 55, // Tilt camera as we get closer to prepare for 3D dive
          duration: 1800,
          essential: true,
        });
      });

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat(feature.coordinates)
        .addTo(map);

      markersRef.current.push(marker);
    });
  }, [features, selectedFeatureId, onSelectFeature]);

  return (
    <div className="relative w-full h-full overflow-hidden bg-ink-950">
      <div ref={mapContainer} className="w-full h-full" />

      {/* Cartographic Overlays HUD */}
      <div className="absolute top-4 left-4 z-10 flex items-center gap-3 pointer-events-none">
        <div className="bg-ink-900/85 backdrop-blur-md px-3.5 py-2 rounded-lg border border-line/70 shadow-xl flex items-center gap-2.5 text-xs">
          <div className="w-2.5 h-2.5 rounded-full bg-accent animate-pulse" />
          <span className="font-medium text-text">District Cartographic Grid</span>
          <span className="text-muted font-mono">WGS84</span>
        </div>

        <div className="bg-ink-900/85 backdrop-blur-md px-3.5 py-2 rounded-lg border border-line/70 shadow-xl flex items-center gap-4 text-xs font-mono text-muted">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-accent"></span>
            <span>Tube-Wells ({features.filter((f) => f.type === 'tube_well').length})</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-success"></span>
            <span>Piezometers ({features.filter((f) => f.type === 'piezometer').length})</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#335E8C]"></span>
            <span>Stations ({features.filter((f) => f.type === 'monitoring_station').length})</span>
          </div>
        </div>
      </div>

      {/* Quick Navigation Floating Guide */}
      <div className="absolute bottom-4 left-4 z-10 bg-ink-900/90 backdrop-blur-md px-4 py-2 rounded-lg border border-line/60 text-xs text-muted shadow-2xl flex items-center gap-2">
        <Compass className="w-4 h-4 text-accent animate-spin-slow" />
        <span>Click any station marker to dive into the <strong>3D Subsurface Cutaway</strong></span>
      </div>
    </div>
  );
};
