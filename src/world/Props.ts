import * as THREE from 'three/webgpu';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Physics } from '../core/Physics';
import { mulberry32, type Terrain, type ShapeSpec } from './Terrain';
import { instanceModel, type NatureAssets, type NatureName } from './Assets';
import { buildScarecrow } from '../interact/Scarecrow';
import type { Instance, Scatter } from './Scatter';

export interface FruitTree {
  position: THREE.Vector3;
  /** Tree root at the base. The trunk, canopy and fruit all live under it so a shake moves them together. */
  object: THREE.Object3D;
  /** Mango instances in the canopy. */
  fruit: THREE.InstancedMesh;
}

export interface Props {
  fruitTrees: FruitTree[];
  /** Scarecrow model at its spot in the paddy. Its interaction is wired in main. */
  scarecrow: THREE.Group;
  /** Positions of the decoy scarecrows (no interaction), for the paddy's stalks to keep clear of. */
  decoys: THREE.Vector3[];
}

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);

const PALMS: NatureName[] = [
  'tree_palm', 'tree_palmBend', 'tree_palmShort', 'tree_palmTall', 'tree_palmDetailedShort', 'tree_palmDetailedTall',
];
const FRUIT_TREES: NatureName[] = ['tree_default', 'tree_oak', 'tree_fat', 'tree_detailed'];
const LARGE_ROCKS: NatureName[] = ['rock_largeA', 'rock_largeB', 'rock_largeC', 'rock_tallA'];
const SMALL_ROCKS: NatureName[] = ['rock_smallA', 'rock_smallB', 'rock_smallC'];
const BUSHES: NatureName[] = ['plant_bush', 'plant_bushLarge', 'plant_bushDetailed'];
/** Models that skip shadow casting: small, flat or many-instanced. */
const NO_SHADOW = new Set<NatureName>([
  'mushroom_red', 'crops_wheatStageB', 'lily_large', 'lily_small',
  'flower_purpleA', 'flower_redA', 'flower_yellowA', 'flower_purpleB', 'flower_redB', 'flower_yellowB',
  'grass', 'grass_large', 'grass_leafs',
]);
/** Beach palms on the sand (besides the three leaning ones): at most this many, this far apart, and clear of the pier approach. */
const BEACH_PALMS = 6;
const BEACH_PALM_GAP = 8;
const BEACH_PATH_CLEAR = 10;

/**
 * Places trees, rocks, bushes, decorations, bamboo, lily pads, a rice paddy
 * and the scarecrow (rice is built by PaddyField). Scenery goes through `scatter`, so it can be hidden later.
 */
export function addProps(
  scene: THREE.Object3D,
  terrain: Terrain,
  physics: Physics,
  assets: NatureAssets,
  scatter: Scatter,
  spec: ShapeSpec,
): Props {
  const { ColliderDesc } = physics.RAPIER;
  const rand = mulberry32(42);
  const { spawn, ponds, paddy } = spec.zones;
  const orchards = spec.orchards;
  // Linear scale K: distances grow with K, and scatter counts with K squared, so the density stays the same.
  const K = spec.scale;
  const density = K * K;
  const count = (n: number) => Math.round(n * density);
  const group = new THREE.Group();
  group.name = 'props';
  scene.add(group);

  const range = (a: number, b: number) => a + rand() * (b - a);
  const pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)];
  const inOrchard = (x: number, z: number) => orchards.some((o) => Math.hypot(x - o.x, z - o.z) < o.r + 3);
  const onBeach = (z: number) => spec.beach !== undefined && z >= spec.beach.fromZ;

  /** Spots kept free of props. A lily pad may sit on its pond, so the pond's margin is skipped for it. */
  const keepClear = (x: number, z: number, pondOk: boolean) => {
    if (Math.hypot(x - spawn.x, z - spawn.z) < spawn.r) return true;
    if (!pondOk && ponds.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + 2)) return true;
    if (spec.keepOut?.(x, z)) return true;
    if (Math.abs(x - paddy.x) < paddy.w / 2 + 2 && Math.abs(z - paddy.z) < paddy.d / 2 + 2) return true;
    return inOrchard(x, z);
  };

  /** Random land spot inside a disc of radius maxR around (cx, cz) that passes the test. */
  const findSpot = (cx: number, cz: number, maxR: number, test: (x: number, z: number, h: number) => boolean, pondOk = false) => {
    for (let tries = 0; tries < 300; tries++) {
      const r = Math.sqrt(rand()) * maxR;
      const a = rand() * TAU;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      const h = terrain.heightAt(x, z);
      if (!keepClear(x, z, pondOk) && test(x, z, h)) return { x, y: h, z };
    }
    return null;
  };

  /** Queues a model at a spot, turned to a random heading. */
  const add = (name: NatureName, x: number, y: number, z: number, height: number, sxz = height): Instance => {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromAxisAngle(UP, rand() * TAU),
      new THREE.Vector3(sxz, height, sxz),
    );
    return scatter.add(name, m, x, z);
  };
  /** Gives an instance a static collider, which is switched off while the instance is hidden. */
  const collide = (inst: Instance, desc: RAPIER.ColliderDesc, x: number, y: number, z: number) => {
    inst.colliders.push(physics.addStatic(desc, x, y, z));
  };
  /** Widest horizontal extent of a model at a given height, in metres. */
  const widthOf = (name: NatureName, height: number) => {
    const b = assets[name].box;
    return Math.max(b.max.x - b.min.x, b.max.z - b.min.z) * height;
  };

  // Orchards: each cluster is a ring of mango trees around its centre.
  const fruitGeo = new THREE.SphereGeometry(0.14, 8, 6);
  const fruitMat = new THREE.MeshStandardMaterial({ color: '#ff9d2e', roughness: 0.5, flatShading: true });
  const fruitTrees: FruitTree[] = [];
  for (const orchard of orchards)
  for (let i = 0; i < orchard.trees; i++) {
    const a = (i / orchard.trees) * TAU + range(-0.2, 0.2);
    const r = orchard.r * range(0.6, 1);
    const x = orchard.x + Math.cos(a) * r;
    const z = orchard.z + Math.sin(a) * r;
    const y = terrain.heightAt(x, z);
    const h = range(4, 5);
    const name = pick(FRUIT_TREES);
    physics.addStatic(ColliderDesc.cylinder(h * 0.25, 0.35), x, y + h * 0.25, z);

    // Tree model under its own root, so shaking it moves the whole tree.
    const object = new THREE.Object3D();
    object.position.set(x, y, z);
    group.add(object);
    const rot = new THREE.Quaternion().setFromAxisAngle(UP, rand() * TAU);
    const local = new THREE.Matrix4().compose(new THREE.Vector3(), rot, new THREE.Vector3(h, h, h));
    instanceModel(object, assets[name], [local], { shadow: true, wind: 0.03 });

    // Mango-coloured fruit hanging inside the canopy.
    const canopy = Math.max(assets[name].box.max.x, assets[name].box.max.z) * h;
    const count = 4 + Math.floor(rand() * 4);
    const fruit = new THREE.InstancedMesh(fruitGeo, fruitMat, count);
    const m = new THREE.Matrix4();
    for (let k = 0; k < count; k++) {
      const fa = rand() * TAU;
      const fr = canopy * range(0.4, 0.85);
      m.makeTranslation(Math.cos(fa) * fr, h * range(0.45, 0.7), Math.sin(fa) * fr);
      fruit.setMatrixAt(k, m);
    }
    fruit.instanceMatrix.needsUpdate = true;
    fruit.castShadow = true;
    object.add(fruit);
    fruitTrees.push({ position: new THREE.Vector3(x, y, z), object, fruit });
  }

  // Beach palms: a few, spaced apart and kept off the pier's approach. The leaning ones (Beach.ts) count for spacing.
  const beachSpots: Array<[number, number]> = [...(spec.beach?.palmSpots ?? [])];
  for (let placed = 0, tries = 0; placed < BEACH_PALMS && tries < 60; tries++) {
    const p = findSpot(0, 0, 62 * K, (x, z, h) =>
      onBeach(z) && Math.abs(x) >= BEACH_PATH_CLEAR && h >= 0.4 && h <= 1.5
      && beachSpots.every(([sx, sz]) => Math.hypot(x - sx, z - sz) >= BEACH_PALM_GAP));
    if (!p) continue;
    const h = range(5, 7);
    const inst = add(pick(PALMS), p.x, p.y, p.z, h);
    collide(inst, ColliderDesc.cylinder(h * 0.4, 0.3), p.x, p.y + h * 0.4, p.z);
    beachSpots.push([p.x, p.z]);
    placed++;
  }

  // Palms: mostly on the coast, a few inland on higher ground. The beach has its own handful above.
  for (let i = 0; i < count(26); i++) {
    const p = findSpot(0, 0, 62 * K, (x, z, h) => Math.hypot(x, z) > 40 * K && h >= 0.4 && h <= 1.5 && !onBeach(z));
    if (!p) continue;
    const h = range(5, 7);
    const inst = add(pick(PALMS), p.x, p.y, p.z, h);
    collide(inst, ColliderDesc.cylinder(h * 0.4, 0.3), p.x, p.y + h * 0.4, p.z);
  }
  for (let i = 0; i < count(6); i++) {
    const p = findSpot(0, 0, 36 * K, (_x, z, h) => h > 0.9 && h < 3.5 && !onBeach(z));
    if (!p) continue;
    const h = range(5, 7);
    const inst = add(pick(PALMS), p.x, p.y, p.z, h);
    collide(inst, ColliderDesc.cylinder(h * 0.4, 0.3), p.x, p.y + h * 0.4, p.z);
  }

  // Rocks: large ones always get a ball collider, small ones only if at least 0.5 m.
  for (let i = 0; i < count(14); i++) {
    const p = findSpot(0, 0, 70 * K, (_x, _z, h) => h > 0.2);
    if (!p) continue;
    const h = range(1.2, 2.2);
    const name = pick(LARGE_ROCKS);
    const base = p.y - 0.1 * h;
    const inst = add(name, p.x, base, p.z, h);
    const r = widthOf(name, h) * 0.45;
    collide(inst, ColliderDesc.ball(r), p.x, base + r * 0.9, p.z);
  }
  for (let i = 0; i < count(30); i++) {
    const p = findSpot(0, 0, 60 * K, (_x, _z, h) => h > 0.2);
    if (!p) continue;
    const h = range(0.3, 0.7);
    const name = pick(SMALL_ROCKS);
    const inst = add(name, p.x, p.y, p.z, h);
    if (h >= 0.5) {
      const r = widthOf(name, h) * 0.45;
      collide(inst, ColliderDesc.ball(r), p.x, p.y + r * 0.9, p.z);
    }
  }

  // Bushes and a few decorations on land.
  for (let i = 0; i < count(22); i++) {
    const p = findSpot(0, 0, 70 * K, (_x, _z, h) => h > 0.5);
    if (p) add(pick(BUSHES), p.x, p.y, p.z, range(0.8, 1.5));
  }
  for (let i = 0; i < count(3); i++) {
    const p = findSpot(0, 0, 60 * K, (_x, _z, h) => h > 0.5);
    if (p) add('stump_round', p.x, p.y, p.z, 0.5);
  }
  for (let i = 0; i < count(3); i++) {
    const p = findSpot(0, 0, 60 * K, (_x, _z, h) => h > 0.5);
    if (p) add('log', p.x, p.y, p.z, 0.45);
  }
  for (let i = 0; i < count(8); i++) {
    const p = findSpot(0, 0, 60 * K, (_x, _z, h) => h > 0.5);
    if (p) add('mushroom_red', p.x, p.y, p.z, range(0.2, 0.35));
  }

  // Bamboo clump on the first pond's west shore, about 2 m from the water edge.
  const pond = ponds[0];
  const bx = pond.x - 12.5 * K;
  const bz = pond.z;
  for (let i = 0; i < 10; i++) {
    const a = rand() * TAU;
    const r = Math.sqrt(rand()) * 1.2 * K;
    const x = bx + Math.cos(a) * r;
    const z = bz + Math.sin(a) * r;
    add('crops_bambooStageB', x, terrain.heightAt(x, z), z, range(3, 4));
  }
  // One camera-blocking cylinder around the whole clump: spread 1.2 m plus 0.3 m, stalks up to 4 m.
  physics.addCameraBlocker(ColliderDesc.cylinder(2, 1.5), bx, terrain.heightAt(bx, bz) + 2, bz);

  // Lily pads floating on each pond. They sample around their own pond, and may sit in its keep-clear margin.
  for (const water of ponds) {
    for (let i = 0; i < count(16); i++) {
      const p = findSpot(water.x, water.z, water.r - 1.5, (_x, _z, h) => h < -0.2, true);
      if (!p) continue;
      add(pick(['lily_large', 'lily_small'] as const), p.x, 0.03, p.z, range(0.7, 1.3));
    }
  }

  scatter.flush(group, assets, (name) => ({
    shadow: !NO_SHADOW.has(name),
    // Trees and palms sway very slightly.
    wind: name.startsWith('tree_') || name.startsWith('plant_') ? 0.03 : 0,
  }));

  // Scarecrow at the paddy edge, with a post collider. Its paddy stalks are built by PaddyField.
  const scarecrowX = paddy.x + 4 * K;
  const scarecrowZ = paddy.z + 2 * K;
  const scarecrow = buildScarecrow();
  scarecrow.position.set(scarecrowX, terrain.heightAt(scarecrowX, scarecrowZ), scarecrowZ);
  group.add(scarecrow);
  physics.addStatic(ColliderDesc.cylinder(1.2, 0.1), scarecrowX, scarecrow.position.y + 1.2, scarecrowZ);
  // Decoy scarecrows (no interaction) with the same post collider.
  const decoys: THREE.Vector3[] = [];
  for (const [dx, dz] of spec.decoyScarecrows ?? []) {
    const decoy = buildScarecrow();
    decoy.position.set(dx, terrain.heightAt(dx, dz), dz);
    group.add(decoy);
    decoys.push(decoy.position);
    physics.addStatic(ColliderDesc.cylinder(1.2, 0.1), dx, decoy.position.y + 1.2, dz);
  }
  return { fruitTrees, scarecrow, decoys };
}
