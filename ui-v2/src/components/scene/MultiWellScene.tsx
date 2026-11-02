import React, { useRef, useMemo } from 'react';
import { OrbitControls, Billboard, Text } from '@react-three/drei';
import * as THREE from 'three';
import {
  RenderablePointFeature,
  RenderableInterval,
  RenderableRegionalSlab,
} from '../../types/scientific';

interface MultiWellSceneProps {
  features: RenderablePointFeature[];
  selectedFeature: RenderablePointFeature | null;
  onSelectFeature: (f: RenderablePointFeature) => void;
  regionalSlabs: RenderableRegionalSlab[];
  bounds: { minLng: number; maxLng: number; minLat: number; maxLat: number; center: [number, number] };
  verticalExaggeration: number;
  explodeOffset: number;
  showTransectCurtains: boolean;
  showWaterPlane: boolean;
  showRegionalSlabs: boolean;
  onSelectInterval?: (interval: RenderableInterval) => void;
}

/**
 * Normalizes Lng/Lat coordinates to 3D scene units centered at (0, 0)
 */
function geoToScene(
  lng: number,
  lat: number,
  center: [number, number],
  bounds: { minLng: number; maxLng: number; minLat: number; maxLat: number }
): [number, number] {
  const spanLng = Math.max(0.01, bounds.maxLng - bounds.minLng);
  const spanLat = Math.max(0.01, bounds.maxLat - bounds.minLat);
  const sceneScale = 36; // Scale of the district in Three.js units

  const x = ((lng - center[0]) / spanLng) * sceneScale;
  const z = -((lat - center[1]) / spanLat) * sceneScale; // Invert latitude for 3D Z-axis
  return [x, z];
}

/**
 * Individual 3D Well Bore with Strata and Billboarded Label
 */
const BoreholeStationMesh: React.FC<{
  feature: RenderablePointFeature;
  isSelected: boolean;
  onSelect: () => void;
  position: [number, number, number];
  verticalExaggeration: number;
  explodeOffset: number;
  onSelectInterval?: (interval: RenderableInterval) => void;
}> = ({
  feature,
  isSelected,
  onSelect,
  position,
  verticalExaggeration,
  explodeOffset,
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
          color={isSelected ? '#fbbf24' : '#06b6d4'}
          emissive={isSelected ? '#f59e0b' : '#0891b2'}
          emissiveIntensity={isSelected ? 0.8 : 0.2}
          roughness={0.2}
          metalness={0.8}
        />
      </mesh>

      {/* Vertical Laser Beam to Sky for Easy Discovery */}
      <mesh position={[0, 3, 0]}>
        <cylinderGeometry args={[0.02, 0.08, 6, 8]} />
        <meshBasicMaterial
          color={isSelected ? '#fbbf24' : '#38bdf8'}
          transparent
          opacity={isSelected ? 0.7 : 0.25}
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
                opacity={iv.transparency || 0.85}
              />
            </mesh>
          </group>
        );
      })}

      {/* Fallback solid casing if no interval data exists */}
      {intervals.length === 0 && (
        <mesh position={[0, -totalHeight / 2, 0]}>
          <cylinderGeometry args={[0.25, 0.25, totalHeight, 16]} />
          <meshStandardMaterial
            color="#334155"
            metalness={0.6}
            roughness={0.3}
            transparent
            opacity={0.6}
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
          <meshBasicMaterial color="#00f0ff" side={THREE.DoubleSide} transparent opacity={0.85} />
        </mesh>
      )}

      {/* CAMERA-FACING BILLBOARD LABEL (Always readable from every angle!) */}
      <Billboard position={[0, 1.4, 0]} follow lockX={false} lockY={false} lockZ={false}>
        <group onClick={(e) => { e.stopPropagation(); onSelect(); }}>
          <mesh position={[0, 0, -0.02]}>
            <planeGeometry args={[feature.name.length * 0.18 + 0.6, 0.45]} />
            <meshBasicMaterial
              color={isSelected ? '#0f172a' : '#020617'}
              transparent
              opacity={0.85}
            />
          </mesh>
          <Text
            fontSize={0.24}
            color={isSelected ? '#fbbf24' : '#f8fafc'}
            anchorX="center"
            anchorY="middle"
          >
            {feature.name}
          </Text>
        </group>
      </Billboard>
    </group>
  );
};

/**
 * Transect Curtain Ribbons connecting neighboring boreholes
 */
const TransectCurtainRibbon: React.FC<{
  featureA: RenderablePointFeature;
  featureB: RenderablePointFeature;
  posA: [number, number];
  posB: [number, number];
  verticalExaggeration: number;
}> = ({ featureA, featureB, posA, posB, verticalExaggeration }) => {
  const depthA = featureA.totalDepthMeters || 80;
  const depthB = featureB.totalDepthMeters || 80;
  const avgDepth = (depthA + depthB) / 2;
  const scale = 0.04 * (verticalExaggeration / 10);
  const curtainHeight = avgDepth * scale;

  // Midpoint & rotation
  const midX = (posA[0] + posB[0]) / 2;
  const midZ = (posA[1] + posB[1]) / 2;
  const dx = posB[0] - posA[0];
  const dz = posB[1] - posA[1];
  const distance = Math.sqrt(dx * dx + dz * dz);
  const angle = Math.atan2(dz, dx);

  return (
    <group position={[midX, -curtainHeight / 2, midZ]} rotation={[0, -angle, 0]}>
      {/* Translucent Stratigraphic Fence */}
      <mesh>
        <planeGeometry args={[distance, curtainHeight]} />
        <meshStandardMaterial
          color="#38bdf8"
          side={THREE.DoubleSide}
          transparent
          opacity={0.18}
          wireframe
        />
      </mesh>

      {/* Top Surface Baseline Ribbon */}
      <mesh position={[0, curtainHeight / 2, 0]}>
        <planeGeometry args={[distance, 0.08]} />
        <meshBasicMaterial color="#06b6d4" side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
};

export const MultiWellScene: React.FC<MultiWellSceneProps> = ({
  features,
  selectedFeature,
  onSelectFeature,
  regionalSlabs,
  bounds,
  verticalExaggeration,
  explodeOffset,
  showTransectCurtains,
  showWaterPlane,
  showRegionalSlabs,
  onSelectInterval,
}) => {
  // Pre-calculate positions for all features
  const featurePositions = useMemo(() => {
    return features.map((f) => {
      const [x, z] = geoToScene(f.coordinates[0], f.coordinates[1], bounds.center, bounds);
      return { feature: f, pos: [x, 0, z] as [number, number, number], x2d: x, z2d: z };
    });
  }, [features, bounds]);

  // Generate nearest-neighbor transect links to interconnect the points
  const transectLinks = useMemo(() => {
    if (!showTransectCurtains || featurePositions.length < 2) return [];
    const links: Array<{ fA: RenderablePointFeature; fB: RenderablePointFeature; posA: [number, number]; posB: [number, number] }> = [];

    // Connect stations within reasonable distance to form fence corridors
    for (let i = 0; i < featurePositions.length; i++) {
      for (let j = i + 1; j < featurePositions.length; j++) {
        const p1 = featurePositions[i];
        const p2 = featurePositions[j];
        const dist = Math.hypot(p1.x2d - p2.x2d, p1.z2d - p2.z2d);
        // Link neighbors (between 3 and 10 units apart)
        if (dist > 2.5 && dist < 8.5) {
          links.push({
            fA: p1.feature,
            fB: p2.feature,
            posA: [p1.x2d, p1.z2d],
            posB: [p2.x2d, p2.z2d],
          });
        }
      }
    }
    return links.slice(0, 24); // Cap to 24 clean fence panels
  }, [featurePositions, showTransectCurtains]);

  return (
    <>
      <ambientLight intensity={0.8} />
      <directionalLight position={[25, 40, 30]} intensity={1.6} castShadow />
      <pointLight position={[-20, -15, -20]} intensity={0.6} color="#06b6d4" />

      {/* Orbit Controls with generous bounds for district exploration */}
      <OrbitControls
        enableDamping
        dampingFactor={0.06}
        maxPolarAngle={Math.PI / 2 + 0.35}
        minDistance={4}
        maxDistance={65}
      />

      {/* Topographic Surface Ground Grid across the district */}
      <group position={[0, 0, 0]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[46, 46, 32, 32]} />
          <meshStandardMaterial
            color="#090d16"
            roughness={0.9}
            metalness={0.1}
            transparent
            opacity={0.8}
          />
        </mesh>
        <gridHelper args={[46, 46, '#06b6d4', '#1e293b']} position={[0, 0.02, 0]} />
      </group>

      {/* All 33 Geocoded Boreholes / Stations Rendered in True Relative 3D Space */}
      {featurePositions.map(({ feature, pos }) => (
        <BoreholeStationMesh
          key={feature.id}
          feature={feature}
          isSelected={selectedFeature?.id === feature.id}
          onSelect={() => onSelectFeature(feature)}
          position={pos}
          verticalExaggeration={verticalExaggeration}
          explodeOffset={explodeOffset}
          onSelectInterval={onSelectInterval}
        />
      ))}

      {/* Subsurface Transect Fence Curtains Interconnecting Stations */}
      {showTransectCurtains &&
        transectLinks.map((link, idx) => (
          <TransectCurtainRibbon
            key={idx}
            featureA={link.fA}
            featureB={link.fB}
            posA={link.posA}
            posB={link.posB}
            verticalExaggeration={verticalExaggeration}
          />
        ))}

      {/* Regional Formations Slabs across District Footprint */}
      {showRegionalSlabs &&
        regionalSlabs.map((slab, idx) => {
          const scale = 0.04 * (verticalExaggeration / 10);
          const topY = slab.start * scale;
          const btmY = slab.end * scale;
          const thickness = Math.max(0.6, btmY - topY);
          const explodeY = -idx * (explodeOffset * 2.5);
          const yCenter = -(topY + thickness / 2) + explodeY;

          return (
            <group key={slab.id || idx} position={[0, yCenter, 0]}>
              <mesh>
                <boxGeometry args={[42, thickness, 42]} />
                <meshStandardMaterial
                  color={slab.colorHex}
                  transparent
                  opacity={0.12}
                  roughness={0.3}
                  metalness={0.2}
                  side={THREE.DoubleSide}
                  depthWrite={false}
                />
              </mesh>
              <lineSegments>
                <edgesGeometry args={[new THREE.BoxGeometry(42, thickness, 42)]} />
                <lineBasicMaterial color={slab.colorHex} transparent opacity={0.3} />
              </lineSegments>
            </group>
          );
        })}
    </>
  );
};
