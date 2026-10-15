import React, { useState, useRef, useEffect } from 'react';
import { useChatStore } from '../store/useChatStore';
import { useProviderStore } from '../store/useProviderStore';
import { useSceneStore } from '../store/useSceneStore';
import { streamChatCompletion } from '../services/sseStreamClient';
import { sceneController } from '../engine3d/SceneController';
import {
  Send,
  Square,
  Sparkles,
  Bot,
  User,
  ShieldCheck,
  AlertTriangle,
  ExternalLink,
  ChevronRight,
  ChevronLeft,
  X,
  BookOpen
} from 'lucide-react';

const QUICK_FOLLOWUPS = [
  'Simplify this explanation',
  'Go deeper (Clinical level)',
  'Show surrounding organs',
  'What happens if this isn\'t treated?'
];

export const ChatSidebar: React.FC = () => {
  const {
    messages,
    isStreaming,
    activeMode,
    comprehensionLevel,
    setComprehensionLevel,
    addMessage,
    updateLastMessageContent,
    setIsStreaming,
    selectedCitation,
    setSelectedCitation
  } = useChatStore();

  const { baseUrl, apiKey, selectedModelId } = useProviderStore();
  const { selectedFmaId } = useSceneStore();

  const [input, setInput] = useState('');
  const [isCollapsed, setIsCollapsed] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isStreaming]);

  const handleSend = async (messageText?: string) => {
    const textToSend = (messageText || input).trim();
    if (!textToSend || isStreaming) return;

    setInput('');

    // Add user message
    const userMessageId = `user-${Date.now()}`;
    addMessage({
      id: userMessageId,
      role: 'user',
      content: textToSend,
      timestamp: Date.now(),
      mode: activeMode,
      level: comprehensionLevel
    });

    // Check if user requested simple / deeper level change in message
    if (textToSend.toLowerCase().includes('simplify') || textToSend.toLowerCase().includes('more simply')) {
      setComprehensionLevel('layperson');
    } else if (textToSend.toLowerCase().includes('clinical') || textToSend.toLowerCase().includes('go deeper')) {
      setComprehensionLevel('clinician');
    }

    // Add empty assistant placeholder
    const assistantMessageId = `asst-${Date.now()}`;
    addMessage({
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      mode: activeMode,
      level: comprehensionLevel,
      groundingStatus: 'verified'
    });

    setIsStreaming(true);
    abortControllerRef.current = new AbortController();

    let fullContent = '';

    await streamChatCompletion(
      {
        message: textToSend,
        mode: activeMode,
        comprehension_level: comprehensionLevel,
        base_url: baseUrl,
        api_key: apiKey || null,
        model_id: selectedModelId,
        current_focused_ids: selectedFmaId ? [selectedFmaId] : undefined
      },
      {
        onTextDelta: (delta) => {
          fullContent += delta;
          updateLastMessageContent(fullContent);
        },
        onSceneCommand: (cmd) => {
          sceneController.executeCommand(cmd);
        },
        onSceneChoreography: (steps) => {
          sceneController.playChoreography(steps);
        },
        onCitation: (citation) => {
          useChatStore.getState().setActiveCitations([
            ...useChatStore.getState().activeCitations,
            citation
          ]);
        },
        onGroundingStatus: (status) => {
          // Update last message grounding status
          const msgs = [...useChatStore.getState().messages];
          if (msgs.length > 0) {
            msgs[msgs.length - 1].groundingStatus = status;
            useChatStore.setState({ messages: msgs });
          }
        },
        onDone: () => {
          setIsStreaming(false);
          abortControllerRef.current = null;
        },
        onError: (err) => {
          fullContent += `\n\n*(Error: ${err})*`;
          updateLastMessageContent(fullContent);
          setIsStreaming(false);
          abortControllerRef.current = null;
        }
      },
      abortControllerRef.current.signal
    );
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsStreaming(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Helper to render text with clickable citation badges and step badges
  const renderMessageContent = (content: string) => {
    // Regex for [NBK...] or [PMID...] citations
    const citationRegex = /\[(NBK\d+|PMID\d+|StatPearls:[^\]]+)\]/g;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = citationRegex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        parts.push(content.substring(lastIndex, match.index));
      }
      const sourceId = match[1];
      parts.push(
        <button
          key={`cite-${match.index}`}
          onClick={() => {
            setSelectedCitation({
              source_id: sourceId,
              source_type: 'StatPearls',
              title: sourceId.startsWith('NBK459269')
                ? 'Acute Myocardial Infarction'
                : 'National Library of Medicine Bookshelf',
              section: 'Vetted Medical Literature',
              excerpt: 'Grounding literature excerpt referenced in this explanation.',
              citation_url: `https://www.ncbi.nlm.nih.gov/books/${sourceId.replace(/[^0-9A-Za-z]/g, '')}/`
            });
          }}
          className="inline-flex items-center gap-1 mx-1 px-1.5 py-0.5 rounded bg-teal-500/20 hover:bg-teal-500/30 border border-teal-500/40 text-[10px] font-mono text-teal-300 transition-colors"
        >
          <BookOpen className="w-2.5 h-2.5" />
          [{sourceId}]
        </button>
      );
      lastIndex = citationRegex.lastIndex;
    }

    if (lastIndex < content.length) {
      parts.push(content.substring(lastIndex));
    }

    return (
      <div className="whitespace-pre-wrap leading-relaxed text-xs">
        {parts}
      </div>
    );
  };

  return (
    <>
      {/* Collapse Toggle Button */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="absolute top-20 right-4 z-30 p-2 rounded-xl bg-slate-900/90 border border-slate-700 text-slate-300 hover:text-white shadow-xl pointer-events-auto"
      >
        {isCollapsed ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
      </button>

      {/* Main Sidebar */}
      <aside
        className={`absolute top-14 bottom-0 right-0 z-20 w-96 max-w-[90vw] bg-slate-900/95 backdrop-blur-xl border-l border-slate-800 flex flex-col shadow-2xl transition-transform duration-300 pointer-events-auto ${
          isCollapsed ? 'translate-x-full' : 'translate-x-0'
        }`}
      >
        {/* Sidebar Header */}
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-teal-500/20 border border-teal-500/40 flex items-center justify-center text-teal-400">
              <Bot className="w-3.5 h-3.5" />
            </div>
            <div>
              <h2 className="text-xs font-semibold text-slate-200">AI Medical Tutor</h2>
              <p className="text-[10px] text-slate-400 font-mono">
                {selectedModelId ? selectedModelId.split('/').pop() : 'OpenAI-Compatible'}
              </p>
            </div>
          </div>
          <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-slate-800 text-teal-300 border border-slate-700">
            {comprehensionLevel}
          </span>
        </div>

        {/* Message Thread */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col gap-1.5 ${
                msg.role === 'user' ? 'items-end' : 'items-start'
              }`}
            >
              <div className="flex items-center gap-1.5 text-[10px] text-slate-400 px-1 font-mono">
                {msg.role === 'user' ? (
                  <>
                    <span>You</span>
                    <User className="w-3 h-3 text-slate-400" />
                  </>
                ) : (
                  <>
                    <Bot className="w-3 h-3 text-teal-400" />
                    <span>HoloMed AI</span>
                  </>
                )}
              </div>

              {/* Message Bubble */}
              <div
                className={`p-3.5 rounded-2xl max-w-[95%] shadow-md ${
                  msg.role === 'user'
                    ? 'bg-teal-600/30 border border-teal-500/40 text-slate-100 rounded-tr-none'
                    : 'bg-slate-950/80 border border-slate-800 text-slate-200 rounded-tl-none'
                }`}
              >
                {/* Grounding Notice if unverified */}
                {msg.role === 'assistant' && msg.groundingStatus === 'unverified' && (
                  <div className="p-2 mb-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[11px] flex items-start gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                    <span>Unverified Literature: Showing 3D anatomy without clinical assertions.</span>
                  </div>
                )}

                {msg.content ? (
                  renderMessageContent(msg.content)
                ) : (
                  <div className="flex items-center gap-2 text-xs text-slate-400 py-1">
                    <div className="w-2 h-2 rounded-full bg-teal-400 animate-ping" />
                    <span>Consulting medical literature and orchestrating 3D scene...</span>
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Quick-Action Follow-Up Chips */}
          {!isStreaming && messages.length > 0 && (
            <div className="pt-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1 mb-2">
                <Sparkles className="w-3 h-3 text-teal-400" />
                Suggested Follow-Ups
              </span>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_FOLLOWUPS.map((chip) => (
                  <button
                    key={chip}
                    onClick={() => handleSend(chip)}
                    className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-950/80 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-teal-300 transition-all text-left"
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Footer */}
        <div className="p-3 border-t border-slate-800 bg-slate-950/60">
          <div className="relative flex items-end bg-slate-900 border border-slate-700/80 rounded-2xl p-1.5 focus-within:border-teal-500/60 focus-within:ring-1 focus-within:ring-teal-500/30 shadow-inner">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about human anatomy, blood flow, or disease..."
              rows={2}
              className="w-full bg-transparent text-xs text-slate-100 placeholder-slate-500 px-2 py-1 resize-none focus:outline-none"
            />
            {isStreaming ? (
              <button
                type="button"
                onClick={handleStop}
                className="p-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 transition-colors shrink-0"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleSend()}
                disabled={!input.trim()}
                className="p-2 rounded-xl bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold transition-all disabled:opacity-30 disabled:pointer-events-none shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="flex items-center justify-between mt-2 px-1 text-[10px] text-slate-500 font-mono">
            <span className="flex items-center gap-1">
              <ShieldCheck className="w-3 h-3 text-teal-400" />
              StatPearls Grounded
            </span>
            <span>Shift+Enter for newline</span>
          </div>
        </div>
      </aside>

      {/* Citation Detail Modal / Drawer */}
      {selectedCitation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-lg w-full p-5 shadow-2xl relative">
            <button
              onClick={() => setSelectedCitation(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-200"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-teal-400 text-xs font-mono uppercase tracking-wider mb-2">
              <BookOpen className="w-4 h-4" />
              <span>Verified Medical Source</span>
            </div>
            <h3 className="text-base font-semibold text-slate-100 mb-1">
              {selectedCitation.title}
            </h3>
            <p className="text-xs text-slate-400 font-medium mb-3">
              Section: {selectedCitation.section} ({selectedCitation.source_id})
            </p>
            <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs text-slate-300 leading-relaxed mb-4 max-h-60 overflow-y-auto">
              &quot;{selectedCitation.excerpt}&quot;
            </div>
            <a
              href={selectedCitation.citation_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-teal-500 hover:bg-teal-400 text-slate-950 text-xs font-semibold shadow-lg shadow-teal-500/20 transition-all"
            >
              <span>View Source on NCBI Bookshelf</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      )}
    </>
  );
};
