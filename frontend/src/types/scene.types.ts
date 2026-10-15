export type ActionType =
  | 'FOCUS_STRUCTURE'
  | 'ISOLATE_STRUCTURES'
  | 'FOCUS_AND_ISOLATE'
  | 'HIGHLIGHT_STRUCTURES'
  | 'APPLY_PATHOLOGY'
  | 'ANIMATE_FLOW'
  | 'PLACE_ANNOTATION'
  | 'RESET_SCENE';

export type CameraPreset =
  | 'anterior'
  | 'posterior'
  | 'left_lateral'
  | 'right_lateral'
  | 'superior'
  | 'inferior'
  | 'anterior_oblique'
  | 'superior_oblique';

export type PathologyType =
  | 'ischemic'
  | 'necrotic'
  | 'inflamed'
  | 'vascular_occlusion';

export type FlowType =
  | 'oxygenated'
  | 'deoxygenated'
  | 'lymphatic'
  | 'neural';

export interface FlowAnimationSchema {
  path_ids: string[];
  speed?: number;
  flow_type?: FlowType;
  blocked?: boolean;
}

export interface AnnotationSchema {
  target_id: string;
  title: string;
  body: string;
}

export interface SceneCommandSchema {
  step?: number;
  action: ActionType;
  target_id?: string;
  target_ids?: string[];
  fade_occluders?: boolean;
  camera_preset?: CameraPreset;
  highlight_color?: string;
  pathology_type?: PathologyType;
  severity?: number;
  downstream_ischemic_ids?: string[];
  flow_animation?: FlowAnimationSchema;
  annotation?: AnnotationSchema;
}

export interface AnatomicalStructureMeta {
  fma_id: string;
  mesh_node_name: string;
  common_name: string;
  latin_name?: string;
  organ_system: string;
  bbox_min: [number, number, number];
  bbox_max: [number, number, number];
  centroid: [number, number, number];
  bounding_radius: number;
  description_summary?: string;
}

export interface ManifestData {
  version: string;
  structures: Record<string, AnatomicalStructureMeta>;
}
