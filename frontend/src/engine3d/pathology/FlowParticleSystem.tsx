import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSceneStore } from '../../store/useSceneStore';

/**
 * Renders 3D arterial/venous blood particles streaming along a Catmull-Rom curve
 * connecting any sequence of anatomical structures (e.g., Heart -> Aorta -> Carotids -> Brain).
 */
export const FlowParticleSystem: React.FC = () => {
  const instancedMeshRef = useRef<THREE.InstancedMesh>(null);
  const { activeFlow, resolveTargetEntry, meshRegistry } = useSceneStore();

  const particleCount = activeFlow?.particle_count ?? 180;
  const flowColor = activeFlow?.color ?? '#ff2a2a';
  const flowSpeed = activeFlow?.speed ?? 0.42;

  const dummy = useMemo(() => new THREE.Object3D(), []);

  // Build smooth 3D anatomical pathway spline from resolved mesh centers
  const flowSpline = useMemo(() => {
    if (!activeFlow || !activeFlow.path_ids || activeFlow.path_ids.length < 2) {
      return null;
    }

    const waypoints: THREE.Vector3[] = [];
    for (const targetId of activeFlow.path_ids) {
      const entry = resolveTargetEntry(targetId);
      if (entry) {
        waypoints.push(entry.center.clone());
      }
    }

    if (waypoints.length < 2) return null;

    // Add slight anatomical arch intermediate points if jumping directly between Heart and Brain
    if (waypoints.length === 2) {
      const mid = new THREE.Vector3().lerpVectors(waypoints[0], waypoints[1], 0.5);
      mid.z += 0.06;
      waypoints.splice(1, 0, mid);
    }

    return new THREE.CatmullRomCurve3(waypoints, false, 'catmullrom', 0.45);
  }, [activeFlow, resolveTargetEntry, meshRegistry]);

  // Generate glowing tube geometry along the vascular path
  const tubeGeometry = useMemo(() => {
    if (!flowSpline) return null;
    return new THREE.TubeGeometry(flowSpline, 64, 0.018, 12, false);
  }, [flowSpline]);

  useFrame(({ clock }) => {
    if (!instancedMeshRef.current || !flowSpline) return;
    const elapsed = clock.getElapsedTime() * flowSpeed;

    for (let i = 0; i < particleCount; i++) {
      const u = (elapsed + i / particleCount) % 1.0;
      const pos = flowSpline.getPointAt(u);
      const tangent = flowSpline.getTangentAt(u);

      // Helical micro-jitter so erythrocytes fill the vessel lumen naturally
      const radialAngle = i * 2.4 + elapsed * 8.0;
      const radialOffset = 0.012 * Math.sin(i);
      pos.x += Math.cos(radialAngle) * radialOffset;
      pos.z += Math.sin(radialAngle) * radialOffset;

      dummy.position.copy(pos);
      dummy.lookAt(pos.clone().add(tangent));
      const pulseScale = 0.85 + 0.35 * Math.sin(u * Math.PI);
      dummy.scale.setScalar(pulseScale);
      dummy.updateMatrix();
      instancedMeshRef.current.setMatrixAt(i, dummy.matrix);
    }
    instancedMeshRef.current.instanceMatrix.needsUpdate = true;
  });

  if (!flowSpline || !tubeGeometry) return null;

  return (
    <group>
      {/* Translucent glowing vascular conduit */}
      <mesh geometry={tubeGeometry}>
        <meshBasicMaterial
          color={flowColor}
          transparent
          opacity={0.26}
          depthWrite={false}
        />
      </mesh>

      {/* 180 instanced oxygenated blood particles */}
      <instancedMesh ref={instancedMeshRef} args={[undefined, undefined, particleCount]}>
        <sphereGeometry args={[0.016, 10, 10]} />
        <meshStandardMaterial
          color={flowColor}
          emissive={flowColor}
          emissiveIntensity={1.6}
          roughness={0.2}
        />
      </instancedMesh>
    </group>
  );
};
