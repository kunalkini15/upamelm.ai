import React, { useEffect, useRef, useImperativeHandle, forwardRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MousePointerClick } from 'lucide-react';
import {
  RenderablePointFeature,
  RenderableRegionalSlab,
  RenderableInterval,
} from '../../types/scientific';

const escapeHtml = (value: unknown) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

function pointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
  if (polygon.length < 3) return false;
  const [x, y] = point;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const crosses = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }

  return inside;
}

if (typeof window !== 'undefined' && (maplibregl as any).setWorkerUrl) {
  (maplibregl as any).setWorkerUrl('/maplibre-gl-worker.mjs');
}

export interface SeamlessMapHandle {
  flyToFeature: (feature: RenderablePointFeature) => void;
  flyToStudyArea: () => void;
  fitToFeatures: (featureIds: string[]) => void;
  resetView: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  getCanvas: () => HTMLCanvasElement | null;
  captureAlignedCrop: (poly: [number, number][], worldSpan3D: number, sceneScale3D: number) => Promise<HTMLCanvasElement | null>;
}

interface SeamlessMapProps {
  features: RenderablePointFeature[];
  regionalSlabs: RenderableRegionalSlab[];
  selectedFeatureId: string | null;
  highlightedFeatureIds?: string[];
  onSelectFeature: (feature: RenderablePointFeature) => void;
  onSelectInterval?: (interval: RenderableInterval) => void;
  onZoomChange: (zoom: number, pitch: number) => void;
  onExitLocalView: () => void;
  onEnterSubsurface: (feature?: RenderablePointFeature) => void;
  center: [number, number];
  bounds: { minLng: number; maxLng: number; minLat: number; maxLat: number };
  studyAreaPolygon: [number, number][];
  studyAreaName: string;
}

export const SeamlessMap = forwardRef<SeamlessMapHandle, SeamlessMapProps>(
  (
    {
      features,
      selectedFeatureId,
      highlightedFeatureIds = [],
      onSelectFeature,
      onZoomChange,
      onExitLocalView,
      onEnterSubsurface,
      center,
      bounds,
      studyAreaPolygon,
      studyAreaName,
    },
    ref
  ) => {
    const [instructionStage, setInstructionStage] = useState<'district' | 'coverage' | 'stations'>('district');
    const mapContainer = useRef<HTMLDivElement>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const markersRef = useRef<maplibregl.Marker[]>([]);
    const macroMarkerRef = useRef<maplibregl.Marker | null>(null);
    const featuresRef = useRef(features);
    featuresRef.current = features;
    const onEnterSubsurfaceRef = useRef(onEnterSubsurface);
    onEnterSubsurfaceRef.current = onEnterSubsurface;
    const onExitLocalViewRef = useRef(onExitLocalView);
    onExitLocalViewRef.current = onExitLocalView;
    const selectedFeatureIdRef = useRef(selectedFeatureId);
    selectedFeatureIdRef.current = selectedFeatureId;
    const highlightedFeatureIdsRef = useRef(highlightedFeatureIds);
    highlightedFeatureIdsRef.current = highlightedFeatureIds;
    const currentZoomRef = useRef(10.2);

    useImperativeHandle(ref, () => ({
      flyToFeature: (feature: RenderablePointFeature) => {
        if (!mapRef.current) return;
        mapRef.current.flyTo({
          center: feature.coordinates,
          zoom: 14.2,
          pitch: 50,
          duration: 1800,
          essential: true,
        });
      },
      flyToStudyArea: () => {
        if (!mapRef.current) return;
        mapRef.current.fitBounds(
          [
            [bounds.minLng - 0.04, bounds.minLat - 0.04],
            [bounds.maxLng + 0.04, bounds.maxLat + 0.04],
          ],
          { padding: 80, duration: 1600 }
        );
      },
      fitToFeatures: (featureIds: string[]) => {
        const targets = featuresRef.current.filter((feature) => featureIds.includes(feature.id));
        if (!mapRef.current || targets.length === 0) return;
        if (targets.length === 1) {
          mapRef.current.flyTo({ center: targets[0].coordinates, zoom: 13.2, pitch: 35, duration: 1200, essential: true });
          return;
        }
        const lngs = targets.map((feature) => feature.coordinates[0]);
        const lats = targets.map((feature) => feature.coordinates[1]);
        mapRef.current.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 120, duration: 1400, maxZoom: 13 });
      },
      resetView: () => {
        if (!mapRef.current) return;
        mapRef.current.flyTo({
          center: center,
          zoom: 5.5, // Return to macro view of India
          pitch: 0,
          bearing: 0,
          duration: 1500,
        });
      },
      zoomIn: () => {
        mapRef.current?.zoomIn();
      },
      zoomOut: () => {
        mapRef.current?.zoomOut();
      },
      getCanvas: () => {
        return mapRef.current?.getCanvas() || null;
      },
      captureAlignedCrop: async (poly: [number, number][], worldSpan3D: number, sceneScale3D: number) => {
        const map = mapRef.current;
        if (!map || poly.length < 3) return null;

        const previousView = {
          center: map.getCenter(),
          zoom: map.getZoom(),
          pitch: map.getPitch(),
          bearing: map.getBearing(),
        };

        // Compute centroid
        let sumLng = 0, sumLat = 0;
        const count = poly.length > 2 && poly[0][0] === poly[poly.length - 1][0] && poly[0][1] === poly[poly.length - 1][1]
          ? poly.length - 1
          : poly.length;
        for (let i = 0; i < count; i++) {
          sumLng += poly[i][0];
          sumLat += poly[i][1];
        }
        const cLng = sumLng / count;
        const cLat = sumLat / count;

        const cssW = map.getContainer().clientWidth;
        const cssH = map.getContainer().clientHeight;
        const cosLat = Math.cos((cLat * Math.PI) / 180);

        // Calculate zoom level where the worldSpan3D crop precisely fits within the viewport height
        const targetCropCss = cssH * 0.92;
        const constant = (worldSpan3D / (cosLat * sceneScale3D)) * (512 / 360);
        const targetZoom = Math.log2(targetCropCss / constant);

        // Jump map exactly to centroid with 0 pitch and 0 bearing for orthographic alignment
        map.jumpTo({ center: [cLng, cLat], zoom: targetZoom, pitch: 0, bearing: 0 });

        // Wait for tiles to load and WebGL frame to paint cleanly
        await new Promise<void>((resolve) => {
          let resolved = false;
          const finish = () => {
            if (!resolved) {
              resolved = true;
              resolve();
            }
          };
          map.once('idle', finish);
          map.once('render', () => {
            if (map.areTilesLoaded()) finish();
          });
          map.triggerRepaint();
          setTimeout(finish, 320);
        });

        const src = map.getCanvas();
        const scaleRatio = src.width / cssW;

        const mercatorFactor = (512 / 360) * Math.pow(2, targetZoom);
        const mapCssPxPerUnit = (mercatorFactor / cosLat) / sceneScale3D;

        const cropCss = worldSpan3D * mapCssPxPerUnit;
        const cropSrc = cropCss * scaleRatio;

        const cProj = map.project([cLng, cLat]);
        const srcX = (cProj.x - cropCss / 2) * scaleRatio;
        const srcY = (cProj.y - cropCss / 2) * scaleRatio;

        const squareCanvas = document.createElement('canvas');
        squareCanvas.width = 1024;
        squareCanvas.height = 1024;
        const ctx = squareCanvas.getContext('2d');
        if (!ctx) return null;

        ctx.drawImage(src, srcX, srcY, cropSrc, cropSrc, 0, 0, 1024, 1024);
        map.jumpTo(previousView);
        return squareCanvas;
      },
    }));

    // Initialize MapLibre
    useEffect(() => {
      if (!mapContainer.current) return;

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
                'raster-contrast': 0.45,
                'raster-saturation': -0.95,
              },
            },
          ],
        },
        center: center,
        zoom: 5.5, // Start at Macro India overview
        pitch: 0,
        bearing: 0,
        maxPitch: 85,
        canvasContextAttributes: { preserveDrawingBuffer: true },
      });

      map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');

      (window as any).mapInstance = map;
      mapRef.current = map;

      // Report Zoom & Pitch continuously on every frame
      const handleMove = () => {
        const z = map.getZoom();
        currentZoomRef.current = z;
        setInstructionStage(z < 7.5 ? 'district' : z < 8.5 ? 'coverage' : 'stations');
        onZoomChange(z, map.getPitch());
        updateMarkerVisibility(z);
      };

      map.on('move', handleMove);
      map.on('zoom', handleMove);
      map.on('pitch', handleMove);

      // Wheel Gesture Handoff: At local threshold (zoom >= 14.4), smoothly enter 3D
      const wheelSurface = map.getCanvas();
      const enterFromMapZoom = (event: WheelEvent) => {
        if (event.deltaY > 0 && map.getZoom() <= 12.7) {
          onExitLocalViewRef.current();
        }

        if (map.getZoom() >= 14.4 && event.deltaY < 0) {
          const canvasRect = wheelSurface.getBoundingClientRect();
          const cursorLocation = map.unproject([
            event.clientX - canvasRect.left,
            event.clientY - canvasRect.top,
          ]);

          // The zoom-to-3D handoff is meaningful only over the synthesized
          // study footprint. Outside it, preserve ordinary map navigation.
          if (!pointInPolygon([cursorLocation.lng, cursorLocation.lat], studyAreaPolygon)) return;

          event.preventDefault();
          event.stopPropagation();

          const selFeature = featuresRef.current.find((f) => f.id === selectedFeatureIdRef.current);
          const mapCenter = map.getCenter();
          const nearest = featuresRef.current.reduce<RenderablePointFeature | undefined>((best, cur) => {
            if (!best) return cur;
            const d1 = Math.hypot(cur.coordinates[0] - mapCenter.lng, cur.coordinates[1] - mapCenter.lat);
            const d0 = Math.hypot(best.coordinates[0] - mapCenter.lng, best.coordinates[1] - mapCenter.lat);
            return d1 < d0 ? cur : best;
          }, undefined);

          const target = selFeature || nearest;
          onEnterSubsurfaceRef.current(target);
        }
      };

      wheelSurface.addEventListener('wheel', enterFromMapZoom, { passive: false, capture: true });

      map.on('load', () => {
        // 1. Add Study Area Polygon GeoJSON Source
        const polygonGeoJSON: any = {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              properties: {
                name: studyAreaName,
              },
              geometry: {
                type: 'Polygon',
                coordinates: [studyAreaPolygon],
              },
            },
          ],
        };

        map.addSource('study-area-source', {
          type: 'geojson',
          data: polygonGeoJSON,
        });

        // 2. Translucent Area Fill Layer (Appears at intermediate zoom: 7.5 to 13.5)
        map.addLayer({
          id: 'study-area-fill',
          type: 'fill',
          source: 'study-area-source',
          minzoom: 7,
          maxzoom: 14,
          paint: {
            'fill-color': '#06b6d4',
            'fill-opacity': [
              'interpolate',
              ['linear'],
              ['zoom'],
              7.0, 0.0,
              8.0, 0.22,
              12.0, 0.26,
              14.0, 0.05,
            ],
          },
        });

        // 3. Glowing Study Area Boundary Outline
        map.addLayer({
          id: 'study-area-outline',
          type: 'line',
          source: 'study-area-source',
          minzoom: 7,
          maxzoom: 16,
          paint: {
            'line-color': '#22d3ee',
            'line-width': [
              'interpolate',
              ['linear'],
              ['zoom'],
              7.0, 1.5,
              10.0, 3.0,
              14.0, 2.0,
            ],
            'line-opacity': 0.85,
          },
        });

        // Interactive hover & click on the study area polygon
        // When in area view, clicking directly on the highlighted area initiates the 3D Subsurface dive
        map.on('click', 'study-area-fill', (e) => {
          e.originalEvent.stopPropagation();
          onEnterSubsurfaceRef.current();
        });

        map.on('mouseenter', 'study-area-fill', () => {
          map.getCanvas().style.cursor = 'pointer';
        });

        map.on('mouseleave', 'study-area-fill', () => {
          map.getCanvas().style.cursor = '';
        });

        // Initial setup for markers
        updateMarkerVisibility(map.getZoom());
      });

      return () => {
        wheelSurface.removeEventListener('wheel', enterFromMapZoom, true);
        map.remove();
      };
    }, []);

    // Helper to toggle between Macro Pulse Beacon vs Local Feature Pins based on Zoom
    const updateMarkerVisibility = (zoom: number) => {
      const showMacroBeacon = zoom < 7.5;
      const showLocalPins = zoom >= 8.5;

      if (macroMarkerRef.current) {
        const el = macroMarkerRef.current.getElement();
        el.style.display = showMacroBeacon ? 'block' : 'none';
      }

      markersRef.current.forEach((marker) => {
        const el = marker.getElement();
        el.style.display = showLocalPins ? 'block' : 'none';
      });
    };

    // Build Macro Beacon Marker (Visible at Zoom < 8.5)
    useEffect(() => {
      const map = mapRef.current;
      if (!map) return;

      if (macroMarkerRef.current) {
        macroMarkerRef.current.remove();
      }

      const macroEl = document.createElement('div');
      macroEl.className = 'group cursor-pointer relative';
      macroEl.innerHTML = `
        <div class="relative flex items-center justify-center">
          <div class="absolute w-20 h-20 rounded-full bg-cyan-400/25 animate-ping"></div>
          <div class="absolute w-12 h-12 rounded-full bg-cyan-500/35 animate-pulse"></div>
          <div class="w-8 h-8 rounded-full bg-cyan-500 text-slate-950 ring-4 ring-cyan-300 shadow-[0_0_30px_rgba(6,182,212,1)] flex items-center justify-center">
            <div class="w-3.5 h-3.5 rounded-full bg-slate-950"></div>
          </div>
          <div class="absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap px-3 py-1 rounded-full bg-slate-900/95 border border-cyan-500/60 text-xs font-mono font-bold text-cyan-300 shadow-2xl">
            ${escapeHtml(studyAreaName)} • ${features.length} Stations
          </div>
        </div>
      `;

      macroEl.addEventListener('click', (e) => {
        e.stopPropagation();
        map.fitBounds(
          [
            [bounds.minLng, bounds.minLat],
            [bounds.maxLng, bounds.maxLat],
          ],
          { padding: 60, duration: 1600 }
        );
      });

      const macroMarker = new maplibregl.Marker({ element: macroEl })
        .setLngLat(center)
        .addTo(map);

      macroMarkerRef.current = macroMarker;
      updateMarkerVisibility(map.getZoom());
    }, [center, bounds, features.length, studyAreaName]);

    // Build Individual Station Markers (Visible at Zoom >= 8.5)
    useEffect(() => {
      const map = mapRef.current;
      if (!map) return;

      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];

      features.forEach((feature) => {
        const isSelected = feature.id === selectedFeatureId;
        const isHighlighted = highlightedFeatureIdsRef.current.includes(feature.id);
        const hasDeepData = (feature.totalDepthMeters || 0) > 50 || feature.intervals.length > 0;

        const el = document.createElement('div');
        el.className = 'group cursor-pointer relative';

        el.innerHTML = `
          <div class="relative flex items-center justify-center">
            ${
              hasDeepData
                ? `<div class="absolute w-8 h-8 rounded-full bg-cyan-500/20 beacon-ring"></div>`
                : ''
            }
            <div class="w-5 h-5 rounded-full flex items-center justify-center transition-all duration-300 group-hover:scale-130 ${
              isSelected
                ? 'bg-amber-400 text-slate-950 ring-4 ring-amber-400/40 shadow-[0_0_25px_rgba(251,191,36,0.9)]'
                : isHighlighted
                ? 'bg-violet-400 text-slate-950 ring-4 ring-violet-300/50 shadow-[0_0_25px_rgba(167,139,250,0.85)]'
                : hasDeepData
                ? 'bg-cyan-500 text-slate-950 ring-2 ring-cyan-300 shadow-[0_0_18px_rgba(6,182,212,0.7)]'
                : 'bg-slate-700 text-slate-300 border border-slate-500'
            }">
              <div class="w-2 h-2 rounded-full ${isSelected || isHighlighted ? 'bg-slate-950' : 'bg-slate-950/80'}"></div>
            </div>
            <div class="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap px-2 py-0.5 rounded bg-slate-900/90 border border-slate-700/80 text-[10px] font-mono text-slate-300 shadow-xl pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-40">
              ${escapeHtml(feature.name)} ${feature.totalDepthMeters ? `(${feature.totalDepthMeters}m)` : ''}
            </div>
          </div>
        `;

        el.addEventListener('click', (e) => {
          e.stopPropagation();
          onSelectFeature(feature);

          map.flyTo({
            center: feature.coordinates,
            zoom: 14.2,
            pitch: 50,
            duration: 1800,
            essential: true,
          });
        });

        const marker = new maplibregl.Marker({ element: el })
          .setLngLat(feature.coordinates)
          .addTo(map);

        markersRef.current.push(marker);
      });

      updateMarkerVisibility(map.getZoom());
    }, [features, selectedFeatureId, highlightedFeatureIds, onSelectFeature]);

    return (
      <div className="absolute inset-0 w-full h-full">
        <div ref={mapContainer} className="w-full h-full" />
        {!selectedFeatureId && (
          <div className="pointer-events-none absolute bottom-6 left-1/2 z-20 -translate-x-1/2">
            <div className="flex items-center gap-2 rounded-full border border-slate-600/70 bg-slate-950/88 px-3.5 py-2 text-[11px] font-mono text-slate-200 shadow-[0_8px_30px_rgba(0,0,0,0.45)] backdrop-blur-md animate-in fade-in duration-300">
              <MousePointerClick className="h-3.5 w-3.5 flex-none text-cyan-400" />
              {instructionStage === 'district' && (
                <span>Select the pulsing district marker to explore the study area</span>
              )}
              {instructionStage === 'coverage' && (
                <span>Explore the highlighted coverage area · Continue zooming to reveal stations</span>
              )}
              {instructionStage === 'stations' && (
                <span>Select a station for details · Select the highlighted area to open the 3D subsurface</span>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }
);
