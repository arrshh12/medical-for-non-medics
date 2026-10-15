import { create } from 'zustand';
import * as THREE from 'three';
import {
  AnatomicalStructureMeta,
  ManifestData,
  PathologyType,
  AnnotationSchema,
  CameraPreset,
  SceneCommandSchema
} from '../types/scene.types';

interface SceneState {
  manifest: ManifestData | null;
  meshRegistry: Map<string, THREE.Object3D>;
  selectedFmaId: string | null;
  hoveredFmaId: string | null;
  focusedFmaIds: string[];
  isolatedFmaIds: string[];
  highlightedFmaIds: Record<string, string>; // fma_id -> hex color
  tissueStates: Record<string, PathologyType>; // fma_id -> state
  blockages: Record<string, { severity: number }>; // fma_id -> blockage
  activeFlowPaths: Array<{ pathIds: string[]; speed: number; flowType: string; blocked: boolean }>;
  activeAnnotations: AnnotationSchema[];
  cameraPreset: CameraPreset | null;
  cameraTargetPosition: [number, number, number] | null;
  cameraLookAtTarget: [number, number, number] | null;
  cameraTransitionDuration: number;
  isTransitioningCamera: boolean;
  commandHistory: SceneCommandSchema[];

  setManifest: (manifest: ManifestData) => void;
  registerMesh: (fmaId: string, object: THREE.Object3D) => void;
  unregisterMesh: (fmaId: string) => void;
  selectStructure: (fmaId: string | null) => void;
  setHoveredStructure: (fmaId: string | null) => void;
  focusStructures: (fmaIds: string[], preset?: CameraPreset) => void;
  isolateStructures: (fmaIds: string[]) => void;
  highlightStructures: (fmaIds: string[], color?: string) => void;
  applyPathology: (fmaId: string, pathology: PathologyType, severity?: number) => void;
  setFlowAnimation: (pathIds: string[], speed?: number, flowType?: string, blocked?: boolean) => void;
  addAnnotation: (annotation: AnnotationSchema) => void;
  clearAnnotations: () => void;
  resetScene: () => void;
  getStructureMeta: (fmaId: string) => AnatomicalStructureMeta | null;
}

export const useSceneStore = create<SceneState>((set, get) => ({
  manifest: null,
  meshRegistry: new Map(),
  selectedFmaId: null,
  hoveredFmaId: null,
  focusedFmaIds: [],
  isolatedFmaIds: [],
  highlightedFmaIds: {},
  tissueStates: {},
  blockages: {},
  activeFlowPaths: [],
  activeAnnotations: [],
  cameraPreset: null,
  cameraTargetPosition: null,
  cameraLookAtTarget: null,
  cameraTransitionDuration: 0.9,
  isTransitioningCamera: false,
  commandHistory: [],

  setManifest: (manifest: ManifestData) => set({ manifest }),

  registerMesh: (fmaId: string, object: THREE.Object3D) => {
    const registry = get().meshRegistry;
    registry.set(fmaId, object);
    // Also index by common_name if meta available
    const meta = get().manifest?.structures[fmaId];
    if (meta) {
      registry.set(meta.common_name.toLowerCase(), object);
    }
  },

  unregisterMesh: (fmaId: string) => {
    const registry = get().meshRegistry;
    registry.delete(fmaId);
  },

  selectStructure: (fmaId: string | null) => set({ selectedFmaId: fmaId }),

  setHoveredStructure: (fmaId: string | null) => set({ hoveredFmaId: fmaId }),

  focusStructures: (fmaIds: string[], preset: CameraPreset = 'anterior_oblique') => {
    set({
      focusedFmaIds: fmaIds,
      cameraPreset: preset,
      isTransitioningCamera: true
    });
  },

  isolateStructures: (fmaIds: string[]) => {
    set({ isolatedFmaIds: fmaIds });
  },

  highlightStructures: (fmaIds: string[], color: string = '#38bdf8') => {
    const currentHighlights = { ...get().highlightedFmaIds };
    fmaIds.forEach((id) => {
      currentHighlights[id] = color;
    });
    set({ highlightedFmaIds: currentHighlights });
  },

  applyPathology: (fmaId: string, pathology: PathologyType, severity: number = 0.8) => {
    const currentTissueStates = { ...get().tissueStates, [fmaId]: pathology };
    const currentBlockages = { ...get().blockages };
    if (pathology === 'vascular_occlusion') {
      currentBlockages[fmaId] = { severity };
    }
    set({ tissueStates: currentTissueStates, blockages: currentBlockages });
  },

  setFlowAnimation: (pathIds: string[], speed: number = 1.0, flowType: string = 'oxygenated', blocked: boolean = false) => {
    set({
      activeFlowPaths: [{ pathIds, speed, flowType, blocked }]
    });
  },

  addAnnotation: (annotation: AnnotationSchema) => {
    set((state) => ({
      activeAnnotations: [
        ...state.activeAnnotations.filter((a) => a.target_id !== annotation.target_id),
        annotation
      ]
    }));
  },

  clearAnnotations: () => set({ activeAnnotations: [] }),

  resetScene: () => {
    set({
      selectedFmaId: null,
      hoveredFmaId: null,
      focusedFmaIds: [],
      isolatedFmaIds: [],
      highlightedFmaIds: {},
      tissueStates: {},
      blockages: {},
      activeFlowPaths: [],
      activeAnnotations: [],
      cameraPreset: 'anterior',
      cameraTargetPosition: [0, 0, 4.5],
      cameraLookAtTarget: [0, 0, 0],
      isTransitioningCamera: true
    });
  },

  getStructureMeta: (fmaId: string) => {
    const manifest = get().manifest;
    if (!manifest) return null;
    if (manifest.structures[fmaId]) return manifest.structures[fmaId];
    // Case-insensitive lookup by name
    const lower = fmaId.toLowerCase();
    for (const item of Object.values(manifest.structures)) {
      if (item.common_name.toLowerCase() === lower || item.latin_name?.toLowerCase() === lower) {
        return item;
      }
    }
    return null;
  }
}));
