import React, { useEffect, useRef } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSceneStore } from '../store/useSceneStore';
import { CameraPreset } from '../types/scene.types';
import { occlusionManager } from './OcclusionManager';

// Camera preset direction unit vectors in patient anatomical coordinate space
export const CAMERA_PRESET_DIRECTIONS: Record<CameraPreset, [number, number, number]> = {
  anterior: [0, 0, 1],
  posterior: [0, 0, -1],
  left_lateral: [-1, 0, 0],
  right_lateral: [1, 0, 0],
  superior: [0, 0.98, 0.18],
  inferior: [0, -0.98, 0.18],
  anterior_oblique: [0.45, 0.35, 0.82],
  superior_oblique: [0.3, 0.7, 0.64],
};

// Smooth cubic ease-in-out curve for cinematic camera transitions
function cubicEaseInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Scratch math objects pre-allocated outside useFrame loop to guarantee ZERO memory allocations
const _scratchVec1 = new THREE.Vector3();
const _scratchVec2 = new THREE.Vector3();
const _scratchBox = new THREE.Box3();
const _scratchSphere = new THREE.Sphere();
const _startPos = new THREE.Vector3();
const _destPos = new THREE.Vector3();
const _startTarget = new THREE.Vector3();
const _destTarget = new THREE.Vector3();
const _startQuat = new THREE.Quaternion();
const _destQuat = new THREE.Quaternion();
const _lookMatrix = new THREE.Matrix4();
const _upVec = new THREE.Vector3(0, 1, 0);

export const CameraRig: React.FC = () => {
  const { camera, controls } = useThree();

  const isTransitioningCamera = useSceneStore((state) => state.isTransitioningCamera);
  const focusedFmaIds = useSceneStore((state) => state.focusedFmaIds);
  const cameraPreset = useSceneStore((state) => state.cameraPreset);
  const cameraTargetPosition = useSceneStore((state) => state.cameraTargetPosition);
  const cameraLookAtTarget = useSceneStore((state) => state.cameraLookAtTarget);
  const cameraTransitionDuration = useSceneStore((state) => state.cameraTransitionDuration);
  const getStructureMeta = useSceneStore((state) => state.getStructureMeta);
  const meshRegistry = useSceneStore((state) => state.meshRegistry);

  const isAnimatingRef = useRef(false);
  const elapsedRef = useRef(0);
  const durationRef = useRef(0.9);

  // Inform OcclusionManager of camera reference
  useEffect(() => {
    if (camera) {
      occlusionManager.setCamera(camera);
    }
  }, [camera]);

  // Listen to user manual orbit controls start to gracefully yield control
  useEffect(() => {
    if (!controls) return;
    const ctrl = controls as any;
    const onControlStart = () => {
      if (isAnimatingRef.current) {
        isAnimatingRef.current = false;
        useSceneStore.setState({ isTransitioningCamera: false });
      }
    };

    if (typeof ctrl.addEventListener === 'function') {
      ctrl.addEventListener('start', onControlStart);
      return () => {
        ctrl.removeEventListener('start', onControlStart);
      };
    }
  }, [controls]);

  // Trigger camera framing calculation whenever a transition is requested
  useEffect(() => {
    if (!isTransitioningCamera) return;

    durationRef.current = Math.max(0.2, cameraTransitionDuration || 0.9);
    elapsedRef.current = 0;

    // Record initial camera position and orientation
    _startPos.copy(camera.position);
    _startQuat.copy(camera.quaternion);

    if (controls && 'target' in (controls as any)) {
      _startTarget.copy((controls as any).target);
    } else {
      _startTarget.set(0, 0, 0);
    }

    // Branch A: Explicit coordinate targets provided (e.g. RESET_SCENE)
    if (cameraTargetPosition && cameraLookAtTarget) {
      _destPos.set(cameraTargetPosition[0], cameraTargetPosition[1], cameraTargetPosition[2]);
      _destTarget.set(cameraLookAtTarget[0], cameraLookAtTarget[1], cameraLookAtTarget[2]);
    }
    // Branch B: Target structures provided (FOCUS_STRUCTURE, FOCUS_AND_ISOLATE)
    else if (focusedFmaIds.length > 0) {
      let sumX = 0;
      let sumY = 0;
      let sumZ = 0;
      let validCount = 0;
      const targetItems: Array<{ center: [number, number, number]; radius: number }> = [];

      for (const fmaId of focusedFmaIds) {
        const meta = getStructureMeta(fmaId);
        if (meta) {
          sumX += meta.centroid[0];
          sumY += meta.centroid[1];
          sumZ += meta.centroid[2];
          validCount++;
          targetItems.push({
            center: meta.centroid,
            radius: Math.max(0.1, meta.bounding_radius),
          });
        } else {
          const mesh = meshRegistry.get(fmaId);
          if (mesh) {
            mesh.getWorldPosition(_scratchVec1);
            sumX += _scratchVec1.x;
            sumY += _scratchVec1.y;
            sumZ += _scratchVec1.z;
            validCount++;

            _scratchBox.setFromObject(mesh);
            _scratchBox.getBoundingSphere(_scratchSphere);
            targetItems.push({
              center: [_scratchSphere.center.x, _scratchSphere.center.y, _scratchSphere.center.z],
              radius: Math.max(0.1, _scratchSphere.radius || 0.4),
            });
          }
        }
      }

      if (validCount > 0) {
        // Combined Centroid: C = (1/k) * sum(c_i)
        const Cx = sumX / validCount;
        const Cy = sumY / validCount;
        const Cz = sumZ / validCount;
        _destTarget.set(Cx, Cy, Cz);

        // Combined Radius: R = max(||c_i - C|| + r_i)
        let maxRadius = 0.15;
        for (const item of targetItems) {
          const dx = item.center[0] - Cx;
          const dy = item.center[1] - Cy;
          const dz = item.center[2] - Cz;
          const distToCenter = Math.sqrt(dx * dx + dy * dy + dz * dz);
          const totalR = distToCenter + item.radius;
          if (totalR > maxRadius) {
            maxRadius = totalR;
          }
        }
        const combinedR = Math.max(maxRadius, 0.25);

        // Vertical field of view in radians
        const persCamera = camera as THREE.PerspectiveCamera;
        const fovRad = persCamera.fov
          ? (persCamera.fov * Math.PI) / 180
          : (45 * Math.PI) / 180;

        // Camera distance formula: d = (1.35 * R) / sin(fov_rad / 2)
        const sinHalfFov = Math.sin(fovRad / 2);
        const cameraDistance = (1.35 * combinedR) / Math.max(0.01, sinHalfFov);
        const clampedDistance = Math.min(15.0, Math.max(0.9, cameraDistance));

        // Normalized preset direction vector
        const presetKey = cameraPreset || 'anterior_oblique';
        const presetVec = CAMERA_PRESET_DIRECTIONS[presetKey] || CAMERA_PRESET_DIRECTIONS['anterior_oblique'];
        _scratchVec2.set(presetVec[0], presetVec[1], presetVec[2]).normalize();

        // P_cam = C + d * u_hat
        _destPos.copy(_destTarget).addScaledVector(_scratchVec2, clampedDistance);
      } else {
        // Default framing fallback
        _destPos.set(0, 0, 4.5);
        _destTarget.set(0, 0, 0);
      }
    } else {
      // Default framing fallback
      _destPos.set(0, 0, 4.5);
      _destTarget.set(0, 0, 0);
    }

    // Compute destination rotation quaternion via lookAt matrix
    _lookMatrix.lookAt(_destPos, _destTarget, _upVec);
    _destQuat.setFromRotationMatrix(_lookMatrix);

    isAnimatingRef.current = true;
  }, [
    isTransitioningCamera,
    focusedFmaIds,
    cameraPreset,
    cameraTargetPosition,
    cameraLookAtTarget,
    cameraTransitionDuration,
    camera,
    controls,
    getStructureMeta,
    meshRegistry,
  ]);

  // Frame loop: Strictly NO Vector3 or Quaternion allocations allowed here!
  useFrame((_, delta) => {
    // 1. Advance material opacity transitions in OcclusionManager
    occlusionManager.update(delta);

    // 2. Camera rig interpolation
    if (!isAnimatingRef.current) return;

    elapsedRef.current += delta;
    const progress = Math.min(1.0, elapsedRef.current / durationRef.current);
    const easedT = cubicEaseInOut(progress);

    // Smoothly interpolate camera position and quaternion
    camera.position.lerpVectors(_startPos, _destPos, easedT);
    camera.quaternion.slerpQuaternions(_startQuat, _destQuat, easedT);

    // Smoothly interpolate OrbitControls target
    if (controls && 'target' in (controls as any)) {
      const ctrl = controls as any;
      ctrl.target.lerpVectors(_startTarget, _destTarget, easedT);
      ctrl.update();
    }

    // Transition completion
    if (progress >= 1.0) {
      isAnimatingRef.current = false;
      camera.position.copy(_destPos);
      camera.quaternion.copy(_destQuat);

      if (controls && 'target' in (controls as any)) {
        const ctrl = controls as any;
        ctrl.target.copy(_destTarget);
        ctrl.update();
      }

      useSceneStore.setState({
        isTransitioningCamera: false,
        cameraTargetPosition: null,
        cameraLookAtTarget: null,
      });

      // Update occlusion detection once camera arrives at target viewpoint
      if (focusedFmaIds.length > 0) {
        occlusionManager.detectAndFadeOccluders(focusedFmaIds, camera);
      }
    }
  });

  return null;
};

export default CameraRig;
