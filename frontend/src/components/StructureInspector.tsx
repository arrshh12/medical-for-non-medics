import React from 'react';
import { useSceneStore } from '../store/useSceneStore';
import {
  Activity,
  Layers,
  Crosshair,
  Sparkles,
  Info,
  X
} from 'lucide-react';

interface StructureInspectorProps {
  onAskAi?: (question: string) => void;
}

export const StructureInspector: React.FC<StructureInspectorProps> = ({ onAskAi }) => {
  const {
    selectedFmaId,
    hoveredFmaId,
    getStructureMeta,
    selectStructure,
    focusStructures,
    isolateStructures,
    highlightStructures,
    tissueStates
  } = useSceneStore();

  const activeId = selectedFmaId || hoveredFmaId;
  const meta = activeId ? getStructureMeta(activeId) : null;

  if (!meta) {
    return (
      <div className="absolute top-20 left-6 z-20 pointer-events-auto">
        <div className="bg-slate-900/80 backdrop-blur-md border border-slate-800 rounded-2xl px-4 py-3 shadow-xl max-w-xs text-xs text-slate-400 flex items-center gap-2">
          <Info className="w-4 h-4 text-teal-400 shrink-0" />
          <span>Click or hover any 3D organ or vessel to inspect anatomical details.</span>
        </div>
      </div>
    );
  }

  const tissue = tissueStates[meta.fma_id] || 'normal';

  return (
    <div className="absolute top-20 left-6 z-20 pointer-events-auto animate-in fade-in slide-in-from-left-4 duration-200">
      <div className="bg-slate-900/90 backdrop-blur-md border border-slate-700/80 rounded-2xl p-4 shadow-2xl w-80 text-slate-200">
        {/* Header */}
        <div className="flex items-start justify-between gap-2 border-b border-slate-800 pb-2.5 mb-3">
          <div>
            <span className="text-[10px] font-mono uppercase tracking-wider text-teal-400 font-semibold">
              {meta.organ_system}
            </span>
            <h3 className="font-semibold text-slate-100 text-sm leading-tight">
              {meta.common_name}
            </h3>
            {meta.latin_name && (
              <p className="text-[11px] italic text-slate-400 font-serif">
                {meta.latin_name}
              </p>
            )}
          </div>
          {selectedFmaId && (
            <button
              onClick={() => selectStructure(null)}
              className="text-slate-400 hover:text-slate-200 p-1 hover:bg-slate-800 rounded-lg"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* FMA ID & Tissue State Chips */}
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700 text-teal-300">
            {meta.fma_id}
          </span>
          <span
            className={`text-[10px] uppercase font-semibold px-2 py-0.5 rounded-md border ${
              tissue === 'ischemic'
                ? 'bg-purple-900/40 border-purple-600 text-purple-300'
                : tissue === 'necrotic'
                ? 'bg-zinc-800 border-zinc-600 text-zinc-300'
                : tissue === 'inflamed'
                ? 'bg-rose-900/40 border-rose-600 text-rose-300'
                : 'bg-emerald-950/40 border-emerald-600/40 text-emerald-300'
            }`}
          >
            {tissue}
          </span>
        </div>

        {/* Clinical Summary */}
        {meta.description_summary && (
          <p className="text-xs text-slate-300 leading-relaxed mb-4">
            {meta.description_summary}
          </p>
        )}

        {/* Action Buttons */}
        <div className="grid grid-cols-3 gap-1.5 pt-1 border-t border-slate-800">
          <button
            onClick={() => focusStructures([meta.fma_id])}
            className="flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-medium text-slate-200 transition-colors"
          >
            <Crosshair className="w-3 h-3 text-teal-400" />
            Focus
          </button>

          <button
            onClick={() => isolateStructures([meta.fma_id])}
            className="flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-medium text-slate-200 transition-colors"
          >
            <Layers className="w-3 h-3 text-cyan-400" />
            Isolate
          </button>

          <button
            onClick={() => highlightStructures([meta.fma_id], '#f59e0b')}
            className="flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-medium text-slate-200 transition-colors"
          >
            <Sparkles className="w-3 h-3 text-amber-400" />
            Highlight
          </button>
        </div>

        {/* Ask AI shortcut */}
        <button
          onClick={() => {
            if (onAskAi) {
              onAskAi(`Tell me about the ${meta.common_name} (${meta.fma_id}) and its clinical significance.`);
            }
          }}
          className="w-full mt-2 py-1.5 px-3 rounded-lg bg-teal-500/20 hover:bg-teal-500/30 border border-teal-500/40 text-[11px] font-medium text-teal-200 flex items-center justify-center gap-1.5 transition-colors"
        >
          <Activity className="w-3 h-3 text-teal-400" />
          Ask AI Tutor about this structure
        </button>
      </div>
    </div>
  );
};
