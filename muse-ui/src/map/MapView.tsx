// Global 2D surface map, driven directly by MapLibre GL JS on its own WebGL
// context. Consumes the typed scene model + interaction state only. Layer
// color follows the categorical token order by layer slot (never document
// identity); selection pairs color with size and label.

import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { layerDash } from "../design/channels.ts";
import { cameraDuration } from "../design/components.tsx";
import { TOKENS } from "../design/tokens.ts";
import { useInteraction } from "../interaction/store.tsx";
import { antimeridianCenter, boundsOfFeatures } from "../scene-model/coordinates.ts";
import type { SceneFeature, SceneModel } from "../scene-model/types.ts";
import { configuredStyleUrl, fallbackStyle } from "./fallbackStyle.ts";

export interface MapDebugHandle {
  center: () => { lng: number; lat: number };
  zoom: () => number;
  projection: () => string;
  styleName: () => string | undefined;
  fitStudy: () => void;
  fitSelection: () => void;
}

const CAT: string[] = [...TOKENS.cat];

function layerSlotOf(feature: SceneFeature, scene: SceneModel): number {
  const i = scene.layers.findIndex((l) => l.id === feature.layerId);
  return i < 0 ? 0 : i;
}

function featureCollection(scene: SceneModel, visibleIds: Set<string>): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: scene.features
      .filter((f) => visibleIds.has(f.layerId))
      .map((f) => {
        const g = f.geometry;
        const geometry =
          g.kind === "point"
            ? { type: "Point", coordinates: g.coordinates }
            : g.kind === "line"
              ? { type: "LineString", coordinates: g.coordinates }
              : { type: "Polygon", coordinates: g.coordinates };
        return {
          type: "Feature",
          id: f.id,
          properties: { fid: f.id, label: f.label, layer: f.layerId, slot: layerSlotOf(f, scene) },
          geometry: geometry as GeoJSON.Geometry,
        };
      }),
  };
}

function slotColorExpression(defaultColor: string): maplibregl.ExpressionSpecification {
  // MapLibre match on the validated layer slot; unknown slots fall back.
  const expr: unknown[] = ["match", ["get", "slot"]];
  CAT.forEach((c, i) => {
    expr.push(i, c);
  });
  expr.push(defaultColor);
  return expr as unknown as maplibregl.ExpressionSpecification;
}

const SOURCE_ID = "muse-scene";
const POINT_LAYER = "muse-points";
const LINE_LAYER = "muse-lines";
const FILL_LAYER = "muse-fills";
const FILL_OUTLINE = "muse-fills-outline";

export function MapView({
  scene,
  onReady,
  dimmed,
  reducedMotion,
}: {
  scene: SceneModel;
  onReady: () => void;
  dimmed?: boolean;
  reducedMotion?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  const reducedRef = useRef(reducedMotion ?? false);
  reducedRef.current = reducedMotion ?? false;
  const { state, dispatch } = useInteraction();
  const [basemapFailed, setBasemapFailed] = useState(false);
  const [projection, setProjection] = useState<"mercator" | "globe">("mercator");
  const [mapReady, setMapReady] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);

  function frameBounds(bounds: ReturnType<typeof boundsOfFeatures>) {
    const map = mapRef.current;
    if (!map || !bounds) return;
    const duration = cameraDuration(500, reducedRef.current);
    if (bounds.crossesAntimeridian) {
      map.easeTo({ center: antimeridianCenter(bounds), zoom: 1.5, duration });
    } else if (bounds.west === bounds.east && bounds.south === bounds.north) {
      // Single-point selection: fitBounds would dive to max zoom and strand
      // the evidence without context. Center on the point at a contextual
      // zoom instead, never zooming out past the user's current view.
      map.easeTo({
        center: [bounds.west, bounds.south],
        zoom: Math.max(map.getZoom(), 8),
        duration,
      });
    } else {
      map.fitBounds(
        [
          [bounds.west, bounds.south],
          [bounds.east, bounds.north],
        ],
        { padding: 60, duration },
      );
    }
  }

  function fitStudy() {
    frameBounds(boundsOfFeatures(scene.features.map((f) => f.geometry)));
  }

  const fitStudyRef = useRef(fitStudy);
  fitStudyRef.current = fitStudy;
  const fitSelectionRef = useRef<() => void>(() => {});
  fitSelectionRef.current = () => {
    const feature = scene.features.find((f) => f.id === state.activeFeatureId);
    if (feature) frameBounds(boundsOfFeatures([feature.geometry]));
  };
  // Selection focuses spatially by default: a selection arriving from any
  // surface (map click, 3D, narrative, report) frames the evidence on the
  // map without a manual step. Camera travel honors reduced motion.
  const framedSelectionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!mapReady) return;
    if (state.activeFeatureId && state.activeFeatureId !== framedSelectionRef.current) {
      framedSelectionRef.current = state.activeFeatureId;
      fitSelectionRef.current();
    } else if (!state.activeFeatureId) {
      framedSelectionRef.current = null;
    }
  }, [mapReady, state.activeFeatureId]);

  // Expose a tiny read-only handle so browser tests and the tour affordance
  // can assert framing without reaching into MapLibre internals.
  useEffect(() => {
    const handle: MapDebugHandle = {
      center: () => {
        const c = mapRef.current?.getCenter();
        return { lng: c?.lng ?? 0, lat: c?.lat ?? 0 };
      },
      zoom: () => mapRef.current?.getZoom() ?? 0,
      // TEMP-M1-DIAG (reverted before handoff): expose internals for diagnosis.
      ...( { __diag: () => {
        const m = mapRef.current as unknown as {
          transform: { width: number; height: number };
          painter: { width: number; height: number } | undefined;
          loaded: () => boolean;
          areTilesLoaded: () => boolean;
          getCanvas: () => HTMLCanvasElement;
          getContainer: () => HTMLElement;
          resize: (e?: unknown) => void;
          triggerRepaint: () => void;
          _resizeObserver: unknown;
        } | null;
        return m ? {
          transform: { w: m.transform.width, h: m.transform.height },
          painter: m.painter ? { w: m.painter.width, h: m.painter.height } : null,
          loaded: m.loaded(),
          tilesLoaded: m.areTilesLoaded(),
          backing: { w: m.getCanvas().width, h: m.getCanvas().height },
          canvasCss: { w: m.getCanvas().clientWidth, h: m.getCanvas().clientHeight },
          containerClient: { w: m.getContainer().clientWidth, h: m.getContainer().clientHeight },
          hasRO: !!m._resizeObserver,
        } : null;
      }, __resize: () => mapRef.current?.resize(), __repaint: () => (mapRef.current as unknown as { triggerRepaint: () => void })?.triggerRepaint() } as object),
      projection: () => projection,
      styleName: () => (mapRef.current?.getStyle() as { name?: string } | undefined)?.name,
      fitStudy: () => fitStudyRef.current(),
      fitSelection: () => fitSelectionRef.current(),
    };
    (window as unknown as { __museMap?: MapDebugHandle }).__museMap = handle;
    return () => {
      delete (window as unknown as { __museMap?: MapDebugHandle }).__museMap;
    };
  }, [projection]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;
    let map: maplibregl.Map | null = null;

    async function init() {
      const url = configuredStyleUrl();
      let style: string | ReturnType<typeof fallbackStyle> = url;
      try {
        const res = await fetch(url, { method: "GET" });
        if (!res.ok) throw new Error(`style HTTP ${res.status}`);
        await res.json();
      } catch {
        if (!cancelled) {
          style = fallbackStyle();
          setBasemapFailed(true);
        } else {
          style = fallbackStyle();
        }
      }
      if (cancelled || !containerRef.current) return;
      map = new maplibregl.Map({
        container: containerRef.current,
        style,
        center: [0, 20],
        zoom: 1.5,
        // Compact attribution collapses to a toggle so the credit line never
        // runs through the bottom canvas toolbar in narrow panes (split mode
        // or a docked fallback banner). Full attribution stays one tap away.
        attributionControl: { compact: true },
      });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
      map.addControl(new maplibregl.ScaleControl({}), "bottom-right");
      map.on("load", () => {
        if (cancelled) return;
        setMapReady(true);
        if (!readyRef.current) {
          readyRef.current = true;
          onReady();
        }
      });
      // Runtime tile failures after a successful style load keep the map
      // usable and raise the same honest notice.
      map.on("error", (e) => {
        const err = e?.error as { status?: number } | undefined;
        if (err && typeof err.status === "number" && err.status >= 400) {
          setBasemapFailed((prev) => {
            if (!prev) {
              try {
                map?.setStyle(fallbackStyle());
              } catch {
                /* keep current style */
              }
            }
            return true;
          });
        }
      });
    }

    void init();
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scene data layer lifecycle: one GeoJSON source, four paint layers, setData
  // updates only (no per-frame allocation).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const visible = new Set(state.activeLayerIds);
    const selected = state.activeFeatureId ?? "∅";
    const selectedColor = CAT[5]!;
    const defaultFill = "#2f6f9f";

    const ensure = () => {
      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, { type: "geojson", data: featureCollection(scene, visible) });
        map.addLayer({
          id: FILL_LAYER,
          type: "fill",
          source: SOURCE_ID,
          filter: ["==", "$type", "Polygon"],
          paint: {
            "fill-color": slotColorExpression(defaultFill),
            "fill-opacity": 0.28,
          },
        });
        map.addLayer({
          id: FILL_OUTLINE,
          type: "line",
          source: SOURCE_ID,
          filter: ["==", "$type", "Polygon"],
          paint: {
            "line-color": slotColorExpression(defaultFill),
            "line-width": 2,
          },
        });
        map.addLayer({
          id: LINE_LAYER,
          type: "line",
          source: SOURCE_ID,
          filter: ["==", "$type", "LineString"],
          paint: {
            "line-color": [
              "case",
              ["==", ["get", "fid"], selected],
              selectedColor,
              slotColorExpression(defaultFill),
            ],
            "line-width": ["case", ["==", ["get", "fid"], selected], 4, 2],
          },
        });
        map.addLayer({
          id: POINT_LAYER,
          type: "circle",
          source: SOURCE_ID,
          filter: ["==", "$type", "Point"],
          paint: {
            "circle-radius": ["case", ["==", ["get", "fid"], selected], 9, 6],
            "circle-color": [
              "case",
              ["==", ["get", "fid"], selected],
              selectedColor,
              slotColorExpression(TOKENS.evidenceMark),
            ],
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2,
          },
        });
        for (const layer of [POINT_LAYER, LINE_LAYER, FILL_LAYER]) {
          map.on("mouseenter", layer, (e) => {
            const fid = e.features?.[0]?.properties?.fid;
            if (typeof fid === "string") dispatch({ type: "hover", featureId: fid });
            map.getCanvas().style.cursor = "pointer";
          });
          map.on("mouseleave", layer, () => {
            dispatch({ type: "hover", featureId: null });
            map.getCanvas().style.cursor = "";
          });
          map.on("click", layer, (e) => {
            const fid = e.features?.[0]?.properties?.fid;
            dispatch({ type: "select", featureId: typeof fid === "string" ? fid : null });
          });
        }
      } else {
        (map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource).setData(
          featureCollection(scene, visible),
        );
        if (map.getLayer(LINE_LAYER)) {
          map.setPaintProperty(LINE_LAYER, "line-color", [
            "case",
            ["==", ["get", "fid"], selected],
            selectedColor,
            slotColorExpression(defaultFill),
          ]);
          map.setPaintProperty(LINE_LAYER, "line-width", [
            "case",
            ["==", ["get", "fid"], selected],
            4,
            2,
          ]);
        }
        if (map.getLayer(POINT_LAYER)) {
          map.setPaintProperty(POINT_LAYER, "circle-color", [
            "case",
            ["==", ["get", "fid"], selected],
            selectedColor,
            slotColorExpression(TOKENS.evidenceMark),
          ]);
          map.setPaintProperty(POINT_LAYER, "circle-radius", [
            "case",
            ["==", ["get", "fid"], selected],
            9,
            6,
          ]);
        }
      }
    };
    if (!map.isStyleLoaded()) {
      map.once("idle", ensure);
    } else {
      ensure();
    }
  }, [mapReady, scene, state.activeLayerIds, state.activeFeatureId, dispatch]);

  function fitSelection() {
    fitSelectionRef.current();
  }

  function home() {
    mapRef.current?.easeTo({ center: [0, 20], zoom: 1.5, duration: cameraDuration(500, reducedRef.current) });
  }

  function toggleProjection() {
    const map = mapRef.current;
    const next = projection === "mercator" ? "globe" : "mercator";
    try {
      (map as unknown as { setProjection?: (p: { type: string }) => void })?.setProjection?.({
        type: next,
      });
    } catch {
      /* projection unsupported by this MapLibre build; label stays honest */
      return;
    }
    setProjection(next);
  }

  return (
    <div className="mapwrap" data-testid="map-wrap">
      <div ref={containerRef} className="mapcanvas" data-testid="map-canvas" aria-hidden={dimmed} />
      <div className="maptoolbar" role="toolbar" aria-label="Map controls">
        <button type="button" data-testid="btn-home" onClick={home} title="Reset to world view (overview preset)">
          Home
        </button>
        <button
          type="button"
          data-testid="btn-projection"
          onClick={toggleProjection}
          title="Switch between Mercator and globe projections"
        >
          Projection: {projection}
        </button>
        <button
          type="button"
          data-testid="btn-fit-study"
          onClick={fitStudy}
          disabled={scene.features.length === 0}
          title={scene.features.length === 0 ? "No study geometry to frame" : "Overview preset: frame all study geometry"}
        >
          Fit study
        </button>
        <button
          type="button"
          data-testid="btn-fit-selection"
          onClick={fitSelection}
          disabled={!state.activeFeatureId}
          title={!state.activeFeatureId ? "Select a feature first" : "Detail preset: frame the selected feature"}
        >
          Fit selection
        </button>
        <button
          type="button"
          data-testid="btn-legend"
          onClick={() => setLegendOpen((v) => !v)}
          aria-expanded={legendOpen}
          title="Toggle legend (compact layouts)"
        >
          Legend
        </button>
      </div>
      {scene.layers.length > 0 && (
      <div className={legendOpen ? "legend-dock compact-open" : "legend-dock"} data-testid="legend" aria-label="Map legend">
        <h2>Legend</h2>
          <ul>
            {scene.layers.map((l, i) => (
              <li key={l.id} data-testid={`legend-row-${l.id}`}>
                <span
                  className={l.capabilityId === "point-observation" ? "swatch" : "swatch-line"}
                  style={{
                    background: l.capabilityId === "point-observation" ? CAT[i % CAT.length] : undefined,
                    borderColor: l.capabilityId === "point-observation" ? undefined : CAT[i % CAT.length],
                    borderTopStyle: layerDash(i).length > 0 ? "dashed" : "solid",
                  }}
                  aria-hidden="true"
                />
                <span>{l.title} · {l.capabilityId}</span>
                {l.referenceKind === "water-level" && <span className="ref-tag">reference</span>}
              </li>
            ))}
          </ul>
      </div>
      )}
      {basemapFailed && (
        <p className="notice basemap-chip" data-testid="basemap-notice" role="status">
          Remote basemap unavailable — showing the bundled neutral fallback. Study controls and
          attribution remain usable.
        </p>
      )}
    </div>
  );
}
