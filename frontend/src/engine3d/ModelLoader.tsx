import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame, ThreeEvent } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { useSceneStore } from '../store/useSceneStore';
import type { AnatomicalStructureMeta, RegisteredMeshEntry } from '../types/scene.types';
import { checkRayCylinderOcclusion } from './OcclusionManager';

const SYSTEM_PALETTE: Record<string, { color: string; roughness: number; metalness: number }> = {
  skeletal: { color: '#e8dfd1', roughness: 0.48, metalness: 0.05 },       // Cortical ivory bone
  cardiovascular: { color: '#b91c1c', roughness: 0.32, metalness: 0.08 }, // Myocardial/Arterial crimson
  nervous: { color: '#f4b4c4', roughness: 0.42, metalness: 0.04 },        // Cerebral gyri pink-beige
  respiratory: { color: '#c08497', roughness: 0.55, metalness: 0.02 },    // Pulmonary parenchymal rose
  digestive: { color: '#8d4024', roughness: 0.38, metalness: 0.05 },      // Hepatic/Gastric sienna
  urinary: { color: '#7c2d12', roughness: 0.40, metalness: 0.06 },        // Renal cortex brown-red
  skin: { color: '#94a3b8', roughness: 0.70, metalness: 0.0 },
};

function classifyNodeToFma(
  nodeName: string,
  centerYNormalized: number,
  manifestList: AnatomicalStructureMeta[]
): AnatomicalStructureMeta {
  const clean = nodeName.toLowerCase();
  for (const item of manifestList) {
    if (
      item.fma_id.toLowerCase() === clean ||
      item.common_name.toLowerCase() === clean ||
      (item.canonical_name && item.canonical_name.toLowerCase() === clean) ||
      (item.glb_aliases ?? []).some((a) => clean.includes(a.toLowerCase()))
    ) {
      return item;
    }
  }

  // Heuristic anatomical classifier for sub-nodes inside the NIH Visible Human GLB
  if (clean.includes('brain') || clean.includes('cerebr') || clean.includes('encephal')) {
    return manifestList.find((m) => m.fma_id === 'FMA_50801') ?? manifestList[0];
  }
  if (clean.includes('skull') || clean.includes('crani') || (clean.includes('bone') && centerYNormalized > 0.82)) {
    return manifestList.find((m) => m.fma_id === 'FMA_46565') ?? manifestList[0];
  }
  if (clean.includes('heart') || clean.includes('ventricle') || clean.includes('atrium') || clean.includes('coronary') || clean.includes('myocardi')) {
    return manifestList.find((m) => m.fma_id === 'FMA_7088') ?? manifestList[0];
  }
  if (clean.includes('carotid') || clean.includes('jugular') || (clean.includes('vasculature') && centerYNormalized > 0.7)) {
    return manifestList.find((m) => m.fma_id === 'FMA_3939') ?? manifestList[0];
  }
  if (clean.includes('aorta') || clean.includes('artery') || clean.includes('vein')) {
    return manifestList.find((m) => m.fma_id === 'FMA_3734') ?? manifestList[0];
  }
  if (clean.includes('sternum') || clean.includes('manubrium')) {
    return manifestList.find((m) => m.fma_id === 'FMA_7485') ?? manifestList[0];
  }
  if (clean.includes('lung') || clean.includes('bronch') || clean.includes('trachea') || clean.includes('respirat') || clean.includes('pleura')) {
    return manifestList.find((m) => m.fma_id === 'FMA_7195') ?? manifestList[0];
  }
  if (clean.includes('liver') || clean.includes('hepat')) {
    return manifestList.find((m) => m.fma_id === 'FMA_7197') ?? manifestList[0];
  }
  if (clean.includes('kidney') || clean.includes('renal')) {
    return manifestList.find((m) => m.fma_id === 'FMA_7203') ?? manifestList[0];
  }
  return manifestList.find((m) => m.fma_id === 'FMA_7480') ?? manifestList[0];
}

export const ModelLoader: React.FC = () => {
  const groupRef = useRef<THREE.Group>(null);
  const gltf = useGLTF('/models/human_anatomy.glb');

  const {
    registerGlbScene,
    meshRegistry,
    selectedFmaId,
    hoveredFmaId,
    highlightedIds,
    ghostedIds,
    pulsingIds,
    tissueStates,
    visibleSystems,
    cameraFocusIds,
    selectStructure,
    setHoveredStructure,
  } = useSceneStore();

  const clonedScene = useMemo(() => gltf.scene.clone(true), [gltf.scene]);

  useEffect(() => {
    let cancelled = false;

    async function initializeAnatomyScene() {
      try {
        const resp = await fetch('/models/manifest.json');
        const manifestData = await resp.json();
        const structuresList: AnatomicalStructureMeta[] = Array.isArray(manifestData.structures)
          ? manifestData.structures
          : Object.values(manifestData.structures ?? {});

        // 1. Center and normalize full human body height to 3.4 world units
        const rawBox = new THREE.Box3().setFromObject(clonedScene);
        const rawSize = new THREE.Vector3();
        const rawCenter = new THREE.Vector3();
        rawBox.getSize(rawSize);
        rawBox.getCenter(rawCenter);

        const maxDim = Math.max(rawSize.x, rawSize.y, rawSize.z, 0.001);
        const targetScale = 3.4 / maxDim;
        clonedScene.scale.setScalar(targetScale);
        clonedScene.position.set(
          -rawCenter.x * targetScale,
          -rawCenter.y * targetScale,
          -rawCenter.z * targetScale
        );
        clonedScene.updateMatrixWorld(true);

        const normalizedBodyBox = new THREE.Box3().setFromObject(clonedScene);
        const minY = normalizedBodyBox.min.y;
        const totalHeight = Math.max(normalizedBodyBox.max.y - minY, 0.001);

        const entriesMap: Record<string, RegisteredMeshEntry> = {};
        const metaMap: Record<string, AnatomicalStructureMeta> = {};
        for (const s of structuresList) {
          metaMap[s.fma_id] = s;
        }

        clonedScene.traverse((child) => {
          if (!(child as THREE.Mesh).isMesh) return;
          const mesh = child as THREE.Mesh;
          const lineageName = `${mesh.parent?.name ?? ''}_${mesh.name}`;

          // Hide outer skin shell by default so skeleton and internal organs are clearly visible
          if (/skin|body_surface|outer_surface/i.test(lineageName)) {
            mesh.userData.isSkinShell = true;
            mesh.visible = false;
            return;
          }

          const meshBox = new THREE.Box3().setFromObject(mesh);
          const meshCenter = new THREE.Vector3();
          meshBox.getCenter(meshCenter);
          const relativeHeight = (meshCenter.y - minY) / totalHeight;

          const matchedMeta = classifyNodeToFma(lineageName, relativeHeight, structuresList);
          const fmaId = matchedMeta.fma_id;
          mesh.userData.fmaId = fmaId;
          mesh.userData.organSystem = matchedMeta.organ_system;

          const palette = SYSTEM_PALETTE[matchedMeta.organ_system] ?? SYSTEM_PALETTE.skeletal;
          mesh.material = new THREE.MeshPhysicalMaterial({
            color: new THREE.Color(palette.color),
            roughness: palette.roughness,
            metalness: palette.metalness,
            clearcoat: matchedMeta.organ_system === 'cardiovascular' ? 0.35 : 0.1,
            transparent: true,
            opacity: 1.0,
          });
          mesh.userData.baseColor = palette.color;

          if (!entriesMap[fmaId]) {
            entriesMap[fmaId] = {
              fma_id: fmaId,
              name: matchedMeta.common_name || matchedMeta.canonical_name || fmaId,
              organ_system: matchedMeta.organ_system,
              meshes: [],
              boundingBox: new THREE.Box3(),
              center: new THREE.Vector3(),
              radius: 0.2,
            };
          }
          entriesMap[fmaId].meshes.push(mesh);
          entriesMap[fmaId].boundingBox.union(meshBox);
        });

        // Compute final bounding spheres for each anatomical structure
        for (const entry of Object.values(entriesMap)) {
          const sphere = new THREE.Sphere();
          entry.boundingBox.getBoundingSphere(sphere);
          entry.center.copy(sphere.center);
          entry.radius = Math.max(sphere.radius, 0.12);
        }

        if (!cancelled) {
          registerGlbScene(entriesMap, metaMap);
        }
      } catch (err) {
        console.error('[ModelLoader] Initialization error:', err);
      }
    }

    initializeAnatomyScene();
    return () => {
      cancelled = true;
    };
  }, [clonedScene, registerGlbScene]);

  // Real-time 60 FPS Shader, Opacity, Occlusion & Systolic Heartbeat Loop
  useFrame(({ clock, camera }) => {
    const t = clock.getElapsedTime();

    // Determine dynamic line-of-sight bone/organ occluders between camera and focused organ
    const dynamicOccluders = checkRayCylinderOcclusion(
      camera.position,
      cameraFocusIds,
      meshRegistry
    );

    for (const [fmaId, entry] of Object.entries(meshRegistry)) {
      const systemVisible = visibleSystems[entry.organ_system] ?? true;
      const isSelected = selectedFmaId === fmaId;
      const isHovered = hoveredFmaId === fmaId;
      const isHighlighted = highlightedIds.includes(fmaId) || isSelected;
      const isPulsing = pulsingIds.includes(fmaId);
      const isGhosted = ghostedIds.includes(fmaId) || dynamicOccluders.has(fmaId);
      const tissueState = tissueStates[fmaId] ?? 'normal';

      // Systolic heartbeat contraction scale (72 BPM = 1.2 Hz)
      const pulseWave = isPulsing ? Math.pow(Math.sin(t * Math.PI * 2.4), 4) : 0;

      for (const mesh of entry.meshes) {
        mesh.visible = systemVisible;
        if (!systemVisible) continue;

        const mat = mesh.material as THREE.MeshPhysicalMaterial;
        const baseColor = new THREE.Color(mesh.userData.baseColor ?? '#e8dfd1');

        // Apply tissue state / highlight emissive colors
        if (tissueState === 'ischemic') {
          mat.color.lerp(new THREE.Color('#4c1d95'), 0.18);
          mat.emissive.set('#6d28d9');
          mat.emissiveIntensity = 0.35 + 0.2 * Math.sin(t * 4.0);
        } else if (tissueState === 'necrotic') {
          mat.color.lerp(new THREE.Color('#1e1b4b'), 0.2);
          mat.emissive.set('#312e81');
          mat.emissiveIntensity = 0.25;
        } else if (isHighlighted || isPulsing) {
          mat.color.copy(baseColor);
          mat.emissive.set(isPulsing ? '#ef4444' : '#14b8a6');
          mat.emissiveIntensity = isPulsing ? 0.25 + pulseWave * 0.65 : 0.45;
        } else if (isHovered) {
          mat.color.copy(baseColor);
          mat.emissive.set('#38bdf8');
          mat.emissiveIntensity = 0.28;
        } else {
          mat.color.copy(baseColor);
          mat.emissive.set('#000000');
          mat.emissiveIntensity = 0;
        }

        // Smoothly interpolate opacity for ghosted occluders (Sternum, Rib Cage, Skull)
        const targetOpacity = isGhosted && !isHighlighted ? 0.12 : 1.0;
        mat.opacity = THREE.MathUtils.lerp(mat.opacity, targetOpacity, 0.12);
        mat.depthWrite = mat.opacity > 0.45;
      }
    }
  });

  const handlePointerClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const fmaId = e.object.userData?.fmaId;
    if (fmaId) {
      selectStructure(fmaId);
    }
  };

  const handlePointerOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const fmaId = e.object.userData?.fmaId;
    if (fmaId) {
      document.body.style.cursor = 'pointer';
      setHoveredStructure(fmaId);
    }
  };

  const handlePointerOut = () => {
    document.body.style.cursor = 'default';
    setHoveredStructure(null);
  };

  return (
    <group
      ref={groupRef}
      onClick={handlePointerClick}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
    >
      <primitive object={clonedScene} />
    </group>
  );
};

useGLTF.preload('/models/human_anatomy.glb');
