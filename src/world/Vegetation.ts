import * as THREE from 'three/webgpu';
import { ZONES, mulberry32, type Terrain } from './Terrain';
import { instanceModel, type NatureAssets, type NatureName } from './Assets';

const GRASS_ENABLED = false; // grass looked off; disabled for now
const GRASS: NatureName[] = ['grass', 'grass_large', 'grass_leafs'];
const FLOWERS: NatureName[] = [
  'flower_purpleA', 'flower_redA', 'flower_yellowA', 'flower_purpleB', 'flower_redB', 'flower_yellowB',
];
const UP = new THREE.Vector3(0, 1, 0);

/** Scatters swaying grass tufts and flowers on grassy land (no shadows). */
export function addVegetation(
  scene: THREE.Object3D,
  terrain: Terrain,
  assets: NatureAssets,
  inCorridor: (x: number, z: number) => boolean,
) {
  const rand = mulberry32(911);
  const { pond, paddy } = ZONES;
  const group = new THREE.Group();
  group.name = 'vegetation';
  scene.add(group);

  // Grassy land: inland, above the beach, not in the pond, paddy or bridge landings.
  const grassy = (x: number, z: number) => {
    if (inCorridor(x, z)) return false;
    if (Math.hypot(x, z) > 44) return false;
    if (Math.hypot(x - pond.x, z - pond.z) < pond.r + 2) return false;
    if (Math.abs(x - paddy.x) < paddy.w / 2 + 1 && Math.abs(z - paddy.z) < paddy.d / 2 + 1) return false;
    return terrain.heightAt(x, z) > 0.7;
  };

  // Rejection-sample land points, then give each one a model and a size.
  const sample = (count: number) => {
    const points: { x: number; z: number; y: number }[] = [];
    for (let tries = 0; points.length < count && tries < count * 50; tries++) {
      const x = (rand() - 0.5) * 150;
      const z = (rand() - 0.5) * 150;
      if (grassy(x, z)) points.push({ x, z, y: terrain.heightAt(x, z) });
    }
    return points;
  };

  const build = (
    points: ReturnType<typeof sample>,
    names: NatureName[],
    sizeOf: (name: NatureName) => [number, number],
    wind: number,
  ) => {
    const byName = new Map<NatureName, THREE.Matrix4[]>(names.map((n) => [n, []]));
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
      byName.get(name)!.push(new THREE.Matrix4().compose(pos, quat, scale));
    }
    for (const [name, mats] of byName) instanceModel(group, assets[name], mats, { wind, jitter: rand });
  };

  // Tufts are kept short so they read as grass, not crystal shards.
  const grassSize = (name: NatureName): [number, number] => (name === 'grass' ? [0.2, 0.4] : [0.25, 0.45]);
  if (GRASS_ENABLED) build(sample(3000), GRASS, grassSize, 0.25);
  build(sample(500), FLOWERS, () => [0.3, 0.5], 0.2);
}
