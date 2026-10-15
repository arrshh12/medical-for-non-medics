import React, { useEffect, useRef, useState, useMemo } from 'react';
import * as THREE from 'three';
import { ThreeEvent } from '@react-three/fiber';
import { useSceneStore } from '../store/useSceneStore';
import { ManifestData, AnatomicalStructureMeta } from '../types/scene.types';
import { applyTissueStateToMaterial } from './pathology/TissueStateShader';

// Procedural geometry factory for each anatomical structure type
function createOrganGeometry(meta: AnatomicalStructureMeta): THREE.BufferGeometry {
  const r = meta.bounding_radius;
  const sys = meta.organ_system;
  const id = meta.fma_id;

  // Vessels (arteries, veins, aorta)
  if (id.includes('7101') || id.includes('7100') || id.includes('7105')) {
    // Coronary arteries: branching curving tubular path
    const curve = new THREE.CubicBezierCurve3(
      new THREE.Vector3(meta.bbox_min[0], meta.bbox_max[1], meta.bbox_min[2]),
      new THREE.Vector3(meta.centroid[0] * 1.1, meta.centroid[1] + 0.1, meta.centroid[2]),
      new THREE.Vector3(meta.centroid[0], meta.centroid[1] - 0.1, meta.centroid[2] * 1.1),
      new THREE.Vector3(meta.bbox_max[0], meta.bbox_min[1], meta.bbox_max[2])
    );
    return new THREE.TubeGeometry(curve, 24, 0.045, 8, false);
  }

  if (id === 'FMA_3734' || id === 'FMA_3735') {
    // Aorta & Aortic Arch: majestic thick curved tube
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.05, 0.35, 0.15),
      new THREE.Vector3(-0.05, 0.9, 0.12),
      new THREE.Vector3(-0.1, 1.35, -0.05),
      new THREE.Vector3(-0.25, 1.15, -0.2),
      new THREE.Vector3(-0.25, 0.5, -0.25)
    ]);
    return new THREE.TubeGeometry(curve, 32, 0.14, 16, false);
  }

  if (id === 'FMA_4720' || id === 'FMA_4721') {
    // Venae Cavae: vertical venous cylinder
    const height = Math.abs(meta.bbox_max[1] - meta.bbox_min[1]) || 0.8;
    return new THREE.CylinderGeometry(0.12, 0.12, height, 16);
  }

  if (id === 'FMA_8614') {
    // Pulmonary trunk: wide bifurcating conduit
    return new THREE.CylinderGeometry(0.13, 0.14, 0.5, 16);
  }

  // Heart chambers
  if (id === 'FMA_7099') {
    // Left Ventricle: thick conical ellipsoid
    const geom = new THREE.SphereGeometry(r * 0.9, 24, 24);
    geom.scale(0.85, 1.25, 0.85);
    return geom;
  }

  if (id === 'FMA_7098') {
    // Right Ventricle: crescent wrapping shape
    const geom = new THREE.SphereGeometry(r * 0.85, 24, 24);
    geom.scale(0.9, 1.1, 0.7);
    return geom;
  }

  if (id === 'FMA_7096' || id === 'FMA_7097') {
    // Atria: rounded auricle domes
    const geom = new THREE.SphereGeometry(r * 0.85, 20, 20);
    geom.scale(1.0, 0.9, 0.9);
    return geom;
  }

  // Heart Valves
  if (id.includes('7234') || id.includes('7236') || id.includes('7237') || id.includes('7238')) {
    return new THREE.TorusGeometry(r * 0.8, 0.025, 12, 24);
  }

  // Myocardial regions (Septum, Apex)
  if (id === 'FMA_9462') {
    // Septum: curved muscular plate
    const geom = new THREE.BoxGeometry(0.18, 0.55, 0.35);
    return geom;
  }

  if (id === 'FMA_7163') {
    // Apex: conical cardiac tip
    const geom = new THREE.ConeGeometry(0.25, 0.45, 16);
    geom.rotateX(Math.PI);
    return geom;
  }

  // Lungs
  if (id === 'FMA_7309' || id === 'FMA_7310') {
    const geom = new THREE.SphereGeometry(r * 0.85, 24, 24);
    geom.scale(0.7, 1.3, 0.9);
    return geom;
  }

  // Trachea
  if (id === 'FMA_7394') {
    return new THREE.CylinderGeometry(0.12, 0.12, 1.0, 16);
  }

  // Sternum
  if (id === 'FMA_7485') {
    const geom = new THREE.BoxGeometry(0.35, 1.7, 0.08);
    return geom;
  }

  // Ribcage: thoracic cage arches
  if (id === 'FMA_7480') {
    const geom = new THREE.TorusGeometry(r * 0.75, 0.05, 8, 32, Math.PI * 1.5);
    geom.rotateX(Math.PI / 2);
    return geom;
  }

  // Thoracic Spine
  if (id === 'FMA_9139') {
    return new THREE.CylinderGeometry(0.16, 0.16, 2.8, 12);
  }

  // Generic fallback: organic ellipsoid
  const geom = new THREE.SphereGeometry(Math.max(r * 0.75, 0.2), 20, 20);
  if (sys === 'cardiovascular') geom.scale(1.0, 1.1, 0.9);
  return geom;
}

// Get realistic default anatomical material color
function getDefaultOrganColor(meta: AnatomicalStructureMeta): string {
  const id = meta.fma_id;
  const sys = meta.organ_system;

  if (id === 'FMA_7088' || id === 'FMA_7099' || id === 'FMA_9462' || id === 'FMA_7163') {
    return '#991b1b'; // Deep myocardial crimson
  }
  if (id === 'FMA_7098') {
    return '#831843'; // Right ventricle darker venous muscle
  }
  if (id === 'FMA_7096' || id === 'FMA_4720' || id === 'FMA_4721') {
    return '#3b82f6'; // Systemic venous blue
  }
  if (id === 'FMA_7097') {
    return '#dc2626'; // Left atrium oxygenated red
  }
  if (id === 'FMA_7101' || id === 'FMA_7100' || id === 'FMA_7105' || id === 'FMA_3734' || id === 'FMA_3735') {
    return '#ef4444'; // Arterial scarlet red
  }
  if (id.includes('7234') || id.includes('7236') || id.includes('7237') || id.includes('7238')) {
    return '#f8fafc'; // Valvular collagen white
  }
  if (id === 'FMA_8614') {
    return '#0284c7'; // Pulmonary trunk
  }
  if (sys === 'respiratory') {
    return '#f472b6'; // Lung parenchyma pink
  }
  if (sys === 'skeletal') {
    return '#e2e8f0'; // Bone ivory
  }
  return '#cbd5e1';
}

interface AnatomicalNodeProps {
  meta: AnatomicalStructureMeta;
}

const AnatomicalNode: React.FC<AnatomicalNodeProps> = ({ meta }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const {
    registerMesh,
    unregisterMesh,
    selectedFmaId,
    hoveredFmaId,
    selectStructure,
    setHoveredStructure,
    isolatedFmaIds,
    highlightedFmaIds,
    tissueStates
  } = useSceneStore();

  const isSelected = selectedFmaId === meta.fma_id;
  const isHovered = hoveredFmaId === meta.fma_id;
  const isIsolatedTarget = isolatedFmaIds.length === 0 || isolatedFmaIds.includes(meta.fma_id);
  const highlightColor = highlightedFmaIds[meta.fma_id];
  const tissueState = tissueStates[meta.fma_id] || 'normal';

  // Geometry
  const geometry = useMemo(() => createOrganGeometry(meta), [meta]);

  // Color selection
  const baseColor = useMemo(() => {
    if (tissueState === 'ischemic') return '#4c1d95'; // Hypoxic violaceous cyanosis
    if (tissueState === 'necrotic') return '#27272a'; // Mottled dark necrotic infarcted
    if (tissueState === 'inflamed') return '#ff2222'; // Hyperemic erythematous glow
    return getDefaultOrganColor(meta);
  }, [meta, tissueState]);

  // Register mesh
  useEffect(() => {
    if (meshRef.current) {
      meshRef.current.userData = { fma_id: meta.fma_id, meta };
      registerMesh(meta.fma_id, meshRef.current);
    }
    return () => {
      unregisterMesh(meta.fma_id);
    };
  }, [meta, registerMesh, unregisterMesh]);

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    selectStructure(meta.fma_id);
  };

  const handlePointerOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHoveredStructure(meta.fma_id);
  };

  const handlePointerOut = () => {
    setHoveredStructure(null);
  };

  // Skeletal structures (sternum/ribcage) have subtle transparency to act as natural occluders
  const isSkeletal = meta.organ_system === 'skeletal';
  const isLung = meta.organ_system === 'respiratory';

  let opacity = 1.0;
  let transparent = false;

  if (!isIsolatedTarget) {
    opacity = 0.06;
    transparent = true;
  } else if (isSkeletal) {
    opacity = 0.45;
    transparent = true;
  } else if (isLung) {
    opacity = 0.55;
    transparent = true;
  }

  // Emissive calculation
  let emissive = '#000000';
  let emissiveIntensity = 0.0;

  if (highlightColor) {
    emissive = highlightColor;
    emissiveIntensity = 0.7;
  } else if (isSelected) {
    emissive = '#2dd4bf'; // Teal select glow
    emissiveIntensity = 0.6;
  } else if (isHovered) {
    emissive = '#38bdf8'; // Cyan hover glow
    emissiveIntensity = 0.4;
  } else if (tissueState === 'inflamed') {
    emissive = '#ef4444';
    emissiveIntensity = 0.5;
  }

  const materialRef = useRef<THREE.MeshStandardMaterial>(null);

  useEffect(() => {
    if (materialRef.current) {
      const activeState = tissueState && tissueState !== 'vascular_occlusion'
        ? tissueState
        : (highlightColor ? 'highlighted' : 'normal');
      applyTissueStateToMaterial(materialRef.current, {
        state: activeState,
        highlightColor: highlightColor || (isSelected ? '#2dd4bf' : (isHovered ? '#38bdf8' : undefined)),
        severity: 0.9
      });
    }
  }, [tissueState, highlightColor, isSelected, isHovered]);

  return (
    <mesh
      ref={meshRef}
      position={meta.centroid}
      geometry={geometry}
      onClick={handleClick}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
      castShadow
      receiveShadow
    >
      <meshStandardMaterial
        ref={materialRef}
        color={baseColor}
        roughness={isSkeletal ? 0.35 : 0.45}
        metalness={0.1}
        opacity={opacity}
        transparent={transparent}
        depthWrite={!transparent}
        emissive={emissive}
        emissiveIntensity={emissiveIntensity}
      />
    </mesh>
  );
};

export const ModelLoader: React.FC = () => {
  const { manifest, setManifest } = useSceneStore();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/models/manifest.json')
      .then((res) => {
        if (!res.ok) throw new Error('Could not load manifest.json');
        return res.json();
      })
      .then((data: ManifestData) => {
        setManifest(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error('[ModelLoader] Manifest load error:', err);
        setLoading(false);
      });
  }, [setManifest]);

  if (loading || !manifest) {
    return null;
  }

  return (
    <group name="anatomical_rig_root">
      {Object.values(manifest.structures).map((meta) => (
        <AnatomicalNode key={meta.fma_id} meta={meta} />
      ))}
    </group>
  );
};
