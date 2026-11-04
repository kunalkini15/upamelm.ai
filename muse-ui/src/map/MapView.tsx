// Global 2D surface map, driven directly by MapLibre GL JS on its own WebGL
// context. Consumes the typed scene model + interaction state only.

import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { useInteraction } from "../interaction/store.tsx";
import { antimeridianCenter, boundsOfFeatures } from "../scene-model/coordinates.ts";
import type { SceneFeature, SceneModel } from "../scene-model/types.ts";
import { configuredStyleUrl, fallbackStyle } from "./fallbackStyle.ts";

export interface MapDebugHandle {
  center: () => { lng: number; lat: number };
  zoom: () => number;
  projection: () => string;
  styleName: () => string | undefined;
}

function featureCollection(features: SceneFeature[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: features.map((f) => {
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
        properties: { fid: f.id, label: f.label, layer: f.layerId },
        geometry: geometry as GeoJSON.Geometry,
      };
    }),
  };
}

const SOURCE_ID = "muse-scene";
const POINT_LAYER = "muse-points";
const LINE_LAYER = "muse-lines";
const FILL_LAYER = "muse-fills";
const FILL_OUTLINE = "muse-fills-outline";

export function MapView({ scene, onReady }: { scene: SceneModel; onReady: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  const { state, dispatch } = useInteraction();
  const [basemapFailed, setBasemapFailed] = useState(false);
  const [projection, setProjection] = useState<"mercator" | "globe">("mercator");
  const [mapReady, setMapReady] = useState(false);

  // Expose a tiny read-only handle so browser tests can assert framing
  // without reaching into MapLibre internals.
  useEffect(() => {
    const handle: MapDebugHandle = {
      center: () => {
        const c = mapRef.current?.getCenter();
        return { lng: c?.lng ?? 0, lat: c?.lat ?? 0 };
      },
      zoom: () => mapRef.current?.getZoom() ?? 0,
      projection: () => projection,
      styleName: () => (mapRef.current?.getStyle() as { name?: string } | undefined)?.name,
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
        attributionControl: { compact: false },
      });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "top-right");
      map.addControl(new maplibregl.ScaleControl({}), "bottom-left");
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

  // Scene data layer lifecycle.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const visible = scene.features.filter((f) => state.activeLayerIds.includes(f.layerId));

    const ensure = () => {
      if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, { type: "geojson", data: featureCollection(visible) });
        map.addLayer({
          id: FILL_LAYER,
          type: "fill",
          source: SOURCE_ID,
          filter: ["==", "$type", "Polygon"],
          paint: { "fill-color": "#2f6f9f", "fill-opacity": 0.35 },
        });
        map.addLayer({
          id: FILL_OUTLINE,
          type: "line",
          source: SOURCE_ID,
          filter: ["==", "$type", "Polygon"],
          paint: { "line-color": "#1d4e75", "line-width": 2 },
        });
        map.addLayer({
          id: LINE_LAYER,
          type: "line",
          source: SOURCE_ID,
          filter: ["==", "$type", "LineString"],
          paint: {
            "line-color": ["case", ["==", ["get", "fid"], state.activeFeatureId ?? "\0"], "#d9822b", "#1d4e75"],
            "line-width": ["case", ["==", ["get", "fid"], state.activeFeatureId ?? "\0"], 4, 2],
          },
        });
        map.addLayer({
          id: POINT_LAYER,
          type: "circle",
          source: SOURCE_ID,
          filter: ["==", "$type", "Point"],
          paint: {
            "circle-radius": ["case", ["==", ["get", "fid"], state.activeFeatureId ?? "\0"], 9, 6],
            "circle-color": ["case", ["==", ["get", "fid"], state.activeFeatureId ?? "\0"], "#d9822b", "#2f6f9f"],
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
          featureCollection(visible),
        );
        const selected = state.activeFeatureId ?? "∅";
        if (map.getLayer(LINE_LAYER)) {
          map.setPaintProperty(LINE_LAYER, "line-color", [
            "case",
            ["==", ["get", "fid"], selected],
            "#d9822b",
            "#1d4e75",
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
            "#d9822b",
            "#2f6f9f",
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

  function frameBounds(bounds: ReturnType<typeof boundsOfFeatures>) {
    const map = mapRef.current;
    if (!map || !bounds) return;
    if (bounds.crossesAntimeridian) {
      map.easeTo({ center: antimeridianCenter(bounds), zoom: 1.5, duration: 500 });
    } else {
      map.fitBounds(
        [
          [bounds.west, bounds.south],
          [bounds.east, bounds.north],
        ],
        { padding: 60, duration: 500 },
      );
    }
  }

  function fitStudy() {
    frameBounds(boundsOfFeatures(scene.features.map((f) => f.geometry)));
  }

  function fitSelection() {
    const feature = scene.features.find((f) => f.id === state.activeFeatureId);
    if (feature) frameBounds(boundsOfFeatures([feature.geometry]));
  }

  function home() {
    mapRef.current?.easeTo({ center: [0, 20], zoom: 1.5, duration: 500 });
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
      <div ref={containerRef} className="mapcanvas" data-testid="map-canvas" />
      <div className="maptoolbar" role="toolbar" aria-label="Map controls">
        <button type="button" data-testid="btn-home" onClick={home} title="Reset to world view">
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
          title={scene.features.length === 0 ? "No study geometry to frame" : "Frame all study geometry"}
        >
          Fit study
        </button>
        <button
          type="button"
          data-testid="btn-fit-selection"
          onClick={fitSelection}
          disabled={!state.activeFeatureId}
          title={!state.activeFeatureId ? "Select a feature first" : "Frame the selected feature"}
        >
          Fit selection
        </button>
      </div>
      {basemapFailed && (
        <p className="notice" data-testid="basemap-notice" role="status">
          Remote basemap unavailable — showing the bundled neutral fallback. Study controls and
          attribution remain usable.
        </p>
      )}
    </div>
  );
}
