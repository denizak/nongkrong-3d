import * as THREE from 'three/webgpu';
import type { Physics } from '../core/Physics';
import { instanceModel, type NatureAssets, type NatureName } from './Assets';
import { bakeStatic } from './Bake';
import { HUT_RING_R, PLAZA } from './MainTerrain';
import { mulberry32, type Terrain } from './Terrain';

/**
 * The main island's village plaza: five stilt huts ringing a flat square, a campfire with a stone ring and a
 * flickering flame, four benches around the fire, a signpost and four flower beds. Static parts are merged into a
 * few meshes with bakeStatic; the flame and the campfire light stay live.
 */

/** Name of the live flame group: the proxies leave it out (see Proxies). */
export const CAMPFIRE_FLAME = 'campfire-flame';

export interface Campfire {
  readonly light: THREE.PointLight;
  /** Per frame. `night` is DayNight.nightFactor. */
  update(dt: number, night: number): void;
}

const WOOD = '#9b7650';
const WOOD_DARK = '#6b4a2e';
const BAMBOO = '#c9a86a';
const THATCH = '#9a7a3e';
const DOOR = '#4a3322';
const STONE = '#8a867c';
const LOG = '#6b4a2e';
const SOIL = '#6b4f36';
const FLAME_OUTER = '#ff8a2a';
const FLAME_INNER = '#ffd36b';

const TAU = Math.PI * 2;
const HUT_ANGLES = [-90, -18, 54, 126, 198].map((d) => (d * Math.PI) / 180);
const BENCH_R = 3.6;
const FIRE_LIGHT = 9;
const FIRE_DISTANCE = 14;
const FLOWERS: NatureName[] = ['flower_purpleA', 'flower_redA', 'flower_yellowA', 'flower_purpleB', 'flower_redB', 'flower_yellowB'];
/** The signpost, between the spawn and the fire. */
const SIGN_POS = { x: -6, z: 14 };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const wobble = (x: number) => Math.sin(x) * 0.5 + Math.sin(x * 2.13 + 1.7) * 0.3 + Math.sin(x * 0.57 + 4.1) * 0.2;

/** A plain, flat-shaded material of one colour. */
function mat(color: string) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, flatShading: true });
}

/** A box at a local position inside `g`. */
function box(g: THREE.Object3D, sx: number, sy: number, sz: number, color: string, x: number, y: number, z: number) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat(color));
  m.position.set(x, y, z);
  g.add(m);
  return m;
}

/** Quaternion for a yaw (rotation about Y), as the {x, y, z, w} rapier takes. */
const yawQuat = (a: number) => ({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) });

/** One stilt hut at (cx, cz), door facing the plaza centre. Walls, posts and roof go into `g`; a solid box collider covers it. */
function addHut(g: THREE.Group, terrain: Terrain, physics: Physics, cx: number, cz: number) {
  const { ColliderDesc } = physics.RAPIER;
  const yaw = Math.atan2(-cx, -cz);
  const ground = terrain.heightAt(cx, cz);
  const floor = ground + 0.8;
  const hut = new THREE.Group();
  hut.position.set(cx, 0, cz);
  hut.rotation.y = yaw;
  g.add(hut);

  // Platform on short posts that sink into the ground.
  box(hut, 4.2, 0.22, 4.2, WOOD, 0, floor - 0.11, 0);
  for (const sx of [-1.9, 1.9]) {
    for (const sz of [-1.9, 1.9]) {
      const h = floor - 0.22 - (ground - 0.3);
      box(hut, 0.22, h, 0.22, WOOD_DARK, sx, ground - 0.3 + h / 2, sz);
    }
  }
  // Bamboo walls, a door on the front (local +z, toward the plaza) and two windows.
  box(hut, 3.2, 1.9, 3.2, BAMBOO, 0, floor + 0.95, 0);
  box(hut, 0.9, 1.5, 0.06, DOOR, 0, floor + 0.75, 1.62);
  for (const sx of [-1, 1]) box(hut, 0.06, 0.5, 0.6, DOOR, sx * 1.62, floor + 1.25, 0);
  // Steep thatched roof: a square pyramid with an overhang. ConeGeometry with four sides, turned to square on the walls.
  const roof = new THREE.Mesh(new THREE.ConeGeometry(3.1, 2.3, 4).rotateY(Math.PI / 4), mat(THATCH));
  roof.position.set(0, floor + 1.9 + 1.15 - 0.02, 0);
  hut.add(roof);

  // One solid box from the ground to the eaves, rotated with the hut.
  const bottom = ground - 0.3;
  const top = floor + 1.9;
  physics.addStatic(
    ColliderDesc.cuboid(2.1, (top - bottom) / 2, 2.1).setRotation(yawQuat(yaw)),
    cx, (top + bottom) / 2, cz,
  );
}

/** The fire: stones in a ring, two crossed logs, and a live flame group with its light. */
function addCampfire(root: THREE.Group): Campfire {
  const fire = new THREE.Group();
  fire.name = 'campfire';
  root.add(fire);
  // The stone ring and logs are static and sit in the baked layer (see buildPlaza).
  const flame = new THREE.Group();
  flame.name = CAMPFIRE_FLAME;
  flame.position.set(0, PLAZA.h + 0.25, 0);
  const outerMat = new THREE.MeshBasicMaterial({ color: FLAME_OUTER, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
  const innerMat = new THREE.MeshBasicMaterial({ color: FLAME_INNER, transparent: true, depthWrite: false, opacity: 0 });
  const outer = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.3, 6), outerMat);
  outer.position.y = 0.65;
  const inner = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.8, 5), innerMat);
  inner.position.y = 0.4;
  flame.add(outer, inner);
  fire.add(flame);

  const light = new THREE.PointLight('#ffa050', 0, FIRE_DISTANCE, 2);
  light.position.set(0, PLAZA.h + 1.5, 0);
  light.castShadow = false;
  fire.add(light);

  let t = 0;
  return {
    light,
    update(dt: number, night: number) {
      t += dt;
      const vis = smoothstep(0.05, 0.25, night);
      flame.visible = vis > 0.001;
      if (!flame.visible) {
        light.intensity = 0;
        return;
      }
      const n = wobble(t * 7);
      const breathe = 1 + 0.14 * wobble(t * 9 + 1.3);
      flame.scale.set(1 - 0.06 * n, breathe, 1 - 0.06 * n);
      flame.rotation.z = 0.05 * Math.sin(t * 2.3) + 0.02 * Math.sin(t * 5.1);
      flame.rotation.x = 0.04 * Math.cos(t * 1.9);
      light.intensity = FIRE_LIGHT * night * (0.9 + 0.1 * n);
      outerMat.opacity = 0.85 * vis;
      innerMat.opacity = vis;
    },
  };
}

/** Four benches around the fire, each facing it, with a backrest on the far side. */
function addBenches(g: THREE.Group, physics: Physics, y: number) {
  const { ColliderDesc } = physics.RAPIER;
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const bench = new THREE.Group();
    bench.position.set(Math.cos(a) * BENCH_R, y, Math.sin(a) * BENCH_R);
    // Long axis tangential; local +z points at the fire, local -z is the backrest side.
    const yaw = -a - Math.PI / 2;
    bench.rotation.y = yaw;
    g.add(bench);
    box(bench, 1.7, 0.1, 0.45, WOOD, 0, 0.45, 0);
    for (const sx of [-0.75, 0.75]) for (const sz of [-0.18, 0.18]) box(bench, 0.08, 0.45, 0.08, WOOD_DARK, sx, 0.225, sz);
    box(bench, 1.7, 0.45, 0.06, WOOD, 0, 0.72, -0.22);
    physics.addStatic(
      ColliderDesc.cuboid(0.85, 0.3, 0.25).setRotation(yawQuat(yaw)),
      bench.position.x, y + 0.3, bench.position.z,
    );
  }
}

/** The signpost by the spawn: a post with a board reading "Pulau Nongkrong". */
function addSignpost(g: THREE.Group, physics: Physics) {
  const { ColliderDesc } = physics.RAPIER;
  const { x, z } = SIGN_POS;
  const y = PLAZA.h;
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 2.3, 6), mat(WOOD_DARK));
  post.position.set(x, y + 1.15, z);
  g.add(post);
  box(g, 2.3, 0.85, 0.1, BAMBOO, x, y + 1.9, z);

  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 190;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#e9d7a4';
  ctx.fillRect(0, 0, 512, 190);
  ctx.fillStyle = '#2f3b2a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '800 70px system-ui, -apple-system, sans-serif';
  ctx.fillText('Pulau Nongkrong', 256, 98);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(2.1, 0.78),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, metalness: 0 }),
  );
  face.position.set(x, y + 1.9, z + 0.055);
  g.add(face);
  physics.addStatic(ColliderDesc.cylinder(1.15, 0.1), x, y + 1.15, z);
}

/** Four round beds of soil with flowers and a bush each. Flowers go through instanceModel, then bake with the rest. */
function addFlowerBeds(g: THREE.Group, assets: NatureAssets) {
  const rand = mulberry32(2026);
  const centres: Array<[number, number]> = [];
  for (let i = 0; i < 4; i++) {
    const a = (Math.PI / 4) + (i * Math.PI) / 2;
    centres.push([Math.cos(a) * 15, Math.sin(a) * 15]);
  }
  for (const [cx, cz] of centres) {
    const soil = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.5, 0.14, 8), mat(SOIL));
    soil.position.set(cx, PLAZA.h + 0.07, cz);
    g.add(soil);
  }
  // Each flower instance picks a model at random; one InstancedMesh set per model.
  const byName = new Map<NatureName, THREE.Matrix4[]>(FLOWERS.map((n) => [n, []]));
  for (const [cx, cz] of centres) {
    for (let k = 0; k < 6; k++) {
      const r = Math.sqrt(rand()) * 1.0;
      const a = rand() * TAU;
      const s = 0.45 + rand() * 0.2;
      const name = FLOWERS[Math.floor(rand() * FLOWERS.length)];
      byName.get(name)!.push(new THREE.Matrix4().compose(
        new THREE.Vector3(cx + Math.cos(a) * r, PLAZA.h + 0.12, cz + Math.sin(a) * r),
        new THREE.Quaternion(),
        new THREE.Vector3(s, s, s),
      ));
    }
  }
  for (const [name, matrices] of byName) instanceModel(g, assets[name], matrices);
}

/**
 * Builds the plaza under `root` (the main island's live root). Huts and benches get colliders, the fire keeps
 * a live flame, and the rest is baked into a few meshes.
 */
export function buildPlaza(root: THREE.Group, terrain: Terrain, physics: Physics, assets: NatureAssets): Campfire {
  const raw = new THREE.Group();
  raw.name = 'plaza-raw';

  // Fire ring: stones and two crossed logs (static).
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU + 0.2;
    const s = 0.26 + ((i * 37) % 7) / 60;
    const stone = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), mat(STONE));
    stone.scale.set(1, 0.6, 1);
    stone.position.set(Math.cos(a) * 1.25, PLAZA.h + s * 0.3, Math.sin(a) * 1.25);
    raw.add(stone);
  }
  for (const yaw of [0.35, -0.5]) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.12, 2.1, 6), mat(LOG));
    log.rotation.set(0, yaw, Math.PI / 2 - 0.12);
    log.position.set(0, PLAZA.h + 0.16, 0);
    raw.add(log);
  }

  // Huts ring the plaza.
  const hutGroup = new THREE.Group();
  for (const a of HUT_ANGLES) addHut(hutGroup, terrain, physics, Math.cos(a) * HUT_RING_R, Math.sin(a) * HUT_RING_R);
  raw.add(hutGroup);

  addBenches(raw, physics, PLAZA.h);
  addSignpost(raw, physics);
  addFlowerBeds(raw, assets);

  // Merge everything static into one piece per look.
  for (const b of bakeStatic(raw, () => false)) {
    const m = new THREE.Mesh(b.geometry, b.material);
    m.name = 'plaza';
    m.castShadow = m.receiveShadow = true;
    root.add(m);
  }
  return addCampfire(root);
}
