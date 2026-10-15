import type * as THREE from 'three';

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

export type CameraViewPreset =
  | 'anterior'
  | 'posterior'
  | 'superior'
  | 'inferior'
  | 'lateral_left'
  | 'lateral_right'
  | 'anterior_closeup';

export type PathologyType =
  | 'ischemic'
  | 'necrotic'
  | 'inflamed'
  | 'vascular_occlusion';

export type TissueVisualState =
  | 'normal'
  | 'highlighted'
  | 'ischemic'
  | 'inflamed'
  | 'necrotic'
  | 'pulsing';

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

export interface FloatingAnnotation {
  target_id: string;
  title: string;
  subtitle?: string;
  severity?: 'info' | 'warning' | 'critical';
}

export interface VascularFlowCommand {
  path_ids: string[];       // Ordered FMA IDs or mesh names, e.g. ["FMA_7088", "FMA_3734", "FMA_3939", "FMA_50801"]
  color?: string;           // e.g. "#ff2a2a" for oxygenated arterial blood
  speed?: number;           // 0.2 to 2.5
  particle_count?: number;  // default 180
}

export interface ChoreographyKeyframe {
  step_index: number;
  label: string;
  narration: string;
  duration_ms: number;
  camera_focus_ids: string[];            // Organ(s) to frame or track
  camera_view?: CameraViewPreset;
  follow_flow_spline?: boolean;          // If true, camera rides alongside moving blood particles
  highlight_ids?: string[];
  ghost_ids?: string[];                  // Explicit structures to fade (e.g. Sternum, Rib Cage, Skull)
  auto_occlude_ancestors?: boolean;      // Raycast cylinder occlusion between camera & target
  pulse_ids?: string[];                  // Organs that contract/pulse (e.g. Heart at 72 BPM)
  tissue_states?: Record<string, TissueVisualState>;
  vascular_flow?: VascularFlowCommand | null;
  annotations?: FloatingAnnotation[];
}

export interface ChoreographyTimeline {
  title?: string;
  steps: ChoreographyKeyframe[];
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
  canonical_name?: string;
  common_name: string;
  latin_name?: string;
  mesh_node_name?: string;
  glb_aliases?: string[];
  organ_system: string;
  bbox_min: [number, number, number];
  bbox_max: [number, number, number];
  centroid: [number, number, number];
  bounding_radius: number;
  description_summary?: string;
  canonical_physiology_summary?: string;
  cranio_caudal_rank?: number;
  caudo_cranial_rank?: number;
  occluding_fma_ids?: string[];
  supplies_fma_ids?: string[];
}

export interface RegisteredMeshEntry {
  fma_id: string;
  name: string;
  organ_system: string;
  meshes: THREE.Mesh[];
  boundingBox: THREE.Box3;
  center: THREE.Vector3;
  radius: number;
}

export interface ManifestData {
  version: string;
  source?: string;
  total_structures?: number;
  glb_file?: string;
  glb_url?: string;
  discovered_glb_nodes?: string[];
  structures: Record<string, AnatomicalStructureMeta> | AnatomicalStructureMeta[];
}
