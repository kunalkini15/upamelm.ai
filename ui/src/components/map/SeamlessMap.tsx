/**
 * @file SeamlessMap.tsx
 * @module ui/components/map/SeamlessMap
 * @description 2D Geospatial GIS engine powered by MapLibre GL.
 *
 * Capabilities:
 * - High-resolution dark basemap with vector fallback layers.
 * - Point observation markers with dynamic cluster and depth-fidelity color coding.
 * - Multi-layer geometry rendering: polygon study boundaries, alignment corridors, raster overlays.
 * - Synchronized viewport transitions (fly-to animations on feature/finding selection).
 * - Canvas export capability for 3D terrain texture draping.
 */

import React, { useEffect, useRef, useImperativeHandle, forwardRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MousePointerClick } from 'lucide-react';
import {
  RenderablePointFeature,
  RenderableRegionalSlab,
  RenderableInterval,
  RawFeature,
  NativeAsset,
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

function geometryPositions(value: unknown, output: [number, number][] = []): [number, number][] {
  if (!Array.isArray(value)) return output;
  if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') output.push([value[0], value[1]]);
  else value.forEach((entry) => geometryPositions(entry, output));
  return output;
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
  spatialFeatures: RawFeature[];
  regionalSlabs: RenderableRegionalSlab[];
  selectedFeatureId: string | null;
  highlightedFeatureIds?: string[];
  onSelectFeature: (feature: RenderablePointFeature) => void;
  onSelectSpatialFeature?: (feature: RawFeature) => void;
  onSelectInterval?: (interval: RenderableInterval) => void;
  onZoomChange: (zoom: number, pitch: number) => void;
  onExitLocalView: () => void;
  onEnterSubsurface?: (feature?: RenderablePointFeature) => void;
  center: [number, number];
  bounds: { minLng: number; maxLng: number; minLat: number; maxLat: number };
  studyAreaPolygon: [number, number][];
  studyAreaName: string;
  nativeAssets?: NativeAsset[];
  sourceBaseUrl?: string;
  activeLayerIds?: string[];
}

export const SeamlessMap = forwardRef<SeamlessMapHandle, SeamlessMapProps>(
  (
    {
      features,
      spatialFeatures,
      selectedFeatureId,
      highlightedFeatureIds = [],
      onSelectFeature,
      onSelectSpatialFeature,
      onZoomChange,
      onExitLocalView,
      onEnterSubsurface,
      center,
      bounds,
      studyAreaPolygon,
      studyAreaName,
      nativeAssets = [],
      sourceBaseUrl,
      activeLayerIds = [],
    },
    ref
  ) => {
    const macroBounds = {
      minLng: Math.min(67, bounds.minLng),
      minLat: Math.min(6, bounds.minLat),
      maxLng: Math.max(98, bounds.maxLng),
      maxLat: Math.max(38, bounds.maxLat),
    };
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
    const onSelectSpatialFeatureRef = useRef(onSelectSpatialFeature);
    onSelectSpatialFeatureRef.current = onSelectSpatialFeature;
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
        const spatialTargets = spatialFeatures.filter((feature) => featureIds.includes(feature.id) && feature.geometry);
        if (!mapRef.current || (targets.length === 0 && spatialTargets.length === 0)) return;
        if (targets.length === 1) {
          mapRef.current.flyTo({ center: targets[0].coordinates, zoom: 13.2, pitch: 35, duration: 1200, essential: true });
          return;
        }
        const positions = [...targets.map((feature) => feature.coordinates), ...spatialTargets.flatMap((feature) => geometryPositions(feature.geometry?.coordinates))];
        const lngs = positions.map((position) => position[0]);
        const lats = positions.map((position) => position[1]);
        mapRef.current.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 120, duration: 1400, maxZoom: 13 });
      },
      resetView: () => {
        if (!mapRef.current) return;
        mapRef.current.fitBounds(
          [[macroBounds.minLng, macroBounds.minLat], [macroBounds.maxLng, macroBounds.maxLat]],
          { padding: 36, duration: 1500, pitch: 0, bearing: 0 }
        );
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
        center: [82.5, 22],
        zoom: 3.4,
        pitch: 0,
        bearing: 0,
        maxPitch: 85,
        canvasContextAttributes: { preserveDrawingBuffer: true },
      });

      map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');

      (window as any).mapInstance = map;
      mapRef.current = map;

      // Begin with the complete validated spatial footprint in view. The
      // conservative max zoom keeps regional packages in geographic context,
      // while nationwide packages naturally frame the full country.
      map.once('load', () => {
        map.fitBounds(
          [[macroBounds.minLng, macroBounds.minLat], [macroBounds.maxLng, macroBounds.maxLat]],
          { padding: 36, duration: 0, pitch: 0, bearing: 0 }
        );
      });

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

        if (onEnterSubsurfaceRef.current && map.getZoom() >= 14.4 && event.deltaY < 0) {
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
          onEnterSubsurfaceRef.current?.(target);
        }
      };

      wheelSurface.addEventListener('wheel', enterFromMapZoom, { passive: false, capture: true });

      map.on('load', () => {
        // Georeferenced source figures become bounded image layers only when
        // the package supplies both browser-accessible imagery and bounds.
        nativeAssets.filter((asset) => asset.bounds && asset.path).forEach((asset, index) => {
          let url: string | null = null;
          try {
            if (/^https?:\/\/|^data:image\/|^blob:/.test(asset.path!)) url = asset.path!;
            else if (asset.path!.startsWith('/') && !asset.path!.startsWith('/Users/')) url = asset.path!;
            else if (sourceBaseUrl && !asset.path!.startsWith('/Users/')) url = new URL(asset.path!, sourceBaseUrl).href;
          } catch { url = null; }
          if (!url) return;
          const [west, south, east, north] = asset.bounds!;
          const sourceId = `package-image-${index}`;
          map.addSource(sourceId, { type: 'image', url, coordinates: [[west, north], [east, north], [east, south], [west, south]] });
          map.addLayer({ id: `${sourceId}-layer`, type: 'raster', source: sourceId, paint: { 'raster-opacity': 0.72, 'raster-fade-duration': 0 } });
        });

        // Preserve every supported geometry not already represented by an
        // interactive single-point marker. This also keeps MultiPoint visible.
        const nonPointFeatures = spatialFeatures
          .filter((feature) => feature.geometry && feature.geometry.type !== 'Point' && (!feature.layerIds?.length || feature.layerIds.some((id) => activeLayerIds.includes(id))))
          .map((feature) => ({
            type: 'Feature',
            id: feature.id,
            properties: { id: feature.id, name: feature.name, featureType: feature.type, evidenceStatus: feature.evidenceStatus || 'unspecified', locationFidelity: feature.locationFidelity || feature.geometry?.fidelity || 'unspecified', confidence: feature.confidence || 'unspecified', selected: highlightedFeatureIdsRef.current.includes(feature.id) },
            geometry: feature.geometry,
          }));
        if (nonPointFeatures.length > 0) {
          map.addSource('package-spatial-source', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: nonPointFeatures } as any,
          });
          map.addLayer({
            id: 'package-polygons-fill', type: 'fill', source: 'package-spatial-source',
            filter: ['==', ['geometry-type'], 'Polygon'],
            paint: { 'fill-color': ['match', ['get', 'evidenceStatus'], 'proposed', '#E3B34E', 'derived', '#C2A15C', 'figure-derived', '#5FB8D6', '#35C4B5'], 'fill-opacity': ['case', ['get', 'selected'], 0.42, 0.18] },
          });
          map.addLayer({
            id: 'package-polygons-outline', type: 'line', source: 'package-spatial-source',
            filter: ['==', ['geometry-type'], 'Polygon'],
            paint: { 'line-color': ['case', ['get', 'selected'], '#ECF2EF', '#C2A15C'], 'line-width': ['case', ['get', 'selected'], 4, 2], 'line-opacity': 0.85 },
          });
          map.addLayer({
            id: 'package-lines', type: 'line', source: 'package-spatial-source',
            filter: ['==', ['geometry-type'], 'LineString'],
            paint: { 'line-color': ['case', ['get', 'selected'], '#ECF2EF', ['match', ['get', 'evidenceStatus'], 'proposed', '#E3B34E', 'derived', '#C2A15C', 'figure-derived', '#5FB8D6', '#E3B34E']], 'line-width': ['case', ['get', 'selected'], 5, 3], 'line-opacity': 0.9 },
          });
          map.addLayer({
            id: 'package-multipoints', type: 'circle', source: 'package-spatial-source',
            filter: ['==', ['geometry-type'], 'Point'],
            paint: {
              'circle-radius': 6,
              'circle-color': '#35C4B5',
              'circle-stroke-color': '#1F4A45',
              'circle-stroke-width': 2,
              'circle-opacity': 0.9,
            },
          });
          const selectSpatial = (event: maplibregl.MapLayerMouseEvent) => {
            const id = String(event.features?.[0]?.properties?.id || '');
            const feature = spatialFeatures.find((item) => item.id === id);
            if (feature) onSelectSpatialFeatureRef.current?.(feature);
          };
          ['package-polygons-fill', 'package-lines', 'package-multipoints'].forEach((layerId) => map.on('click', layerId, selectSpatial));
        }

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
            'fill-color': '#35C4B5',
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
            'line-color': '#35C4B5',
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
          if (!onEnterSubsurfaceRef.current) return;
          e.originalEvent.stopPropagation();
          onEnterSubsurfaceRef.current?.();
        });

        map.on('mouseenter', 'study-area-fill', () => {
          if (onEnterSubsurfaceRef.current) map.getCanvas().style.cursor = 'pointer';
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
      const source = map?.getSource('package-spatial-source') as maplibregl.GeoJSONSource | undefined;
      if (!source) return;
      const nonPointFeatures = spatialFeatures.filter((feature) => feature.geometry && feature.geometry.type !== 'Point' && (!feature.layerIds?.length || feature.layerIds.some((id) => activeLayerIds.includes(id)))).map((feature) => ({ type: 'Feature', id: feature.id, properties: { id: feature.id, name: feature.name, featureType: feature.type, evidenceStatus: feature.evidenceStatus || 'unspecified', locationFidelity: feature.locationFidelity || feature.geometry?.fidelity || 'unspecified', confidence: feature.confidence || 'unspecified', selected: highlightedFeatureIds.includes(feature.id) }, geometry: feature.geometry }));
      source.setData({ type: 'FeatureCollection', features: nonPointFeatures } as any);
    }, [activeLayerIds, spatialFeatures, highlightedFeatureIds]);

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
          <div class="absolute w-20 h-20 rounded-full bg-accent/25 animate-ping"></div>
          <div class="absolute w-12 h-12 rounded-full bg-accent/35 animate-pulse"></div>
          <div class="w-8 h-8 rounded-full bg-accent text-ink-950 ring-4 ring-accent-strong flex items-center justify-center">
            <div class="w-3.5 h-3.5 rounded-full bg-ink-950"></div>
          </div>
          <div class="absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap px-3 py-1 rounded-full bg-ink-900/95 border border-accent/60 text-xs font-mono font-bold text-accent-strong shadow-2xl">
            ${escapeHtml(studyAreaName)} • ${spatialFeatures.filter((feature) => feature.geometry).length} Mapped objects
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

    // Build individual point-object markers (visible at Zoom >= 8.5)
    useEffect(() => {
      const map = mapRef.current;
      if (!map) return;

      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];

      features.filter((feature) => !feature.layerIds?.length || feature.layerIds.some((id) => activeLayerIds.includes(id))).forEach((feature) => {
        const isSelected = feature.id === selectedFeatureId;
        const isHighlighted = highlightedFeatureIdsRef.current.includes(feature.id);
        const hasDeepData = (feature.totalDepthMeters || 0) > 50 || feature.intervals.length > 0;

        const el = document.createElement('div');
        el.className = 'group cursor-pointer relative';

        el.innerHTML = `
          <div class="relative flex items-center justify-center">
            ${
              hasDeepData
                ? `<div class="absolute w-8 h-8 rounded-full bg-accent/20 beacon-ring"></div>`
                : ''
            }
            <div class="w-5 h-5 rounded-full flex items-center justify-center transition-all duration-300 group-hover:scale-130 ${
              isSelected
                ? 'bg-amber text-ink-950 ring-4 ring-amber/40 shadow-[0_0_18px_rgba(227,179,78,0.45)]'
                : isHighlighted
                ? 'bg-[#C2A15C] text-ink-950 ring-4 ring-[#C2A15C]/50 shadow-[0_0_18px_rgba(194,161,92,0.45)]'
                : hasDeepData
                ? 'bg-accent text-ink-950 ring-2 ring-accent-strong'
                : 'bg-ink-800 text-muted border border-line'
            }">
              <div class="w-2 h-2 rounded-full ${isSelected || isHighlighted ? 'bg-ink-950' : 'bg-ink-950/80'}"></div>
            </div>
            <div class="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap px-2 py-0.5 rounded bg-ink-900/90 border border-line/80 text-[10px] font-mono text-muted shadow-xl pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-40">
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
    }, [features, selectedFeatureId, highlightedFeatureIds, onSelectFeature, activeLayerIds]);

    return (
      <div className="absolute inset-0 w-full h-full">
        <div ref={mapContainer} className="w-full h-full" />
        {!selectedFeatureId && (
          <div className="pointer-events-none absolute bottom-6 left-1/2 z-20 -translate-x-1/2">
            <div className="flex items-center gap-2 rounded-full border border-line/70 bg-ink-950/88 px-3.5 py-2 text-[11px] font-mono text-text shadow-[0_8px_30px_rgba(0,0,0,0.45)] backdrop-blur-md animate-in fade-in duration-300">
              <MousePointerClick className="h-3.5 w-3.5 flex-none text-accent" />
              {instructionStage === 'district' && (
                <span>Select the pulsing study marker to explore the evidence footprint</span>
              )}
              {instructionStage === 'coverage' && (
                <span>Explore the highlighted coverage area · Continue zooming to reveal objects</span>
              )}
              {instructionStage === 'stations' && (
                <span>
                  {onEnterSubsurface
                    ? 'Select an object for details · Click the highlighted area or zoom into the ground to open the 3D view'
                    : 'Select an object for details'}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }
);
