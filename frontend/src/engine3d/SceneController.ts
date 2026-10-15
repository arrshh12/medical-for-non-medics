import { useSceneStore } from '../store/useSceneStore';
import {
  SceneCommandSchema,
  AnnotationSchema,
  FlowAnimationSchema,
  PathologyType,
} from '../types/scene.types';
import { occlusionManager } from './OcclusionManager';

// Well-known medical clinical abbreviations to canonical FMA IDs for high-reliability RAG alignment
const MEDICAL_ABBREVIATION_MAP: Record<string, string> = {
  lad: 'FMA_7101', // Left Anterior Descending Artery
  rca: 'FMA_7100', // Right Coronary Artery
  lcx: 'FMA_7105', // Left Circumflex Artery
  cx: 'FMA_7105',
  ra: 'FMA_7096', // Right Atrium
  la: 'FMA_7097', // Left Atrium
  rv: 'FMA_7098', // Right Ventricle
  lv: 'FMA_7099', // Left Ventricle
  svc: 'FMA_4720', // Superior Vena Cava
  ivc: 'FMA_4721', // Inferior Vena Cava
  av: 'FMA_7237', // Aortic Valve
  mv: 'FMA_7236', // Mitral Valve
  tv: 'FMA_7234', // Tricuspid Valve
  pv: 'FMA_7238', // Pulmonary Valve
};

export class SceneController {
  private activeSequenceAbortController: AbortController | null = null;
  private isRunningSequence: boolean = false;

  /**
   * Resolves any target_id to a canonical FMA ID using defensive fallback hierarchy:
   * 1. Exact match in meshRegistry
   * 2. Exact key in manifest.structures
   * 3. Normalized FMA ID (e.g. "fma_7101", "FMA-7101", "7101")
   * 4. Medical clinical abbreviation lookup (e.g. "LAD", "RCA", "LV")
   * 5. Case-insensitive common_name, latin_name, or mesh_node_name in manifest
   * 6. Fuzzy substring match in manifest
   * 7. Returns null and logs non-fatal warning if unresolved (Rule 1 compliance)
   */
  public resolveTargetId(targetId?: string): string | null {
    if (!targetId || typeof targetId !== 'string') return null;

    const trimmed = targetId.trim();
    if (!trimmed) return null;

    const store = useSceneStore.getState();
    const registry = store.meshRegistry;
    const manifest = store.manifest;

    // 1. Exact match in active mesh registry
    if (registry.has(trimmed)) {
      return trimmed;
    }

    // 2. Exact match in manifest structures
    if (manifest && manifest.structures[trimmed]) {
      return trimmed;
    }

    // 3. Normalized FMA ID check
    const normalizedUpper = trimmed.toUpperCase().replace(/[\s-]+/g, '_');
    if (registry.has(normalizedUpper)) return normalizedUpper;
    if (manifest && manifest.structures[normalizedUpper]) return normalizedUpper;

    const withFmaPrefix = normalizedUpper.startsWith('FMA_')
      ? normalizedUpper
      : `FMA_${normalizedUpper}`;
    if (registry.has(withFmaPrefix)) return withFmaPrefix;
    if (manifest && manifest.structures[withFmaPrefix]) return withFmaPrefix;

    // 4. Clinical abbreviation lookup
    const lower = trimmed.toLowerCase();
    if (MEDICAL_ABBREVIATION_MAP[lower]) {
      const mappedId = MEDICAL_ABBREVIATION_MAP[lower];
      if (registry.has(mappedId) || (manifest && manifest.structures[mappedId])) {
        return mappedId;
      }
    }

    // 5. Case-insensitive common_name, latin_name, mesh_node_name lookup in manifest
    if (manifest) {
      for (const meta of Object.values(manifest.structures)) {
        if (
          meta.common_name.toLowerCase() === lower ||
          meta.latin_name?.toLowerCase() === lower ||
          meta.mesh_node_name.toLowerCase() === lower
        ) {
          return meta.fma_id;
        }
      }

      // 6. Substring match for common medical naming
      for (const meta of Object.values(manifest.structures)) {
        const common = meta.common_name.toLowerCase();
        if (common.includes(lower) || (lower.length > 3 && lower.includes(common))) {
          return meta.fma_id;
        }
      }
    }

    // Case-insensitive registry key check
    for (const [key] of registry.entries()) {
      if (key.toLowerCase() === lower) {
        return key;
      }
    }

    // Structured non-fatal warning strictly mandated by Rule 1 item 3
    console.warn(`[SceneController] Unresolved target_id: "${targetId}"`);
    return null;
  }

  /**
   * Helper to resolve an array of targets from a command object
   */
  public resolveTargetIds(cmd: SceneCommandSchema): string[] {
    const rawIds: string[] = [];
    if (cmd.target_id) rawIds.push(cmd.target_id);
    if (cmd.target_ids && Array.isArray(cmd.target_ids)) {
      rawIds.push(...cmd.target_ids);
    }

    const resolved = new Set<string>();
    for (const raw of rawIds) {
      const canonical = this.resolveTargetId(raw);
      if (canonical) resolved.add(canonical);
    }
    return Array.from(resolved);
  }

  /**
   * Deterministically execute a single 3D scene command
   */
  public async executeCommand(command: SceneCommandSchema): Promise<void> {
    const store = useSceneStore.getState();

    switch (command.action) {
      case 'FOCUS_STRUCTURE': {
        const targets = this.resolveTargetIds(command);
        if (targets.length === 0) {
          console.warn('[SceneController] FOCUS_STRUCTURE received no resolvable targets.');
          break;
        }
        store.focusStructures(targets, command.camera_preset || 'anterior_oblique');
        if (command.fade_occluders) {
          occlusionManager.detectAndFadeOccluders(targets);
        }
        break;
      }

      case 'ISOLATE_STRUCTURES': {
        const targets = this.resolveTargetIds(command);
        if (targets.length === 0) {
          console.warn('[SceneController] ISOLATE_STRUCTURES received no resolvable targets.');
          break;
        }
        store.isolateStructures(targets);
        if (command.fade_occluders) {
          occlusionManager.detectAndFadeOccluders(targets);
        }
        break;
      }

      case 'FOCUS_AND_ISOLATE': {
        const targets = this.resolveTargetIds(command);
        if (targets.length > 0) {
          store.focusStructures(targets, command.camera_preset || 'anterior_oblique');
          store.isolateStructures(targets);
          if (command.fade_occluders !== false) {
            occlusionManager.detectAndFadeOccluders(targets);
          }
        }
        if (command.annotation) {
          this.executeAnnotation(command.annotation);
        }
        break;
      }

      case 'HIGHLIGHT_STRUCTURES': {
        const targets = this.resolveTargetIds(command);
        if (targets.length > 0) {
          store.highlightStructures(targets, command.highlight_color || '#38bdf8');
        }
        break;
      }

      case 'APPLY_PATHOLOGY': {
        const pathologyType: PathologyType = command.pathology_type || 'ischemic';
        const severity = command.severity ?? 0.8;
        const targets = this.resolveTargetIds(command);

        for (const target of targets) {
          store.applyPathology(target, pathologyType, severity);
        }

        // Apply ischemic cascade to downstream dependent structures
        if (command.downstream_ischemic_ids && Array.isArray(command.downstream_ischemic_ids)) {
          for (const dsId of command.downstream_ischemic_ids) {
            const resolved = this.resolveTargetId(dsId);
            if (resolved) {
              store.applyPathology(resolved, 'ischemic', Math.max(0.4, severity * 0.85));
            }
          }
        }

        if (command.flow_animation) {
          this.executeFlowAnimation(command.flow_animation);
        }
        break;
      }

      case 'ANIMATE_FLOW': {
        if (command.flow_animation) {
          this.executeFlowAnimation(command.flow_animation);
        } else {
          const targets = this.resolveTargetIds(command);
          if (targets.length > 0) {
            store.setFlowAnimation(targets, 1.0, 'oxygenated', false);
          }
        }
        break;
      }

      case 'PLACE_ANNOTATION': {
        if (command.annotation) {
          this.executeAnnotation(command.annotation);
        }
        break;
      }

      case 'RESET_SCENE': {
        store.resetScene();
        occlusionManager.restoreAll();
        break;
      }

      default: {
        console.warn(`[SceneController] Unhandled action: ${(command as any).action}`);
      }
    }

    // Record command execution history in store
    useSceneStore.setState((s) => ({
      commandHistory: [...s.commandHistory, command],
    }));
  }

  /**
   * Helper to execute annotation command with target resolution
   */
  private executeAnnotation(annotation: AnnotationSchema): void {
    const resolvedTarget = this.resolveTargetId(annotation.target_id);
    if (resolvedTarget) {
      useSceneStore.getState().addAnnotation({
        ...annotation,
        target_id: resolvedTarget,
      });
    } else {
      console.warn(
        `[SceneController] Cannot place annotation; unresolved target_id: "${annotation.target_id}"`
      );
    }
  }

  /**
   * Helper to execute flow animation command with path resolution
   */
  private executeFlowAnimation(flow: FlowAnimationSchema): void {
    const resolvedPaths: string[] = [];
    for (const pathId of flow.path_ids) {
      const resolved = this.resolveTargetId(pathId);
      if (resolved) {
        resolvedPaths.push(resolved);
      }
    }

    if (resolvedPaths.length > 0) {
      useSceneStore.getState().setFlowAnimation(
        resolvedPaths,
        flow.speed ?? 1.0,
        flow.flow_type ?? 'oxygenated',
        flow.blocked ?? false
      );
    } else {
      console.warn('[SceneController] No valid path_ids resolved for flow animation.');
    }
  }

  /**
   * Execute a multi-step sequence of commands with configurable timing between steps
   *
   * @param commands Ordered list of scene commands to execute sequentially
   * @param stepIntervalMs Time in milliseconds to pause between consecutive steps
   */
  public async executeSequence(
    commands: SceneCommandSchema[],
    stepIntervalMs: number = 1800
  ): Promise<void> {
    this.cancelSequence();

    const abortController = new AbortController();
    this.activeSequenceAbortController = abortController;
    this.isRunningSequence = true;

    try {
      for (let i = 0; i < commands.length; i++) {
        if (abortController.signal.aborted) break;

        const cmd = commands[i];
        await this.executeCommand(cmd);

        if (i < commands.length - 1 && !abortController.signal.aborted) {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
              resolve();
            }, stepIntervalMs);

            abortController.signal.addEventListener(
              'abort',
              () => {
                clearTimeout(timer);
                reject(new Error('Sequence aborted'));
              },
              { once: true }
            );
          });
        }
      }
    } catch (err: any) {
      if (err?.message !== 'Sequence aborted') {
        console.error('[SceneController] Error in command sequence:', err);
      }
    } finally {
      if (this.activeSequenceAbortController === abortController) {
        this.isRunningSequence = false;
        this.activeSequenceAbortController = null;
      }
    }
  }

  /**
   * Cancel any running multi-step sequence
   */
  public cancelSequence(): void {
    if (this.activeSequenceAbortController) {
      this.activeSequenceAbortController.abort();
      this.activeSequenceAbortController = null;
    }
    this.isRunningSequence = false;
  }

  /**
   * Check if a multi-step sequence is currently playing
   */
  public isExecutingSequence(): boolean {
    return this.isRunningSequence;
  }
}

// Global singleton instance
export const sceneController = new SceneController();

// Expose on window in browser environment for debugging and testing
if (typeof window !== 'undefined') {
  (window as any).sceneController = sceneController;
}
