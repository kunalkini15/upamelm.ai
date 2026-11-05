import React, { useRef, useMemo } from 'react';
import { Billboard, Text } from '@react-three/drei';
import * as THREE from 'three';
import {
  RenderablePointFeature,
  RenderableInterval,
  RenderableRegionalSlab,
} from '../../types/scientific';

interface SubsurfaceOverlaySceneProps {
  features: RenderablePointFeature[];
  selectedFeature: RenderablePointFeature | null;
  onSelectFeature: (f: RenderablePointFeature) => void;
  regionalSlabs: RenderableRegionalSlab[];
  bounds: { minLng: number; maxLng: number; minLat: number; maxLat: number; center: [number, number] };
  verticalExaggeration: number;
  explodeOffset: number;
  zoomLevel: number;
  pitchAngle: number;
  onSelectInterval?: (interval: RenderableInterval) => void;
}

/**
 * Projects real geographic coordinates into 3D scene units
 */
function geoToScene(
  lng: number,
  lat: number,
  center: [number, number],
  bounds: { minLng: number; maxLng: number; minLat: number; maxLat: number }
): [number, number] {
  const spanLng = Math.max(0.01, bounds.maxLng - bounds.minLng);
  const spanLat = Math.max(0.01, bounds.maxLat - bounds.minLat);
  const sceneScale = 40;

  const x = ((lng - center[0]) / spanLng) * sceneScale;
  const z = -((lat - center[1]) / spanLat) * sceneScale;
  return [x, z];
}

/**
 * 3D Borehole Core Cylinder
 */
const ExtrudedBoreholeMesh: React.FC<{
  feature: RenderablePointFeature;
  isSelected: boolean;
  onSelect: () => void;
  position: [number, number, number];
  verticalExaggeration: number;
  explodeOffset: number;
  opacity: number;
  onSelectInterval?: (interval: RenderableInterval) => void;
}> = ({
  feature,
  isSelected,
  onSelect,
  position,
  verticalExaggeration,
  explodeOffset,
  opacity,
  onSelectInterval,
}) => {
  const intervals = feature.intervals || [];
  const depth = feature.totalDepthMeters || (intervals.length > 0 ? intervals[intervals.length - 1].end : 80);
  const scale = 0.04 * (verticalExaggeration / 10);
  const totalHeight = depth * scale;

  return (
    <group position={position}>
      {/* Surface Wellhead Collar */}
      <mesh
        position={[0, 0.3, 0]}
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
      >
        <cylinderGeometry args={[0.35, 0.45, 0.6, 16]} />
        <meshStandardMaterial
          color={isSelected ? '#E3B34E' : '#35C4B5'}
          emissive={isSelected ? '#E3B34E' : '#1F4A45'}
          emissiveIntensity={isSelected ? 0.9 : 0.3}
          roughness={0.2}
          metalness={0.8}
          transparent
          opacity={opacity}
        />
      </mesh>

      {/* Vertical Pin Light Beam */}
      <mesh position={[0, 3, 0]}>
        <cylinderGeometry args={[0.02, 0.08, 6, 8]} />
        <meshBasicMaterial
          color={isSelected ? '#E3B34E' : '#5FB8D6'}
          transparent
          opacity={opacity * (isSelected ? 0.8 : 0.3)}
        />
      </mesh>

      {/* Extruded Strata Segments */}
      {intervals.map((iv, idx) => {
        const topY = iv.start * scale;
        const btmY = iv.end * scale;
        const segHeight = Math.max(0.4, btmY - topY);
        const explodeY = -idx * (explodeOffset * 1.5);
        const yCenter = -(topY + segHeight / 2) + explodeY;
        const isClay = (iv.material || iv.name || '').toLowerCase().includes('clay');

        return (
          <group key={iv.id || idx} position={[0, yCenter, 0]}>
            <mesh
              onClick={(e) => {
                e.stopPropagation();
                onSelect();
                onSelectInterval?.(iv);
              }}
            >
              <cylinderGeometry args={[0.38, 0.38, segHeight, 20]} />
              <meshStandardMaterial
                color={iv.colorHex}
                roughness={isClay ? 0.8 : 0.2}
                metalness={isClay ? 0.1 : 0.5}
                transparent
                opacity={opacity * (iv.transparency || 0.85)}
              />
            </mesh>
          </group>
        );
      })}

      {/* Fallback casing */}
      {intervals.length === 0 && (
        <mesh position={[0, -totalHeight / 2, 0]}>
          <cylinderGeometry args={[0.25, 0.25, totalHeight, 16]} />
          <meshStandardMaterial
            color="#334155"
            metalness={0.6}
            roughness={0.3}
            transparent
            opacity={opacity * 0.65}
          />
        </mesh>
      )}

      {/* Standing Water Level Ring */}
      {feature.waterLevelMeters && (
        <mesh
          position={[0, -(feature.waterLevelMeters * scale), 0]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <ringGeometry args={[0.4, 0.9, 24]} />
          <meshBasicMaterial
            color="#3FD2C8"
            side={THREE.DoubleSide}
            transparent
            opacity={opacity * 0.85}
          />
        </mesh>
      )}

      {/* Always camera-facing billboard callout */}
      <Billboard position={[0, 1.4, 0]} follow lockX={false} lockY={false} lockZ={false}>
        <group onClick={(e) => { e.stopPropagation(); onSelect(); }}>
          <mesh position={[0, 0, -0.02]}>
            <planeGeometry args={[feature.name.length * 0.18 + 0.6, 0.45]} />
            <meshBasicMaterial
              color={isSelected ? '#0C1114' : '#07090B'}
              transparent
              opacity={opacity * 0.85}
            />
          </mesh>
          <Text
            fontSize={0.24}
            color={isSelected ? '#E3B34E' : '#ECF2EF'}
            anchorX="center"
            anchorY="middle"
            fillOpacity={opacity}
          >
            {feature.name}
          </Text>
        </group>
      </Billboard>
    </group>
  );
};

export const SubsurfaceOverlayScene: React.FC<SubsurfaceOverlaySceneProps> = ({
  features,
  selectedFeature,
  onSelectFeature,
  regionalSlabs,
  bounds,
  verticalExaggeration,
  explodeOffset,
  zoomLevel,
  pitchAngle,
  onSelectInterval,
}) => {
  // Smoothly blend 3D opacity based on zoom depth:
  // Zoom < 11.5: 0% opacity (pure map)
  // Zoom 11.5 - 13.5: smooth transition
  // Zoom > 13.5: 100% full 3D subterranean digital twin
  const transitionProgress = Math.min(1, Math.max(0, (zoomLevel - 11.2) / 2.3));

  const featurePositions = useMemo(() => {
    return features.map((f) => {
      const [x, z] = geoToScene(f.coordinates[0], f.coordinates[1], bounds.center, bounds);
      return { feature: f, pos: [x, 0, z] as [number, number, number], x2d: x, z2d: z };
    });
  }, [features, bounds]);

  // Procedural Transect Links
  const transectLinks = useMemo(() => {
    if (featurePositions.length < 2) return [];
    const links: Array<{ posA: [number, number]; posB: [number, number]; avgDepth: number }> = [];

    for (let i = 0; i < featurePositions.length; i++) {
      for (let j = i + 1; j < featurePositions.length; j++) {
        const p1 = featurePositions[i];
        const p2 = featurePositions[j];
        const dist = Math.hypot(p1.x2d - p2.x2d, p1.z2d - p2.z2d);
        if (dist > 2.5 && dist < 8.5) {
          const depthA = p1.feature.totalDepthMeters || 80;
          const depthB = p2.feature.totalDepthMeters || 80;
          links.push({
            posA: [p1.x2d, p1.z2d],
            posB: [p2.x2d, p2.z2d],
            avgDepth: (depthA + depthB) / 2,
          });
        }
      }
    }
    return links.slice(0, 20);
  }, [featurePositions]);

  if (transitionProgress <= 0.02) {
    return null; // Don't render 3D meshes while high in space to maximize FPS
  }

  return (
    <>
      <ambientLight intensity={0.9} />
      <directionalLight position={[20, 35, 25]} intensity={1.5} />
      <pointLight position={[-15, -15, -15]} intensity={0.6} color="#35C4B5" />

      {/* Ground Subsurface Grid */}
      <group position={[0, 0, 0]}>
        <gridHelper
          args={[48, 48, '#35C4B5', '#1C262C']}
          position={[0, 0.02, 0]}
        />
      </group>

      {/* Multi-Well Constellation */}
      {featurePositions.map(({ feature, pos }) => (
        <ExtrudedBoreholeMesh
          key={feature.id}
          feature={feature}
          isSelected={selectedFeature?.id === feature.id}
          onSelect={() => onSelectFeature(feature)}
          position={pos}
          verticalExaggeration={verticalExaggeration}
          explodeOffset={explodeOffset}
          opacity={transitionProgress}
          onSelectInterval={onSelectInterval}
        />
      ))}

      {/* Transect Curtains */}
      {transectLinks.map((link, idx) => {
        const scale = 0.04 * (verticalExaggeration / 10);
        const curtainHeight = link.avgDepth * scale;
        const midX = (link.posA[0] + link.posB[0]) / 2;
        const midZ = (link.posA[1] + link.posB[1]) / 2;
        const dx = link.posB[0] - link.posA[0];
        const dz = link.posB[1] - link.posA[1];
        const distance = Math.sqrt(dx * dx + dz * dz);
        const angle = Math.atan2(dz, dx);

        return (
          <group key={idx} position={[midX, -curtainHeight / 2, midZ]} rotation={[0, -angle, 0]}>
            <mesh>
              <planeGeometry args={[distance, curtainHeight]} />
              <meshStandardMaterial
                color="#5FB8D6"
                side={THREE.DoubleSide}
                transparent
                opacity={transitionProgress * 0.22}
                wireframe
              />
            </mesh>
            <mesh position={[0, curtainHeight / 2, 0]}>
              <planeGeometry args={[distance, 0.08]} />
              <meshBasicMaterial
                color="#35C4B5"
                side={THREE.DoubleSide}
                transparent
                opacity={transitionProgress * 0.7}
              />
            </mesh>
          </group>
        );
      })}

      {/* Regional Slabs */}
      {regionalSlabs.map((slab, idx) => {
        const scale = 0.04 * (verticalExaggeration / 10);
        const topY = slab.start * scale;
        const btmY = slab.end * scale;
        const thickness = Math.max(0.6, btmY - topY);
        const explodeY = -idx * (explodeOffset * 2.5);
        const yCenter = -(topY + thickness / 2) + explodeY;

        return (
          <group key={slab.id || idx} position={[0, yCenter, 0]}>
            <mesh>
              <boxGeometry args={[44, thickness, 44]} />
              <meshStandardMaterial
                color={slab.colorHex}
                transparent
                opacity={transitionProgress * 0.12}
                roughness={0.3}
                metalness={0.2}
                side={THREE.DoubleSide}
                depthWrite={false}
              />
            </mesh>
            <lineSegments>
              <edgesGeometry args={[new THREE.BoxGeometry(44, thickness, 44)]} />
              <lineBasicMaterial
                color={slab.colorHex}
                transparent
                opacity={transitionProgress * 0.3}
              />
            </lineSegments>
          </group>
        );
      })}
    </>
  );
};
