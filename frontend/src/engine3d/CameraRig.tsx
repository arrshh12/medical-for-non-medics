import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useSceneStore } from '../store/useSceneStore';
import type { CameraViewPreset } from '../types/scene.types';

const VIEW_DIRECTION_VECTORS: Record<CameraViewPreset, THREE.Vector3> = {
  anterior: new THREE.Vector3(0, 0.08, 1).normalize(),
  anterior_closeup: new THREE.Vector3(0.12, 0.06, 1).normalize(),
  posterior: new THREE.Vector3(0, 0.08, -1).normalize(),
  superior: new THREE.Vector3(0, 1, 0.25).normalize(),
  inferior: new THREE.Vector3(0, -1, 0.25).normalize(),
  lateral_left: new THREE.Vector3(1, 0.08, 0.25).normalize(),
  lateral_right: new THREE.Vector3(-1, 0.08, 0.25).normalize(),
};

export const CameraRig: React.FC = () => {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const { camera } = useThree();

  const {
    meshRegistry,
    cameraFocusIds,
    cameraViewPreset,
    followFlowSpline,
    activeFlow,
    cameraResetTrigger,
    resolveTargetEntry,
  } = useSceneStore();

  const desiredCameraPos = useRef(new THREE.Vector3(0, 0.2, 4.2));
  const desiredLookAt = useRef(new THREE.Vector3(0, 0.1, 0));
  const isUserInteracting = useRef(false);
  const splineStartTime = useRef<number | null>(null);

  // Build 3D Catmull-Rom curve whenever the AI activates `followFlowSpline`
  const activeFlowCurve = useMemo(() => {
    if (!followFlowSpline || !activeFlow || activeFlow.path_ids.length < 2) return null;
    const points: THREE.Vector3[] = [];
    for (const id of activeFlow.path_ids) {
      const entry = resolveTargetEntry(id);
      if (entry) {
        points.push(entry.center.clone());
      }
    }
    if (points.length < 2) return null;
    return new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.45);
  }, [followFlowSpline, activeFlow, resolveTargetEntry, meshRegistry]);

  // Reset camera when user clicks "Reset Scene"
  useEffect(() => {
    isUserInteracting.current = false;
    splineStartTime.current = null;
    desiredCameraPos.current.set(0, 0.2, 4.2);
    desiredLookAt.current.set(0, 0.1, 0);
  }, [cameraResetTrigger]);

  // Recalculate target framing box whenever AI or user changes `cameraFocusIds`
  useEffect(() => {
    isUserInteracting.current = false;
    if (followFlowSpline && activeFlowCurve) {
      splineStartTime.current = performance.now();
      return;
    }
    splineStartTime.current = null;

    if (!cameraFocusIds.length) return;

    const combinedBox = new THREE.Box3();
    let foundAny = false;
    for (const id of cameraFocusIds) {
      const entry = resolveTargetEntry(id);
      if (entry) {
        combinedBox.union(entry.boundingBox);
        foundAny = true;
      }
    }
    if (!foundAny) return;

    const sphere = new THREE.Sphere();
    combinedBox.getBoundingSphere(sphere);

    const viewDir = VIEW_DIRECTION_VECTORS[cameraViewPreset] ?? VIEW_DIRECTION_VECTORS.anterior_closeup;
    const distanceMultiplier = cameraViewPreset === 'anterior_closeup' ? 2.35 : 3.1;
    const distance = Math.max(sphere.radius * distanceMultiplier, 0.65);

    desiredLookAt.current.copy(sphere.center);
    desiredCameraPos.current.copy(sphere.center).addScaledVector(viewDir, distance);
  }, [cameraFocusIds, cameraViewPreset, followFlowSpline, activeFlowCurve, resolveTargetEntry]);

  useFrame((_, delta) => {
    if (!controlsRef.current || isUserInteracting.current) return;

    // Mode B: Real-time camera tracking along the 3D blood flow spline (e.g., Heart -> Neck -> Brain)
    if (followFlowSpline && activeFlowCurve && splineStartTime.current !== null) {
      const elapsedSec = (performance.now() - splineStartTime.current) / 1000;
      const cycleProgress = Math.min((elapsedSec % 4.5) / 4.5, 1.0);
      const pointOnVessel = activeFlowCurve.getPointAt(cycleProgress);
      const lookAheadPoint = activeFlowCurve.getPointAt(Math.min(cycleProgress + 0.12, 1.0));

      desiredLookAt.current.lerp(lookAheadPoint, 0.1);
      const cameraOffset = new THREE.Vector3(0.22, 0.12, 0.95);
      desiredCameraPos.current.copy(pointOnVessel).add(cameraOffset);
    }

    const dampFactor = 1 - Math.exp(-4.5 * delta);
    camera.position.lerp(desiredCameraPos.current, dampFactor);
    controlsRef.current.target.lerp(desiredLookAt.current, dampFactor);
    controlsRef.current.update();
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.07}
      minDistance={0.35}
      maxDistance={8.0}
      onStart={() => {
        isUserInteracting.current = true;
      }}
    />
  );
};
