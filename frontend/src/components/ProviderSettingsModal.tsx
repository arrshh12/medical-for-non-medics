import React, { useState } from 'react';
import { useProviderStore } from '../store/useProviderStore';
import { useDebouncedModelAutoFetch } from '../services/modelAutoFetcher';
import {
  X,
  Server,
  Key,
  Cpu,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  Zap,
  Globe
} from 'lucide-react';

const PRESETS = [
  { name: 'OpenRouter', url: 'https://openrouter.ai/api/v1' },
  { name: 'OpenAI', url: 'https://api.openai.com/v1' },
  { name: 'Groq', url: 'https://api.groq.com/openai/v1' },
  { name: 'Local Ollama', url: 'http://localhost:11434/v1' },
];

export const ProviderSettingsModal: React.FC = () => {
  const {
    baseUrl,
    apiKey,
    selectedModelId,
    availableModels,
    isLoadingModels,
    modelFetchError,
    connectionStatus,
    connectionMessage,
    isSettingsModalOpen,
    setBaseUrl,
    setApiKey,
    setSelectedModelId,
    closeSettingsModal,
    fetchModels,
    testConnection
  } = useProviderStore();

  const [showApiKey, setShowApiKey] = useState(false);
  const [modelSearch, setModelSearch] = useState('');

  // Enable debounced auto-fetch
  useDebouncedModelAutoFetch(600);

  if (!isSettingsModalOpen) return null;

  const filteredModels = availableModels.filter(m =>
    m.id.toLowerCase().includes(modelSearch.toLowerCase()) ||
    (m.owned_by && m.owned_by.toLowerCase().includes(modelSearch.toLowerCase()))
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/80">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-teal-500/10 border border-teal-500/30 rounded-xl text-teal-400">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-100">LLM Provider Settings</h2>
              <p className="text-xs text-slate-400">Universal OpenAI-compatible API gateway</p>
            </div>
          </div>
          <button
            onClick={closeSettingsModal}
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5 overflow-y-auto">
          {/* Quick Presets */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 mb-2">
              <Globe className="w-3.5 h-3.5 text-teal-400" />
              Quick Presets
            </label>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map(preset => (
                <button
                  key={preset.name}
                  type="button"
                  onClick={() => setBaseUrl(preset.url)}
                  className={`text-xs px-2.5 py-1.5 rounded-lg border transition-all ${
                    baseUrl === preset.url
                      ? 'bg-teal-500/20 border-teal-500 text-teal-200 font-medium'
                      : 'bg-slate-800/80 border-slate-700 text-slate-300 hover:bg-slate-800 hover:border-slate-600'
                  }`}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>

          {/* Base URL */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 mb-2">
              <Server className="w-3.5 h-3.5 text-teal-400" />
              OpenAI-Compatible Base URL
            </label>
            <div className="relative">
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://openrouter.ai/api/v1 or https://api.openai.com/v1"
                className="w-full bg-slate-950 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400 placeholder-slate-500 font-mono"
              />
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
              Supports OpenRouter, OpenAI, Groq, DeepSeek, Google Gemini OpenAI-compat, or local Ollama.
            </p>
          </div>

          {/* API Key */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5 mb-2">
              <Key className="w-3.5 h-3.5 text-teal-400" />
              API Key (Optional for Local Ollama)
            </label>
            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                className="w-full bg-slate-950 border border-slate-700/80 rounded-xl pl-3.5 pr-10 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400 placeholder-slate-500 font-mono"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
              >
                {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Model Selection & Auto-Discovery */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-teal-400" />
                Discovered Models ({availableModels.length})
              </label>
              <button
                type="button"
                onClick={() => fetchModels()}
                disabled={isLoadingModels}
                className="text-xs flex items-center gap-1 text-teal-400 hover:text-teal-300 disabled:opacity-50 font-medium"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingModels ? 'animate-spin' : ''}`} />
                {isLoadingModels ? 'Fetching...' : 'Refresh Models'}
              </button>
            </div>

            {modelFetchError && (
              <div className="p-3 mb-2 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
                <div>
                  <span className="font-semibold">Discovery Notice: </span>
                  {modelFetchError}
                </div>
              </div>
            )}

            {availableModels.length > 0 ? (
              <div className="space-y-2">
                <input
                  type="text"
                  value={modelSearch}
                  onChange={(e) => setModelSearch(e.target.value)}
                  placeholder="Filter models by ID or provider..."
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-slate-600"
                />
                <div className="max-h-40 overflow-y-auto border border-slate-800 bg-slate-950/70 rounded-xl divide-y divide-slate-850">
                  {filteredModels.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setSelectedModelId(m.id)}
                      className={`w-full text-left px-3.5 py-2.5 text-xs flex items-center justify-between transition-colors ${
                        selectedModelId === m.id
                          ? 'bg-teal-500/20 text-teal-200 font-medium'
                          : 'text-slate-300 hover:bg-slate-800/60'
                      }`}
                    >
                      <span className="font-mono truncate mr-2">{m.id}</span>
                      {m.owned_by && (
                        <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded">
                          {m.owned_by}
                        </span>
                      )}
                    </button>
                  ))}
                  {filteredModels.length === 0 && (
                    <div className="p-3 text-center text-xs text-slate-500">
                      No models matched &quot;{modelSearch}&quot;
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-4 bg-slate-950/60 border border-dashed border-slate-800 rounded-xl text-center">
                <p className="text-xs text-slate-400">
                  {isLoadingModels
                    ? 'Connecting to endpoint and querying /models...'
                    : 'Paste an endpoint URL above to auto-populate models.'}
                </p>
                <div className="mt-2">
                  <input
                    type="text"
                    value={selectedModelId}
                    onChange={(e) => setSelectedModelId(e.target.value)}
                    placeholder="Or enter custom model ID manually (e.g. gpt-4o)"
                    className="w-full bg-slate-900 border border-slate-700/60 rounded-lg px-3 py-1.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-teal-400"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Connection Test Status */}
          {connectionMessage && (
            <div
              className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
                connectionStatus === 'connected'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : connectionStatus === 'error'
                  ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                  : 'bg-slate-800 border-slate-700 text-slate-300'
              }`}
            >
              {connectionStatus === 'connected' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              ) : connectionStatus === 'error' ? (
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              ) : (
                <RefreshCw className="w-4 h-4 shrink-0 animate-spin text-slate-400" />
              )}
              <span>{connectionMessage}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-800 bg-slate-900/80">
          <button
            type="button"
            onClick={() => testConnection()}
            disabled={connectionStatus === 'testing' || !selectedModelId}
            className="flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 hover:text-white border border-slate-700 rounded-xl transition-all disabled:opacity-50"
          >
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            {connectionStatus === 'testing' ? 'Testing...' : 'Test Connection'}
          </button>

          <button
            type="button"
            onClick={closeSettingsModal}
            className="px-5 py-2 text-xs font-semibold text-slate-950 bg-teal-400 hover:bg-teal-300 rounded-xl shadow-lg shadow-teal-500/20 transition-all"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
