import React, { useRef, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { useSceneStore } from '../../store/useSceneStore';
import { AnatomicalStructureMeta } from '../../types/scene.types';
import { AlertTriangle } from 'lucide-react';

const upAxis = new THREE.Vector3(0, 1, 0);

/**
 * Computes exact 3D coordinates and tangent vector along a vessel lumen
 * at longitudinal progress parameter s in [0, 1].
 */
export function getVesselPathSample(
  meta: AnatomicalStructureMeta,
  s: number = 0.45
): { position: THREE.Vector3; tangent: THREE.Vector3; vesselRadius: number } {
  const fma = meta.fma_id;

  // Coronary arteries (e.g. FMA_7101 LAD, FMA_7100 RCA, FMA_7105 LCx)
  if (fma.includes('7101') || fma.includes('7100') || fma.includes('7105')) {
    const curve = new THREE.CubicBezierCurve3(
      new THREE.Vector3(meta.bbox_min[0], meta.bbox_max[1], meta.bbox_min[2]),
      new THREE.Vector3(meta.centroid[0] * 1.1, meta.centroid[1] + 0.1, meta.centroid[2]),
      new THREE.Vector3(meta.centroid[0], meta.centroid[1] - 0.1, meta.centroid[2] * 1.1),
      new THREE.Vector3(meta.bbox_max[0], meta.bbox_min[1], meta.bbox_max[2])
    );
    return {
      position: curve.getPointAt(s),
      tangent: curve.getTangentAt(s).normalize(),
      vesselRadius: 0.045
    };
  }

  // Aorta & Aortic Arch (FMA_3734, FMA_3735)
  if (fma === 'FMA_3734' || fma === 'FMA_3735') {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.05, 0.35, 0.15),
      new THREE.Vector3(-0.05, 0.9, 0.12),
      new THREE.Vector3(-0.1, 1.35, -0.05),
      new THREE.Vector3(-0.25, 1.15, -0.2),
      new THREE.Vector3(-0.25, 0.5, -0.25)
    ]);
    return {
      position: curve.getPointAt(s),
      tangent: curve.getTangentAt(s).normalize(),
      vesselRadius: 0.14
    };
  }

  // Generic vessel or tubular organ fallback
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(meta.bbox_min[0], meta.bbox_max[1], meta.bbox_min[2]),
    new THREE.Vector3(meta.centroid[0], meta.centroid[1], meta.centroid[2]),
    new THREE.Vector3(meta.bbox_max[0], meta.bbox_min[1], meta.bbox_max[2])
  ]);

  return {
    position: curve.getPointAt(s),
    tangent: curve.getTangentAt(s).normalize(),
    vesselRadius: Math.max(meta.bounding_radius * 0.1, 0.04)
  };
}

interface SingleBlockageProps {
  meta: AnatomicalStructureMeta;
  severity: number;
  s?: number;
}

const SingleBlockageItem: React.FC<SingleBlockageProps> = ({ meta, severity, s = 0.45 }) => {
  const pulseRingRef = useRef<THREE.Mesh>(null);
  const pulseRingMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const beaconCoreRef = useRef<THREE.Mesh>(null);
  const beaconCoreMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const thrombusGroupRef = useRef<THREE.Group>(null);

  // Compute position, orientation, and vessel scale
  const { position, tangent, vesselRadius } = useMemo(() => {
    return getVesselPathSample(meta, s);
  }, [meta, s]);

  // Orientation quaternion aligned with vessel lumen tangent
  const rotationQuaternion = useMemo(() => {
    const q = new THREE.Quaternion();
    q.setFromUnitVectors(upAxis, tangent);
    return q;
  }, [tangent]);

  // Stenosis percentage for clinical HUD
  const stenosisPercent = Math.round(Math.min(Math.max(severity, 0.1), 1.0) * 100);

  // Frame animation loop with zero memory allocations
  useFrame(({ clock }) => {
    const elapsed = clock.getElapsedTime();

    // 1. Holographic pulse wave expanding and fading radially
    if (pulseRingRef.current && pulseRingMatRef.current) {
      const pulsePhase = (elapsed * 1.8) % 1.0; // 0 to 1 cycle
      const scaleFactor = 1.0 + pulsePhase * 1.6;
      pulseRingRef.current.scale.set(scaleFactor, scaleFactor, scaleFactor);
      pulseRingMatRef.current.opacity = (1.0 - pulsePhase) * 0.75;
    }

    // 2. Pulsing high-visibility warning beacon core
    if (beaconCoreRef.current && beaconCoreMatRef.current) {
      beaconCoreRef.current.rotation.y = elapsed * 3.0;
      beaconCoreRef.current.rotation.x = elapsed * 1.5;
      const flash = 0.6 + 0.4 * Math.sin(elapsed * 8.0);
      beaconCoreMatRef.current.emissiveIntensity = flash * 1.2;
    }

    // 3. Subtle micro-jitter on the thrombus clot representing turbulent vascular pressure
    if (thrombusGroupRef.current) {
      const wobble = Math.sin(elapsed * 12.0) * 0.0015;
      thrombusGroupRef.current.position.y = position.y + wobble;
    }
  });

  const plaqueOuterRadius = vesselRadius * 1.25;
  const plaqueInnerRadius = vesselRadius * Math.max(0.12, 1.0 - severity * 0.88);

  return (
    <group position={position} quaternion={rotationQuaternion}>
      {/* Intraluminal Thrombus / Atherosclerotic Plaque Constriction Ring */}
      <group ref={thrombusGroupRef}>
        {/* Atheromatous Lipid Core (eccentric yellowish cholesterol deposit) */}
        <mesh position={[vesselRadius * 0.25, 0, 0]}>
          <cylinderGeometry
            args={[
              plaqueOuterRadius * 0.95,
              plaqueOuterRadius * 1.05,
              vesselRadius * 1.2,
              20,
              1,
              false
            ]}
          />
          <meshStandardMaterial
            color="#d97706"
            roughness={0.65}
            metalness={0.1}
            emissive="#78350f"
            emissiveIntensity={0.25}
          />
        </mesh>

        {/* Intraluminal Fibrin/Platelet Thrombus Clot (Dark coagulated reddish-brown mass) */}
        <mesh position={[-vesselRadius * 0.15, 0, 0]}>
          <torusGeometry
            args={[
              (plaqueOuterRadius + plaqueInnerRadius) * 0.5,
              (plaqueOuterRadius - plaqueInnerRadius) * 0.6,
              16,
              24
            ]}
          />
          <meshStandardMaterial
            color="#7f1d1d"
            roughness={0.5}
            metalness={0.05}
            emissive="#450a0a"
            emissiveIntensity={0.35}
          />
        </mesh>

        {/* Constriction Collar Ring (Visual marker of stenosis perimeter) */}
        <mesh>
          <torusGeometry args={[plaqueOuterRadius * 1.08, 0.012, 12, 32]} />
          <meshStandardMaterial
            color="#ef4444"
            emissive="#dc2626"
            emissiveIntensity={0.8}
            roughness={0.2}
          />
        </mesh>
      </group>

      {/* Pulsing Warning Beacon Holographic Shockwave Ring */}
      <mesh ref={pulseRingRef} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[vesselRadius * 1.2, vesselRadius * 1.45, 32]} />
        <meshBasicMaterial
          ref={pulseRingMatRef}
          color="#f87171"
          transparent
          opacity={0.7}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* Pulsing High-Visibility Diamond Beacon Core */}
      <mesh ref={beaconCoreRef} position={[0, vesselRadius * 1.8, 0]}>
        <octahedronGeometry args={[vesselRadius * 0.55, 0]} />
        <meshStandardMaterial
          ref={beaconCoreMatRef}
          color="#ef4444"
          emissive="#ef4444"
          emissiveIntensity={0.9}
          roughness={0.2}
          metalness={0.2}
        />
      </mesh>

      {/* Anatomical Clinical Callout HUD Pin */}
      <Html
        position={[0, vesselRadius * 2.8, 0]}
        center
        distanceFactor={5.5}
        zIndexRange={[80, 0]}
        className="pointer-events-none select-none"
      >
        <div className="flex flex-col items-center animate-in fade-in zoom-in-90 duration-300">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-950/90 border border-red-500/70 shadow-lg shadow-red-500/30 text-white backdrop-blur-md whitespace-nowrap">
            <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 animate-bounce" />
            <span className="text-[11px] font-bold font-mono text-red-200">
              {stenosisPercent}% Stenosis
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-ping ml-0.5" />
          </div>
          <div className="text-[9px] text-red-300/80 font-sans tracking-wide mt-0.5 bg-black/50 px-1.5 py-0.5 rounded">
            {meta.common_name} Occlusion
          </div>
        </div>
      </Html>
    </group>
  );
};

export interface VascularBlockageMeshProps {
  targetId?: string;
  severity?: number;
  s?: number;
}

/**
 * React Three Fiber component that renders procedural intraluminal thrombus / atherosclerotic
 * plaque constrictions and pulsing warning beacons at vessel coordinates.
 * Reads active blockages from useSceneStore if no explicit targetId prop is passed.
 */
export const VascularBlockageMesh: React.FC<VascularBlockageMeshProps> = ({
  targetId,
  severity,
  s
}) => {
  const { blockages, getStructureMeta } = useSceneStore();

  // If a specific targetId prop was provided directly, render that single blockage
  if (targetId) {
    const meta = getStructureMeta(targetId);
    if (!meta) return null;
    return <SingleBlockageItem meta={meta} severity={severity ?? 0.85} s={s ?? 0.45} />;
  }

  // Otherwise, render all active blockages registered in useSceneStore
  const blockageEntries = Object.entries(blockages);
  if (blockageEntries.length === 0) {
    return null;
  }

  return (
    <group name="vascular_blockages_root">
      {blockageEntries.map(([fmaId, blockage]) => {
        const meta = getStructureMeta(fmaId);
        if (!meta) return null;
        return (
          <SingleBlockageItem
            key={`blockage-${fmaId}`}
            meta={meta}
            severity={blockage.severity}
            s={s ?? 0.45}
          />
        );
      })}
    </group>
  );
};
