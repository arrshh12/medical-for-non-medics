import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ModelInfo, FetchModelsResponse, TestConnectionResponse } from '../types/llm.types';

interface ProviderState {
  baseUrl: string;
  apiKey: string;
  selectedModelId: string;
  availableModels: ModelInfo[];
  isLoadingModels: boolean;
  modelFetchError: string | null;
  connectionStatus: 'idle' | 'testing' | 'connected' | 'error';
  connectionMessage: string | null;
  isSettingsModalOpen: boolean;

  setBaseUrl: (url: string) => void;
  setApiKey: (key: string) => void;
  setSelectedModelId: (id: string) => void;
  setAvailableModels: (models: ModelInfo[]) => void;
  setIsLoadingModels: (loading: boolean) => void;
  setModelFetchError: (error: string | null) => void;
  setConnectionStatus: (status: 'idle' | 'testing' | 'connected' | 'error', message?: string | null) => void;
  openSettingsModal: () => void;
  closeSettingsModal: () => void;
  fetchModels: () => Promise<void>;
  testConnection: () => Promise<boolean>;
}

export const useProviderStore = create<ProviderState>()(
  persist(
    (set, get) => ({
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: '',
      selectedModelId: 'google/gemini-2.5-flash',
      availableModels: [],
      isLoadingModels: false,
      modelFetchError: null,
      connectionStatus: 'idle',
      connectionMessage: null,
      isSettingsModalOpen: false,

      setBaseUrl: (baseUrl: string) => set({ baseUrl, modelFetchError: null }),
      setApiKey: (apiKey: string) => set({ apiKey, modelFetchError: null }),
      setSelectedModelId: (selectedModelId: string) => set({ selectedModelId }),
      setAvailableModels: (availableModels: ModelInfo[]) => set({ availableModels }),
      setIsLoadingModels: (isLoadingModels: boolean) => set({ isLoadingModels }),
      setModelFetchError: (modelFetchError: string | null) => set({ modelFetchError }),
      setConnectionStatus: (connectionStatus, connectionMessage = null) =>
        set({ connectionStatus, connectionMessage }),
      openSettingsModal: () => set({ isSettingsModalOpen: true }),
      closeSettingsModal: () => set({ isSettingsModalOpen: false }),

      fetchModels: async () => {
        const { baseUrl, apiKey } = get();
        if (!baseUrl || !baseUrl.trim()) {
          set({ modelFetchError: 'Base URL cannot be empty' });
          return;
        }

        set({ isLoadingModels: true, modelFetchError: null });
        try {
          const res = await fetch('/api/v1/llm/models', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ base_url: baseUrl.trim(), api_key: apiKey.trim() || null })
          });

          if (!res.ok) {
            const errData = await res.json().catch(() => ({ detail: res.statusText }));
            throw new Error(errData.detail || `HTTP ${res.status}: Failed to fetch models`);
          }

          const data: FetchModelsResponse = await res.json();
          set({
            availableModels: data.models,
            isLoadingModels: false,
            modelFetchError: null
          });

          // If current selectedModelId is not in fetched list, select first available if present
          const currentSelected = get().selectedModelId;
          if (data.models.length > 0 && !data.models.some(m => m.id === currentSelected)) {
            set({ selectedModelId: data.models[0].id });
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Unknown error fetching models';
          set({
            isLoadingModels: false,
            modelFetchError: msg
          });
        }
      },

      testConnection: async () => {
        const { baseUrl, apiKey, selectedModelId } = get();
        if (!selectedModelId) {
          set({ connectionStatus: 'error', connectionMessage: 'No model selected' });
          return false;
        }

        set({ connectionStatus: 'testing', connectionMessage: 'Testing connection...' });
        try {
          const res = await fetch('/api/v1/llm/test-connection', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              base_url: baseUrl.trim(),
              api_key: apiKey.trim() || null,
              model_id: selectedModelId
            })
          });

          const data: TestConnectionResponse = await res.json();
          if (data.success) {
            set({
              connectionStatus: 'connected',
              connectionMessage: `${data.message} (${data.latency_ms}ms)`
            });
            return true;
          } else {
            set({
              connectionStatus: 'error',
              connectionMessage: data.message
            });
            return false;
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Network error';
          set({ connectionStatus: 'error', connectionMessage: msg });
          return false;
        }
      }
    }),
    {
      name: 'holomed_provider_settings',
      partialize: (state) => ({
        baseUrl: state.baseUrl,
        apiKey: state.apiKey,
        selectedModelId: state.selectedModelId,
        availableModels: state.availableModels
      })
    }
  )
);
