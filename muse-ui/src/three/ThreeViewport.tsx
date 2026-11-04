// Separate coordinated scientific 3D viewport. It owns its own WebGL context
// (never MapLibre's) and derives everything from the scene model plus the
// interaction state. Only validated finite meters are rendered, positioned in
// a local metric frame anchored to the validated study bounds; nothing is
// invented. Planar horizons, the reference water level, and the transect
// section curtain render as matte, bounded geometry at declared depths.
// Clipping is a local clipping plane; vertical exaggeration is an explicitly
// labelled schematic control (BASELINE.md D3).

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { useEffect, useRef, useState } from "react";
import { cameraDuration } from "../design/components.tsx";
import { TOKENS } from "../design/tokens.ts";
import type { SceneFeature, SceneModel } from "../scene-model/types.ts";
import { anchorOfBounds, featurePositionsToLocal, lonLatToLocal, type LocalAnchor } from "./localFrame.ts";

export interface ClipState {
  enabled: boolean;
  // Height of the clip plane in local meters (depths are negative).
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
  drawCalls: () => number;
  objectCount: () => number;
}

const CAT: string[] = [...TOKENS.cat];

function slotOf(feature: SceneFeature, scene: SceneModel): number {
  const i = scene.layers.findIndex((l) => l.id === feature.layerId);
  return i < 0 ? 0 : i;
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

/** Local footprint of a polygon ring (first ring only), for bounded planes. */
function ringFootprint(feature: SceneFeature, anchor: LocalAnchor): Array<{ x: number; z: number }> {
  const g = feature.geometry;
  if (g.kind !== "polygon") return [];
  const ring = g.coordinates[0] ?? [];
  return featurePositionsToLocal(ring, anchor);
}

/** Reference water-level elevation (meters) from a validated reference layer, if any. */
export function referenceWaterElevation(scene: SceneModel): number | null {
  const refLayers = new Set(
    scene.layers.filter((l) => l.referenceKind === "water-level").map((l) => l.id),
  );
  if (refLayers.size === 0) return null;
  const elevations = scene.features
    .filter((f) => refLayers.has(f.layerId))
    .map((f) => f.geometry.elevationMeters)
    .filter((e): e is number => typeof e === "number" && Number.isFinite(e));
  return elevations.length > 0 ? elevations[0]! : null;
}

export function ThreeViewport({
  enabledReason,
  scene,
  activeFeatureId,
  reducedMotion,
}: {
  enabledReason: string | null;
  scene: SceneModel;
  activeFeatureId: string | null;
  reducedMotion?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const materialsRef = useRef<THREE.Material[]>([]);
  const clipIndicatorRef = useRef<THREE.Mesh | null>(null);
  const selectedRef = useRef<string | null>(activeFeatureId);
  selectedRef.current = activeFeatureId;
  const resetRef = useRef<() => void>(() => {});
  const [exaggeration, setExaggeration] = useState(1);
  const [clip, setClip] = useState<ClipState>(createClipState);
  const exaggerationRef = useRef(exaggeration);
  exaggerationRef.current = exaggeration;

  const elevated = enabledReason === null ? elevatedFeatures(scene) : [];
  const anchor = enabledReason === null && scene.bounds ? anchorOfBounds(scene.bounds) : null;
  const waterElevation = enabledReason === null ? referenceWaterElevation(scene) : null;

  const layerOf = (feature: SceneFeature): string =>
    scene.layers.find((l) => l.id === feature.layerId)?.capabilityId ?? "";
  const isRefWater = (feature: SceneFeature): boolean =>
    scene.layers.find((l) => l.id === feature.layerId)?.referenceKind === "water-level";
  // Render-time partition mirrors the effect's exactly-once rule: planes and
  // the curtain claim their features; everything else elevated is a column.
  const planeIds = new Set(
    elevated
      .filter(
        (f) =>
          f.geometry.kind === "polygon" && (layerOf(f) === "subsurface-surface" || isRefWater(f)),
      )
      .map((f) => f.id),
  );
  const sectionIds = new Set(
    elevated.filter((f) => f.geometry.kind === "line" && layerOf(f) === "cross-section").map((f) => f.id),
  );
  const columnCount = elevated.filter((f) => !planeIds.has(f.id) && !sectionIds.has(f.id)).length;
  // Columns whose validated span (datum 0 to declared depth) crosses the
  // active clip height — the visible payoff of the investigative clip action.
  const clipCrossCount = clip.enabled
    ? elevated
        .filter((f) => !planeIds.has(f.id) && !sectionIds.has(f.id))
        .filter((f) => {
          const h = f.geometry.elevationMeters;
          if (typeof h !== "number" || !Number.isFinite(h)) return false;
          return Math.min(h, 0) <= clip.height && clip.height <= Math.max(h, 0);
        }).length
    : 0;
  const planeCount = planeIds.size;
  const sectionCount = sectionIds.size;
  const showPlanes = planeIds.size > 0;

  function depthText(elevationMeters: number | null): string {
    if (elevationMeters === null || !Number.isFinite(elevationMeters)) return "no validated depth";
    if (elevationMeters === 0) return "0 m (datum)";
    return elevationMeters < 0
      ? `${Math.abs(elevationMeters)} m below datum`
      : `${elevationMeters} m above datum`;
  }
  // Human-readable 3D evidence roster for the overlay legend: every bounded
  // plane, reference datum, and section curtain with its validated depth.
  // Labels come from the scene model, so no fixture or document names appear
  // in source; colors mirror the materials authored in the effect below.
  const legendPlanes = elevated
    .filter((f) => planeIds.has(f.id))
    .map((f) => ({
      id: f.id,
      label: f.label,
      depth: depthText(f.geometry.elevationMeters),
      color: isRefWater(f)
        ? (TOKENS.seq[3] ?? "#88c0e0")
        : (CAT[slotOf(f, scene) % CAT.length] ?? TOKENS.evidenceMark),
      role: isRefWater(f) ? "reference datum" : "horizon surface",
    }));
  const legendSections = elevated
    .filter((f) => sectionIds.has(f.id))
    .map((f) => ({
      id: f.id,
      label: f.label,
      depth: depthText(f.geometry.elevationMeters),
      color: TOKENS.seq[2] ?? "#2e7ca8",
      role: "section curtain (schematic)",
    }));
  // Labelled depth rail pinned to the validated datum, reference level,
  // and evidence depths (data-driven scale context, never decorative).
  const depthTicks = (() => {
    const rows: Array<{ label: string; depth: string }> = [{ label: "Ground datum", depth: "0 m" }];
    if (waterElevation !== null) rows.push({ label: "Reference water level", depth: depthText(waterElevation) });
    for (const p of legendPlanes) {
      if (p.role !== "reference datum") rows.push({ label: p.label, depth: p.depth });
    }
    const depths = elevated
      .map((f) => f.geometry.elevationMeters)
      .filter((e): e is number => typeof e === "number" && Number.isFinite(e) && e < 0);
    if (depths.length > 0) rows.push({ label: "Deepest evidence", depth: depthText(Math.min(...depths)) });
    return rows;
  })();

  // Mount/unmount owns the render loop; switching modes disposes everything.
  useEffect(() => {
    if (enabledReason !== null) return;
    const canvas = canvasRef.current;
    if (!canvas || !scene.bounds || !anchor) return;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.localClippingEnabled = true;
    const scene3 = new THREE.Scene();
    scene3.background = new THREE.Color(TOKENS.canvas);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000000);
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
    // symbology, never measurements. The lower bound preserves the verified
    // meter-scale look; the extent term keeps markers at a few pixels on
    // kilometer-scale basins where a fixed cap would render them sub-pixel.
    const symbolR = Math.max(
      0.35,
      Math.min(dist * 0.01, Math.max(Math.min(8, maxOffset * 0.02), maxOffset * 0.006)),
    );
    const reduced = reducedMotion ?? false;
    // Low oblique overview: columns read vertically against the bounded
    // planes instead of foreshortening behind them from a high viewpoint.
    const home = new THREE.Vector3(dist * 0.75, dist * 0.38, dist * 0.95);
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
    const grid = track(new THREE.GridHelper(Math.max(20, maxOffset * 2), 10, 0x6b7c8d, Number.parseInt(TOKENS.grid.slice(1), 16)));
    group.add(grid);
    // Investigative clip datum: a visible amber sheet at the active clip
    // height, so the clipped / unclipped read is unmistakable even at 1x.
    // It is deliberately excluded from the clipped materials so it stays
    // visible as the cut location.
    const clipIndicator = new THREE.Mesh(
      track(new THREE.PlaneGeometry(Math.max(20, maxOffset * 2), Math.max(20, maxOffset * 2))),
      track(
        new THREE.MeshBasicMaterial({
          color: TOKENS.selectionMark,
          transparent: true,
          opacity: 0.18,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      ),
    );
    clipIndicator.rotation.x = -Math.PI / 2;
    clipIndicator.visible = false;
    group.add(clipIndicator);
    clipIndicatorRef.current = clipIndicator;
    const axes = track(new THREE.AxesHelper(Math.max(6, maxOffset / 2)));
    group.add(axes);
    const markerMaterials: THREE.Material[] = [];
    const markerById = new Map<string, THREE.MeshStandardMaterial>();
    const originalColor = new Map<string, string>();

    // Evidence columns for located features with validated heights that are
    // not otherwise rendered as bounded planes or section curtains. Points
    // render at their validated position; legacy line/profile evidence keeps
    // the bootstrap behavior of a column at its representative position, so
    // the previously verified enabled-3D contract is preserved.
    // Every elevated feature renders exactly once: planes, water, and the
    // section curtain claim their features; anything left (points, legacy
    // lines/profiles) renders as an evidence column.
    const handled = new Set<string>();
    const renderColumn = (
      feature: SceneFeature,
      frame: { x: number; z: number; h: number },
      withWhisker: boolean,
    ) => {
      if (!Number.isFinite(frame.h)) return;
      const markerMaterial = track(
        new THREE.MeshStandardMaterial({ color: TOKENS.evidenceMark, emissive: 0x000000 }),
      );
      const marker = new THREE.Mesh(track(new THREE.SphereGeometry(symbolR * 2, 16, 12)), markerMaterial);
      marker.position.set(frame.x, frame.h, frame.z);
      group.add(marker);
      const columnHeight = Math.abs(frame.h);
      const columnMaterial = track(
        new THREE.MeshStandardMaterial({ color: TOKENS.accent }),
      );
      if (columnHeight >= 0.01) {
        const column = new THREE.Mesh(
          track(new THREE.CylinderGeometry(symbolR, symbolR, columnHeight, 12)),
          columnMaterial,
        );
        column.position.set(frame.x, frame.h / 2, frame.z);
        group.add(column);
      }
      // Uncertainty whisker: a thin vertical segment spanning ±u about the
      // validated depth, where a finite uncertainty is declared.
      const u = feature.geometry.uncertaintyMeters;
      if (withWhisker && typeof u === "number" && u > 0) {
        const whiskerGeo = track(
          new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(frame.x, frame.h - u, frame.z),
            new THREE.Vector3(frame.x, frame.h + u, frame.z),
          ]),
        );
        const whisker = new THREE.Line(
          whiskerGeo,
          track(new THREE.LineBasicMaterial({ color: TOKENS.uncertainty })),
        );
        group.add(whisker);
        markerMaterials.push(whisker.material as THREE.Material);
      }
      markerMaterials.push(columnMaterial, markerMaterial);
      markerById.set(feature.id, markerMaterial);
    };
    for (const { feature, frame } of framed) {
      if (feature.geometry.kind !== "point") continue;
      const layer = scene.layers.find((l) => l.id === feature.layerId);
      if (layer && (layer.capabilityId === "subsurface-surface" || layer.referenceKind === "water-level")) {
        continue;
      }
      renderColumn(feature, frame, true);
      handled.add(feature.id);
    }

    // Bounded subsurface planes: validated polygon footprints at validated
    // depths. Matte, double-sided, opacity-capped; edges drawn as wireframe.
    // Schematic dip is NOT applied as geometry (strike unknown); it is
    // reported as text in the inspector.
    const polygonFeatures = scene.features.filter(
      (f) =>
        f.geometry.kind === "polygon" &&
        scene.layers.find((l) => l.id === f.layerId)?.capabilityId === "subsurface-surface",
    );
    for (const feature of polygonFeatures) {
      const depth = feature.geometry.elevationMeters;
      if (typeof depth !== "number" || !Number.isFinite(depth)) continue;
      const footprint = ringFootprint(feature, frameAnchor);
      if (footprint.length < 3) continue;
      // ShapeGeometry lies in XY and rotation.x = -PI/2 maps (x, y) -> (x, -y)
      // in Z, so negate local Z up front to avoid mirroring the footprint.
      const shape = new THREE.Shape(footprint.map((p) => new THREE.Vector2(p.x, -p.z)));
      const geo = track(new THREE.ShapeGeometry(shape));
      const color = CAT[slotOf(feature, scene) % CAT.length] ?? TOKENS.evidenceMark;
      const mat = track(
        new THREE.MeshStandardMaterial({
          color,
          transparent: true,
          // Capped below full cover so evidence columns threading the plane
          // stay legible from the default oblique preset.
          opacity: 0.42,
          side: THREE.DoubleSide,
          roughness: 1,
          metalness: 0,
          emissive: 0x000000,
        }),
      );
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      // ShapeGeometry lies in XY; rotate to XZ then translate to depth.
      mesh.position.y = depth;
      group.add(mesh);
      const edges = new THREE.LineSegments(
        track(new THREE.EdgesGeometry(geo)),
        track(new THREE.LineBasicMaterial({ color })),
      );
      edges.rotation.x = -Math.PI / 2;
      edges.position.y = depth;
      group.add(edges);
      markerMaterials.push(mat);
      markerById.set(feature.id, mat as unknown as THREE.MeshStandardMaterial);
      originalColor.set(feature.id, color);
      handled.add(feature.id);

      // Uncertainty band: a translucent box spanning ±u about the depth,
      // clipped to the declared easting bound where one exists.
      const u = feature.geometry.uncertaintyMeters;
      if (typeof u === "number" && u > 0) {
        const xs = footprint.map((p) => p.x);
        const zs = footprint.map((p) => p.z);
        const eastMin = feature.uncertaintyEastingMinMeters;
        const loX = eastMin === null ? Math.min(...xs) : Math.max(Math.min(...xs), eastMin);
        const hiX = Math.max(...xs);
        if (hiX > loX) {
          const bandGeo = track(new THREE.BoxGeometry(Math.max(0.01, hiX - loX), u * 2, Math.max(0.01, Math.max(...zs) - Math.min(...zs))));
          const bandMat = track(
            new THREE.MeshStandardMaterial({
              color: TOKENS.uncertainty,
              transparent: true,
              opacity: 0.22,
              depthWrite: false,
              wireframe: true,
            }),
          );
          const band = new THREE.Mesh(bandGeo, bandMat);
          band.position.set((loX + hiX) / 2, depth, (Math.min(...zs) + Math.max(...zs)) / 2);
          group.add(band);
          markerMaterials.push(bandMat);
        }
      }
    }

    // Reference water level: translucent bounded plane at the validated
    // reference depth, visually distinct from evidence horizons.
    const waterFeatures = scene.features.filter(
      (f) =>
        f.geometry.kind === "polygon" &&
        scene.layers.find((l) => l.id === f.layerId)?.referenceKind === "water-level",
    );
    for (const feature of waterFeatures) {
      const depth = feature.geometry.elevationMeters;
      if (typeof depth !== "number" || !Number.isFinite(depth)) continue;
      const footprint = ringFootprint(feature, frameAnchor);
      if (footprint.length < 3) continue;
      const shape = new THREE.Shape(footprint.map((p) => new THREE.Vector2(p.x, -p.z)));
      const geo = track(new THREE.ShapeGeometry(shape));
      const mat = track(
        new THREE.MeshStandardMaterial({
          color: TOKENS.seq[3] ?? "#88c0e0",
          transparent: true,
          opacity: 0.25,
          side: THREE.DoubleSide,
          roughness: 1,
          metalness: 0,
          emissive: 0x000000,
          depthWrite: false,
        }),
      );
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = depth;
      group.add(mesh);
      // Outlined edge so the reference plane — and the clip preset tied to
      // it — reads as an explicit investigative datum, not a wash of color.
      const waterColor = TOKENS.seq[3] ?? "#88c0e0";
      const edges = new THREE.LineSegments(
        track(new THREE.EdgesGeometry(geo)),
        track(new THREE.LineBasicMaterial({ color: waterColor })),
      );
      edges.rotation.x = -Math.PI / 2;
      edges.position.y = depth;
      group.add(edges);
      markerMaterials.push(mat);
      markerById.set(feature.id, mat as unknown as THREE.MeshStandardMaterial);
      originalColor.set(feature.id, waterColor);
      handled.add(feature.id);
    }

    // Section curtain: the validated transect line extruded from the ground
    // datum to its declared base depth — a schematic reading aid, labelled as
    // such wherever it is described.
    const sectionFeatures = scene.features.filter(
      (f) =>
        f.geometry.kind === "line" &&
        scene.layers.find((l) => l.id === f.layerId)?.capabilityId === "cross-section",
    );
    for (const feature of sectionFeatures) {
      const g = feature.geometry;
      if (g.kind !== "line") continue;
      const base = g.elevationMeters;
      if (typeof base !== "number" || !Number.isFinite(base)) continue;
      const pts = featurePositionsToLocal(g.coordinates, frameAnchor);
      if (pts.length < 2) continue;
      const positions: number[] = [];
      const index: number[] = [];
      pts.forEach((p, i) => {
        positions.push(p.x, 0, p.z, p.x, base, p.z);
        if (i < pts.length - 1) {
          const a = i * 2;
          index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      });
      const geo = track(new THREE.BufferGeometry());
      geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geo.setIndex(index);
      geo.computeVertexNormals();
      const mat = track(
        new THREE.MeshStandardMaterial({
          color: TOKENS.seq[2] ?? "#2e7ca8",
          transparent: true,
          opacity: 0.35,
          side: THREE.DoubleSide,
          roughness: 1,
          metalness: 0,
          emissive: 0x000000,
          depthWrite: false,
        }),
      );
      const curtain = new THREE.Mesh(geo, mat);
      group.add(curtain);
      markerMaterials.push(mat);
      markerById.set(feature.id, mat as unknown as THREE.MeshStandardMaterial);
      originalColor.set(feature.id, TOKENS.seq[2] ?? "#2e7ca8");
      handled.add(feature.id);
    }

    // Fallback: any elevated feature not claimed by a plane or curtain
    // (legacy lines and profiles) keeps the bootstrap column treatment.
    for (const { feature, frame } of framed) {
      if (handled.has(feature.id)) continue;
      renderColumn(feature, frame, feature.geometry.kind === "point");
    }

    materialsRef.current = markerMaterials;
    scene3.add(new THREE.AmbientLight(0xffffff, 0.9));
    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(5, 8, 4);
    scene3.add(dir);

    const paintSelection = () => {
      for (const [id, mat] of markerById) {
        if (!(mat instanceof THREE.MeshStandardMaterial)) continue;
        const selected = id === selectedRef.current;
        if (selected) {
          mat.color.set(TOKENS.selectionMark);
          mat.emissive.set(0x7a4a00);
        } else {
          // Restore the authored categorical/reference color so deselection
          // never strands a highlight; the inspector carries the shared
          // highlight in parallel.
          mat.color.set(originalColor.get(id) ?? TOKENS.evidenceMark);
          mat.emissive.set(0x000000);
        }
        mat.needsUpdate = true;
      }
    };
    paintSelection();

    resetRef.current = () => {
      const duration = cameraDuration(500, reduced);
      if (duration === 0) {
        camera.position.copy(home);
        controls.target.set(0, 0, 0);
        controls.update();
        return;
      }
      // Deterministic eased travel: interpolate over fixed frames.
      const from = camera.position.clone();
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        camera.position.lerpVectors(from, home, t);
        controls.target.set(0, 0, 0);
        controls.update();
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
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
      drawCalls: () => renderer.info.render.calls,
      objectCount: () => scene3.children.length,
    };

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      controls.dispose();
      for (const d of disposables) d.dispose();
      renderer.dispose();
      materialsRef.current = [];
      clipIndicatorRef.current = null;
      delete (window as unknown as { __museThree?: ThreeDebugHandle }).__museThree;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledReason, scene, anchor?.lon, anchor?.lat, reducedMotion]);

  useEffect(() => {
    if (enabledReason !== null) return;
    applyClipState(materialsRef.current, clip);
    // The amber datum sheet rides with the clip state; it lives inside the
    // exaggerated group so it aligns with the exaggerated columns it cuts.
    const indicator = clipIndicatorRef.current;
    if (indicator) {
      indicator.visible = clip.enabled;
      indicator.position.y = clip.height;
    }
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
      {(legendPlanes.length > 0 || legendSections.length > 0) && (
        <div className="three-legend" data-testid="three-legend" aria-label="3D evidence legend">
          <h2>3D evidence</h2>
          <ul>
            {legendPlanes.map((p) => (
              <li key={p.id}>
                <span className="swatch" style={{ background: p.color }} aria-hidden="true" />
                <span>
                  {p.label} · {p.role}
                </span>
                <span className="depth">{p.depth}</span>
              </li>
            ))}
            {legendSections.map((s) => (
              <li key={s.id}>
                <span className="swatch-line" style={{ borderColor: s.color }} aria-hidden="true" />
                <span>
                  {s.label} · {s.role}
                </span>
                <span className="depth">{s.depth}</span>
              </li>
            ))}
            <li>
              <span className="swatch" style={{ background: TOKENS.evidenceMark }} aria-hidden="true" />
              <span>
                {columnCount} evidence column(s), true height
              </span>
            </li>
          </ul>
        </div>
      )}
      <div className="three-depth" data-testid="three-depth" aria-label="Validated depth scale">
        <h2>Depths (validated m)</h2>
        <ul>
          {depthTicks.map((t) => (
            <li key={`${t.label}-${t.depth}`}>
              <span className="tick" aria-hidden="true" />
              <span>
                {t.label} — {t.depth}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p className="muted" data-testid="three-provenance">
        Local metric frame anchored at {anchor ? `${anchor.lon.toFixed(4)}, ${anchor.lat.toFixed(4)}` : "—"}
        {" "}(WGS84 lon/lat, equirectangular meters); {columnCount} evidence column(s)
        {planeCount > 0 && `, ${planeCount} subsurface plane(s)`}
        {sectionCount > 0 && `, ${sectionCount} section(s)`}, heights in
        meters as validated.{showPlanes && " Horizons render as bounded matte planes at declared depths."}{" "}
        Grid and axes are scale context, not evidence; marker sizes are
        schematic while positions and heights are to scale.
      </p>
      {clip.enabled && (
        <p className="muted" data-testid="clip-status" role="status">
          Clip active: showing at or below {clip.height} m · {clipCrossCount} of {columnCount}{" "}
          column(s) cross the plane (schematic section aid, not measured thickness).
        </p>
      )}
      <div className="threetoolbar" role="toolbar" aria-label="3D controls">
        <button
          type="button"
          data-testid="btn-three-home"
          onClick={() => resetRef.current()}
          title="Reset the 3D camera"
        >
          Reset view
        </button>
        <label>
          Vertical exaggeration: {exaggeration.toFixed(1)}× (schematic — not measured scale){" "}
          <input
            type="range"
            min={1}
            max={5}
            step={0.5}
            value={exaggeration}
            data-testid="input-exaggeration"
            onChange={(e) => setExaggeration(Number(e.target.value))}
            aria-label="Vertical exaggeration, schematic, not measured scale"
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
            min={-300}
            max={50}
            step={5}
            value={clip.height}
            data-testid="input-clip-height"
            onChange={(e) => setClip((c) => ({ ...c, height: Number(e.target.value) }))}
            aria-label="Clip plane height in meters"
          />
        </label>
        <button
          type="button"
          data-testid="btn-clip-water"
          disabled={waterElevation === null}
          title={waterElevation === null ? "No validated reference water level in this package" : `Section preset: clip at the reference water level (${waterElevation} m)`}
          onClick={() => {
            if (waterElevation !== null) setClip({ enabled: true, height: waterElevation });
          }}
        >
          Clip at water level
        </button>
        <span data-testid="three-cue" title="Red +X east, green +Y up, blue −Z north; drag to orbit, scroll to zoom">
          Orientation: +X east · +Y up · −Z north — drag to orbit
        </span>
      </div>
    </div>
  );
}
