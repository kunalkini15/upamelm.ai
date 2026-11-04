import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Eye, Focus } from 'lucide-react';
import { FloatingHUD } from '../hud/FloatingHUD';
import {
  RenderablePointFeature,
  RenderableRegionalSlab,
  ScientificUIModel,
} from '../../types/scientific';

interface SubsurfaceExplorerProps {
  model: ScientificUIModel;
  selectedFeature: RenderablePointFeature | null;
  onSelectFeature: (f: RenderablePointFeature | null) => void;
  onClose: () => void;
  surfaceCanvas?: HTMLCanvasElement | null;
  focusFinding?: { title: string; intervalIds: string[]; featureIds: string[] } | null;
}

const WELL_PALETTE = [
  '#fb7185', // coral
  '#a78bfa', // violet
  '#34d399', // emerald
  '#fb923c', // orange
  '#e2e8f0', // mineral white
];

function wellColor(featureId: string): string {
  let hash = 0;
  for (let i = 0; i < featureId.length; i++) hash = (hash * 31 + featureId.charCodeAt(i)) | 0;
  return WELL_PALETTE[Math.abs(hash) % WELL_PALETTE.length];
}

function createTextSprite(
  text: string,
  color = '#38bdf8',
  bgColor = '#090d16',
  fontSize = 28,
  fixedHeight = 4.0
) {
  // 1. Measure text dynamically using an offscreen canvas
  const measureCanvas = document.createElement('canvas');
  const measureCtx = measureCanvas.getContext('2d')!;
  const renderFontSize = fontSize * 2;
  const fontStyle = `bold ${renderFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "JetBrains Mono", sans-serif`;
  measureCtx.font = fontStyle;
  const metrics = measureCtx.measureText(text);
  const textWidth = metrics.width;

  // 2. Compute dynamic canvas size based on measured text length + padding
  const paddingX = 80; // generous left/right padding so text never clips or overflows
  const canvasHeight = 160;
  const canvasWidth = Math.max(380, Math.ceil(textWidth + paddingX * 2));

  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext('2d')!;

  // 3. Draw rounded pill background
  ctx.fillStyle = bgColor;
  ctx.beginPath();
  ctx.roundRect(8, 8, canvasWidth - 16, canvasHeight - 16, 28);
  ctx.fill();

  // 4. Vibrant high-contrast border
  ctx.strokeStyle = color;
  ctx.lineWidth = 10;
  ctx.stroke();

  // 5. Crisp typography with drop shadow
  ctx.font = fontStyle;
  ctx.shadowColor = '#000000';
  ctx.shadowBlur = 12;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvasWidth / 2, canvasHeight / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.renderOrder = 999;

  // 6. Set 3D world scale proportional to the text's actual aspect ratio
  const aspect = canvasWidth / canvasHeight;
  const worldWidth = fixedHeight * aspect;
  sprite.scale.set(worldWidth, fixedHeight, 1);
  return sprite;
}

/**
 * Creates the continuous world terrain texture with the excavated district window
 */
function createExcavatedWorldTerrain(
  surfaceCanvas: HTMLCanvasElement | null | undefined,
  poly2d: [number, number][],
  worldSpan: number
): THREE.CanvasTexture {
  const size = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  // 1. Draw continuous map surface
  if (surfaceCanvas) {
    ctx.drawImage(surfaceCanvas, 0, 0, size, size);
  } else {
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, size, size);
  }

  // 2. Clear out the district cutaway window so the underground is 100% visible
  // In our Three.js terrain:
  // plane is rotated -PI/2 around X, so plane's local +X is world +X, local +Y is world -Z.
  // UV (0,0) is at top-left of texture which maps to (x = -worldSpan/2, z = -worldSpan/2).
  const canvasPoly = poly2d.map(([x, z]) => {
    const px = ((x + worldSpan / 2) / worldSpan) * size;
    const py = ((z + worldSpan / 2) / worldSpan) * size;
    return [px, py] as [number, number];
  });

  if (canvasPoly.length > 2) {
    // Cut out the district window
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.moveTo(canvasPoly[0][0], canvasPoly[0][1]);
    for (let i = 1; i < canvasPoly.length; i++) {
      ctx.lineTo(canvasPoly[i][0], canvasPoly[i][1]);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // 3. Draw a glowing excavation boundary rim around the district aperture
    ctx.save();
    ctx.strokeStyle = '#06b6d4';
    ctx.lineWidth = 4;
    ctx.shadowColor = '#06b6d4';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(canvasPoly[0][0], canvasPoly[0][1]);
    for (let i = 1; i < canvasPoly.length; i++) {
      ctx.lineTo(canvasPoly[i][0], canvasPoly[i][1]);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export const SubsurfaceExplorer: React.FC<SubsurfaceExplorerProps> = ({
  model,
  selectedFeature,
  onSelectFeature,
  onClose,
  surfaceCanvas,
  focusFinding,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const onSelectFeatureRef = useRef(onSelectFeature);
  onSelectFeatureRef.current = onSelectFeature;
  const selectAndIsolateRef = useRef((feature: RenderablePointFeature) => {
    onSelectFeature(feature);
    setFocusMode(true);
  });
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const listContainerRef = useRef<HTMLDivElement>(null);
  const selectedItemRef = useRef<HTMLButtonElement>(null);

  const scaleY = 0.55;
  const currentFeature = selectedFeature;
  const currentFeatureIdRef = useRef<string | null>(currentFeature?.id || null);
  currentFeatureIdRef.current = currentFeature?.id || null;
  const sceneFeatures = useMemo(
    () => model.featuresWithCoords.filter((feature) => !feature.isSpatialOutlier),
    [model.featuresWithCoords]
  );
  const isDepthReady = (feature: RenderablePointFeature) =>
    feature.intervals.length > 0 ||
    (typeof feature.totalDepthMeters === 'number' &&
      feature.totalDepthMeters > 0 &&
      feature.depthFidelity !== 'illustrative_default');
  const depthReadyCount = useMemo(
    () => sceneFeatures.filter(isDepthReady).length,
    [sceneFeatures]
  );
  const [focusMode, setFocusMode] = useState<boolean>(false);
  const focusModeRef = useRef(focusMode);
  focusModeRef.current = focusMode;
  selectAndIsolateRef.current = (feature: RenderablePointFeature) => {
    onSelectFeatureRef.current(feature);
    setFocusMode(true);
  };

  const updateHighlightsRef = useRef<((selectedId: string | null, isFocus: boolean) => void) | null>(null);

  useEffect(() => {
    if (currentFeature?.isSpatialOutlier && sceneFeatures.length > 0) {
      onSelectFeature(sceneFeatures[0]);
    }
  }, [currentFeature?.isSpatialOutlier, onSelectFeature, sceneFeatures]);

  useEffect(() => {
    if (selectedItemRef.current) {
      selectedItemRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
    if (updateHighlightsRef.current) {
      updateHighlightsRef.current(currentFeature?.id || null, focusMode);
    }
  }, [currentFeature?.id, focusMode]);

  const maxDepth = useMemo(() => {
    let d = 120;
    sceneFeatures.forEach((f) => {
      if (f.totalDepthMeters && f.totalDepthMeters > d) d = f.totalDepthMeters;
      f.intervals.forEach((iv) => {
        if (iv.end > d) d = iv.end;
      });
    });
    return Math.min(600, d);
  }, [sceneFeatures]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // 1. Scene Setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#030712'); // Sky/Void atmosphere
    scene.fog = new THREE.FogExp2('#030712', 0.0007);

    const camera = new THREE.PerspectiveCamera(
      42,
      container.clientWidth / container.clientHeight,
      0.5,
      8000
    );
    camera.position.set(160, 120, 260);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.set(0, -maxDepth * 0.16, 0);
    controls.minDistance = 30;
    controls.maxDistance = 650;

    // 2. Lighting
    const hemiLight = new THREE.HemisphereLight('#67e8f9', '#0f172a', 1.7);
    scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight('#ffffff', 1.8);
    sunLight.position.set(180, 260, 200);
    scene.add(sunLight);

    const ambientSubsurface = new THREE.DirectionalLight('#0ea5e9', 0.85);
    ambientSubsurface.position.set(-160, -100, -140);
    scene.add(ambientSubsurface);

    // 3. Project coordinates & Study Polygon to 3D scene units
    // Compute district centroid
    const poly = model.studyAreaPolygon;
    const count = poly.length > 2 && poly[0][0] === poly[poly.length - 1][0] && poly[0][1] === poly[poly.length - 1][1]
      ? poly.length - 1
      : poly.length;
    let sumLng = 0, sumLat = 0;
    for (let i = 0; i < count; i++) {
      sumLng += poly[i][0];
      sumLat += poly[i][1];
    }
    const cLng = sumLng / count;
    const cLat = sumLat / count;
    const cosLat = Math.cos((cLat * Math.PI) / 180);

    // Conformal metric scale: 200 scene units per longitude degree (aspect-corrected by cosLat)
    const sceneScale = 200;

    const poly2d: [number, number][] = model.studyAreaPolygon.map(([lng, lat]) => [
      (lng - cLng) * cosLat * sceneScale,
      -(lat - cLat) * sceneScale,
    ]);

    // 4. Continuous Ground Terrain with Excavated District Window
    const worldSpan = 700; // Expansive continuous map plane covering all adjacent districts
    const terrainTexture = createExcavatedWorldTerrain(surfaceCanvas, poly2d, worldSpan);

    const terrainGeom = new THREE.PlaneGeometry(worldSpan, worldSpan, 64, 64);
    const terrainMat = new THREE.MeshStandardMaterial({
      map: terrainTexture,
      transparent: true,
      roughness: 0.85,
      metalness: 0.1,
      side: THREE.DoubleSide,
      depthWrite: true,
    });

    const terrainMesh = new THREE.Mesh(terrainGeom, terrainMat);
    terrainMesh.rotation.x = -Math.PI / 2;
    terrainMesh.position.y = 0;
    scene.add(terrainMesh);

    // Coordinate orientation grid extending across the subcontinent
    const gridHelper = new THREE.GridHelper(worldSpan, 40, '#06b6d4', '#111827');
    gridHelper.position.y = -0.2;
    scene.add(gridHelper);

    // 5. Main Subsurface Group (Excavated underneath the study polygon)
    const rootSubsurface = new THREE.Group();
    scene.add(rootSubsurface);

    if (focusFinding && focusFinding.intervalIds.length > 0) {
      const focusedIntervals = sceneFeatures
        .flatMap((feature) => feature.intervals)
        .filter((interval) => focusFinding.intervalIds.includes(interval.id));
      if (focusedIntervals.length > 0) {
        const topDepth = Math.min(...focusedIntervals.map((interval) => interval.start));
        const bottomDepth = Math.max(...focusedIntervals.map((interval) => interval.end));
        const focusBand = new THREE.Mesh(
          new THREE.BoxGeometry(330, Math.max(1.5, (bottomDepth - topDepth) * scaleY), 330),
          new THREE.MeshBasicMaterial({ color: '#fbbf24', transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false })
        );
        focusBand.position.y = -((topDepth + bottomDepth) / 2) * scaleY;
        rootSubsurface.add(focusBand);
      }
    }

    const stationPositions = sceneFeatures.map((feat) => {
      const x = (feat.coordinates[0] - cLng) * cosLat * sceneScale;
      const z = -(feat.coordinates[1] - cLat) * sceneScale;
      return { feat, x, z };
    });

    const clickableObjects: THREE.Object3D[] = [];
    const adaptiveSpritesRef: THREE.Sprite[] = [];

    // Track borehole sub-meshes to update highlights and focus/blur dynamically
    const boreholeMeshesRef: {
      featId: string;
      group: THREE.Group;
      collar: THREE.Mesh;
      laser: THREE.Mesh;
      laserH: number;
      sprite: THREE.Sprite;
      fDepth: number;
      featName: string;
      baseColor: string;
      casingMeshes: THREE.Mesh[];
      rings: THREE.Mesh[];
    }[] = [];

    // A. Render every located feature. Only source-supported depths are literal;
    // other locations use symbolic surface beacons and never invent a borehole.
    stationPositions.forEach(({ feat, x, z }) => {
      const isSelected = currentFeature && feat.id === currentFeature.id;
      const depthReady = isDepthReady(feat);
      const stationColor = wellColor(feat.id);
      const bGroup = new THREE.Group();
      bGroup.position.set(x, 0, z);
      bGroup.userData = { feature: feat };

      const fDepth = depthReady
        ? (feat.totalDepthMeters || feat.intervals[feat.intervals.length - 1]?.end || 0)
        : 0;
      const totalH = fDepth * scaleY;
      const radius = depthReady ? 1.5 : 1.15;

      const casingMeshes: THREE.Mesh[] = [];
      const rings: THREE.Mesh[] = [];

      // Surface wellhead collar (anchored at ground level y = 0)
      const collarMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(radius * 1.5, radius * 1.8, 2.5, 16),
        new THREE.MeshStandardMaterial({
          color: isSelected ? '#fbbf24' : stationColor,
          roughness: 0.2,
          metalness: 0.8,
          emissive: isSelected ? '#d97706' : stationColor,
          emissiveIntensity: isSelected ? 0.9 : 0.4,
          transparent: true,
          opacity: 1.0,
        })
      );
      collarMesh.position.y = 1.25;
      collarMesh.userData = { feature: feat };
      bGroup.add(collarMesh);
      clickableObjects.push(collarMesh);

      if (depthReady) {
        const outlinePipe = new THREE.Mesh(
          new THREE.CylinderGeometry(radius * 1.28, radius * 1.28, totalH, 16),
          new THREE.MeshBasicMaterial({
            color: '#020617',
            side: THREE.BackSide,
            transparent: true,
            opacity: 0.9,
            depthWrite: false,
          })
        );
        outlinePipe.position.y = -totalH / 2;
        bGroup.add(outlinePipe);

        const continuousPipe = new THREE.Mesh(
          new THREE.CylinderGeometry(radius * 0.92, radius * 0.92, totalH, 16),
          new THREE.MeshStandardMaterial({
            color: isSelected ? '#fde047' : stationColor,
            emissive: isSelected ? '#d97706' : stationColor,
            emissiveIntensity: isSelected ? 0.75 : 0.42,
            transparent: true,
            opacity: 0.98,
            metalness: 0.55,
            roughness: 0.18,
          })
        );
        continuousPipe.position.y = -totalH / 2;
        continuousPipe.userData = {
          feature: feat,
          wellBaseColor: stationColor,
          wellBaseEmissive: stationColor,
        };
        bGroup.add(continuousPipe);
        clickableObjects.push(continuousPipe);
        casingMeshes.push(continuousPipe);
      } else {
        const symbolicHalo = new THREE.Mesh(
          new THREE.TorusGeometry(radius * 2.35, 0.28, 8, 28),
          new THREE.MeshBasicMaterial({
            color: isSelected ? '#fbbf24' : stationColor,
            transparent: true,
            opacity: isSelected ? 1 : 0.72,
          })
        );
        symbolicHalo.rotation.x = Math.PI / 2;
        symbolicHalo.position.y = 0.35;
        symbolicHalo.userData = { feature: feat };
        bGroup.add(symbolicHalo);
        clickableObjects.push(symbolicHalo);
        rings.push(symbolicHalo);
      }

      // 2. Overlay specific screen / lithology interval segments with colored casing collars
      if (depthReady && feat.intervals.length > 0) {
        feat.intervals.forEach((iv) => {
          const top = iv.start * scaleY;
          const btm = iv.end * scaleY;
          const h = Math.max(1.5, btm - top);
          const yCenter = -(top + h / 2);

          const seg = new THREE.Mesh(
            new THREE.CylinderGeometry(radius * 1.08, radius * 1.08, h, 16),
            new THREE.MeshStandardMaterial({
              color: isSelected ? '#fde047' : stationColor,
              emissive: isSelected ? '#d97706' : stationColor,
              emissiveIntensity: isSelected ? 0.7 : 0.25,
              roughness: 0.18,
              metalness: 0.45,
              transparent: true,
              opacity: 1.0,
            })
          );
          seg.position.y = yCenter;
          const segmentColor = stationColor;
          seg.userData = {
            feature: feat,
            wellBaseColor: segmentColor,
            wellBaseEmissive: segmentColor,
          };
          bGroup.add(seg);
          clickableObjects.push(seg);
          casingMeshes.push(seg);
        });
      }

      // Water Table Ring
      if (feat.waterLevelMeters !== undefined) {
        const wtY = -feat.waterLevelMeters * scaleY;
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(radius * 2.8, 0.4, 8, 24),
          new THREE.MeshBasicMaterial({ color: stationColor, transparent: true, opacity: 0.95 })
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.y = wtY;
        ring.userData = { feature: feat };
        bGroup.add(ring);
        clickableObjects.push(ring);
        rings.push(ring);
      }

      // Skyward Plummet Laser Beam (visible above ground) - compact height
      const laserH = isSelected ? 24 : (depthReady ? 16 : 10);
      const laser = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.35, laserH, 8),
        new THREE.MeshBasicMaterial({
          color: isSelected ? '#fde047' : stationColor,
          transparent: true,
          opacity: isSelected ? 0.95 : 0.5,
        })
      );
      laser.position.y = laserH / 2;
      laser.userData = { feature: feat };
      bGroup.add(laser);
      clickableObjects.push(laser);

      // Station Name Callout Sprite (positioned just above wellhead beacon)
      const sprite = createTextSprite(
        depthReady ? `${feat.name} (${fDepth}m)` : `${feat.name} · surface`,
        isSelected ? '#f59e0b' : stationColor,
        '#090d16',
        28,
        4.0
      );
      sprite.position.y = laserH + 4;
      sprite.userData = { feature: feat };
      bGroup.add(sprite);
      clickableObjects.push(sprite);

      boreholeMeshesRef.push({
        featId: feat.id,
        group: bGroup,
        collar: collarMesh,
        laser,
        laserH: depthReady ? 16 : 10,
        sprite,
        fDepth,
        featName: feat.name,
        baseColor: stationColor,
        casingMeshes,
        rings,
      });

      // Track all dynamic sprite objects for camera distance adaptive scaling
      adaptiveSpritesRef.push(sprite);

      // Expanded hit target for smooth clicking
      const hitCylinder = new THREE.Mesh(
        new THREE.CylinderGeometry(radius * 3.5, radius * 3.5, Math.max(4, totalH + laserH), 12),
        new THREE.MeshBasicMaterial({ visible: false })
      );
      hitCylinder.position.y = depthReady ? (laserH - totalH) / 2 : laserH / 2;
      hitCylinder.userData = { feature: feat };
      bGroup.add(hitCylinder);
      clickableObjects.push(hitCylinder);

      rootSubsurface.add(bGroup);
    });

    // Curtain fences group so they can be hidden in isolated mode
    const curtainsGroup = new THREE.Group();
    rootSubsurface.add(curtainsGroup);

    // B. Transect Curtain Fences Connecting Wells
    const depthStationPositions = stationPositions.filter(({ feat }) => isDepthReady(feat));
    if (depthStationPositions.length > 1) {
      let connections = 0;
      for (let i = 0; i < depthStationPositions.length && connections < 24; i++) {
        for (let j = i + 1; j < depthStationPositions.length && connections < 24; j++) {
          const a = depthStationPositions[i];
          const b = depthStationPositions[j];
          const dx = b.x - a.x;
          const dz = b.z - a.z;
          const dist = Math.sqrt(dx * dx + dz * dz);

          if (dist > 5 && dist < 70) {
            connections++;
            const maxD = Math.max(
              a.feat.totalDepthMeters || a.feat.intervals[a.feat.intervals.length - 1]?.end || 0,
              b.feat.totalDepthMeters || b.feat.intervals[b.feat.intervals.length - 1]?.end || 0
            );
            const curtainH = maxD * scaleY;
            const midX = (a.x + b.x) / 2;
            const midZ = (a.z + b.z) / 2;
            const angle = Math.atan2(dz, dx);

            const curtain = new THREE.Mesh(
              new THREE.PlaneGeometry(dist, curtainH),
              new THREE.MeshStandardMaterial({
                color: '#38bdf8',
                side: THREE.DoubleSide,
                transparent: true,
                opacity: 0.22,
                wireframe: true,
              })
            );
            curtain.position.set(midX, -curtainH / 2, midZ);
            curtain.rotation.y = -angle;
            curtainsGroup.add(curtain);

            // Ground Surface Path Line
            const rail = new THREE.Line(
              new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(a.x, 0.2, a.z),
                new THREE.Vector3(b.x, 0.2, b.z),
              ]),
              new THREE.LineBasicMaterial({ color: '#22d3ee', transparent: true, opacity: 0.7 })
            );
            curtainsGroup.add(rail);
          }
        }
      }
    }

    // Dynamic Orbit-Tracking Subsurface Depth Gauge
    if (model.regionalSlabs.length > 0 && poly2d.length > 2) {
      const districtShape = new THREE.Shape();
      districtShape.moveTo(poly2d[0][0], -poly2d[0][1]);
      for (let i = 1; i < poly2d.length; i++) {
        districtShape.lineTo(poly2d[i][0], -poly2d[i][1]);
      }
      districtShape.closePath();

      model.regionalSlabs.forEach((slab) => {
        const topY = slab.start * scaleY;
        const btmY = slab.end * scaleY;
        const thickness = Math.max(3, btmY - topY);

        const slabGeom = new THREE.ExtrudeGeometry(districtShape, {
          depth: thickness,
          bevelEnabled: false,
        });
        slabGeom.rotateX(Math.PI / 2);

        const slabMat = new THREE.MeshStandardMaterial({
          color: slab.colorHex || '#0ea5e9',
          transparent: true,
          opacity: 0.075,
          side: THREE.DoubleSide,
          depthWrite: false,
          roughness: 0.4,
        });

        const slabMesh = new THREE.Mesh(slabGeom, slabMat);
        slabMesh.position.y = -topY;
        rootSubsurface.add(slabMesh);

        // Edge wireframe outline for stratigraphic boundary
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(slabGeom),
          new THREE.LineBasicMaterial({
            color: slab.colorHex || '#0ea5e9',
            transparent: true,
            opacity: 0.18,
          })
        );
        edges.position.y = -topY;
        rootSubsurface.add(edges);
      });
    }

    // Dynamic Orbit-Tracking Subsurface Depth Gauge
    // Follows the camera orbit around the study perimeter so it is ALWAYS in full view
    const rulerGroup = new THREE.Group();
    rootSubsurface.add(rulerGroup);
    const totalRulerH = maxDepth * scaleY;

    // Solid prominent vertical depth ruler mast (rendered as a 3D cylinder with emissive glow)
    // Only spans underground (from surface y = 0 down to -totalRulerH)
    const rulerMast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.75, 0.75, totalRulerH, 16),
      new THREE.MeshStandardMaterial({
        color: '#fbbf24',
        emissive: '#d97706',
        emissiveIntensity: 0.6,
        roughness: 0.2,
        metalness: 0.8,
      })
    );
    rulerMast.position.y = -totalRulerH / 2;
    rulerGroup.add(rulerMast);

    // Ticks only strictly under ground (d >= 25m)
    for (let d = 25; d <= maxDepth; d += 25) {
      const y = -d * scaleY;
      // Prominent horizontal tick peg
      const tick = new THREE.Mesh(
        new THREE.CylinderGeometry(0.4, 0.4, 8, 12),
        new THREE.MeshStandardMaterial({
          color: '#fbbf24',
          emissive: '#d97706',
          emissiveIntensity: 0.8,
        })
      );
      tick.rotation.z = Math.PI / 2;
      tick.position.set(0, y, 0);
      rulerGroup.add(tick);

      // Large, crystal-clear depth number badge
      const dSprite = createTextSprite(
        `${d}m`,
        '#f59e0b',
        '#030712',
        36,
        4.0
      );
      dSprite.position.set(-12, y, 0);
      rulerGroup.add(dSprite);
      adaptiveSpritesRef.push(dSprite);
    }

    // 6. Interactive Raycaster for Clicking 3D Points
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let mouseDownPos = { x: 0, y: 0 };

    // Continuous scroll handoff: Scrolling outward past the maximum camera distance returns to Map View
    let zoomOutWheelAccum = 0;
    const onSceneWheel = (e: WheelEvent) => {
      // deltaY > 0 is scrolling backward / zooming out
      if (e.deltaY > 0) {
        const camDist = camera.position.distanceTo(controls.target);
        if (camDist >= controls.maxDistance * 0.82) {
          zoomOutWheelAccum += e.deltaY;
          if (zoomOutWheelAccum > 120) {
            zoomOutWheelAccum = 0;
            onCloseRef.current();
          }
        } else {
          zoomOutWheelAccum = 0;
        }
      } else {
        zoomOutWheelAccum = 0;
      }
    };

    renderer.domElement.addEventListener('wheel', onSceneWheel, { passive: true });

    const onPointerDown = (e: MouseEvent) => {
      mouseDownPos = { x: e.clientX, y: e.clientY };
    };

    const onPointerUp = (e: MouseEvent) => {
      const dx = Math.abs(e.clientX - mouseDownPos.x);
      const dy = Math.abs(e.clientY - mouseDownPos.y);
      if (dx > 5 || dy > 5) return; // Orbit drag guard

      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const activeClickables = clickableObjects.filter((o) => {
        let p: THREE.Object3D | null = o;
        while (p) {
          if (!p.visible) return false;
          p = p.parent;
        }
        return true;
      });
      const intersects = raycaster.intersectObjects(activeClickables, true);

      if (intersects.length > 0) {
        let obj: THREE.Object3D | null = intersects[0].object;
        while (obj && !obj.userData?.feature) {
          obj = obj.parent;
        }
        if (obj?.userData?.feature) {
          selectAndIsolateRef.current(obj.userData.feature);
        }
      }
    };

    const onPointerMove = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const activeClickables = clickableObjects.filter((o) => {
        let p: THREE.Object3D | null = o;
        while (p) {
          if (!p.visible) return false;
          p = p.parent;
        }
        return true;
      });
      const intersects = raycaster.intersectObjects(activeClickables, true);

      if (intersects.length > 0) {
        renderer.domElement.style.cursor = 'pointer';
      } else {
        renderer.domElement.style.cursor = 'grab';
      }
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointermove', onPointerMove);

    // Dynamic highlight & isolation update handler without rebuilding Three.js scene or resetting OrbitControls
    updateHighlightsRef.current = (selId: string | null, isFocus: boolean) => {
      // If focus mode is active and a station is selected, hide the curtain fences
      curtainsGroup.visible = !isFocus;

      boreholeMeshesRef.forEach((item) => {
        const isSel = selId === item.featId;

        if (isFocus) {
          // STRICT ISOLATION MODE:
          // Show only the selected station; hide all others completely
          item.group.visible = isSel;

          if (isSel) {
            // Wellhead collar
            const collarMat = item.collar.material as THREE.MeshStandardMaterial;
            collarMat.color.set('#fbbf24');
            collarMat.emissive.set('#d97706');
            collarMat.emissiveIntensity = 1.0;
            collarMat.opacity = 1.0;
            item.collar.scale.setScalar(1.15);

            // Casing intervals & water rings
            item.casingMeshes.forEach((mesh) => {
              const mat = mesh.material as THREE.MeshStandardMaterial;
              mat.color.set('#fde047');
              mat.emissive.set('#d97706');
              mat.emissiveIntensity = 0.75;
              mat.opacity = 1.0;
            });
            item.rings.forEach((ring) => {
              const mat = ring.material as THREE.MeshBasicMaterial;
              mat.opacity = 1.0;
            });

            // Skyward laser
            const laserMat = item.laser.material as THREE.MeshBasicMaterial;
            laserMat.color.set('#fde047');
            laserMat.opacity = 1.0;
            const targetLaserH = 24;
            item.laser.scale.set(1.4, targetLaserH / item.laserH, 1.4);
            item.laser.position.y = targetLaserH / 2;

            // Callout sprite label
            item.sprite.visible = true;
            item.sprite.position.y = targetLaserH + 4;
            const newSprite = createTextSprite(
              `${item.featName} (${item.fDepth}m)`,
              '#f59e0b',
              '#090d16',
              28,
              4.0
            );
            item.sprite.material.map?.dispose();
            item.sprite.material.map = newSprite.material.map;
            item.sprite.scale.copy(newSprite.scale);
            baseSpriteScales.set(item.sprite, newSprite.scale.clone());
            item.sprite.material.needsUpdate = true;
          }
        } else {
          // SHOW ALL MODE:
          // All boreholes visible
          item.group.visible = true;

          const collarMat = item.collar.material as THREE.MeshStandardMaterial;
          collarMat.color.set(isSel ? '#fbbf24' : item.baseColor);
          collarMat.emissive.set(isSel ? '#d97706' : item.baseColor);
          collarMat.emissiveIntensity = isSel ? 0.9 : 0.4;
          collarMat.opacity = 1.0;

          item.casingMeshes.forEach((mesh) => {
            const mat = mesh.material as THREE.MeshStandardMaterial;
            mat.color.set(isSel ? '#fde047' : mesh.userData.wellBaseColor || '#e2f7ff');
            mat.emissive.set(isSel ? '#d97706' : mesh.userData.wellBaseEmissive || '#0891b2');
            mat.emissiveIntensity = isSel ? 0.75 : 0.32;
            mat.opacity = 0.85;
          });
          item.rings.forEach((ring) => {
            const mat = ring.material as THREE.MeshBasicMaterial;
            mat.opacity = 0.95;
          });

          const laserMat = item.laser.material as THREE.MeshBasicMaterial;
          laserMat.color.set(isSel ? '#fde047' : item.baseColor);
          laserMat.opacity = isSel ? 0.95 : 0.45;
          const targetLaserH = isSel ? 24 : 16;
          item.laser.scale.set(1, targetLaserH / item.laserH, 1);
          item.laser.position.y = targetLaserH / 2;

          item.sprite.visible = true;
          item.sprite.position.y = targetLaserH + 4;
          const newSprite = createTextSprite(
            `${item.featName} (${item.fDepth}m)`,
            isSel ? '#f59e0b' : item.baseColor,
            '#090d16',
            28,
            4.0
          );
          item.sprite.material.map?.dispose();
          item.sprite.material.map = newSprite.material.map;
          item.sprite.scale.copy(newSprite.scale);
          baseSpriteScales.set(item.sprite, newSprite.scale.clone());
          item.sprite.material.needsUpdate = true;
        }
      });
    };

    // Store base scales for all sprites so they can adapt smoothly with camera zoom distance
    const baseSpriteScales = new Map<THREE.Sprite, THREE.Vector3>();
    adaptiveSpritesRef.forEach((sp) => {
      baseSpriteScales.set(sp, sp.scale.clone());
    });

    // 7. Animation Loop
    let animId: number;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      controls.update();

      const dist = camera.position.distanceTo(controls.target);

      // The ruler belongs to the underground inspection view. A shallow,
      // side-on camera can still be above the terrain, so use the actual world
      // surface (y = 0) rather than orbit angle as the visibility boundary.
      const isUndergroundView = camera.position.y < -2;
      rulerGroup.visible = isUndergroundView;

      // A. Dynamic Camera-Orbit Tracking for the 3D Subsurface Depth Meter:
      // Computes horizontal camera angle and places ruler on the left edge of camera's line-of-sight
      const camAngle = Math.atan2(
        camera.position.x - controls.target.x,
        camera.position.z - controls.target.z
      );
      // Place depth gauge at an offset angle from camera view (to the visual left of the cutaway window)
      const offsetAngle = camAngle + 0.55;
      const rulerRadius = 55; // snug around cutaway perimeter
      rulerGroup.position.x = controls.target.x + Math.sin(offsetAngle) * rulerRadius;
      rulerGroup.position.z = controls.target.z + Math.cos(offsetAngle) * rulerRadius;

      // B. Adaptive Dynamic Scaling & Decluttering:
      // Modulate scale with zoom distance with gentle bounds so labels stay clean and never overpower the view
      const zoomFactor = Math.min(1.4, Math.max(0.75, dist / 220));

      const isIsolated = focusModeRef.current;
      const activeSelId = currentFeatureIdRef.current;

      // Project each label into screen space. The previous implementation only
      // enforced a quota, so a small number of labels could still overlap.
      const candidates = boreholeMeshesRef.map((item) => {
        const labelWorldPos = new THREE.Vector3();
        item.sprite.getWorldPosition(labelWorldPos);
        const projected = labelWorldPos.clone().project(camera);

        // Rank against the nearest point along the actual underground borehole.
        // This makes the active labels change naturally as the camera moves down,
        // around, or between wells instead of favoring a fixed surface subset.
        const stationWorldPos = new THREE.Vector3();
        item.group.getWorldPosition(stationWorldPos);
        const boreBottomY = stationWorldPos.y - item.fDepth * scaleY;
        const nearestBoreY = THREE.MathUtils.clamp(camera.position.y, boreBottomY, stationWorldPos.y);
        const proximityPoint = new THREE.Vector3(stationWorldPos.x, nearestBoreY, stationWorldPos.z);
        const proximityDistance = camera.position.distanceTo(proximityPoint);
        const labelDistance = camera.position.distanceTo(labelWorldPos);

        return {
          item,
          projected,
          proximityDistance,
          labelDistance,
          isSel: item.featId === activeSelId,
        };
      });

      // Selected label first, then favor labels closest to the camera.
      candidates.sort(
        (a, b) => Number(b.isSel) - Number(a.isSel) || a.proximityDistance - b.proximityDistance
      );

      const viewportWidth = renderer.domElement.clientWidth;
      const viewportHeight = renderer.domElement.clientHeight;
      const perspectiveScale = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
      const maxLabelsToShow = dist > 260 ? 6 : dist > 140 ? 10 : 16;
      const acceptedRects: Array<{ left: number; right: number; top: number; bottom: number }> = [];
      let labelsShown = 0;

      candidates.forEach(({ item, projected, labelDistance, isSel }) => {
        if (isIsolated) {
          // In isolate mode, only show the selected label
          item.sprite.visible = isSel;
          return;
        }

        item.sprite.visible = false;
        if (labelsShown >= maxLabelsToShow || projected.z < -1 || projected.z > 1) return;

        const baseScale = baseSpriteScales.get(item.sprite) || item.sprite.scale;
        const pixelsPerWorldUnit = perspectiveScale / Math.max(1, labelDistance);
        const labelWidth = baseScale.x * zoomFactor * pixelsPerWorldUnit;
        const labelHeight = baseScale.y * zoomFactor * pixelsPerWorldUnit;
        const centerX = (projected.x * 0.5 + 0.5) * viewportWidth;
        const centerY = (-projected.y * 0.5 + 0.5) * viewportHeight;
        const padding = 8;
        const rect = {
          left: centerX - labelWidth / 2 - padding,
          right: centerX + labelWidth / 2 + padding,
          top: centerY - labelHeight / 2 - padding,
          bottom: centerY + labelHeight / 2 + padding,
        };

        const isOnScreen = rect.right >= 0 && rect.left <= viewportWidth && rect.bottom >= 0 && rect.top <= viewportHeight;
        const overlaps = acceptedRects.some(
          (other) =>
            rect.left < other.right &&
            rect.right > other.left &&
            rect.top < other.bottom &&
            rect.bottom > other.top
        );

        if (isOnScreen && !overlaps) {
          item.sprite.visible = true;
          acceptedRects.push(rect);
          labelsShown++;
        }
      });

      // Tie the visible label set back to the geometry. Nearby labelled wells
      // glow more strongly while the remaining context recedes slightly.
      if (!isIsolated) {
        boreholeMeshesRef.forEach((item) => {
          const isContextHighlight = item.sprite.visible;
          const collarMat = item.collar.material as THREE.MeshStandardMaterial;
          const laserMat = item.laser.material as THREE.MeshBasicMaterial;
          collarMat.emissiveIntensity = isContextHighlight ? 0.85 : 0.28;
          item.collar.scale.setScalar(isContextHighlight ? 1.12 : 0.92);
          laserMat.opacity = isContextHighlight ? 0.72 : 0.28;
        });
      }

      baseSpriteScales.forEach((baseScale, sp) => {
        if (sp.visible) {
          sp.scale.set(
            baseScale.x * zoomFactor,
            baseScale.y * zoomFactor,
            baseScale.z
          );
        }
      });

      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!container) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      updateHighlightsRef.current = null;
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('wheel', onSceneWheel);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      controls.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [
    model,
    sceneFeatures,
    surfaceCanvas,
    maxDepth,
    focusFinding,
  ]);

  return (
    <div className="absolute inset-0 z-40 bg-slate-950 text-slate-100 flex flex-col overflow-hidden select-none animate-in fade-in duration-300">
      {/* 3D Canvas Host */}
      <div ref={mountRef} className="absolute inset-0 w-full h-full cursor-grab active:cursor-grabbing" />

      {focusFinding && (
        <div className="absolute top-16 left-1/2 z-50 -translate-x-1/2 rounded-full border border-amber-400/60 bg-slate-950/90 px-4 py-2 text-[11px] font-mono text-amber-200 shadow-xl backdrop-blur-md">
          Finding focus: {focusFinding.title}{focusFinding.intervalIds.length > 0 ? ` · ${focusFinding.intervalIds.length} depth interval${focusFinding.intervalIds.length === 1 ? '' : 's'}` : ''}
        </div>
      )}

      {/* Floating Left Station Navigator */}
      <div className="absolute top-16 bottom-5 left-5 z-50 w-76 bg-slate-900/95 backdrop-blur-xl border border-slate-700/70 rounded-xl shadow-[0_16px_50px_rgba(0,0,0,0.8)] p-3 pointer-events-auto flex min-h-0 flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-2 border-b border-slate-800 text-xs font-mono">
          <span className="text-slate-200 font-bold tracking-wide">LOCATED STUDY OBJECTS</span>
          <span className="text-cyan-400 font-semibold">{sceneFeatures.length} Located · {depthReadyCount} Depth</span>
        </div>

        {/* Distinct Mode Segmented Action Banner */}
        <div className="my-2.5 bg-slate-950/80 p-1 rounded-lg border border-slate-800 flex gap-1">
          <button
            onClick={() => {
              if (!sceneFeatures.some((feature) => feature.id === currentFeature?.id) && sceneFeatures.length > 0) {
                onSelectFeature(sceneFeatures[0]);
              }
              setFocusMode(true);
            }}
            className={`flex-1 py-1.5 px-2 rounded-md text-[11px] font-mono font-bold transition flex items-center justify-center gap-1.5 ${
              focusMode
                ? 'bg-amber-400 text-slate-950 shadow-md shadow-amber-400/20'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Focus className="w-3.5 h-3.5" />
            <span>Focus Station</span>
          </button>
          <button
            onClick={() => {
              setFocusMode(false);
              onSelectFeature(null);
            }}
            className={`flex-1 py-1.5 px-2 rounded-md text-[11px] font-mono font-bold transition flex items-center justify-center gap-1.5 ${
              !focusMode
                ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Show All ({sceneFeatures.length})</span>
          </button>
        </div>

        <div className="text-[10px] font-mono text-slate-400 px-1 pb-1 flex items-center justify-between">
          <span>STATION LIST</span>
          <span className="text-slate-500">{focusMode ? 'Showing active point' : 'Showing all points'}</span>
        </div>

        <div ref={listContainerRef} className="min-h-0 overflow-y-auto space-y-1.5 flex-1 pr-1 pb-3 scroll-pb-3">
          {sceneFeatures.map((feat) => {
            const isSel = currentFeature && feat.id === currentFeature.id;
            return (
              <button
                key={feat.id}
                ref={isSel ? selectedItemRef : undefined}
                onClick={() => selectAndIsolateRef.current(feat)}
                className={`w-full text-left p-2.5 rounded-lg text-xs font-mono transition flex items-center justify-between ${
                  isSel
                    ? 'bg-amber-400/25 border border-amber-400 text-amber-300 ring-2 ring-amber-400/40 shadow-[0_0_15px_rgba(251,191,36,0.25)]'
                    : 'bg-slate-800/40 hover:bg-slate-800/80 text-slate-300 border border-slate-800/60'
                }`}
              >
                <div className="truncate mr-2">
                  <div className={`font-bold truncate ${isSel ? 'text-amber-200' : 'text-slate-200'}`}>
                    {feat.name}
                  </div>
                  <div className="text-[10px] text-slate-400 capitalize">{feat.type.replace('_', ' ')}</div>
                </div>
                <span className={`text-[10px] font-bold whitespace-nowrap ${isDepthReady(feat) ? 'text-cyan-400' : 'text-violet-300'}`}>
                  {isDepthReady(feat)
                    ? `${feat.totalDepthMeters || feat.intervals[feat.intervals.length - 1]?.end || 0}m`
                    : 'SURFACE'}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Floating Right Detail Panel / Narrative HUD - Only in Isolate One mode when a feature is selected */}
      {focusMode && currentFeature && (
        <FloatingHUD
          feature={currentFeature}
          onCloseFeature={() => onSelectFeature(null)}
          model={model}
        />
      )}
    </div>
  );
};
