import * as THREE from 'three/webgpu';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { float, fract, instanceIndex, positionLocal, sin, time, vec3 } from 'three/tsl';

/** Kenney Nature Kit models in public/models/nature (CC0). */
export const NATURE_MODELS = [
  'tree_palm', 'tree_palmBend', 'tree_palmShort', 'tree_palmTall', 'tree_palmDetailedShort', 'tree_palmDetailedTall',
  'tree_default', 'tree_oak', 'tree_fat', 'tree_detailed',
  'rock_largeA', 'rock_largeB', 'rock_largeC', 'rock_smallA', 'rock_smallB', 'rock_smallC', 'rock_tallA',
  'flower_purpleA', 'flower_redA', 'flower_yellowA', 'flower_purpleB', 'flower_redB', 'flower_yellowB',
  'grass', 'grass_large', 'grass_leafs',
  'plant_bush', 'plant_bushLarge', 'plant_bushDetailed',
  'lily_large', 'lily_small',
  'crops_bambooStageB', 'crops_wheatStageA', 'crops_wheatStageB',
  'stump_round', 'log', 'mushroom_red',
] as const;
export type NatureName = (typeof NATURE_MODELS)[number];

/** Flat models are sized by their footprint, since their height is almost zero. */
const FOOTPRINT_FIT = new Set<NatureName>(['lily_large', 'lily_small']);

/** Kenney material names mapped to a natural palette. Reds, yellows and purples stay as they are. */
const PALETTE: Record<string, string> = {
  grass: '#5fb83f',
  leafsGreen: '#3f9e3a',
  leafsDark: '#2f7d34',
  woodBark: '#8b5e3c',
  woodInner: '#d9b48a',
  dirt: '#9c9488',
  _defaultMat: '#b5afa3',
};

function paletteColor(src: THREE.MeshStandardMaterial) {
  const hex = PALETTE[src.name];
  return hex ? new THREE.Color().set(hex) : src.color.clone();
}

export interface Part {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
}

export interface NatureModel {
  /** Parts with their transforms baked in, so each one can feed an InstancedMesh. */
  parts: Part[];
  /** Bounds in unit space: height (or footprint) of 1, base at y = 0, centred on x/z. */
  box: THREE.Box3;
}

export type NatureAssets = Record<NatureName, NatureModel>;

/** Loads every nature model in parallel and normalises each to unit size. `onLoaded` runs after each one. */
export async function loadNatureAssets(onLoaded?: () => void): Promise<NatureAssets> {
  const loader = new GLTFLoader();
  const entries = await Promise.all(
    NATURE_MODELS.map(async (name) => {
      const model = await loadModel(loader, name);
      onLoaded?.();
      return [name, model] as const;
    }),
  );
  return Object.fromEntries(entries) as NatureAssets;
}

async function loadModel(loader: GLTFLoader, name: NatureName): Promise<NatureModel> {
  const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/nature/${name}.glb`);
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();

  // Bake each mesh's transform relative to the model root into its geometry.
  const parts: Part[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const src = mesh.material as THREE.MeshStandardMaterial;
    const geometry = mesh.geometry
      .clone()
      .applyMatrix4(new THREE.Matrix4().multiplyMatrices(toRoot, mesh.matrixWorld));
    // Kenney's GLB materials are metallic; swap for matte ones with the same colour.
    const material = new THREE.MeshStandardMaterial({
      color: paletteColor(src),
      roughness: 0.9,
      metalness: 0,
      flatShading: true,
    });
    parts.push({ geometry, material });
  });

  const box = new THREE.Box3();
  for (const p of parts) {
    p.geometry.computeBoundingBox();
    box.union(p.geometry.boundingBox!);
  }
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const unit = FOOTPRINT_FIT.has(name) ? Math.max(size.x, size.z) : size.y;
  const s = 1 / unit;
  const normalize = new THREE.Matrix4()
    .makeScale(s, s, s)
    .multiply(new THREE.Matrix4().makeTranslation(-center.x, -box.min.y, -center.z));
  for (const p of parts) p.geometry.applyMatrix4(normalize);

  return { parts, box: box.applyMatrix4(normalize) };
}

const WIND_ENABLED = false; // wind sway looked off; disabled for now

const GOLDEN = 0.6180339887;

/**
 * Material that sways in the wind. The bend grows with the vertex's height
 * (unit space), so bases stay planted. Each instance gets its own phase.
 */
export function windMaterial(color: THREE.Color, amp: number) {
  const mat = new MeshStandardNodeMaterial({ color, roughness: 0.9, metalness: 0, flatShading: true });
  const phase = fract(float(instanceIndex).mul(GOLDEN)).mul(Math.PI * 2);
  const gust = sin(time.mul(1.6).add(phase)).add(sin(time.mul(0.7).add(phase.mul(0.6))).mul(0.5));
  const bend = positionLocal.y.mul(positionLocal.y).mul(amp).mul(gust);
  mat.positionNode = positionLocal.add(vec3(bend, float(0), bend.mul(0.4)));
  return mat;
}

/**
 * Adds one InstancedMesh per part of a model, one instance per matrix.
 * `wind` > 0 makes the parts sway with windMaterial.
 */
export function instanceModel(
  parent: THREE.Object3D,
  model: NatureModel,
  matrices: THREE.Matrix4[],
  opts: { shadow?: boolean; wind?: number; jitter?: () => number } = {},
) {
  if (matrices.length === 0) return;
  for (const part of model.parts) {
    const material = WIND_ENABLED && opts.wind ? windMaterial(part.material.color, opts.wind) : part.material;
    const mesh = new THREE.InstancedMesh(part.geometry, material, matrices.length);
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.instanceMatrix.needsUpdate = true;
    // Optional +/-8% brightness per instance, applied as instance colour.
    if (opts.jitter) {
      const c = new THREE.Color();
      matrices.forEach((_m, i) => mesh.setColorAt(i, c.setScalar(0.92 + opts.jitter!() * 0.16)));
      mesh.instanceColor!.needsUpdate = true;
    }
    mesh.castShadow = !!opts.shadow;
    mesh.receiveShadow = !!opts.shadow;
    parent.add(mesh);
  }
}
