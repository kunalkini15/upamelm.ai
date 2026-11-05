import * as maplibregl from 'maplibre-gl';
import * as THREE from 'three';
import {
  RenderablePointFeature,
  RenderableRegionalSlab,
  RenderableInterval,
} from '../../types/scientific';

export interface SubsurfaceLayerOptions {
  id?: string;
  features: RenderablePointFeature[];
  regionalSlabs: RenderableRegionalSlab[];
  verticalExaggeration: number;
  explodeOffset: number;
  showTransects: boolean;
  showRegionalSlabs: boolean;
  selectedFeatureId: string | null;
  onSelectFeature?: (feature: RenderablePointFeature) => void;
  onSelectInterval?: (interval: RenderableInterval) => void;
}

/**
 * Native MapLibre Custom Layer implementing 3D Subsurface Three.js rendering.
 * Shares MapLibre's WebGL context, camera projection matrix, and depth buffer directly.
 * All mouse gestures (scroll zoom, pan drag, right-click pitch/rotate, touch pinch)
 * work natively without blocking pointer events or losing coordinate sync.
 */
export class SubsurfaceCustomLayer implements maplibregl.CustomLayerInterface {
  id: string;
  type: 'custom' = 'custom';
  renderingMode: '3d' = '3d';

  private map: maplibregl.Map | null = null;
  private camera: THREE.Camera;
  private scene: THREE.Scene;
  private renderer: THREE.WebGLRenderer | null = null;

  // Options & dynamic props
  private options: SubsurfaceLayerOptions;
  private rootGroup: THREE.Group;
  private boreholeMeshMap: Map<string, THREE.Group> = new Map();
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();

  constructor(options: SubsurfaceLayerOptions) {
    this.id = options.id || 'subsurface-3d-twin';
    this.options = { ...options };

    this.camera = new THREE.Camera();
    this.scene = new THREE.Scene();
    this.rootGroup = new THREE.Group();
    this.scene.add(this.rootGroup);

    // Setup Lighting in Scene
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    this.scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.8);
    dirLight1.position.set(1, -1, 2).normalize();
    this.scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x35C4B5, 1.0);
    dirLight2.position.set(-1, 1, -2).normalize();
    this.scene.add(dirLight2);
  }

  onAdd(map: maplibregl.Map, gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    this.map = map;

    this.renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl as WebGLRenderingContext,
      antialias: true,
    });
    this.renderer.autoClear = false;

    // Attach click listener on map canvas for 3D borehole interaction
    map.getCanvas().addEventListener('click', this.handleCanvasClick);

    this.rebuildScene();
  }

  private handleCanvasClick = (e: MouseEvent) => {
    if (!this.map) return;
    const canvas = this.map.getCanvas();
    const rect = canvas.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(this.rootGroup.children, true);

    if (intersects.length > 0) {
      let current: THREE.Object3D | null = intersects[0].object;
      while (current && current !== this.rootGroup) {
        if (current.userData && current.userData.feature) {
          if (this.options.onSelectFeature) {
            this.options.onSelectFeature(current.userData.feature);
          }
          break;
        }
        current = current.parent;
      }
    }
  };

  public updateProps(newOptions: Partial<SubsurfaceLayerOptions>) {
    const prevExagg = this.options.verticalExaggeration;
    const prevExplode = this.options.explodeOffset;
    const prevTransects = this.options.showTransects;
    const prevSlabs = this.options.showRegionalSlabs;
    const prevSel = this.options.selectedFeatureId;

    this.options = { ...this.options, ...newOptions };

    if (
      prevExagg !== this.options.verticalExaggeration ||
      prevExplode !== this.options.explodeOffset ||
      prevTransects !== this.options.showTransects ||
      prevSlabs !== this.options.showRegionalSlabs ||
      prevSel !== this.options.selectedFeatureId ||
      newOptions.features ||
      newOptions.regionalSlabs
    ) {
      this.rebuildScene();
      this.map?.triggerRepaint();
    }
  }

  private rebuildScene() {
    // Clear root group
    while (this.rootGroup.children.length > 0) {
      const obj = this.rootGroup.children[0];
      this.rootGroup.remove(obj);
    }
    this.boreholeMeshMap.clear();

    const {
      features,
      regionalSlabs,
      verticalExaggeration,
      explodeOffset,
      showTransects,
      showRegionalSlabs,
      selectedFeatureId,
    } = this.options;

    if (!features || features.length === 0) return;

    // We anchor all 3D geometries in Mercator meter coordinates.
    // In MapLibre 3D custom layer space:
    // x: [0, 1] Mercator X
    // y: [0, 1] Mercator Y
    // z: Mercator Z (Altitude in Mercator units, where 0 is ground and negative is subterranean)
    const refCoord = maplibregl.MercatorCoordinate.fromLngLat(features[0].coordinates, 0);
    const mercatorMeter = refCoord.meterInMercatorCoordinateUnits();

    // Map each feature to its mercator coordinates
    const featureMercators = features.map((feat) => {
      const mc = maplibregl.MercatorCoordinate.fromLngLat(feat.coordinates, 0);
      return {
        feature: feat,
        mc,
      };
    });

    // 1. Build Boreholes
    featureMercators.forEach(({ feature, mc }) => {
      const isSelected = feature.id === selectedFeatureId;
      const boreholeGroup = new THREE.Group();
      boreholeGroup.userData = { feature };

      const depth =
        feature.totalDepthMeters ||
        (feature.intervals.length > 0
          ? feature.intervals[feature.intervals.length - 1].end
          : 80);

      // Exaggerated vertical depth in Mercator units
      const scaledDepthMeters = depth * verticalExaggeration;
      const depthMercatorUnits = scaledDepthMeters * mercatorMeter;

      // Outer borehole diameter in Mercator units (approx 120-180 meters visual radius for prominence)
      const radiusMercator = (isSelected ? 160 : 110) * mercatorMeter;

      // A. Surface Collar
      const collarHeight = 60 * mercatorMeter;
      const collarGeom = new THREE.CylinderGeometry(
        radiusMercator * 1.4,
        radiusMercator * 1.8,
        collarHeight,
        16
      );
      collarGeom.rotateX(Math.PI / 2); // MapLibre Z is up/down in matrix orientation
      const collarMat = new THREE.MeshStandardMaterial({
        color: isSelected ? 0xE3B34E : 0x35C4B5,
        roughness: 0.2,
        metalness: 0.8,
        emissive: isSelected ? 0xE3B34E : 0x1F4A45,
        emissiveIntensity: 0.6,
      });
      const collarMesh = new THREE.Mesh(collarGeom, collarMat);
      collarMesh.position.set(mc.x, mc.y, collarHeight / 2);
      boreholeGroup.add(collarMesh);

      // B. Subsurface Drilled Extrusion (points downwards into negative Z)
      const intervals = feature.intervals || [];
      if (intervals.length > 0) {
        intervals.forEach((iv) => {
          const topMeters = iv.start * verticalExaggeration;
          const btmMeters = iv.end * verticalExaggeration;
          const thickMercator = (btmMeters - topMeters) * mercatorMeter;
          const centerZMeters = -(topMeters + (btmMeters - topMeters) / 2) * mercatorMeter;

          const cylGeom = new THREE.CylinderGeometry(
            radiusMercator,
            radiusMercator,
            thickMercator,
            16
          );
          cylGeom.rotateX(Math.PI / 2);
          const cylMat = new THREE.MeshStandardMaterial({
            color: new THREE.Color(iv.colorHex),
            roughness: 0.3,
            metalness: 0.2,
            transparent: true,
            opacity: 0.95,
          });
          const segMesh = new THREE.Mesh(cylGeom, cylMat);
          segMesh.position.set(mc.x, mc.y, centerZMeters);
          boreholeGroup.add(segMesh);
        });
      } else {
        // Uniform casing extrusion
        const cylGeom = new THREE.CylinderGeometry(
          radiusMercator,
          radiusMercator,
          depthMercatorUnits,
          16
        );
        cylGeom.rotateX(Math.PI / 2);
        const cylMat = new THREE.MeshStandardMaterial({
          color: isSelected ? 0x5FB8D6 : 0x2F82AD,
          roughness: 0.3,
          metalness: 0.4,
          transparent: true,
          opacity: 0.88,
        });
        const pipeMesh = new THREE.Mesh(cylGeom, cylMat);
        pipeMesh.position.set(mc.x, mc.y, -depthMercatorUnits / 2);
        boreholeGroup.add(pipeMesh);
      }

      // C. Water Table Level Indicator Ring (if measured)
      if (feature.waterLevelMeters) {
        const wtMercator = -feature.waterLevelMeters * verticalExaggeration * mercatorMeter;
        const ringGeom = new THREE.TorusGeometry(radiusMercator * 2.8, radiusMercator * 0.45, 8, 24);
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0x5FB8D6,
          transparent: true,
          opacity: 0.9,
        });
        const ringMesh = new THREE.Mesh(ringGeom, ringMat);
        ringMesh.position.set(mc.x, mc.y, wtMercator);
        boreholeGroup.add(ringMesh);
      }

      // D. Laser Vertical Plummet Beacon (reaches upwards into the sky)
      const beaconHeight = 700 * mercatorMeter;
      const beaconGeom = new THREE.CylinderGeometry(
        radiusMercator * 0.35,
        radiusMercator * 0.35,
        beaconHeight,
        8
      );
      beaconGeom.rotateX(Math.PI / 2);
      const beaconMat = new THREE.MeshBasicMaterial({
        color: isSelected ? 0xE3B34E : 0x5ED6C6,
        transparent: true,
        opacity: isSelected ? 0.95 : 0.65,
      });
      const beaconMesh = new THREE.Mesh(beaconGeom, beaconMat);
      beaconMesh.position.set(mc.x, mc.y, beaconHeight / 2);
      boreholeGroup.add(beaconMesh);

      this.rootGroup.add(boreholeGroup);
      this.boreholeMeshMap.set(feature.id, boreholeGroup);
    });

    // 2. Transect Curtains connecting neighboring stations
    if (showTransects && featureMercators.length > 1) {
      const transectMat = new THREE.MeshStandardMaterial({
        color: 0x5FB8D6,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.28,
        wireframe: true,
      });
      const topRailMat = new THREE.MeshBasicMaterial({
        color: 0x35C4B5,
        transparent: true,
        opacity: 0.85,
      });

      // Connect pairs within reasonable geographic proximity
      let connections = 0;
      for (let i = 0; i < featureMercators.length && connections < 32; i++) {
        for (let j = i + 1; j < featureMercators.length && connections < 32; j++) {
          const a = featureMercators[i];
          const b = featureMercators[j];
          const dx = b.mc.x - a.mc.x;
          const dy = b.mc.y - a.mc.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          // Connect points that are within regional neighborhood
          if (dist > 0.0001 && dist < 0.035) {
            connections++;
            const maxDepth = Math.max(
              a.feature.totalDepthMeters || 80,
              b.feature.totalDepthMeters || 80
            );
            const depthUnits = maxDepth * verticalExaggeration * mercatorMeter;

            // Build vertical quad fence curtain
            const geom = new THREE.BufferGeometry();
            const vertices = new Float32Array([
              a.mc.x, a.mc.y, 0,
              b.mc.x, b.mc.y, 0,
              a.mc.x, a.mc.y, -depthUnits,

              b.mc.x, b.mc.y, 0,
              b.mc.x, b.mc.y, -depthUnits,
              a.mc.x, a.mc.y, -depthUnits,
            ]);
            geom.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
            geom.computeVertexNormals();

            const curtainMesh = new THREE.Mesh(geom, transectMat);
            this.rootGroup.add(curtainMesh);

            // Ground surface line
            const lineGeom = new THREE.BufferGeometry().setFromPoints([
              new THREE.Vector3(a.mc.x, a.mc.y, 0),
              new THREE.Vector3(b.mc.x, b.mc.y, 0),
            ]);
            const line = new THREE.Line(
              lineGeom,
              new THREE.LineBasicMaterial({ color: 0x35C4B5, transparent: true, opacity: 0.7 })
            );
            this.rootGroup.add(line);
          }
        }
      }
    }

    // 3. Regional Stratigraphic Formation Slabs
    if (showRegionalSlabs && regionalSlabs.length > 0) {
      // Find bounding box in Mercator coordinates
      let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity;
      featureMercators.forEach(({ mc }) => {
        if (mc.x < minX) minX = mc.x;
        if (mc.x > maxX) maxX = mc.x;
        if (mc.y < minY) minY = mc.y;
        if (mc.y > maxY) maxY = mc.y;
      });

      // Expand extent padding
      const padX = (maxX - minX) * 0.15 || 0.005;
      const padY = (maxY - minY) * 0.15 || 0.005;
      const sMinX = minX - padX;
      const sMaxX = maxX + padX;
      const sMinY = minY - padY;
      const sMaxY = maxY + padY;

      regionalSlabs.forEach((slab, idx) => {
        const topMeters = slab.start * verticalExaggeration;
        const btmMeters = slab.end * verticalExaggeration;
        const explodeY = idx * (explodeOffset * 40 * verticalExaggeration * mercatorMeter);

        const topZ = -(topMeters * mercatorMeter + explodeY);
        const btmZ = -(btmMeters * mercatorMeter + explodeY);

        // Build box geometry for regional formation slab
        const vertices = new Float32Array([
          // Top Face
          sMinX, sMinY, topZ,   sMaxX, sMinY, topZ,   sMaxX, sMaxY, topZ,
          sMinX, sMinY, topZ,   sMaxX, sMaxY, topZ,   sMinX, sMaxY, topZ,
          // Bottom Face
          sMinX, sMinY, btmZ,   sMaxX, sMaxY, btmZ,   sMaxX, sMinY, btmZ,
          sMinX, sMinY, btmZ,   sMinX, sMaxY, btmZ,   sMaxX, sMaxY, btmZ,
          // West Face
          sMinX, sMinY, btmZ,   sMinX, sMinY, topZ,   sMinX, sMaxY, topZ,
          sMinX, sMinY, btmZ,   sMinX, sMaxY, topZ,   sMinX, sMaxY, btmZ,
          // East Face
          sMaxX, sMinY, btmZ,   sMaxX, sMaxY, topZ,   sMaxX, sMinY, topZ,
          sMaxX, sMinY, btmZ,   sMaxX, sMaxY, btmZ,   sMaxX, sMaxY, topZ,
          // South Face
          sMinX, sMinY, btmZ,   sMaxX, sMinY, topZ,   sMinX, sMinY, topZ,
          sMinX, sMinY, btmZ,   sMaxX, sMinY, btmZ,   sMaxX, sMinY, topZ,
          // North Face
          sMinX, sMaxY, btmZ,   sMinX, sMaxY, topZ,   sMaxX, sMaxY, topZ,
          sMinX, sMaxY, btmZ,   sMaxX, sMaxY, topZ,   sMaxX, sMaxY, btmZ,
        ]);

        const slabGeom = new THREE.BufferGeometry();
        slabGeom.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
        slabGeom.computeVertexNormals();

        const slabMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(slab.colorHex),
          roughness: 0.3,
          metalness: 0.1,
          transparent: true,
          opacity: 0.14,
          side: THREE.DoubleSide,
          depthWrite: false,
        });

        const slabMesh = new THREE.Mesh(slabGeom, slabMat);
        this.rootGroup.add(slabMesh);

        // Wireframe edges for stratigraphic layer bounds
        const edges = new THREE.EdgesGeometry(slabGeom);
        const line = new THREE.LineSegments(
          edges,
          new THREE.LineBasicMaterial({
            color: new THREE.Color(slab.colorHex),
            transparent: true,
            opacity: 0.35,
          })
        );
        this.rootGroup.add(line);
      });
    }
  }

  render(
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    options: any
  ): void {
    if (!this.renderer || !this.map) return;

    (window as any).__renderCount = ((window as any).__renderCount || 0) + 1;
    (window as any).__renderOptions = options;

    const matrix = options?.modelViewProjectionMatrix || options;
    if (matrix) {
      const m = new THREE.Matrix4().fromArray(matrix);
      this.camera.projectionMatrix = m;
    }

    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
    this.map.triggerRepaint();
  }

  onRemove(): void {
    if (this.map) {
      this.map.getCanvas().removeEventListener('click', this.handleCanvasClick);
    }
    this.rootGroup.clear();
    this.renderer?.dispose();
  }
}
