import { useEffect, useRef } from 'react';
import { useProviderStore } from '../store/useProviderStore';

/**
 * Custom hook to debounced auto-fetch models when base_url or api_key changes.
 */
export function useDebouncedModelAutoFetch(delayMs: number = 500) {
  const { baseUrl, apiKey, fetchModels } = useProviderStore();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!baseUrl || !baseUrl.trim()) return;

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      fetchModels();
    }, delayMs);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [baseUrl, apiKey, fetchModels, delayMs]);
}
