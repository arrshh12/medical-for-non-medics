import React from 'react';
import { Html } from '@react-three/drei';
import { useSceneStore } from '../store/useSceneStore';
import { AnnotationSchema } from '../types/scene.types';
import { X, Sparkles } from 'lucide-react';

interface AnnotationPinProps {
  annotation: AnnotationSchema;
  position: [number, number, number];
  onDismiss: () => void;
}

const AnnotationPin: React.FC<AnnotationPinProps> = ({ annotation, position, onDismiss }) => {
  return (
    <group position={position}>
      <Html
        distanceFactor={6}
        center
        className="pointer-events-auto select-none"
        zIndexRange={[100, 0]}
      >
        <div className="relative flex flex-col items-center group -translate-y-6">
          {/* Callout Card */}
          <div className="bg-slate-900/95 backdrop-blur-md border border-teal-500/40 rounded-xl p-3 shadow-2xl shadow-teal-500/10 min-w-[200px] max-w-[280px] text-slate-100 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-1.5 mb-1.5">
              <div className="flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-teal-400 shrink-0" />
                <span className="font-semibold text-xs text-teal-200 tracking-tight">
                  {annotation.title}
                </span>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDismiss();
                }}
                className="text-slate-400 hover:text-slate-200 p-0.5 rounded hover:bg-slate-800"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-[11px] text-slate-300 leading-relaxed font-sans">
              {annotation.body}
            </p>
          </div>

          {/* Leader Line / Anchor Pin */}
          <div className="w-0.5 h-6 bg-gradient-to-b from-teal-400 to-transparent" />
          <div className="w-2.5 h-2.5 rounded-full bg-teal-400 ring-4 ring-teal-400/20 shadow-md shadow-teal-400" />
        </div>
      </Html>
    </group>
  );
};

export const AnnotationOverlay: React.FC = () => {
  const { activeAnnotations, getStructureMeta, clearAnnotations } = useSceneStore();

  if (activeAnnotations.length === 0) return null;

  return (
    <group name="annotation_overlay_root">
      {activeAnnotations.map((ann, idx) => {
        const meta = getStructureMeta(ann.target_id);
        const pos: [number, number, number] = meta
          ? [meta.centroid[0], meta.centroid[1] + (meta.bounding_radius * 0.7), meta.centroid[2]]
          : [0, 0, 0];

        return (
          <AnnotationPin
            key={`${ann.target_id}-${idx}`}
            annotation={ann}
            position={pos}
            onDismiss={() => {
              // Clear or filter out
              clearAnnotations();
            }}
          />
        );
      })}
    </group>
  );
};
