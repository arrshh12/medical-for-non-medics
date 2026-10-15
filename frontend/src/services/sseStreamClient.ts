import { ChatStreamRequestPayload, CitationItem } from '../types/chat.types';
import { SceneCommandSchema } from '../types/scene.types';

export interface SSECallbacks {
  onTextDelta: (delta: string) => void;
  onSceneCommand: (command: SceneCommandSchema) => void;
  onSceneChoreography?: (steps: any[]) => void;
  onCitation: (citation: CitationItem) => void;
  onGroundingStatus: (status: 'verified' | 'unverified', maxSimilarity: number) => void;
  onDone: () => void;
  onError: (errorMsg: string) => void;
}

export async function streamChatCompletion(
  payload: ChatStreamRequestPayload,
  callbacks: SSECallbacks,
  signal?: AbortSignal
): Promise<void> {
  try {
    const response = await fetch('/api/v1/chat/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify(payload),
      signal
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(err.detail || `Server error (HTTP ${response.status})`);
    }

    if (!response.body) {
      throw new Error('ReadableStream not supported by response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || '';

      for (const block of lines) {
        if (!block.trim()) continue;

        let eventType = 'message';
        let dataStr = '';

        const blockLines = block.split('\n');
        for (const line of blockLines) {
          if (line.startsWith('event:')) {
            eventType = line.replace('event:', '').trim();
          } else if (line.startsWith('data:')) {
            dataStr += line.replace('data:', '').trim();
          }
        }

        if (!dataStr) continue;

        try {
          const parsedData = JSON.parse(dataStr);

          if (eventType === 'text_delta') {
            callbacks.onTextDelta(parsedData.delta || '');
          } else if (eventType === 'scene_command') {
            callbacks.onSceneCommand(parsedData);
          } else if (eventType === 'scene_choreography') {
            if (callbacks.onSceneChoreography) {
              const steps = Array.isArray(parsedData) ? parsedData : (parsedData.steps || []);
              callbacks.onSceneChoreography(steps);
            }
          } else if (eventType === 'citation') {
            callbacks.onCitation(parsedData);
          } else if (eventType === 'grounding_status') {
            callbacks.onGroundingStatus(parsedData.status, parsedData.max_similarity);
          } else if (eventType === 'done') {
            callbacks.onDone();
          } else if (eventType === 'error') {
            callbacks.onError(parsedData.message || 'Stream error');
          }
        } catch {
          // If data isn't JSON, handle raw string text
          if (eventType === 'text_delta') {
            callbacks.onTextDelta(dataStr);
          }
        }
      }
    }

    callbacks.onDone();
  } catch (err: unknown) {
    if (signal?.aborted) {
      callbacks.onDone();
      return;
    }
    const message = err instanceof Error ? err.message : 'Streaming request failed';
    callbacks.onError(message);
  }
}
