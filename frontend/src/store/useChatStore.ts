import { create } from 'zustand';
import {
  ActiveMode,
  ComprehensionLevel,
  ChatMessage,
  CitationItem
} from '../types/chat.types';

interface ChatState {
  activeMode: ActiveMode;
  comprehensionLevel: ComprehensionLevel;
  messages: ChatMessage[];
  isStreaming: boolean;
  activeCitations: CitationItem[];
  selectedCitation: CitationItem | null;
  activeStepIndex: number | null;

  setActiveMode: (mode: ActiveMode) => void;
  setComprehensionLevel: (level: ComprehensionLevel) => void;
  addMessage: (message: ChatMessage) => void;
  updateLastMessageContent: (content: string) => void;
  setIsStreaming: (streaming: boolean) => void;
  setActiveCitations: (citations: CitationItem[]) => void;
  setSelectedCitation: (citation: CitationItem | null) => void;
  setActiveStepIndex: (stepIndex: number | null) => void;
  clearChat: () => void;
}

export const useChatStore = create<ChatState>((set) => ({
  activeMode: 'anatomy',
  comprehensionLevel: 'layperson',
  messages: [
    {
      id: 'welcome-1',
      role: 'assistant',
      content: 'Welcome to **HoloMed 3D**! I am your interactive anatomy and pathology AI tutor.\n\nYou can click on any organ or vessel in the 3D viewport, choose your comprehension level above, or ask me questions like:\n- *"Show me blood flow through the heart chambers"*\n- *"How does a heart attack happen in the LAD artery?"*',
      timestamp: Date.now(),
      mode: 'anatomy',
      level: 'layperson',
      groundingStatus: 'verified'
    }
  ],
  isStreaming: false,
  activeCitations: [],
  selectedCitation: null,
  activeStepIndex: null,

  setActiveMode: (activeMode) => set({ activeMode }),
  setComprehensionLevel: (comprehensionLevel) => set({ comprehensionLevel }),
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
  updateLastMessageContent: (content) =>
    set((state) => {
      const msgs = [...state.messages];
      if (msgs.length > 0) {
        msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content };
      }
      return { messages: msgs };
    }),
  setIsStreaming: (isStreaming) => set({ isStreaming }),
  setActiveCitations: (activeCitations) => set({ activeCitations }),
  setSelectedCitation: (selectedCitation) => set({ selectedCitation }),
  setActiveStepIndex: (activeStepIndex) => set({ activeStepIndex }),
  clearChat: () => set({ messages: [] })
}));
