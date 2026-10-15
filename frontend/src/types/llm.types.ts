export interface ModelInfo {
  id: string;
  owned_by?: string | null;
  created?: number | null;
}

export interface FetchModelsRequest {
  base_url: string;
  api_key?: string | null;
}

export interface FetchModelsResponse {
  normalized_base_url: string;
  models: ModelInfo[];
}

export interface TestConnectionRequest {
  base_url: string;
  api_key?: string | null;
  model_id: string;
}

export interface TestConnectionResponse {
  success: boolean;
  message: string;
  latency_ms: number;
  sample_output?: string | null;
}
