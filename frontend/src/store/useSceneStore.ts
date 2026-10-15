import { create } from 'zustand';
import * as THREE from 'three';
import type {
  AnatomicalStructureMeta,
  AnnotationSchema,
  CameraPreset,
  CameraViewPreset,
  ChoreographyKeyframe,
  FloatingAnnotation,
  ManifestData,
  PathologyType,
  RegisteredMeshEntry,
  SceneCommandSchema,
  TissueVisualState,
  VascularFlowCommand,
} from '../types/scene.types';

interface SceneState {
  // Registry of actual Three.js meshes extracted from human_anatomy.glb
  meshRegistry: Record<string, RegisteredMeshEntry>;
  structureMetadata: Record<string, AnatomicalStructureMeta>;
  isModelLoaded: boolean;

  // Interactive Selection & Camera State
  selectedFmaId: string | null;
  hoveredFmaId: string | null;
  cameraFocusIds: string[];
  cameraViewPreset: CameraViewPreset;
  followFlowSpline: boolean;
  cameraResetTrigger: number;

  // Visual States & Layers
  highlightedIds: string[];
  ghostedIds: string[];
  pulsingIds: string[];
  tissueStates: Record<string, TissueVisualState>;
  activeFlow: VascularFlowCommand | null;
  annotations: FloatingAnnotation[];
  visibleSystems: Record<string, boolean>;

  // Multi-Step AI Choreography Timeline
  choreographySteps: ChoreographyKeyframe[];
  activeStepIndex: number;
  isPlayingChoreography: boolean;

  // Legacy fields for backward compatibility with existing components
  manifest: ManifestData | null;
  focusedFmaIds: string[];
  isolatedFmaIds: string[];
  highlightedFmaIds: Record<string, string>;
  blockages: Record<string, { severity: number }>;
  activeFlowPaths: Array<{ pathIds: string[]; speed: number; flowType: string; blocked: boolean }>;
  activeAnnotations: AnnotationSchema[];
  cameraPreset: CameraPreset | null;
  cameraTargetPosition: [number, number, number] | null;
  cameraLookAtTarget: [number, number, number] | null;
  cameraTransitionDuration: number;
  isTransitioningCamera: boolean;
  commandHistory: SceneCommandSchema[];

  // Actions
  registerGlbScene: (
    entries: Record<string, RegisteredMeshEntry>,
    metadata: Record<string, AnatomicalStructureMeta>
  ) => void;
  resolveTargetEntry: (idOrName: string) => RegisteredMeshEntry | null;
  selectStructure: (fmaId: string | null) => void;
  setHoveredStructure: (fmaId: string | null) => void;
  focusStructure: (fmaId: string, view?: CameraViewPreset) => void;
  focusStructures: (fmaIds: string[], preset?: CameraPreset) => void;
  isolateStructure: (fmaId: string) => void;
  isolateStructures: (fmaIds: string[]) => void;
  highlightStructures: (fmaIds: string[], color?: string) => void;
  toggleSystemLayer: (system: string) => void;
  applyKeyframe: (keyframe: ChoreographyKeyframe) => void;
  loadChoreographyTimeline: (steps: ChoreographyKeyframe[]) => void;
  setActiveStepIndex: (index: number) => void;
  setIsPlayingChoreography: (playing: boolean) => void;
  applyPathology: (fmaId: string, pathology: PathologyType, severity?: number) => void;
  setFlowAnimation: (pathIds: string[], speed?: number, flowType?: string, blocked?: boolean) => void;
  addAnnotation: (annotation: AnnotationSchema) => void;
  clearAnnotations: () => void;
  resetScene: () => void;
  getStructureMeta: (fmaId: string) => AnatomicalStructureMeta | null;
  setManifest: (manifest: ManifestData) => void;
  registerMesh: (fmaId: string, object: THREE.Object3D) => void;
  unregisterMesh: (fmaId: string) => void;
}

const DEFAULT_SYSTEMS: Record<string, boolean> = {
  skeletal: true,
  cardiovascular: true,
  nervous: true,
  respiratory: true,
  digestive: true,
  urinary: true,
  skin: false,
};

export const useSceneStore = create<SceneState>((set, get) => ({
  meshRegistry: {},
  structureMetadata: {},
  isModelLoaded: false,

  selectedFmaId: null,
  hoveredFmaId: null,
  cameraFocusIds: [],
  cameraViewPreset: 'anterior',
  followFlowSpline: false,
  cameraResetTrigger: 0,

  highlightedIds: [],
  ghostedIds: [],
  pulsingIds: [],
  tissueStates: {},
  activeFlow: null,
  annotations: [],
  visibleSystems: { ...DEFAULT_SYSTEMS },

  choreographySteps: [],
  activeStepIndex: 0,
  isPlayingChoreography: false,

  // Legacy state
  manifest: null,
  focusedFmaIds: [],
  isolatedFmaIds: [],
  highlightedFmaIds: {},
  blockages: {},
  activeFlowPaths: [],
  activeAnnotations: [],
  cameraPreset: null,
  cameraTargetPosition: null,
  cameraLookAtTarget: null,
  cameraTransitionDuration: 0.9,
  isTransitioningCamera: false,
  commandHistory: [],

  registerGlbScene: (entries, metadata) =>
    set({
      meshRegistry: entries,
      structureMetadata: metadata,
      isModelLoaded: true,
    }),

  resolveTargetEntry: (idOrName: string) => {
    const { meshRegistry, structureMetadata } = get();
    if (!idOrName) return null;
    const clean = idOrName.trim();
    if (meshRegistry[clean]) return meshRegistry[clean];

    const lower = clean.toLowerCase().replace(/[_\s-]+/g, ' ');
    for (const [key, entry] of Object.entries(meshRegistry)) {
      if (
        key.toLowerCase() === lower ||
        entry.name.toLowerCase().includes(lower) ||
        lower.includes(entry.name.toLowerCase())
      ) {
        return entry;
      }
    }

    for (const meta of Object.values(structureMetadata)) {
      const matchAlias = (meta.glb_aliases ?? []).some(
        (alias) =>
          alias.toLowerCase().replace(/[_\s-]+/g, ' ').includes(lower) ||
          lower.includes(alias.toLowerCase().replace(/[_\s-]+/g, ' '))
      );
      if (
        (matchAlias ||
          meta.common_name.toLowerCase().includes(lower) ||
          (meta.canonical_name && meta.canonical_name.toLowerCase().includes(lower))) &&
        meshRegistry[meta.fma_id]
      ) {
        return meshRegistry[meta.fma_id];
      }
    }
    return null;
  },

  selectStructure: (fmaId) => {
    if (!fmaId) {
      set({ selectedFmaId: null });
      return;
    }
    const meta = get().structureMetadata[fmaId];
    set({
      selectedFmaId: fmaId,
      cameraFocusIds: [fmaId],
      focusedFmaIds: [fmaId],
      highlightedIds: [fmaId],
      highlightedFmaIds: { [fmaId]: '#14b8a6' },
      ghostedIds: meta?.occluding_fma_ids ?? [],
      followFlowSpline: false,
    });
  },

  setHoveredStructure: (fmaId) => set({ hoveredFmaId: fmaId }),

  focusStructure: (fmaId, view = 'anterior_closeup') => {
    const meta = get().structureMetadata[fmaId];
    set({
      selectedFmaId: fmaId,
      cameraFocusIds: [fmaId],
      focusedFmaIds: [fmaId],
      cameraViewPreset: view,
      ghostedIds: meta?.occluding_fma_ids ?? [],
      followFlowSpline: false,
      isTransitioningCamera: true,
    });
  },

  focusStructures: (fmaIds, preset = 'anterior') => {
    const validIds = fmaIds.filter(Boolean);
    const firstMeta = validIds.length ? get().structureMetadata[validIds[0]] : null;
    set({
      selectedFmaId: validIds[0] ?? null,
      cameraFocusIds: validIds,
      focusedFmaIds: validIds,
      cameraPreset: preset,
      cameraViewPreset: (preset === 'anterior_oblique' ? 'anterior_closeup' : preset as CameraViewPreset) || 'anterior',
      ghostedIds: firstMeta?.occluding_fma_ids ?? [],
      followFlowSpline: false,
      isTransitioningCamera: true,
    });
  },

  isolateStructure: (fmaId) => {
    const allIds = Object.keys(get().meshRegistry);
    set({
      selectedFmaId: fmaId,
      cameraFocusIds: [fmaId],
      focusedFmaIds: [fmaId],
      highlightedIds: [fmaId],
      isolatedFmaIds: [fmaId],
      ghostedIds: allIds.filter((id) => id !== fmaId),
      followFlowSpline: false,
    });
  },

  isolateStructures: (fmaIds) => {
    const allIds = Object.keys(get().meshRegistry);
    set({
      selectedFmaId: fmaIds[0] ?? null,
      cameraFocusIds: fmaIds,
      focusedFmaIds: fmaIds,
      highlightedIds: fmaIds,
      isolatedFmaIds: fmaIds,
      ghostedIds: allIds.filter((id) => !fmaIds.includes(id)),
      followFlowSpline: false,
    });
  },

  highlightStructures: (fmaIds, color = '#38bdf8') => {
    const newHighlights: Record<string, string> = { ...get().highlightedFmaIds };
    for (const id of fmaIds) {
      newHighlights[id] = color;
    }
    set({
      highlightedIds: Array.from(new Set([...get().highlightedIds, ...fmaIds])),
      highlightedFmaIds: newHighlights,
    });
  },

  toggleSystemLayer: (system) =>
    set((state) => ({
      visibleSystems: {
        ...state.visibleSystems,
        [system]: !state.visibleSystems[system],
      },
    })),

  applyKeyframe: (kf) => {
    const resolvedFocus = kf.camera_focus_ids
      .map((id) => get().resolveTargetEntry(id)?.fma_id || id)
      .filter((x): x is string => Boolean(x));

    const resolvedHighlights = (kf.highlight_ids ?? [])
      .map((id) => get().resolveTargetEntry(id)?.fma_id || id)
      .filter((x): x is string => Boolean(x));

    const resolvedGhosts = new Set<string>(
      (kf.ghost_ids ?? [])
        .map((id) => get().resolveTargetEntry(id)?.fma_id || id)
        .filter((x): x is string => Boolean(x))
    );

    // Automatically add occluding structures (e.g., Sternum/Ribs for Heart; Skull for Brain)
    for (const focusId of resolvedFocus) {
      const occluders = get().structureMetadata[focusId]?.occluding_fma_ids ?? [];
      occluders.forEach((occ) => resolvedGhosts.add(occ));
    }

    const resolvedPulses = (kf.pulse_ids ?? [])
      .map((id) => get().resolveTargetEntry(id)?.fma_id || id)
      .filter((x): x is string => Boolean(x));

    set({
      cameraFocusIds: resolvedFocus,
      focusedFmaIds: resolvedFocus,
      cameraViewPreset: kf.camera_view ?? 'anterior_closeup',
      followFlowSpline: Boolean(kf.follow_flow_spline),
      highlightedIds: resolvedHighlights,
      ghostedIds: Array.from(resolvedGhosts),
      pulsingIds: resolvedPulses,
      tissueStates: kf.tissue_states ?? {},
      activeFlow: kf.vascular_flow ?? null,
      annotations: kf.annotations ?? [],
      isTransitioningCamera: true,
    });
  },

  loadChoreographyTimeline: (steps) => {
    if (!steps.length) return;
    set({
      choreographySteps: steps,
      activeStepIndex: 0,
      isPlayingChoreography: true,
    });
    get().applyKeyframe(steps[0]);
  },

  setActiveStepIndex: (index) => {
    const { choreographySteps } = get();
    if (index >= 0 && index < choreographySteps.length) {
      set({ activeStepIndex: index });
      get().applyKeyframe(choreographySteps[index]);
    }
  },

  setIsPlayingChoreography: (playing) => set({ isPlayingChoreography: playing }),

  applyPathology: (fmaId, pathology, severity = 0.8) => {
    const stateVal: TissueVisualState =
      pathology === 'vascular_occlusion' ? 'ischemic' : (pathology as TissueVisualState);
    set((state) => ({
      tissueStates: { ...state.tissueStates, [fmaId]: stateVal },
      blockages: pathology === 'vascular_occlusion' ? { ...state.blockages, [fmaId]: { severity } } : state.blockages,
    }));
  },

  setFlowAnimation: (pathIds, speed = 1.0, flowType = 'oxygenated', blocked = false) => {
    const color = flowType === 'deoxygenated' ? '#3b82f6' : flowType === 'lymphatic' ? '#10b981' : '#ff2a2a';
    set({
      activeFlow: {
        path_ids: pathIds,
        color,
        speed: speed * 0.42,
        particle_count: 180,
      },
      activeFlowPaths: [{ pathIds, speed, flowType, blocked }],
    });
  },

  addAnnotation: (annotation) =>
    set((state) => ({
      activeAnnotations: [...state.activeAnnotations, annotation],
      annotations: [
        ...state.annotations,
        {
          target_id: annotation.target_id,
          title: annotation.title,
          subtitle: annotation.body,
          severity: 'info',
        },
      ],
    })),

  clearAnnotations: () => set({ activeAnnotations: [], annotations: [] }),

  getStructureMeta: (fmaId: string) => {
    const { structureMetadata, manifest } = get();
    if (structureMetadata[fmaId]) return structureMetadata[fmaId];
    if (manifest && !Array.isArray(manifest.structures) && manifest.structures[fmaId]) {
      return manifest.structures[fmaId];
    }
    if (manifest && Array.isArray(manifest.structures)) {
      return manifest.structures.find((s) => s.fma_id === fmaId) ?? null;
    }
    return null;
  },

  setManifest: (manifest) => {
    const metaMap: Record<string, AnatomicalStructureMeta> = {};
    if (Array.isArray(manifest.structures)) {
      for (const s of manifest.structures) {
        metaMap[s.fma_id] = s;
      }
    } else if (manifest.structures) {
      for (const [id, s] of Object.entries(manifest.structures)) {
        metaMap[id] = s;
      }
    }
    set({ manifest, structureMetadata: metaMap });
  },

  registerMesh: (fmaId, object) => {
    const mesh = object as THREE.Mesh;
    const box = new THREE.Box3().setFromObject(object);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const radius = Math.max(0.15, box.getBoundingSphere(new THREE.Sphere()).radius);

    set((state) => ({
      meshRegistry: {
        ...state.meshRegistry,
        [fmaId]: {
          fma_id: fmaId,
          name: state.structureMetadata[fmaId]?.common_name || fmaId,
          organ_system: state.structureMetadata[fmaId]?.organ_system || 'skeletal',
          meshes: [mesh],
          boundingBox: box,
          center,
          radius,
        },
      },
    }));
  },

  unregisterMesh: (fmaId) => {
    set((state) => {
      const next = { ...state.meshRegistry };
      delete next[fmaId];
      return { meshRegistry: next };
    });
  },

  resetScene: () =>
    set((state) => ({
      selectedFmaId: null,
      hoveredFmaId: null,
      cameraFocusIds: [],
      focusedFmaIds: [],
      isolatedFmaIds: [],
      highlightedIds: [],
      highlightedFmaIds: {},
      ghostedIds: [],
      pulsingIds: [],
      tissueStates: {},
      blockages: {},
      activeFlow: null,
      activeFlowPaths: [],
      annotations: [],
      activeAnnotations: [],
      choreographySteps: [],
      activeStepIndex: 0,
      isPlayingChoreography: false,
      cameraViewPreset: 'anterior',
      followFlowSpline: false,
      cameraResetTrigger: state.cameraResetTrigger + 1,
      visibleSystems: { ...DEFAULT_SYSTEMS },
      commandHistory: [],
      isTransitioningCamera: true,
      cameraTargetPosition: [0, 0.2, 4.2],
      cameraLookAtTarget: [0, 0.1, 0],
    })),
}));
