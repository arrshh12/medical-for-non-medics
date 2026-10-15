import * as THREE from 'three';
import { useSceneStore } from '../store/useSceneStore';
import type { RegisteredMeshEntry } from '../types/scene.types';

const _scratchCamPos = new THREE.Vector3();

/**
 * Automatically identifies skeletal or superficial meshes (such as the Sternum,
 * Rib Cage, or Skull) that sit inside the viewing cylinder between the active
 * 3D camera and the currently focused deep organ (e.g. Heart or Brain).
 */
export function checkRayCylinderOcclusion(
  cameraPos: THREE.Vector3,
  focusFmaIds: string[],
  meshRegistry: Record<string, RegisteredMeshEntry>
): Set<string> {
  const occludedIds = new Set<string>();
  if (!focusFmaIds || !focusFmaIds.length) return occludedIds;

  for (const targetId of focusFmaIds) {
    const targetEntry = meshRegistry[targetId];
    if (!targetEntry) continue;

    const targetCenter = targetEntry.center;
    const camToTargetDist = cameraPos.distanceTo(targetCenter);
    const rayDir = new THREE.Vector3().subVectors(targetCenter, cameraPos).normalize();
    const ray = new THREE.Ray(cameraPos, rayDir);

    for (const [candidateId, candidateEntry] of Object.entries(meshRegistry)) {
      if (candidateId === targetId || focusFmaIds.includes(candidateId)) continue;

      // Only auto-ghost skeletal or respiratory barriers covering internal organs
      if (candidateEntry.organ_system !== 'skeletal' && candidateEntry.organ_system !== 'respiratory') {
        continue;
      }

      const camToCandidateDist = cameraPos.distanceTo(candidateEntry.center);
      if (camToCandidateDist < camToTargetDist * 0.96) {
        const distFromSightLine = ray.distanceToPoint(candidateEntry.center);
        if (distFromSightLine < candidateEntry.radius * 0.95) {
          occludedIds.add(candidateId);
        }
      }
    }
  }

  return occludedIds;
}

export class OcclusionManager {
  private cachedCamera: THREE.Camera | null = null;

  public setCamera(camera: THREE.Camera): void {
    this.cachedCamera = camera;
  }

  public detectAndFadeOccluders(targetFmaIds: string[], camera?: THREE.Camera): void {
    const activeCam = camera || this.cachedCamera;
    if (!activeCam) return;
    this.cachedCamera = activeCam;

    activeCam.getWorldPosition(_scratchCamPos);
    const store = useSceneStore.getState();
    const registry = store.meshRegistry;

    const detected = checkRayCylinderOcclusion(_scratchCamPos, targetFmaIds, registry);
    if (detected.size > 0) {
      useSceneStore.setState({
        ghostedIds: Array.from(new Set([...store.ghostedIds, ...Array.from(detected)])),
      });
    }
  }

  public restoreAllOccluders(): void {
    useSceneStore.setState({ ghostedIds: [] });
  }
}

export const occlusionManager = new OcclusionManager();
