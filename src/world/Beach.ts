import * as THREE from 'three/webgpu';
import type { Physics } from '../core/Physics';
import type { Layout } from './Bridges';
import { instanceModel, type NatureAssets, type NatureName } from './Assets';
import { bakeStatic } from './Bake';
import type { MainTerrain } from './MainTerrain';
import { MAIN_CENTRE, MAIN_ID } from './Islands';

/** Deck height (m) of the pier, above the sea. */
const PIER_H = 0.9;
/** The pier starts this far inland of the shore and runs this far out to sea (40 m in all). */
const PIER_IN = 8;
const PIER_OUT = 32;

/**
 * The pier, as a bridge layout in world coordinates: a flat deck from the south beach straight out to sea.
 * Bridges builds its planks, posts, rails and lanterns, and its colliders make it walkable and fishable.
 */
export function pierLayout(terrain: MainTerrain): Layout {
  const s = terrain.pierShoreZ;
  return {
    id: 'pier',
    islands: [MAIN_ID, MAIN_ID],
    axis: 'z',
    lateral: MAIN_CENTRE.x,
    p0: MAIN_CENTRE.z + s - PIER_IN,
    p1: MAIN_CENTRE.z + s + PIER_OUT,
    h0: PIER_H,
    h1: PIER_H,
    arch: 0,
  };
}

const PALM_NAMES: NatureName[] = ['tree_palmBend', 'tree_palm', 'tree_palmTall'];
const ROCK_NAMES: NatureName[] = ['rock_smallA', 'rock_smallB', 'rock_largeA'];
const LOUNGER_COLOURS = ['#e85d4a', '#2aa7a0', '#f2c14e'];
const TOWEL_COLOURS = ['#4aa3df', '#ff8fab'];
const BOAT_COLOUR = '#2f6fa0';
const TILT_SEA = 0.2;

/** Beach dressing on the south side: three palms leaning to sea, rocks, loungers, towels and an upturned boat. */
export function addBeach(root: THREE.Group, terrain: MainTerrain, physics: Physics, assets: NatureAssets) {
  const { ColliderDesc } = physics.RAPIER;
  const rand = (() => {
    let seed = 77;
    return () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
  })();

  // Palms on the sand, tilted toward the sea (+z), each with a trunk collider.
  const palmMats = new Map<NatureName, THREE.Matrix4[]>();
  for (const x of [-64, -40, 46]) {
    const z = terrain.shoreZ(x) - 9;
    const y = terrain.heightAt(x, z);
    const h = 6.5 + rand();
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), TILT_SEA);
    const name = PALM_NAMES[Math.floor(rand() * PALM_NAMES.length)];
    if (!palmMats.has(name)) palmMats.set(name, []);
    palmMats.get(name)!.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(h, h, h)));
    physics.addStatic(ColliderDesc.cylinder(h * 0.4, 0.3), x, y + h * 0.4, z);
  }
  for (const [name, mats] of palmMats) instanceModel(root, assets[name], mats, { shadow: true, wind: 0 });

  // Beach rocks, a few, half-buried in the sand near the waterline.
  const rocks = new Map<NatureName, THREE.Matrix4[]>();
  for (const x of [-100, -82, -18, 14, 62, 96]) {
    const z = terrain.shoreZ(x) - 2 - rand() * 3;
    const y = terrain.heightAt(x, z);
    const h = 0.6 + rand() * 0.9;
    const name = ROCK_NAMES[Math.floor(rand() * ROCK_NAMES.length)];
    if (!rocks.has(name)) rocks.set(name, []);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2);
    rocks.get(name)!.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y - 0.1 * h, z), q, new THREE.Vector3(h, h, h)));
  }
  for (const [name, mats] of rocks) instanceModel(root, assets[name], mats, { shadow: true });

  // Loungers, towels and the boat go into a temporary group and bake into the root.
  const raw = new THREE.Group();
  const flat = (color: string) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, flatShading: true });
  const add = (geo: THREE.BufferGeometry, color: string, x: number, y: number, z: number, parent: THREE.Object3D = raw) => {
    const m = new THREE.Mesh(geo, flat(color));
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };

  LOUNGER_COLOURS.forEach((colour, i) => {
    const x = -30 + i * 9;
    const z = terrain.shoreZ(x) - 7;
    const lounger = new THREE.Group();
    lounger.position.set(x, terrain.heightAt(x, z), z);
    lounger.rotation.y = 0.2 * (i - 1);
    raw.add(lounger);
    add(new THREE.BoxGeometry(1.8, 0.08, 0.7), colour, 0, 0.4, 0, lounger);
    for (const sx of [-0.8, 0.8]) for (const sz of [-0.28, 0.28]) add(new THREE.BoxGeometry(0.05, 0.4, 0.05), '#f4f1e8', sx, 0.2, sz, lounger);
    const back = add(new THREE.BoxGeometry(1.8, 0.08, 0.7), colour, 0, 0.72, -0.4, lounger);
    back.rotation.x = -0.7;
    back.position.y = 0.74;
    // A towel on the sand in front of the lounger.
    const towel = add(new THREE.BoxGeometry(1.2, 0.02, 0.8), TOWEL_COLOURS[i % TOWEL_COLOURS.length], x + 1.1, terrain.heightAt(x + 1.1, z + 1) + 0.02, z + 1, raw);
    towel.rotation.y = 0.3;
  });

  // An upturned boat: a dome-shaped hull, open side down, on the sand.
  const boatX = 72;
  const boatZ = terrain.shoreZ(boatX) - 12;
  const hull = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), flat(BOAT_COLOUR));
  hull.scale.set(1.1, 0.6, 2.5);
  hull.position.set(boatX, terrain.heightAt(boatX, boatZ), boatZ);
  hull.rotation.y = 0.4;
  raw.add(hull);

  for (const b of bakeStatic(raw, () => false)) {
    const m = new THREE.Mesh(b.geometry, b.material);
    m.name = 'beach';
    m.castShadow = m.receiveShadow = true;
    root.add(m);
  }
}

