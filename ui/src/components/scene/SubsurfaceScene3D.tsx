import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { OrbitControls, Text, Float } from '@react-three/drei';
import * as THREE from 'three';
import {
  NormalizedSpatialPoint,
  NormalizedStrataInterval,
  NormalizedTransectCurtain,
} from '../../types/schema';

interface Scene3DProps {
  point: NormalizedSpatialPoint;
  allPoints: NormalizedSpatialPoint[];
  regionalStrata: NormalizedStrataInterval[];
  transects: NormalizedTransectCurtain[];
  verticalExaggeration: number;
  explodeOffset: number;
  showTransects: boolean;
  showWaterPlane: boolean;
  onSelectInterval?: (interval: NormalizedStrataInterval) => void;
}

/**
 * Procedural Borehole & Core Sample Column
 */
const BoreholeCore: React.FC<{
  point: NormalizedSpatialPoint;
  verticalExaggeration: number;
  explodeOffset: number;
  onSelectInterval?: (interval: NormalizedStrataInterval) => void;
}> = ({ point, verticalExaggeration, explodeOffset, onSelectInterval }) => {
  const intervals = point.strataIntervals || [];
  const maxDepth = point.totalDepthMeters || 300;

  return (
    <group position={[0, 0, 0]}>
      {/* Surface Head Rig Marker */}
      <mesh position={[0, 0.4, 0]}>
        <cylinderGeometry args={[0.3, 0.4, 0.8, 16]} />
        <meshStandardMaterial color="#E3B34E" metalness={0.8} roughness={0.2} />
      </mesh>

      {/* Surface Pin Light Beam */}
      <mesh position={[0, 4, 0]}>
        <cylinderGeometry args={[0.02, 0.2, 8, 16]} />
        <meshBasicMaterial color="#5FB8D6" transparent opacity={0.4} />
      </mesh>

      {/* Extruded Strata Segments */}
      {intervals.map((interval, idx) => {
        // Normalize depth scale into scene units: 100 meters = 4 units
        const scale = 0.04 * (verticalExaggeration / 10);
        const topY = interval.depthTopMeters * scale;
        const btmY = interval.depthBottomMeters * scale;
        const height = Math.max(0.6, btmY - topY);
        // Apply vertical explode separation along Y
        const explodeY = -idx * (explodeOffset * 2.5);
        const yCenter = -(topY + height / 2) + explodeY;

        const isClay = interval.materialType === 'impermeable_clay';

        return (
          <group key={interval.id || idx} position={[0, yCenter, 0]}>
            <mesh
              onClick={(e) => {
                e.stopPropagation();
                onSelectInterval?.(interval);
              }}
            >
              <cylinderGeometry args={[0.7, 0.7, height, 32]} />
              <meshStandardMaterial
                color={interval.colorHex}
                roughness={isClay ? 0.8 : 0.2}
                metalness={isClay ? 0.1 : 0.6}
                transparent
                opacity={interval.transparency || 0.85}
              />
            </mesh>

            {/* Glowing Ring Collar at Strata Junctions */}
            <mesh position={[0, height / 2, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.72, 0.82, 32]} />
              <meshBasicMaterial color="#5FB8D6" side={THREE.DoubleSide} />
            </mesh>

      {/* In-scene 3D Depth Callout */}
      {/* Positioned outward to avoid colliding with other elements */}
      <group position={[1.8, 0, 0]}>
        <mesh position={[0.8, 0, -0.05]}>
          <planeGeometry args={[3.2, 0.6]} />
          <meshBasicMaterial color="#07090B" transparent opacity={0.7} />
        </mesh>
        <Text
          position={[0, 0, 0]}
          fontSize={0.28}
          color="#ECF2EF"
          anchorX="left"
          anchorY="middle"
        >
          {`${interval.depthTopMeters}-${interval.depthBottomMeters}m: ${interval.name}`}
        </Text>
      </group>
          </group>
        );
      })}

      {/* Water Table Piezometric Indicator */}
      {point.standingWaterLevelMeters && (
        <group position={[0, -(point.standingWaterLevelMeters * 0.04 * (verticalExaggeration / 10)), 0]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.85, 1.6, 32]} />
            <meshBasicMaterial color="#3FD2C8" side={THREE.DoubleSide} transparent opacity={0.8} />
          </mesh>
          <Text
            position={[-1.8, 0, 0]}
            fontSize={0.4}
            color="#3FD2C8"
            anchorX="right"
            outlineWidth={0.04}
            outlineColor="#0C1114"
          >
            {`Water Level: ${point.standingWaterLevelMeters} mbgl`}
          </Text>
        </group>
      )}
    </group>
  );
};

/**
 * Animated Hydrogeologic / Horizon Slab
 */
const GeologicalHorizonSlab: React.FC<{
  stratum: NormalizedStrataInterval;
  verticalExaggeration: number;
  explodeOffset: number;
  index: number;
  width?: number;
  depth?: number;
}> = ({ stratum, verticalExaggeration, explodeOffset, index, width = 16, depth = 16 }) => {
  const scale = 0.04 * (verticalExaggeration / 10);
  const topY = stratum.depthTopMeters * scale;
  const btmY = stratum.depthBottomMeters * scale;
  const thickness = Math.max(0.5, btmY - topY);
  const explodeY = -index * (explodeOffset * 2.5);
  const yCenter = -(topY + thickness / 2) + explodeY;

  return (
    <group position={[0, yCenter, 0]}>
      <mesh receiveShadow>
        <boxGeometry args={[width, thickness, depth]} />
        <meshPhysicalMaterial
          color={stratum.colorHex}
          transparent
          opacity={stratum.materialType === 'impermeable_clay' ? 0.35 : 0.18}
          roughness={0.2}
          metalness={0.2}
          transmission={0.5}
          thickness={1.2}
          depthWrite={false}
        />
      </mesh>

      {/* Wireframe Outline for Architectural Polish */}
      <lineSegments>
        <edgesGeometry args={[new THREE.BoxGeometry(width, thickness, depth)]} />
        <lineBasicMaterial color={stratum.colorHex} transparent opacity={0.6} />
      </lineSegments>
    </group>
  );
};

/**
 * Ground Plane with Topographic Coordinate Grid
 */
const GroundSurface: React.FC<{ size?: number }> = ({ size = 20 }) => {
  return (
    <group position={[0, 0, 0]}>
      {/* Frosted Terrain Surface */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[size, size, 32, 32]} />
        <meshStandardMaterial
          color="#0C1114"
          roughness={0.8}
          metalness={0.2}
          transparent
          opacity={0.85}
        />
      </mesh>

      {/* Precision Engineering Coordinate Grid */}
      <gridHelper
        args={[size, 20, '#35C4B5', '#1C262C']}
        position={[0, 0.02, 0]}
      />
    </group>
  );
};

/**
 * Transect Curtain Wall in 3D
 */
const TransectCurtain: React.FC<{
  transect: NormalizedTransectCurtain;
  verticalExaggeration: number;
}> = ({ transect, verticalExaggeration }) => {
  const meshRef = useRef<THREE.Mesh>(null);

  const depth = (transect.bottomDepthMeters * 0.04 * (verticalExaggeration / 10));

  return (
    <group position={[-5, -depth / 2, -5]} rotation={[0, Math.PI / 4, 0]}>
      <mesh ref={meshRef}>
        <planeGeometry args={[14, depth]} />
        <meshStandardMaterial
          color="#5FB8D6"
          side={THREE.DoubleSide}
          transparent
          opacity={0.25}
          wireframe
        />
      </mesh>
      <group position={[0, depth / 2 + 0.4, 0]}>
        <mesh position={[0, 0, -0.05]}>
          <planeGeometry args={[5.5, 0.6]} />
          <meshBasicMaterial color="#07090B" transparent opacity={0.8} />
        </mesh>
        <Text fontSize={0.3} color="#5FB8D6">
          {transect.name}
        </Text>
      </group>
    </group>
  );
};

export const SubsurfaceScene3D: React.FC<Scene3DProps> = ({
  point,
  regionalStrata,
  transects,
  verticalExaggeration,
  explodeOffset,
  showTransects,
  showWaterPlane,
  onSelectInterval,
}) => {
  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[10, 20, 15]} intensity={1.5} castShadow />
      <pointLight position={[-10, -10, -10]} intensity={0.5} color="#35C4B5" />

      {/* Orbit & Camera Controls */}
      <OrbitControls
        enableDamping
        dampingFactor={0.05}
        maxPolarAngle={Math.PI / 2 + 0.3} // Allow peering slightly upwards from underneath
        minDistance={3}
        maxDistance={45}
      />

      {/* Ground Surface */}
      <GroundSurface size={24} />

      {/* Extruded Drill Site Borehole Core */}
      <BoreholeCore
        point={point}
        verticalExaggeration={verticalExaggeration}
        explodeOffset={explodeOffset}
        onSelectInterval={onSelectInterval}
      />

      {/* Regional Volumetric Geological Slabs */}
      {regionalStrata.map((stratum, idx) => (
        <GeologicalHorizonSlab
          key={stratum.id || idx}
          stratum={stratum}
          index={idx}
          verticalExaggeration={verticalExaggeration}
          explodeOffset={explodeOffset}
        />
      ))}

      {/* Transect Curtains */}
      {showTransects &&
        transects.map((transect) => (
          <TransectCurtain
            key={transect.id}
            transect={transect}
            verticalExaggeration={verticalExaggeration}
          />
        ))}

      {/* Dynamic Water Table Continuous Sheet */}
      {showWaterPlane && point.standingWaterLevelMeters && (
        <mesh
          position={[0, -(point.standingWaterLevelMeters * 0.04 * (verticalExaggeration / 10)), 0]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[18, 18, 16, 16]} />
          <meshStandardMaterial
            color="#3FD2C8"
            transparent
            opacity={0.3}
            roughness={0.1}
            metalness={0.5}
            side={THREE.DoubleSide}
          />
        </mesh>
      )}
    </>
  );
};
