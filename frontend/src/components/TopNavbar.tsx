import React from 'react';
import { useChatStore } from '../store/useChatStore';
import { useProviderStore } from '../store/useProviderStore';
import { useSceneStore } from '../store/useSceneStore';
import {
  Activity,
  HeartPulse,
  RotateCcw,
  Settings,
  Cpu,
  GraduationCap
} from 'lucide-react';
import { ComprehensionLevel } from '../types/chat.types';

export const TopNavbar: React.FC = () => {
  const { activeMode, setActiveMode, comprehensionLevel, setComprehensionLevel } = useChatStore();
  const { selectedModelId, openSettingsModal } = useProviderStore();
  const { resetScene } = useSceneStore();

  return (
    <header className="h-14 border-b border-slate-800 bg-slate-900/95 backdrop-blur px-5 flex items-center justify-between shrink-0 z-30 select-none">
      {/* Brand */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-teal-400 via-teal-500 to-cyan-600 flex items-center justify-center shadow-lg shadow-teal-500/20">
          <Activity className="w-5 h-5 text-slate-950 font-bold" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-bold text-sm tracking-wide text-white">HoloMed 3D</h1>
            <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-400 border border-teal-500/20">
              WebGL Anatomy
            </span>
          </div>
          <p className="text-[10px] text-slate-400">Interactive 3D Anatomy & Pathology Tutor</p>
        </div>
      </div>

      {/* Center Controls: Mode Toggle & Comprehension Level */}
      <div className="flex items-center gap-2 sm:gap-4">
        {/* Mode Toggle */}
        <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800">
          <button
            type="button"
            onClick={() => setActiveMode('anatomy')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeMode === 'anatomy'
                ? 'bg-teal-500/20 text-teal-300 shadow-sm border border-teal-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Anatomy</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveMode('pathology')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeMode === 'pathology'
                ? 'bg-rose-500/20 text-rose-300 shadow-sm border border-rose-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <HeartPulse className="w-3.5 h-3.5" />
            <span>Pathology</span>
          </button>
        </div>

        {/* Comprehension Level Dropdown / Pills */}
        <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800">
          <GraduationCap className="w-3.5 h-3.5 text-slate-400 ml-2 mr-1" />
          <select
            value={comprehensionLevel}
            onChange={(e) => setComprehensionLevel(e.target.value as ComprehensionLevel)}
            className="bg-transparent text-xs text-slate-200 pr-2 py-1 font-medium focus:outline-none cursor-pointer"
          >
            <option value="layperson" className="bg-slate-900 text-slate-100">Everyday (Non-Medic)</option>
            <option value="pre_med" className="bg-slate-900 text-slate-100">Student (Pre-Med / Nursing)</option>
            <option value="clinician" className="bg-slate-900 text-slate-100">Clinical / Advanced</option>
          </select>
        </div>
      </div>

      {/* Right Controls: Reset 3D & Provider Modal */}
      <div className="flex items-center gap-2">
        <button
          onClick={resetScene}
          title="Reset 3D Scene to Default"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700/80 text-xs text-slate-300 hover:text-slate-100 transition-all"
        >
          <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
          <span className="hidden md:inline">Reset Scene</span>
        </button>

        <button
          onClick={openSettingsModal}
          className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-750 border border-slate-700 hover:border-teal-500/50 text-xs text-slate-200 transition-all shadow-sm"
        >
          <Cpu className="w-3.5 h-3.5 text-teal-400" />
          <span className="font-mono text-teal-300 font-medium truncate max-w-[130px]">
            {selectedModelId || 'Select Model'}
          </span>
          <Settings className="w-3.5 h-3.5 text-slate-400" />
        </button>
      </div>
    </header>
  );
};
