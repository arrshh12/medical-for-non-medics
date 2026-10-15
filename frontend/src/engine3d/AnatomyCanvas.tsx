import React, { Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { PerspectiveCamera, ContactShadows } from '@react-three/drei';
import { ModelLoader } from './ModelLoader';
import { VascularBlockageMesh } from './pathology/VascularBlockageMesh';
import { FlowParticleSystem } from './pathology/FlowParticleSystem';
import { AnnotationOverlay } from './AnnotationOverlay';
import { CameraRig } from './CameraRig';
import { updateTissueShaderTime } from './pathology/TissueStateShader';
import { Loader2 } from 'lucide-react';

const CanvasLoader: React.FC = () => (
  <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 backdrop-blur-sm z-10 text-slate-300">
    <Loader2 className="w-8 h-8 animate-spin text-teal-400 mb-2" />
    <span className="text-xs font-mono text-slate-400">Loading 3D Anatomical Assets...</span>
  </div>
);

const TissueShaderTicker: React.FC = () => {
  useFrame(({ clock }) => {
    updateTissueShaderTime(clock.getElapsedTime());
  });
  return null;
};

export const AnatomyCanvas: React.FC = () => {
  return (
    <div className="relative w-full h-full bg-radial from-slate-900 to-slate-950 overflow-hidden">
      <Suspense fallback={<CanvasLoader />}>
        <Canvas
          gl={{
            antialias: true,
            alpha: true,
            powerPreference: 'high-performance'
          }}
          className="w-full h-full cursor-grab active:cursor-grabbing"
        >
          {/* Default Perspective Camera */}
          <PerspectiveCamera makeDefault fov={45} position={[0, 0, 4.8]} near={0.1} far={50} />

          {/* Smooth Camera Rig & Bounding-Sphere Framing (includes OrbitControls) */}
          <CameraRig />

          {/* Studio Anatomical Lighting Rig */}
          <ambientLight intensity={0.65} color="#ffffff" />
          <hemisphereLight args={['#bae6fd', '#090d16', 0.45]} />

          {/* Key Light */}
          <directionalLight
            position={[6, 9, 8]}
            intensity={1.2}
            color="#ffffff"
            castShadow
            shadow-mapSize={[1024, 1024]}
          />

          {/* Fill Light (Soft bluish) */}
          <directionalLight
            position={[-7, -3, -4]}
            intensity={0.5}
            color="#93c5fd"
          />

          {/* Rim / Backlight (Cool cyan accent for anatomical edge definition) */}
          <directionalLight
            position={[0, 7, -7]}
            intensity={0.9}
            color="#38bdf8"
          />

          {/* Tissue Pathology Shader Global Time Ticker */}
          <TissueShaderTicker />

          {/* Anatomical Model Rig */}
          <ModelLoader />

          {/* Procedural Vascular Pathology Blockages */}
          <VascularBlockageMesh />

          {/* GPU Instanced Physiological Flow Particles */}
          <FlowParticleSystem />

          {/* 3D Anatomical Callout Pin Overlay */}
          <AnnotationOverlay />

          {/* Subtle Ground Contact Shadow */}
          <ContactShadows
            position={[0, -1.8, 0]}
            opacity={0.35}
            scale={8}
            blur={2.5}
            far={4.5}
            color="#000000"
          />
        </Canvas>
      </Suspense>
    </div>
  );
};
