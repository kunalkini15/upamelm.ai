import React, { useRef } from 'react';
import { OrbitControls, Text } from '@react-three/drei';
import * as THREE from 'three';
import {
  RenderablePointFeature,
  RenderableInterval,
  RenderableRegionalSlab,
} from '../../types/scientific';

interface SubsurfaceSceneProps {
  feature: RenderablePointFeature;
  regionalSlabs: RenderableRegionalSlab[];
  verticalExaggeration: number;
  explodeOffset: number;
  showRegionalSlabs: boolean;
  showWaterPlane: boolean;
  onSelectInterval?: (interval: RenderableInterval) => void;
}

/**
 * Procedural Borehole Lithology Column
 */
const ExtrudedBoreholeColumn: React.FC<{
  feature: RenderablePointFeature;
  verticalExaggeration: number;
  explodeOffset: number;
  onSelectInterval?: (interval: RenderableInterval) => void;
}> = ({ feature, verticalExaggeration, explodeOffset, onSelectInterval }) => {
  const intervals = feature.intervals || [];

  return (
    <group position={[0, 0, 0]}>
      {/* Surface Wellhead Rig Marker */}
      <mesh position={[0, 0.4, 0]}>
        <cylinderGeometry args={[0.3, 0.45, 0.8, 16]} />
        <meshStandardMaterial color="#fbbf24" metalness={0.8} roughness={0.2} />
      </mesh>

      {/* Surface Pin Light Beam */}
      <mesh position={[0, 4, 0]}>
        <cylinderGeometry args={[0.02, 0.25, 8, 16]} />
        <meshBasicMaterial color="#38bdf8" transparent opacity={0.35} />
      </mesh>

      {/* Extruded Strata Segments */}
      {intervals.map((interval, idx) => {
        const scale = 0.04 * (verticalExaggeration / 10);
        const topY = interval.start * scale;
        const btmY = interval.end * scale;
        const height = Math.max(0.6, btmY - topY);
        const explodeY = -idx * (explodeOffset * 2.5);
        const yCenter = -(topY + height / 2) + explodeY;

        const isClay = (interval.material || interval.name || '').toLowerCase().includes('clay');

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
                roughness={isClay ? 0.8 : 0.25}
                metalness={isClay ? 0.1 : 0.5}
                transparent
                opacity={interval.transparency || 0.85}
              />
            </mesh>

            {/* Glowing Ring Collar at Strata Junctions */}
            <mesh position={[0, height / 2, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.72, 0.84, 32]} />
              <meshBasicMaterial color="#38bdf8" side={THREE.DoubleSide} />
            </mesh>

            {/* Depth HUD Banner in 3D Space */}
            <group position={[1.8, 0, 0]}>
              <mesh position={[0.9, 0, -0.05]}>
                <planeGeometry args={[3.4, 0.6]} />
                <meshBasicMaterial color="#020617" transparent opacity={0.75} />
              </mesh>
              <Text
                position={[0, 0, 0]}
                fontSize={0.28}
                color="#f8fafc"
                anchorX="left"
                anchorY="middle"
              >
                {`${interval.start}-${interval.end}m: ${interval.name}`}
              </Text>
            </group>
          </group>
        );
      })}

      {/* Standing Water Level Piezometric Indicator */}
      {feature.waterLevelMeters && (
        <group position={[0, -(feature.waterLevelMeters * 0.04 * (verticalExaggeration / 10)), 0]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.85, 1.8, 32]} />
            <meshBasicMaterial color="#00f0ff" side={THREE.DoubleSide} transparent opacity={0.8} />
          </mesh>
          <group position={[-2, 0, 0]}>
            <mesh position={[-1.2, 0, -0.05]}>
              <planeGeometry args={[3.2, 0.6]} />
              <meshBasicMaterial color="#020617" transparent opacity={0.8} />
            </mesh>
            <Text position={[0, 0, 0]} fontSize={0.28} color="#00f0ff" anchorX="right">
              {`Water Table: ${feature.waterLevelMeters} mbgl`}
            </Text>
          </group>
        </group>
      )}
    </group>
  );
};

/**
 * Regional Geological Formation Slabs
 */
const RegionalSlabMesh: React.FC<{
  slab: RenderableRegionalSlab;
  verticalExaggeration: number;
  explodeOffset: number;
  index: number;
  width?: number;
  depth?: number;
}> = ({ slab, verticalExaggeration, explodeOffset, index, width = 20, depth = 20 }) => {
  const scale = 0.04 * (verticalExaggeration / 10);
  const topY = slab.start * scale;
  const btmY = slab.end * scale;
  const thickness = Math.max(0.6, btmY - topY);
  const explodeY = -index * (explodeOffset * 2.5);
  const yCenter = -(topY + thickness / 2) + explodeY;

  return (
    <group position={[0, yCenter, 0]}>
      <mesh receiveShadow>
        <boxGeometry args={[width, thickness, depth]} />
        <meshStandardMaterial
          color={slab.colorHex}
          transparent
          opacity={0.35}
          roughness={0.2}
          metalness={0.4}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* Crisp Wireframe Outlines */}
      <lineSegments>
        <edgesGeometry args={[new THREE.BoxGeometry(width, thickness, depth)]} />
        <lineBasicMaterial color="#38bdf8" transparent opacity={0.6} />
      </lineSegments>

      {/* 3D Formation Name Tag */}
      <group position={[width / 2 + 0.5, 0, depth / 2]}>
        <Text fontSize={0.32} color="#38bdf8" anchorX="left" anchorY="middle">
          {slab.name}
        </Text>
      </group>
    </group>
  );
};

export const SubsurfaceScene: React.FC<SubsurfaceSceneProps> = ({
  feature,
  regionalSlabs,
  verticalExaggeration,
  explodeOffset,
  showRegionalSlabs,
  showWaterPlane,
  onSelectInterval,
}) => {
  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[12, 24, 18]} intensity={1.5} castShadow />
      <pointLight position={[-10, -10, -10]} intensity={0.5} color="#06b6d4" />

      {/* Orbit Controls */}
      <OrbitControls
        enableDamping
        dampingFactor={0.05}
        maxPolarAngle={Math.PI / 2 + 0.3}
        minDistance={3}
        maxDistance={45}
      />

      {/* Surface Terrain Plane */}
      <group position={[0, 0, 0]}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[26, 26, 32, 32]} />
          <meshStandardMaterial
            color="#0f172a"
            roughness={0.8}
            metalness={0.2}
            transparent
            opacity={0.85}
          />
        </mesh>
        <gridHelper args={[26, 26, '#06b6d4', '#1e293b']} position={[0, 0.02, 0]} />
      </group>

      {/* Drill Site Extruded Core Column */}
      <ExtrudedBoreholeColumn
        feature={feature}
        verticalExaggeration={verticalExaggeration}
        explodeOffset={explodeOffset}
        onSelectInterval={onSelectInterval}
      />

      {/* Regional Formations Slabs */}
      {showRegionalSlabs &&
        regionalSlabs.map((slab, idx) => (
          <RegionalSlabMesh
            key={slab.id || idx}
            slab={slab}
            index={idx}
            verticalExaggeration={verticalExaggeration}
            explodeOffset={explodeOffset}
          />
        ))}

      {/* Continuous Dynamic Water Sheet */}
      {showWaterPlane && feature.waterLevelMeters && (
        <mesh
          position={[0, -(feature.waterLevelMeters * 0.04 * (verticalExaggeration / 10)), 0]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <planeGeometry args={[20, 20, 16, 16]} />
          <meshStandardMaterial
            color="#00f0ff"
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
