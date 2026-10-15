import { SceneCommandSchema } from './scene.types';

export type ComprehensionLevel = 'layperson' | 'pre_med' | 'clinician';
export type ActiveMode = 'anatomy' | 'pathology';

export interface CitationItem {
  source_id: string;
  source_type: 'StatPearls' | 'PubMed_OA';
  title: string;
  section: string;
  excerpt: string;
  citation_url: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  mode: ActiveMode;
  level: ComprehensionLevel;
  commands?: SceneCommandSchema[];
  citations?: CitationItem[];
  groundingStatus?: 'verified' | 'unverified';
}

export interface ChatStreamRequestPayload {
  message: string;
  mode: ActiveMode;
  comprehension_level: ComprehensionLevel;
  base_url?: string | null;
  api_key?: string | null;
  model_id?: string | null;
  current_focused_ids?: string[];
}
