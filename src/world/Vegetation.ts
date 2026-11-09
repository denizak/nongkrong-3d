import * as THREE from 'three/webgpu';
import { mulberry32, type ShapeSpec, type Terrain } from './Terrain';
import type { NatureAssets, NatureName } from './Assets';
import type { Scatter } from './Scatter';

const GRASS_ENABLED = false; // grass looked off; disabled for now
const GRASS: NatureName[] = ['grass', 'grass_large', 'grass_leafs'];
const FLOWERS: NatureName[] = [
  'flower_purpleA', 'flower_redA', 'flower_yellowA', 'flower_purpleB', 'flower_redB', 'flower_yellowB',
];
const UP = new THREE.Vector3(0, 1, 0);

/** Handle on the island's scattered plants. `setShare` draws only that share of the flowers (live, by instance count). */
export interface Vegetation {
  setShare(share: number): void;
}

/**
 * Scatters swaying grass tufts and flowers on grassy land (no shadows). They go through `scatter`, so bridges can hide them.
 * Flowers are always placed in full; the quality tier draws a share of them (their points are random, so a prefix is a fair sample).
 */
export function addVegetation(
  scene: THREE.Object3D,
  terrain: Terrain,
  assets: NatureAssets,
  scatter: Scatter,
  spec: ShapeSpec,
): Vegetation {
  const rand = mulberry32(911);
  const { ponds, paddy } = spec.zones;
  const K = spec.scale;
  const density = K * K;
  const group = new THREE.Group();
  group.name = 'vegetation';
  scene.add(group);

  // Grassy land: inland, above the beach, not in the pond or paddy.
  const grassy = (x: number, z: number) => {
    if (Math.hypot(x, z) > 44 * K) return false;
    if (ponds.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + 2)) return false;
    if (spec.keepOut?.(x, z)) return false;
    if (Math.abs(x - paddy.x) < paddy.w / 2 + 1 && Math.abs(z - paddy.z) < paddy.d / 2 + 1) return false;
    return terrain.heightAt(x, z) > 0.7;
  };

  // Rejection-sample land points, then give each one a model and a size.
  const sample = (count: number) => {
    const points: { x: number; z: number; y: number }[] = [];
    for (let tries = 0; points.length < count && tries < count * 50; tries++) {
      const x = (rand() - 0.5) * 150 * K;
      const z = (rand() - 0.5) * 150 * K;
      if (grassy(x, z)) points.push({ x, z, y: terrain.heightAt(x, z) });
    }
    return points;
  };

  const build = (
    points: ReturnType<typeof sample>,
    names: NatureName[],
    sizeOf: (name: NatureName) => [number, number],
    wind: number,
  ): THREE.InstancedMesh[] => {
    const before = group.children.length;
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const pos = new THREE.Vector3();
    for (const p of points) {
      const name = names[Math.floor(rand() * names.length)];
      const [minH, maxH] = sizeOf(name);
      const h = minH + rand() * (maxH - minH);
      const w = h * (0.85 + rand() * 0.3);
      quat.setFromAxisAngle(UP, rand() * Math.PI * 2);
      pos.set(p.x, p.y, p.z);
      scale.set(w, h, w);
      scatter.add(name, new THREE.Matrix4().compose(pos, quat, scale), p.x, p.z);
    }
    scatter.flush(group, assets, () => ({ wind, jitter: rand }));
    return group.children.slice(before) as THREE.InstancedMesh[];
  };

  // Tufts are kept short so they read as grass, not crystal shards.
  const grassSize = (name: NatureName): [number, number] => (name === 'grass' ? [0.2, 0.4] : [0.25, 0.45]);
  if (GRASS_ENABLED) build(sample(Math.round(3000 * density)), GRASS, grassSize, 0.25);
  const flowers = build(sample(Math.round(500 * density)), FLOWERS, () => [0.3, 0.5], 0.2)
    .filter((m) => m.isInstancedMesh);
  for (const m of flowers) m.userData.fullCount = m.count;

  return {
    setShare(share: number) {
      for (const m of flowers) m.count = Math.round((m.userData.fullCount as number) * share);
    },
  };
}
