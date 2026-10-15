import { useSceneStore } from '../store/useSceneStore';
import type {
  ChoreographyKeyframe,
  SceneCommandSchema,
} from '../types/scene.types';

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
  private stepTimers: number[] = [];

  public clearTimers(): void {
    for (const timerId of this.stepTimers) {
      window.clearTimeout(timerId);
    }
    this.stepTimers = [];
  }

  /**
   * Executes a multi-step AI choreography sequence in real time, advancing
   * camera targets, ghosting occluding bones, pulsing organs, and animating
   * 3D blood flow particles on schedule.
   */
  public playChoreography(steps: ChoreographyKeyframe[]): void {
    this.clearTimers();
    if (!steps || !steps.length) return;

    const store = useSceneStore.getState();
    store.loadChoreographyTimeline(steps);

    let cumulativeDelayMs = 0;
    steps.forEach((step, idx) => {
      if (idx === 0) {
        cumulativeDelayMs += Math.max(step.duration_ms || 3800, 2000);
        return;
      }

      const timer = window.setTimeout(() => {
        const currentStore = useSceneStore.getState();
        if (!currentStore.isPlayingChoreography) return;
        currentStore.setActiveStepIndex(idx);
      }, cumulativeDelayMs);

      this.stepTimers.push(timer);
      cumulativeDelayMs += Math.max(step.duration_ms || 3800, 2000);
    });

    const endTimer = window.setTimeout(() => {
      useSceneStore.getState().setIsPlayingChoreography(false);
    }, cumulativeDelayMs);
    this.stepTimers.push(endTimer);
  }

  /**
   * Resolves any target_id to a canonical FMA ID using defensive fallback hierarchy:
   * 1. Exact match in meshRegistry
   * 2. Exact key in structureMetadata or manifest.structures
   * 3. Normalized FMA ID (e.g. "fma_7101", "FMA-7101", "7101")
   * 4. Medical clinical abbreviation lookup (e.g. "LAD", "RCA", "LV")
   * 5. Case-insensitive common_name, canonical_name, or glb_aliases
   */
  public resolveTargetId(targetId?: string): string | null {
    if (!targetId || typeof targetId !== 'string') return null;

    const trimmed = targetId.trim();
    if (!trimmed) return null;

    const store = useSceneStore.getState();
    const entry = store.resolveTargetEntry(trimmed);
    if (entry) return entry.fma_id;

    const lower = trimmed.toLowerCase();
    if (MEDICAL_ABBREVIATION_MAP[lower]) {
      return MEDICAL_ABBREVIATION_MAP[lower];
    }

    const normalizedUpper = trimmed.toUpperCase().replace(/[\s-]+/g, '_');
    const withFmaPrefix = normalizedUpper.startsWith('FMA_')
      ? normalizedUpper
      : `FMA_${normalizedUpper}`;

    if (store.structureMetadata[withFmaPrefix]) {
      return withFmaPrefix;
    }

    return null;
  }

  /**
   * Executes a single discrete SceneCommandSchema (backwards compatible with single commands)
   */
  public executeCommand(cmd: SceneCommandSchema): void {
    const store = useSceneStore.getState();

    // Append to command history
    useSceneStore.setState((state) => ({
      commandHistory: [...state.commandHistory, cmd],
    }));

    switch (cmd.action) {
      case 'FOCUS_STRUCTURE': {
        const resolvedId = this.resolveTargetId(cmd.target_id);
        if (resolvedId) {
          store.focusStructures([resolvedId], cmd.camera_preset || 'anterior');
        }
        break;
      }

      case 'ISOLATE_STRUCTURES': {
        const ids = (cmd.target_ids || (cmd.target_id ? [cmd.target_id] : []))
          .map((id) => this.resolveTargetId(id))
          .filter((id): id is string => Boolean(id));

        if (ids.length > 0) {
          store.isolateStructures(ids);
        }
        break;
      }

      case 'FOCUS_AND_ISOLATE': {
        const resolvedId = this.resolveTargetId(cmd.target_id);
        if (resolvedId) {
          store.isolateStructures([resolvedId]);
          store.focusStructures([resolvedId], cmd.camera_preset || 'anterior');
        }
        break;
      }

      case 'HIGHLIGHT_STRUCTURES': {
        const ids = (cmd.target_ids || (cmd.target_id ? [cmd.target_id] : []))
          .map((id) => this.resolveTargetId(id))
          .filter((id): id is string => Boolean(id));

        if (ids.length > 0) {
          store.highlightStructures(ids, cmd.highlight_color || '#38bdf8');
        }
        break;
      }

      case 'APPLY_PATHOLOGY': {
        const resolvedId = this.resolveTargetId(cmd.target_id);
        if (resolvedId && cmd.pathology_type) {
          store.applyPathology(resolvedId, cmd.pathology_type, cmd.severity || 0.8);
        }
        break;
      }

      case 'ANIMATE_FLOW': {
        if (cmd.flow_animation && cmd.flow_animation.path_ids) {
          const resolvedPaths = cmd.flow_animation.path_ids
            .map((id) => this.resolveTargetId(id))
            .filter((id): id is string => Boolean(id));

          if (resolvedPaths.length > 0) {
            store.setFlowAnimation(
              resolvedPaths,
              cmd.flow_animation.speed || 1.0,
              cmd.flow_animation.flow_type || 'oxygenated',
              cmd.flow_animation.blocked || false
            );
          }
        }
        break;
      }

      case 'PLACE_ANNOTATION': {
        if (cmd.annotation) {
          const resolvedId = this.resolveTargetId(cmd.annotation.target_id);
          if (resolvedId) {
            store.addAnnotation({
              target_id: resolvedId,
              title: cmd.annotation.title,
              body: cmd.annotation.body,
            });
          }
        }
        break;
      }

      case 'RESET_SCENE': {
        this.clearTimers();
        store.resetScene();
        break;
      }
    }
  }

  public executeSequence(commands: SceneCommandSchema[]): void {
    this.clearTimers();
    if (!commands || commands.length === 0) return;

    let delay = 0;
    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i];
      const timer = window.setTimeout(() => {
        this.executeCommand(cmd);
      }, delay);
      this.stepTimers.push(timer);
      delay += 1200;
    }
  }
}

export const sceneController = new SceneController();
