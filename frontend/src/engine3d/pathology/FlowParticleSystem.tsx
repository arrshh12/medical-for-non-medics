import React, { useRef, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useSceneStore } from '../../store/useSceneStore';
import { AnatomicalStructureMeta, FlowType } from '../../types/scene.types';

// Flow color standards matching medical and physiological taxonomy
export const FLOW_COLORS: Record<FlowType | string, string> = {
  oxygenated: '#ef4444',    // Bright arterial crimson red
  deoxygenated: '#3b82f6',  // Systemic venous blue
  lymphatic: '#10b981',     // Lymph green
  neural: '#f59e0b'         // Neural electric gold
};

// Scratch objects pre-allocated outside frame loop (Rule 3: WebGL Zero-Allocation Frame Loop)
const scratchPos = new THREE.Vector3();
const scratchTan = new THREE.Vector3();
const scratchNormal = new THREE.Vector3();
const scratchBinormal = new THREE.Vector3();
const scratchScale = new THREE.Vector3();
const scratchQuat = new THREE.Quaternion();
const scratchMat4 = new THREE.Matrix4();
const unitY = new THREE.Vector3(0, 1, 0);

const NUM_PARTICLES = 75;

/**
 * Builds a smooth 3D CatmullRom spline curve passing through the centroids
 * of the ordered anatomical structures.
 */
export function buildFlowSpline(
  pathIds: string[],
  getStructureMeta: (id: string) => AnatomicalStructureMeta | null
): THREE.CatmullRomCurve3 | null {
  if (!pathIds || pathIds.length === 0) return null;

  // Single structure case (e.g. coronary artery or aorta)
  if (pathIds.length === 1) {
    const meta = getStructureMeta(pathIds[0]);
    if (!meta) return null;

    // Coronary artery curved path
    if (meta.fma_id.includes('7101') || meta.fma_id.includes('7100') || meta.fma_id.includes('7105')) {
      const bezier = new THREE.CubicBezierCurve3(
        new THREE.Vector3(meta.bbox_min[0], meta.bbox_max[1], meta.bbox_min[2]),
        new THREE.Vector3(meta.centroid[0] * 1.1, meta.centroid[1] + 0.1, meta.centroid[2]),
        new THREE.Vector3(meta.centroid[0], meta.centroid[1] - 0.1, meta.centroid[2] * 1.1),
        new THREE.Vector3(meta.bbox_max[0], meta.bbox_min[1], meta.bbox_max[2])
      );
      return new THREE.CatmullRomCurve3(bezier.getPoints(12), false, 'centripetal', 0.5);
    }

    // Aorta curved arch
    if (meta.fma_id === 'FMA_3734' || meta.fma_id === 'FMA_3735') {
      return new THREE.CatmullRomCurve3(
        [
          new THREE.Vector3(-0.05, 0.35, 0.15),
          new THREE.Vector3(-0.05, 0.9, 0.12),
          new THREE.Vector3(-0.1, 1.35, -0.05),
          new THREE.Vector3(-0.25, 1.15, -0.2),
          new THREE.Vector3(-0.25, 0.5, -0.25)
        ],
        false,
        'centripetal',
        0.5
      );
    }

    // Generic fallback: sample from bbox_min to centroid to bbox_max
    return new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(meta.bbox_min[0], meta.bbox_max[1], meta.bbox_min[2]),
        new THREE.Vector3(meta.centroid[0], meta.centroid[1], meta.centroid[2]),
        new THREE.Vector3(meta.bbox_max[0], meta.bbox_min[1], meta.bbox_max[2])
      ],
      false,
      'centripetal',
      0.5
    );
  }

  // Multi-structure sequential path (e.g. RA -> Tricuspid -> RV -> Pulm Trunk)
  const points: THREE.Vector3[] = [];
  for (const id of pathIds) {
    const meta = getStructureMeta(id);
    if (meta) {
      points.push(new THREE.Vector3(meta.centroid[0], meta.centroid[1], meta.centroid[2]));
    }
  }

  if (points.length < 2) return null;

  return new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.5);
}

interface SinglePathProps {
  pathIds: string[];
  speed?: number;
  flowType?: FlowType | string;
  blocked?: boolean;
}

const SinglePathFlow: React.FC<SinglePathProps> = ({
  pathIds,
  speed = 1.0,
  flowType = 'oxygenated',
  blocked = false
}) => {
  const { getStructureMeta } = useSceneStore();
  const instancedMeshRef = useRef<THREE.InstancedMesh>(null);
  const lineGeometryRef = useRef<THREE.BufferGeometry>(null);

  // Reconstruct spline curve whenever path changes
  const spline = useMemo(() => {
    return buildFlowSpline(pathIds, getStructureMeta);
  }, [pathIds, getStructureMeta]);

  // Compute guide line vertices
  const guideLinePoints = useMemo(() => {
    if (!spline) return [];
    return spline.getPoints(50);
  }, [spline]);

  const hexColor = FLOW_COLORS[flowType] || FLOW_COLORS.oxygenated;

  // Particle arrow/corpuscle geometry: elongated streamlined cone
  const particleGeometry = useMemo(() => {
    // Cone pointing up along +Y
    const geom = new THREE.ConeGeometry(0.018, 0.055, 8);
    return geom;
  }, []);

  // Update guide line geometry
  useEffect(() => {
    if (lineGeometryRef.current && guideLinePoints.length > 0) {
      lineGeometryRef.current.setFromPoints(guideLinePoints);
    }
  }, [guideLinePoints]);

  // Particle offsets array to distribute uniformly along curve
  const particleOffsets = useMemo(() => {
    const offsets = new Float32Array(NUM_PARTICLES);
    for (let i = 0; i < NUM_PARTICLES; i++) {
      offsets[i] = i / NUM_PARTICLES;
    }
    return offsets;
  }, []);

  // Animate GPU instanced corpuscles along spline with zero frame memory allocations
  useFrame(({ clock }) => {
    if (!spline || !instancedMeshRef.current) return;

    const elapsed = clock.getElapsedTime();
    const effectiveSpeed = Math.max(speed, 0.1) * 0.22;
    const blockageProgress = 0.52; // Obstruction locus along path

    for (let i = 0; i < NUM_PARTICLES; i++) {
      let rawProgress = (elapsed * effectiveSpeed + particleOffsets[i]) % 1.0;
      let scale = 1.0;

      if (blocked) {
        // If flow is blocked, simulate upstream congestion, turbulent swirling stasis,
        // and complete absence of blood flow downstream
        if (rawProgress >= blockageProgress) {
          // Particles downstream of blockage: suppressed/ischemic empty lumen
          scale = 0.0;
          scratchPos.set(0, 0, 0);
          scratchQuat.identity();
          scratchScale.set(0, 0, 0);
          scratchMat4.compose(scratchPos, scratchQuat, scratchScale);
          instancedMeshRef.current.setMatrixAt(i, scratchMat4);
          continue;
        } else {
          // Approaching stenosis: flow decelerates sharply and pools
          const distToBlock = blockageProgress - rawProgress;
          if (distToBlock < 0.18) {
            // Deceleration + turbulent swirling eddy
            const stasisDamp = Math.max(distToBlock / 0.18, 0.15);
            rawProgress = blockageProgress - distToBlock * stasisDamp;

            // Sample curve position and normal
            spline.getPointAt(rawProgress, scratchPos);
            spline.getTangentAt(rawProgress, scratchTan).normalize();

            // Compute perpendicular turbulence vector
            scratchNormal.crossVectors(scratchTan, unitY).normalize();
            if (scratchNormal.lengthSq() < 0.001) {
              scratchNormal.set(1, 0, 0);
            }
            scratchBinormal.crossVectors(scratchTan, scratchNormal).normalize();

            const eddyFreq = elapsed * 14.0 + i;
            const eddyRadius = 0.016 * (1.0 - distToBlock / 0.18);
            scratchPos.addScaledVector(scratchNormal, Math.sin(eddyFreq) * eddyRadius);
            scratchPos.addScaledVector(scratchBinormal, Math.cos(eddyFreq) * eddyRadius);

            // Slightly squashed/bunched corpuscles
            scale = 1.25;
            scratchQuat.setFromUnitVectors(unitY, scratchTan);
            scratchScale.set(scale, scale * 0.8, scale);
            scratchMat4.compose(scratchPos, scratchQuat, scratchScale);
            instancedMeshRef.current.setMatrixAt(i, scratchMat4);
            continue;
          }
        }
      }

      // Normal laminar forward flow
      spline.getPointAt(rawProgress, scratchPos);
      spline.getTangentAt(rawProgress, scratchTan).normalize();

      // Orient cone towards tangent direction
      scratchQuat.setFromUnitVectors(unitY, scratchTan);
      scratchScale.set(scale, scale, scale);
      scratchMat4.compose(scratchPos, scratchQuat, scratchScale);
      instancedMeshRef.current.setMatrixAt(i, scratchMat4);
    }

    instancedMeshRef.current.instanceMatrix.needsUpdate = true;
  });

  if (!spline) return null;

  return (
    <group name={`flow_path_${pathIds.join('_')}`}>
      {/* Subtle Glowing Conduit Guide Line */}
      <line>
        <bufferGeometry ref={lineGeometryRef} />
        <lineBasicMaterial
          color={hexColor}
          transparent
          opacity={blocked ? 0.25 : 0.45}
          linewidth={2}
        />
      </line>

      {/* GPU Instanced Flow Corpuscles / Directional Arrows */}
      <instancedMesh
        ref={instancedMeshRef}
        args={[particleGeometry, undefined, NUM_PARTICLES]}
      >
        <meshStandardMaterial
          color={hexColor}
          emissive={hexColor}
          emissiveIntensity={blocked ? 0.6 : 0.85}
          roughness={0.25}
          metalness={0.1}
        />
      </instancedMesh>
    </group>
  );
};

export interface FlowParticleSystemProps {
  pathIds?: string[];
  speed?: number;
  flowType?: FlowType | string;
  blocked?: boolean;
}

/**
 * React Three Fiber component rendering GPU-instanced directional corpuscles along
 * anatomical curves with physiological speed, color classification, and pathological
 * blockage turbulence. Reads active flow paths from useSceneStore if no explicit props passed.
 */
export const FlowParticleSystem: React.FC<FlowParticleSystemProps> = ({
  pathIds,
  speed,
  flowType,
  blocked
}) => {
  const { activeFlowPaths } = useSceneStore();

  // If explicit pathIds prop is passed directly, render that single flow
  if (pathIds && pathIds.length > 0) {
    return (
      <SinglePathFlow
        pathIds={pathIds}
        speed={speed ?? 1.0}
        flowType={flowType ?? 'oxygenated'}
        blocked={blocked ?? false}
      />
    );
  }

  // Otherwise, render all active flow paths configured in useSceneStore
  if (!activeFlowPaths || activeFlowPaths.length === 0) {
    return null;
  }

  return (
    <group name="flow_particle_system_root">
      {activeFlowPaths.map((pathItem, idx) => {
        // Accommodate both camelCase pathIds and snake_case path_ids
        const resolvedIds = pathItem.pathIds || (pathItem as any).path_ids || [];
        if (resolvedIds.length === 0) return null;

        return (
          <SinglePathFlow
            key={`flow-path-${idx}-${resolvedIds.join('-')}`}
            pathIds={resolvedIds}
            speed={pathItem.speed ?? 1.0}
            flowType={pathItem.flowType ?? 'oxygenated'}
            blocked={pathItem.blocked ?? false}
          />
        );
      })}
    </group>
  );
};
