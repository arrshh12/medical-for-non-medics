import React from 'react';
import { TopNavbar } from './components/TopNavbar';
import { StructureInspector } from './components/StructureInspector';
import { AnatomyCanvas } from './engine3d/AnatomyCanvas';
import { ChatSidebar } from './components/ChatSidebar';
import { TimelineScrubber } from './components/TimelineScrubber';
import { ProviderSettingsModal } from './components/ProviderSettingsModal';
import { useChatStore } from './store/useChatStore';
import { ShieldCheck } from 'lucide-react';

export const App: React.FC = () => {
  const { addMessage } = useChatStore();

  const handleAskAiAboutStructure = (prompt: string) => {
    // Add user message to trigger chat
    addMessage({
      id: `user-${Date.now()}`,
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
      mode: useChatStore.getState().activeMode,
      level: useChatStore.getState().comprehensionLevel
    });
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-950 text-slate-100 overflow-hidden font-sans select-none">
      {/* Top Navbar with Mode Toggle & Comprehension Level */}
      <TopNavbar />

      {/* Main 3D Viewport Area with Overlays */}
      <main className="flex-1 relative w-full h-full overflow-hidden">
        {/* Interactive 3D Anatomy Canvas */}
        <AnatomyCanvas />

        {/* Structure Metadata Inspector HUD */}
        <StructureInspector onAskAi={handleAskAiAboutStructure} />

        {/* Multi-step Walkthrough Timeline Scrubber */}
        <TimelineScrubber />

        {/* Interactive Streaming Chat Sidebar */}
        <ChatSidebar />

        {/* Anti-Hallucination Footer Tag */}
        <div className="absolute bottom-3 left-4 pointer-events-none z-10 text-[11px] text-slate-500 flex items-center gap-2 font-mono bg-slate-950/70 backdrop-blur px-2.5 py-1 rounded-lg border border-slate-800/60">
          <ShieldCheck className="w-3.5 h-3.5 text-teal-400" />
          FMA Standardized 3D Rig • StatPearls Vetted Literature
        </div>
      </main>

      {/* Provider Settings Modal */}
      <ProviderSettingsModal />
    </div>
  );
};
