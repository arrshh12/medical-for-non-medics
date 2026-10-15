import { FetchModelsRequest, FetchModelsResponse, TestConnectionRequest, TestConnectionResponse } from '../types/llm.types';

const BASE_API_URL = ''; // Proxied via Vite /api

export async function fetchModelsApi(req: FetchModelsRequest): Promise<FetchModelsResponse> {
  const res = await fetch(`${BASE_API_URL}/api/v1/llm/models`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req)
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(errorData.detail || `HTTP ${res.status}: Failed to fetch models`);
  }

  return res.json();
}

export async function testConnectionApi(req: TestConnectionRequest): Promise<TestConnectionResponse> {
  const res = await fetch(`${BASE_API_URL}/api/v1/llm/test-connection`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req)
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(errorData.detail || `HTTP ${res.status}: Connection test failed`);
  }

  return res.json();
}
