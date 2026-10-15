import React from 'react';
import { useSceneStore } from '../store/useSceneStore';
import { useChatStore } from '../store/useChatStore';
import { sceneController } from '../engine3d/SceneController';
import { Play, Pause, ChevronLeft, ChevronRight, History } from 'lucide-react';

export const TimelineScrubber: React.FC = () => {
  const { commandHistory } = useSceneStore();
  const { activeStepIndex, setActiveStepIndex } = useChatStore();
  const [isPlaying, setIsPlaying] = React.useState(false);

  if (commandHistory.length === 0) return null;

  const totalSteps = commandHistory.length;
  const currentStep = activeStepIndex !== null ? activeStepIndex : totalSteps - 1;

  const goToStep = (index: number) => {
    if (index < 0 || index >= totalSteps) return;
    setActiveStepIndex(index);
    const cmd = commandHistory[index];
    if (cmd) {
      sceneController.executeCommand(cmd);
    }
  };

  const handlePrev = () => goToStep(currentStep - 1);
  const handleNext = () => goToStep(currentStep + 1);

  const togglePlay = () => {
    setIsPlaying(!isPlaying);
  };

  React.useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    if (isPlaying) {
      timer = setInterval(() => {
        const next = (currentStep + 1) % totalSteps;
        goToStep(next);
        if (next === totalSteps - 1) {
          setIsPlaying(false);
        }
      }, 3000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isPlaying, currentStep, totalSteps]);

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 pointer-events-auto select-none">
      <div className="bg-slate-900/90 backdrop-blur-md border border-slate-700/80 rounded-2xl px-4 py-2.5 shadow-2xl flex items-center gap-3">
        <div className="flex items-center gap-1.5 text-xs text-slate-400 font-mono pr-2 border-r border-slate-800">
          <History className="w-3.5 h-3.5 text-teal-400" />
          <span>Walkthrough</span>
        </div>

        {/* Play / Pause / Step Controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={handlePrev}
            disabled={currentStep <= 0}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <button
            onClick={togglePlay}
            className="p-1.5 rounded-lg bg-teal-500/20 border border-teal-500/40 text-teal-300 hover:bg-teal-500/30"
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
          </button>

          <button
            onClick={handleNext}
            disabled={currentStep >= totalSteps - 1}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Step Badges */}
        <div className="flex items-center gap-1.5">
          {commandHistory.map((cmd, idx) => (
            <button
              key={`${cmd.step || idx}-${idx}`}
              onClick={() => goToStep(idx)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-mono transition-all ${
                currentStep === idx
                  ? 'bg-teal-500 text-slate-950 font-bold shadow-md shadow-teal-500/20'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-750'
              }`}
            >
              Step {cmd.step || idx + 1}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
