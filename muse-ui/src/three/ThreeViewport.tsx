// Separate coordinated scientific 3D viewport. It owns its own WebGL context
// (never MapLibre's) and derives everything from the scene model plus the
// interaction state. Only validated finite heights in meters are rendered,
// positioned in a local metric frame anchored to the validated study bounds;
// nothing is invented. Clipping is implemented via a local clipping plane;
// vertical exaggeration is an explicitly labelled control (BASELINE.md D3).

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { useEffect, useRef, useState } from "react";
import type { SceneFeature, SceneModel } from "../scene-model/types.ts";
import { anchorOfBounds, lonLatToLocal } from "./localFrame.ts";

export interface ClipState {
  enabled: boolean;
  // Normalized height of the clip plane in local units.
  height: number;
}

export function createClipState(): ClipState {
  return { enabled: false, height: 0 };
}

export function applyClipState(
  materials: THREE.Material[],
  clip: ClipState,
): THREE.Plane[] {
  if (!clip.enabled) {
    for (const m of materials) {
      m.clippingPlanes = null;
      m.needsUpdate = true;
    }
    return [];
  }
  const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), clip.height);
  for (const m of materials) {
    m.clippingPlanes = [plane];
    m.needsUpdate = true;
  }
  return [plane];
}

export interface ThreeDebugHandle {
  featureCount: () => number;
  selectedId: () => string | null;
  anchor: () => { lon: number; lat: number } | null;
}

function elevatedFeatures(scene: SceneModel): SceneFeature[] {
  return scene.features.filter(
    (f) =>
      typeof f.geometry.elevationMeters === "number" &&
      Number.isFinite(f.geometry.elevationMeters),
  );
}

function representativeLonLat(feature: SceneFeature): [number, number] {
  const g = feature.geometry;
  if (g.kind === "point") return g.coordinates;
  if (g.kind === "line") return g.coordinates[0] as [number, number];
  return g.coordinates[0]?.[0] as [number, number];
}

export function ThreeViewport({
  enabledReason,
  scene,
  activeFeatureId,
}: {
  enabledReason: string | null;
  scene: SceneModel;
  activeFeatureId: string | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const materialsRef = useRef<THREE.Material[]>([]);
  const selectedRef = useRef<string | null>(activeFeatureId);
  selectedRef.current = activeFeatureId;
  const resetRef = useRef<() => void>(() => {});
  const [exaggeration, setExaggeration] = useState(1);
  const [clip, setClip] = useState<ClipState>(createClipState);
  const exaggerationRef = useRef(exaggeration);
  exaggerationRef.current = exaggeration;

  const elevated = enabledReason === null ? elevatedFeatures(scene) : [];
  const anchor = enabledReason === null && scene.bounds ? anchorOfBounds(scene.bounds) : null;

  // Mount/unmount owns the render loop; switching modes disposes everything.
  useEffect(() => {
    if (enabledReason !== null) return;
    const canvas = canvasRef.current;
    if (!canvas || !scene.bounds || !anchor) return;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.localClippingEnabled = true;
    const scene3 = new THREE.Scene();
    scene3.background = new THREE.Color("#101418");
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
    const frameAnchor = anchor;
    // Frame the true evidence extent: fit the widest local offset, never a
    // fixed invented subject.
    let maxOffset = 10;
    const frameOf = (feature: SceneFeature): { x: number; z: number; h: number } => {
      const [lon, lat] = representativeLonLat(feature);
      const { x, z } = lonLatToLocal(lon, lat, frameAnchor);
      const h = Number(feature.geometry.elevationMeters);
      if (Number.isFinite(x)) maxOffset = Math.max(maxOffset, Math.abs(x));
      if (Number.isFinite(z)) maxOffset = Math.max(maxOffset, Math.abs(z));
      if (Number.isFinite(h)) maxOffset = Math.max(maxOffset, Math.abs(h));
      return { x, z, h };
    };
    const framed = elevatedFeatures(scene).map((f) => ({ feature: f, frame: frameOf(f) }));
    const dist = Math.max(20, maxOffset * 2.2);
    // Symbol sizes scale with the evidence extent so markers stay legible at
    // any study scale; positions and heights remain to scale. Radii are
    // symbology, never measurements.
    const symbolR = Math.max(0.35, Math.min(8, maxOffset * 0.02));
    const home = new THREE.Vector3(dist * 0.6, dist * 0.55, dist * 0.8);
    camera.position.copy(home);
    const controls = new OrbitControls(camera, canvas);
    controls.target.set(0, 0, 0);

    const group = new THREE.Group();
    scene3.add(group);
    const disposables: Array<{ dispose: () => void }> = [];
    const track = <T extends { dispose: () => void }>(item: T): T => {
      disposables.push(item);
      return item;
    };
    // Scale context only: a labelled ground grid at y = 0, not evidence.
    const grid = track(new THREE.GridHelper(Math.max(20, maxOffset * 2), 10, 0x6b7c8d, 0x33404d));
    group.add(grid);
    const axes = track(new THREE.AxesHelper(Math.max(6, maxOffset / 2)));
    group.add(axes);
    const markerMaterials: THREE.Material[] = [];
    const markerById = new Map<string, THREE.MeshStandardMaterial>();
    for (const { feature, frame } of framed) {
      if (!Number.isFinite(frame.h)) continue;
      // Span from the y = 0 ground plane to the validated height: truthful
      // columns only, never invented surfaces. Near-zero heights render as a
      // marker alone so no column overshoots the true value.
      const markerMaterial = track(
        new THREE.MeshStandardMaterial({ color: 0x9fd4ff, emissive: 0x000000 }),
      );
      const marker = new THREE.Mesh(track(new THREE.SphereGeometry(symbolR * 2, 16, 12)), markerMaterial);
      marker.position.set(frame.x, frame.h, frame.z);
      group.add(marker);
      const columnHeight = Math.abs(frame.h);
      const columnMaterial = track(
        new THREE.MeshStandardMaterial({ color: 0x2f6f9f }),
      );
      if (columnHeight >= 0.01) {
        const column = new THREE.Mesh(
          track(new THREE.CylinderGeometry(symbolR, symbolR, columnHeight, 12)),
          columnMaterial,
        );
        column.position.set(frame.x, frame.h / 2, frame.z);
        group.add(column);
      }
      markerMaterials.push(columnMaterial, markerMaterial);
      markerById.set(feature.id, markerMaterial);
    }
    materialsRef.current = markerMaterials;
    scene3.add(new THREE.AmbientLight(0xffffff, 0.9));
    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(5, 8, 4);
    scene3.add(dir);

    const paintSelection = () => {
      for (const [id, mat] of markerById) {
        const selected = id === selectedRef.current;
        mat.color.set(selected ? 0xffb340 : 0x9fd4ff);
        mat.emissive.set(selected ? 0x7a4a00 : 0x000000);
        mat.needsUpdate = true;
      }
    };
    paintSelection();

    resetRef.current = () => {
      camera.position.copy(home);
      controls.target.set(0, 0, 0);
      controls.update();
    };

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const w = Math.max(1, parent.clientWidth);
      const h = Math.max(1, parent.clientHeight - 40);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    window.addEventListener("resize", resize);

    let raf = 0;
    let lastSelected: string | null | undefined;
    const loop = () => {
      group.scale.y = exaggerationRef.current;
      if (selectedRef.current !== lastSelected) {
        lastSelected = selectedRef.current;
        paintSelection();
      }
      controls.update();
      renderer.render(scene3, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();

    (window as unknown as { __museThree?: ThreeDebugHandle }).__museThree = {
      featureCount: () => markerById.size,
      selectedId: () => selectedRef.current,
      anchor: () => (frameAnchor ? { ...frameAnchor } : null),
    };

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      controls.dispose();
      for (const d of disposables) d.dispose();
      renderer.dispose();
      materialsRef.current = [];
      delete (window as unknown as { __museThree?: ThreeDebugHandle }).__museThree;
    };
  }, [enabledReason, scene, anchor?.lon, anchor?.lat]);

  useEffect(() => {
    if (enabledReason !== null) return;
    applyClipState(materialsRef.current, clip);
  }, [clip, enabledReason]);

  if (enabledReason !== null) {
    return (
      <div className="three-disabled" data-testid="three-disabled" role="status">
        <h2>3D unavailable</h2>
        <p>{enabledReason}</p>
        <ul>
          <li>Orbit inspection, reset, orientation cue, and scale context appear here.</li>
          <li>
            Clipping and a labelled vertical-exaggeration control are offered where
            scientifically appropriate.
          </li>
        </ul>
      </div>
    );
  }

  return (
    <div className="threewrap" data-testid="three-wrap">
      <canvas ref={canvasRef} data-testid="three-canvas" />
      <p className="muted" data-testid="three-provenance">
        Local metric frame anchored at {anchor ? `${anchor.lon.toFixed(4)}, ${anchor.lat.toFixed(4)}` : "—"}
        {" "}(WGS84 lon/lat, equirectangular meters); {elevated.length} evidence column(s), heights in
        meters as validated. Grid and axes are scale context, not evidence; marker sizes are
        schematic while positions and heights are to scale.
      </p>
      <div className="maptoolbar" role="toolbar" aria-label="3D controls">
        <button
          type="button"
          data-testid="btn-three-home"
          onClick={() => resetRef.current()}
          title="Reset the 3D camera"
        >
          Reset view
        </button>
        <label>
          Vertical exaggeration: {exaggeration.toFixed(1)}×{" "}
          <input
            type="range"
            min={1}
            max={5}
            step={0.5}
            value={exaggeration}
            data-testid="input-exaggeration"
            onChange={(e) => setExaggeration(Number(e.target.value))}
            aria-label="Vertical exaggeration"
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={clip.enabled}
            data-testid="input-clip-enabled"
            onChange={(e) => setClip((c) => ({ ...c, enabled: e.target.checked }))}
          />{" "}
          Clip above height{" "}
          <input
            type="range"
            min={-2}
            max={4}
            step={0.1}
            value={clip.height}
            data-testid="input-clip-height"
            onChange={(e) => setClip((c) => ({ ...c, height: Number(e.target.value) }))}
            aria-label="Clip plane height"
          />
        </label>
        <span data-testid="three-cue" title="Red +X, green +Y (up), blue +Z">
          Orientation: RGB axes · grid 10 units
        </span>
      </div>
    </div>
  );
}
