import * as THREE from 'three';
import { PathologyType } from '../../types/scene.types';

export type TissueShaderState = 'normal' | 'highlighted' | 'ischemic' | 'necrotic' | 'inflamed';

export interface TissueShaderOptions {
  state?: TissueShaderState | PathologyType;
  highlightColor?: string | THREE.Color;
  severity?: number;
  inflammationInflation?: number;
}

export interface TissueUniforms {
  uTissueState: { value: number };
  uTime: { value: number };
  uHighlightColor: { value: THREE.Color };
  uSeverity: { value: number };
  uInflammationInflation: { value: number };
}

// Global shared time uniform across all tissue state materials
export const globalTissueTimeUniform: { value: number } = { value: 0 };

/**
 * Updates the global time uniform driving ischemic 0.5Hz pulses and inflamed throbbing.
 * Should be called once per frame in an animation loop or useFrame.
 */
export function updateTissueShaderTime(elapsedSeconds: number): void {
  globalTissueTimeUniform.value = elapsedSeconds;
}

/**
 * Map string state to shader float index:
 * 0: normal
 * 1: highlighted
 * 2: ischemic
 * 3: necrotic
 * 4: inflamed
 */
export function getTissueStateCode(state: TissueShaderState | PathologyType | string): number {
  switch (state) {
    case 'highlighted':
      return 1.0;
    case 'ischemic':
      return 2.0;
    case 'necrotic':
      return 3.0;
    case 'inflamed':
      return 4.0;
    case 'normal':
    default:
      return 0.0;
  }
}

/**
 * Injects custom GLSL pathology modifiers into Three.js MeshStandardMaterial or MeshPhysicalMaterial
 * via onBeforeCompile.
 */
export function applyTissueStateToMaterial(
  material: THREE.MeshStandardMaterial,
  options: TissueShaderOptions = {}
): THREE.MeshStandardMaterial {
  const state = options.state || 'normal';
  const stateCode = getTissueStateCode(state);
  const severity = options.severity !== undefined ? Math.min(Math.max(options.severity, 0), 1) : 0.85;
  const highlightColor =
    options.highlightColor instanceof THREE.Color
      ? options.highlightColor.clone()
      : new THREE.Color(options.highlightColor || '#38bdf8');
  const inflammationInflation = options.inflammationInflation !== undefined ? options.inflammationInflation : 0.025;

  // Initialize or update custom uniforms stored on material.userData
  if (!material.userData.tissueUniforms) {
    material.userData.tissueUniforms = {
      uTissueState: { value: stateCode },
      uTime: globalTissueTimeUniform,
      uHighlightColor: { value: highlightColor },
      uSeverity: { value: severity },
      uInflammationInflation: { value: inflammationInflation }
    } as TissueUniforms;
  } else {
    const u = material.userData.tissueUniforms as TissueUniforms;
    u.uTissueState.value = stateCode;
    u.uHighlightColor.value.copy(highlightColor);
    u.uSeverity.value = severity;
    u.uInflammationInflation.value = inflammationInflation;
    material.needsUpdate = true;
    return material;
  }

  const uniforms = material.userData.tissueUniforms as TissueUniforms;

  material.onBeforeCompile = (shader: THREE.WebGLProgramParametersWithUniforms) => {
    // Attach uniforms
    shader.uniforms.uTissueState = uniforms.uTissueState;
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uHighlightColor = uniforms.uHighlightColor;
    shader.uniforms.uSeverity = uniforms.uSeverity;
    shader.uniforms.uInflammationInflation = uniforms.uInflammationInflation;

    // 1. VERTEX SHADER INJECTION: Vertex normal displacement for inflammation
    shader.vertexShader = `
      uniform float uTissueState;
      uniform float uTime;
      uniform float uInflammationInflation;
      uniform float uSeverity;
    ` + shader.vertexShader;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
      #include <begin_vertex>
      // Inflamed hyperemic state: expand outward along vertex normal with subtle 0.5Hz pulse
      if (uTissueState > 3.5 && uTissueState < 4.5) {
        float pulse = 1.0 + 0.18 * sin(uTime * 3.14159265);
        transformed += objectNormal * (uInflammationInflation * uSeverity * pulse);
      }
      `
    );

    // 2. FRAGMENT SHADER INJECTION: Color shift, mottled necrosis fbm, emissive glows
    shader.fragmentShader = `
      uniform float uTissueState;
      uniform float uTime;
      uniform vec3 uHighlightColor;
      uniform float uSeverity;

      // Deterministic 3D procedural hash and noise for necrotic infarcted tissue
      float tissueHash3D(vec3 p) {
        p = fract(p * 0.3183099 + 0.1);
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }

      float tissueNoise3D(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(mix(tissueHash3D(i + vec3(0.0, 0.0, 0.0)), tissueHash3D(i + vec3(1.0, 0.0, 0.0)), f.x),
              mix(tissueHash3D(i + vec3(0.0, 1.0, 0.0)), tissueHash3D(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
          mix(mix(tissueHash3D(i + vec3(0.0, 0.0, 1.0)), tissueHash3D(i + vec3(1.0, 0.0, 1.0)), f.x),
              mix(tissueHash3D(i + vec3(0.0, 1.0, 1.0)), tissueHash3D(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
          f.z
        );
      }

      float tissueFbm(vec3 p) {
        float v = 0.0;
        float a = 0.5;
        vec3 shift = vec3(100.0);
        for (int i = 0; i < 4; ++i) {
          v += a * tissueNoise3D(p);
          p = p * 2.0 + shift;
          a *= 0.5;
        }
        return v;
      }
    ` + shader.fragmentShader;

    // Diffuse modification
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `
      #include <color_fragment>

      // State 2: Ischemic (Hypoxic dark violaceous/cyanotic shift with 0.5Hz low-frequency hypoxic pulse)
      if (uTissueState > 1.5 && uTissueState < 2.5) {
        float pulse = 0.5 + 0.5 * sin(uTime * 3.14159265);
        vec3 cyanoticDarkTint = vec3(0.24, 0.10, 0.36); // violaceous cyanosis
        float blend = clamp(uSeverity * (0.65 + 0.28 * pulse), 0.0, 0.95);
        diffuseColor.rgb = mix(diffuseColor.rgb, cyanoticDarkTint, blend);
      }
      // State 3: Necrotic (Infarcted mottled dark grey/brown matte texture)
      else if (uTissueState > 2.5 && uTissueState < 3.5) {
        float n = tissueFbm(vViewPosition * 14.0);
        vec3 necroticBrown = vec3(0.16, 0.13, 0.10); // coagulative necrosis
        vec3 necroticGrey = vec3(0.07, 0.07, 0.07);  // infarcted necrotic core
        vec3 mottled = mix(necroticBrown, necroticGrey, n);
        diffuseColor.rgb = mix(diffuseColor.rgb, mottled, clamp(uSeverity * 0.94, 0.0, 0.98));
      }
      // State 4: Inflamed (Hyperemic bright erythematous flush)
      else if (uTissueState > 3.5 && uTissueState < 4.5) {
        vec3 erythemaRed = vec3(0.88, 0.10, 0.12);
        diffuseColor.rgb = mix(diffuseColor.rgb, erythemaRed, clamp(uSeverity * 0.55, 0.0, 0.85));
      }
      `
    );

    // Roughness modification for necrotic matte texture (loss of specular shine)
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      `
      #include <roughnessmap_fragment>
      if (uTissueState > 2.5 && uTissueState < 3.5) {
        // Complete loss of specular shine on dead necrotic tissue
        roughnessFactor = mix(roughnessFactor, 0.99, uSeverity);
      }
      `
    );

    // Metalness cancellation for necrotic tissue
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <metalnessmap_fragment>',
      `
      #include <metalnessmap_fragment>
      if (uTissueState > 2.5 && uTissueState < 3.5) {
        metalnessFactor = mix(metalnessFactor, 0.0, uSeverity);
      }
      `
    );

    // Emissive modifications for highlighted and inflamed states
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `
      #include <emissivemap_fragment>
      // State 1: Highlighted (Emissive glow with customizable hex color)
      if (uTissueState > 0.5 && uTissueState < 1.5) {
        float hlPulse = 0.75 + 0.25 * sin(uTime * 3.5);
        totalEmissiveRadiance += uHighlightColor * (hlPulse * uSeverity * 0.8);
      }
      // State 4: Inflamed (Hyperemic erythematous pulsing glow)
      else if (uTissueState > 3.5 && uTissueState < 4.5) {
        float inflPulse = 0.5 + 0.5 * sin(uTime * 4.0);
        vec3 hyperemicGlow = vec3(0.75, 0.05, 0.05);
        totalEmissiveRadiance += hyperemicGlow * ((0.35 + 0.35 * inflPulse) * uSeverity);
      }
      `
    );
  };

  material.customProgramCacheKey = () => 'HoloMed_TissueStateShader_v1';
  material.needsUpdate = true;
  return material;
}

/**
 * Applies a tissue pathology state to a 3D Mesh. Clones the material defensively
 * to preserve shared templates and caches original material on mesh.userData for clean revert.
 */
export function applyTissueStateToMesh(
  mesh: THREE.Mesh,
  state: TissueShaderState | PathologyType,
  options: Omit<TissueShaderOptions, 'state'> = {}
): void {
  if (!mesh || !mesh.isMesh) return;

  // Cache original un-mutated material if not yet saved
  if (!mesh.userData.__originalMaterial) {
    mesh.userData.__originalMaterial = mesh.material;
  }

  // If currently using the original material, clone it before modifying
  if (mesh.material === mesh.userData.__originalMaterial) {
    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map((mat) => mat.clone());
    } else {
      mesh.material = mesh.material.clone();
    }
  }

  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  materials.forEach((mat) => {
    if (mat instanceof THREE.MeshStandardMaterial) {
      applyTissueStateToMaterial(mat, { ...options, state });
    }
  });
}

/**
 * Reverts a mesh back to its healthy/original material and disposes the cloned pathology material
 * to prevent GPU/WebGL memory leaks.
 */
export function revertTissueStateFromMesh(mesh: THREE.Mesh): void {
  if (!mesh || !mesh.isMesh) return;

  if (mesh.userData.__originalMaterial) {
    const currentMat = mesh.material;
    mesh.material = mesh.userData.__originalMaterial;
    delete mesh.userData.__originalMaterial;

    // Safely dispose the temporary cloned material
    if (Array.isArray(currentMat)) {
      currentMat.forEach((m) => m.dispose());
    } else if (currentMat && currentMat.dispose) {
      currentMat.dispose();
    }
  } else if (mesh.material instanceof THREE.MeshStandardMaterial && mesh.material.userData.tissueUniforms) {
    // If not cloned, reset state uniform to normal (0.0)
    mesh.material.userData.tissueUniforms.uTissueState.value = 0.0;
    mesh.material.needsUpdate = true;
  }
}

/**
 * Resets all tissue states across a scene mesh registry and disposes temporary materials.
 */
export function resetAllTissueStates(meshRegistry: Map<string, THREE.Object3D>): void {
  meshRegistry.forEach((obj) => {
    obj.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        revertTissueStateFromMesh(child as THREE.Mesh);
      }
    });
  });
}
