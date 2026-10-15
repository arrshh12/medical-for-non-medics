import * as THREE from 'three';
import { useSceneStore } from '../store/useSceneStore';
import { AnatomicalStructureMeta } from '../types/scene.types';

interface TrackedOccluder {
  mesh: THREE.Mesh;
  originalMaterial: THREE.Material | THREE.Material[];
  ghostMaterial: THREE.MeshStandardMaterial;
  currentOpacity: number;
  targetOpacity: number;
  originalOpacity: number;
  isRestoring: boolean;
}

// Pre-allocated scratch vectors & boxes outside render loop to prevent GC allocations
const _scratchCamPos = new THREE.Vector3();
const _scratchCentroid = new THREE.Vector3();
const _scratchPoint = new THREE.Vector3();
const _scratchRayDir = new THREE.Vector3();
const _scratchBox = new THREE.Box3();
const _scratchCorners: THREE.Vector3[] = Array.from({ length: 8 }, () => new THREE.Vector3());

export class OcclusionManager {
  private raycaster: THREE.Raycaster;
  private activeOccluders: Map<string, TrackedOccluder> = new Map();
  private cachedCamera: THREE.Camera | null = null;

  constructor() {
    this.raycaster = new THREE.Raycaster();
    this.raycaster.firstHitOnly = false;
  }

  /**
   * Set or update camera reference used for raycasting
   */
  public setCamera(camera: THREE.Camera): void {
    this.cachedCamera = camera;
  }

  /**
   * Detects meshes occluding the target structures along lines-of-sight from camera
   * and smoothly transitions occluders into ghosted X-ray mode.
   *
   * @param targetFmaIds Canonical FMA IDs of structures currently in focus
   * @param camera Active perspective camera (defaults to cachedCamera)
   */
  public detectAndFadeOccluders(targetFmaIds: string[], camera?: THREE.Camera): void {
    const activeCam = camera || this.cachedCamera;
    if (!activeCam) return;
    this.cachedCamera = activeCam;

    activeCam.getWorldPosition(_scratchCamPos);

    const store = useSceneStore.getState();
    const registry = store.meshRegistry;

    // Collect all target meshes to exclude from occlusion detection
    const targetMeshSet = new Set<THREE.Object3D>();
    for (const fmaId of targetFmaIds) {
      const obj = registry.get(fmaId);
      if (obj) {
        targetMeshSet.add(obj);
        obj.traverse((child) => targetMeshSet.add(child));
      }
    }

    // Collect all candidate non-target meshes
    const candidateMeshes: THREE.Mesh[] = [];
    const seenUuids = new Set<string>();

    for (const [, obj] of registry.entries()) {
      // Mesh registry contains both canonical fma_id and common_name aliases; filter unique
      if (seenUuids.has(obj.uuid)) continue;
      seenUuids.add(obj.uuid);

      if (obj instanceof THREE.Mesh && !targetMeshSet.has(obj)) {
        candidateMeshes.push(obj);
      }
    }

    const detectedOccluders = new Set<THREE.Mesh>();

    // For each target structure, cast rays from camera to centroid and 8 bounding box corners
    for (const fmaId of targetFmaIds) {
      const meta = store.getStructureMeta(fmaId);
      let targetCenter: THREE.Vector3;
      let samplePoints: THREE.Vector3[] = [];

      if (meta) {
        _scratchCentroid.set(meta.centroid[0], meta.centroid[1], meta.centroid[2]);
        targetCenter = _scratchCentroid;

        const [minX, minY, minZ] = meta.bbox_min;
        const [maxX, maxY, maxZ] = meta.bbox_max;

        samplePoints = [
          _scratchCorners[0].set(minX, minY, minZ),
          _scratchCorners[1].set(maxX, minY, minZ),
          _scratchCorners[2].set(minX, maxY, minZ),
          _scratchCorners[3].set(maxX, maxY, minZ),
          _scratchCorners[4].set(minX, minY, maxZ),
          _scratchCorners[5].set(maxX, minY, maxZ),
          _scratchCorners[6].set(minX, maxY, maxZ),
          _scratchCorners[7].set(maxX, maxY, maxZ),
        ];
      } else {
        const targetObj = registry.get(fmaId);
        if (!targetObj) continue;

        _scratchBox.setFromObject(targetObj);
        _scratchBox.getCenter(_scratchCentroid);
        targetCenter = _scratchCentroid;

        const min = _scratchBox.min;
        const max = _scratchBox.max;

        samplePoints = [
          _scratchCorners[0].set(min.x, min.y, min.z),
          _scratchCorners[1].set(max.x, min.y, min.z),
          _scratchCorners[2].set(min.x, max.y, min.z),
          _scratchCorners[3].set(max.x, max.y, min.z),
          _scratchCorners[4].set(min.x, min.y, max.z),
          _scratchCorners[5].set(max.x, min.y, max.z),
          _scratchCorners[6].set(min.x, max.y, max.z),
          _scratchCorners[7].set(max.x, max.y, max.z),
        ];
      }

      // 1. Raycast to target centroid
      this.castOcclusionRay(_scratchCamPos, targetCenter, candidateMeshes, detectedOccluders);

      // 2. Raycast to bounding box corners
      for (const corner of samplePoints) {
        this.castOcclusionRay(_scratchCamPos, corner, candidateMeshes, detectedOccluders);
      }

      // 3. Any non-target superficial mesh with organ_system 'skeletal' (sternum, ribs, spine)
      // or respiratory (lungs) that lies in front of the target structure
      for (const mesh of candidateMeshes) {
        const meshMeta: AnatomicalStructureMeta | undefined = mesh.userData?.meta;
        if (!meshMeta) continue;

        if (meshMeta.organ_system === 'skeletal' || meshMeta.organ_system === 'respiratory') {
          mesh.getWorldPosition(_scratchPoint);
          // If the skeletal/lung structure is between camera and target depth
          const distToCam = _scratchCamPos.distanceTo(_scratchPoint);
          const distTargetToCam = _scratchCamPos.distanceTo(targetCenter);
          if (distToCam < distTargetToCam) {
            detectedOccluders.add(mesh);
          }
        }
      }
    }

    // Apply ghosting to newly detected occluders
    for (const mesh of detectedOccluders) {
      if (!this.activeOccluders.has(mesh.uuid)) {
        // Clone material on demand to avoid mutating shared materials across unrelated meshes
        const originalMat = mesh.material;
        const baseMat = (Array.isArray(originalMat) ? originalMat[0] : originalMat) as THREE.MeshStandardMaterial;
        const ghostMat = baseMat.clone() as THREE.MeshStandardMaterial;

        const origOpacity = baseMat.opacity ?? 1.0;
        ghostMat.transparent = true;
        ghostMat.depthWrite = false;
        ghostMat.opacity = origOpacity;

        mesh.material = ghostMat;

        this.activeOccluders.set(mesh.uuid, {
          mesh,
          originalMaterial: originalMat,
          ghostMaterial: ghostMat,
          currentOpacity: origOpacity,
          targetOpacity: 0.08,
          originalOpacity: origOpacity,
          isRestoring: false,
        });
      } else {
        const entry = this.activeOccluders.get(mesh.uuid)!;
        entry.targetOpacity = 0.08;
        entry.isRestoring = false;
      }
    }

    // Meshes that were occluders but are no longer occluding should restore
    for (const entry of this.activeOccluders.values()) {
      if (!detectedOccluders.has(entry.mesh)) {
        entry.targetOpacity = entry.originalOpacity;
        entry.isRestoring = true;
      }
    }
  }

  /**
   * Cast a ray from origin towards target point and record intersecting occluders
   */
  private castOcclusionRay(
    origin: THREE.Vector3,
    target: THREE.Vector3,
    candidates: THREE.Mesh[],
    outOccluders: Set<THREE.Mesh>
  ): void {
    _scratchRayDir.subVectors(target, origin);
    const targetDistance = _scratchRayDir.length();
    if (targetDistance < 0.01) return;

    _scratchRayDir.normalize();
    this.raycaster.set(origin, _scratchRayDir);
    this.raycaster.near = 0.05;
    this.raycaster.far = targetDistance;

    const intersections = this.raycaster.intersectObjects(candidates, false);
    for (const hit of intersections) {
      // Must be between camera and target with a small threshold before the target
      if (hit.distance < targetDistance - 0.05 && hit.object instanceof THREE.Mesh) {
        outOccluders.add(hit.object);
      }
    }
  }

  /**
   * Smoothly interpolate opacity of ghosted meshes in the render loop.
   * Disposes cloned materials and restores originals when fading completes.
   *
   * @param delta Frame delta time in seconds
   */
  public update(delta: number): void {
    if (this.activeOccluders.size === 0) return;

    const toRemove: string[] = [];
    const transitionSpeed = 4.5; // Smooth transition over ~0.22s

    for (const [uuid, entry] of this.activeOccluders.entries()) {
      const diff = entry.targetOpacity - entry.currentOpacity;
      const step = diff * Math.min(1.0, delta * transitionSpeed);

      if (Math.abs(diff) < 0.005) {
        entry.currentOpacity = entry.targetOpacity;
        entry.ghostMaterial.opacity = entry.targetOpacity;

        if (entry.isRestoring && entry.currentOpacity >= entry.originalOpacity - 0.01) {
          // Perfectly restore original material reference
          entry.mesh.material = entry.originalMaterial;
          // Dispose cloned material to prevent WebGL memory leak
          entry.ghostMaterial.dispose();
          toRemove.push(uuid);
        }
      } else {
        entry.currentOpacity += step;
        entry.ghostMaterial.opacity = entry.currentOpacity;
      }
    }

    for (const uuid of toRemove) {
      this.activeOccluders.delete(uuid);
    }
  }

  /**
   * Immediately restores all meshes to their original materials and disposes cloned ghost materials.
   * Called on RESET_SCENE or scene unmount.
   */
  public restoreAll(): void {
    for (const entry of this.activeOccluders.values()) {
      try {
        if (entry.mesh && entry.mesh.material !== entry.originalMaterial) {
          entry.mesh.material = entry.originalMaterial;
        }
        if (entry.ghostMaterial) {
          entry.ghostMaterial.dispose();
        }
      } catch (err) {
        console.warn('[OcclusionManager] Error disposing material during restoreAll:', err);
      }
    }
    this.activeOccluders.clear();
  }

  /**
   * Reset all state
   */
  public reset(): void {
    this.restoreAll();
    this.cachedCamera = null;
  }

  /**
   * Get count of currently tracked occluder meshes
   */
  public getTrackedCount(): number {
    return this.activeOccluders.size;
  }
}

// Global singleton instance
export const occlusionManager = new OcclusionManager();
