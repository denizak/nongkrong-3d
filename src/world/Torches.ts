import * as THREE from 'three/webgpu';
import type { Physics } from '../core/Physics';
import { ZONES, type Terrain } from './Terrain';
import type { Props } from './Props';
import { MeshBaker } from './Bake';

/** Pole height from the ground to the top of the fuel cup, in metres. */
const POLE_H = 1.9;
const FLAME_BASE_Y = POLE_H + 0.16;
const LIGHT_Y = FLAME_BASE_Y + 0.2;
const GLOW_Y = FLAME_BASE_Y + 0.25;
/** Point light strength at full night (candela-ish, decay 2). */
const LIGHT_BASE = 5;
const LIGHT_DISTANCE = 9;
const COLLIDER_R = 0.12;
const DRY_HEIGHT = 0.4;
/** Visible once nightFactor passes the first value and fully lit by the second. */
const SHOW_FROM = 0.05;
const SHOW_TO = 0.25;

const BAMBOO = new THREE.Color('#c9a86a');
const BAMBOO_RING = new THREE.Color('#a8864e');
const CUP = new THREE.Color('#4a3322');
const FLAME_OUTER = new THREE.Color('#ff8a2a');
const FLAME_INNER = new THREE.Color('#ffd36b');
const LIGHT_COLOR = new THREE.Color('#ffb36b');

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Cheap smooth "noise" from three sines, in roughly -1 to 1. */
function wobble(x: number): number {
  return Math.sin(x) * 0.5 + Math.sin(x * 2.13 + 1.7) * 0.3 + Math.sin(x * 0.57 + 4.1) * 0.2;
}

interface Torch {
  x: number;
  z: number;
  phase: number;
  light: THREE.PointLight;
  flame: THREE.Group;
  outer: THREE.MeshBasicMaterial;
  inner: THREE.MeshBasicMaterial;
  glow: THREE.SpriteMaterial;
  /** Smoothed flicker, so the light does not jitter frame to frame. */
  flicker: number;
}

/**
 * Bamboo tiki torches for the night. Each one has a pole, a fuel cup, a flame made of two cones,
 * a soft glow sprite and a point light. The whole set lives in `group`, so a later refactor can
 * clone the island's visuals by cloning that one object. Call update() once per frame.
 */
export class Torches {
  readonly group = new THREE.Group();
  readonly torches: Torch[] = [];

  private t = 0;

  constructor(scene: THREE.Object3D, terrain: Terrain, physics: Physics, props: Props) {
    this.group.name = 'torch-group';
    scene.add(this.group);
    const { ColliderDesc } = physics.RAPIER;
    // Rapier only indexes new colliders for queries on a step. Only static colliders exist this early,
    // so this step moves nothing; it just makes the prop colliders visible to the placement checks.
    physics.world.step();

    const poleGeo = new THREE.CylinderGeometry(0.05, 0.065, POLE_H, 6);
    const ringGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.05, 6);
    const cupGeo = new THREE.CylinderGeometry(0.13, 0.09, 0.16, 6);
    const outerGeo = new THREE.ConeGeometry(0.16, 0.5, 6);
    const innerGeo = new THREE.ConeGeometry(0.08, 0.3, 5);
    // Poles, rings and cups are baked into two meshes for the whole set (bamboo and cups), so the set costs two draws.
    const bamboo = new MeshBaker(true);
    const cups = new MeshBaker(true);
    // The flame materials are shared: every torch fades in and out together.
    const outerMat = new THREE.MeshBasicMaterial({
      color: FLAME_OUTER, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0,
    });
    const innerMat = new THREE.MeshBasicMaterial({ color: FLAME_INNER, transparent: true, depthWrite: false, opacity: 0 });
    const glowTex = makeGlowTexture();

    for (const [x, z] of this.spots(terrain, physics, props)) {
      const y = terrain.heightAt(x, z);
      const root = new THREE.Group();
      root.name = 'torch';
      root.position.set(x, y, z);

      bamboo.add(poleGeo, new THREE.Matrix4().makeTranslation(x, y + POLE_H / 2, z), BAMBOO);
      for (const ry of [0.35, 0.95, 1.55]) {
        bamboo.add(ringGeo, new THREE.Matrix4().makeTranslation(x, y + ry, z), BAMBOO_RING);
      }
      cups.add(cupGeo, new THREE.Matrix4().makeTranslation(x, y + POLE_H + 0.08, z), CUP);

      // Flame: a flickering group holding the outer and inner cones. The base sits at FLAME_BASE_Y.
      const flame = new THREE.Group();
      flame.name = 'torch-flame';
      flame.position.y = FLAME_BASE_Y;
      const outer = new THREE.Mesh(outerGeo, outerMat);
      outer.position.y = 0.25;
      const inner = new THREE.Mesh(innerGeo, innerMat);
      inner.position.y = 0.15;
      flame.add(outer, inner);
      root.add(flame);

      const glowMat = new THREE.SpriteMaterial({
        map: glowTex, color: LIGHT_COLOR, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, opacity: 0, fog: false,
      });
      const glow = new THREE.Sprite(glowMat);
      glow.position.y = GLOW_Y - y;
      glow.scale.set(2.6, 2.6, 1);
      root.add(glow);

      const light = new THREE.PointLight(LIGHT_COLOR, 0, LIGHT_DISTANCE, 2);
      light.position.y = LIGHT_Y - y;
      light.castShadow = false;
      root.add(light);

      this.group.add(root);

      // Collider: a thin cylinder covering the pole, so the player bumps into it.
      physics.addStatic(ColliderDesc.cylinder(POLE_H / 2, COLLIDER_R), x, y + POLE_H / 2, z);

      this.torches.push({
        x, z, phase: Math.random() * Math.PI * 2, light, flame,
        outer: outerMat, inner: innerMat, glow: glowMat, flicker: 1,
      });
    }
    this.group.add(
      new THREE.Mesh(bamboo.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, flatShading: true })),
      new THREE.Mesh(cups.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true })),
    );
    this.group.visible = false;
  }

  get count(): number {
    return this.torches.length;
  }

  /** Per frame. `night` is DayNight.nightFactor, 0 by day and 1 at deep night. */
  update(dt: number, night: number) {
    this.t += dt;
    const vis = smoothstep(SHOW_FROM, SHOW_TO, night);
    this.group.visible = vis > 0.001;
    if (!this.group.visible) {
      for (const f of this.torches) f.light.intensity = 0;
      return;
    }
    const k = Math.min(1, dt * 10);
    for (const f of this.torches) {
      const n = wobble(this.t * 7 + f.phase);
      const target = 0.975 + 0.125 * n;
      f.flicker += (target - f.flicker) * k;
      // Light: scaled by night and smoothed flicker.
      f.light.intensity = LIGHT_BASE * night * f.flicker;

      // Flame: height breathes between 0.85 and 1.15, with a small sideways sway.
      const breathe = 1 + 0.15 * wobble(this.t * 9 + f.phase * 1.3);
      f.flame.scale.set(1 - 0.05 * n, breathe, 1 - 0.05 * n);
      f.flame.rotation.z = 0.06 * Math.sin(this.t * 2.3 + f.phase) + 0.02 * Math.sin(this.t * 5.1 + f.phase * 2);
      f.flame.rotation.x = 0.04 * Math.cos(this.t * 1.9 + f.phase * 0.7);

      f.outer.opacity = 0.8 * vis;
      f.inner.opacity = 1 * vis;
      f.glow.opacity = (0.75 + 0.15 * n) * vis;
    }
  }

  /** Finds the spots: spawn ring, paddy gap, pond shore, orchard edge, scarecrow. Nudges each toward spawn until valid. */
  private spots(terrain: Terrain, physics: Physics, props: Props): Array<[number, number]> {
    const { spawn, pond, paddy } = ZONES;
    const ORCHARD = { x: -14, z: 12 };
    const raw: Array<[number, number]> = [];

    // 4 around the spawn clearing, loose ring.
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      raw.push([spawn.x + Math.cos(a) * 6, spawn.z + Math.sin(a) * 6]);
    }
    // 2 flanking the paddy's dike gap on the east side (gap is centred on paddy.z, 2 m wide).
    const eastX = paddy.x + paddy.w / 2 + 0.7;
    raw.push([eastX, paddy.z - 1.6], [eastX, paddy.z + 1.6]);
    // 3 along the pond shore on the spawn-facing side, about 2 m back from the water.
    const pondAngle = Math.atan2(spawn.z - pond.z, spawn.x - pond.x);
    for (const d of [-0.3, 0, 0.3]) {
      const a = pondAngle + d;
      raw.push([pond.x + Math.cos(a) * (pond.r + 2), pond.z + Math.sin(a) * (pond.r + 2)]);
    }
    // 2 at the orchard edge facing spawn.
    const orchardAngle = Math.atan2(spawn.z - ORCHARD.z, spawn.x - ORCHARD.x);
    for (const d of [-0.3, 0.3]) {
      const a = orchardAngle + d;
      raw.push([ORCHARD.x + Math.cos(a) * 8, ORCHARD.z + Math.sin(a) * 8]);
    }
    // 1 near the scarecrow.
    const sc = props.scarecrow.position;
    raw.push([sc.x + 1.5, sc.z - 1.5]);

    const out: Array<[number, number]> = [];
    for (const [x0, z0] of raw) {
      const spot = this.settle(x0, z0, terrain, physics, props);
      if (spot) out.push(spot);
      else console.warn(`Torches: no valid spot near (${x0.toFixed(1)}, ${z0.toFixed(1)})`);
    }
    return out;
  }

  /** Walks a spot toward spawn (the origin) until it is on dry land and clear of props. */
  private settle(x0: number, z0: number, terrain: Terrain, physics: Physics, props: Props): [number, number] | null {
    let x = x0;
    let z = z0;
    for (let step = 0; step < 40; step++) {
      const h = terrain.heightAt(x, z);
      if (h > DRY_HEIGHT && this.clear(x, z, h, physics, props)) return [x, z];
      const d = Math.hypot(x, z);
      if (d < 0.5) break;
      x -= (x / d) * 0.6;
      z -= (z / d) * 0.6;
    }
    return null;
  }

  /** True if nothing solid sits at this spot: no tree trunk, scarecrow post or rock collider. */
  private clear(x: number, z: number, h: number, physics: Physics, props: Props): boolean {
    for (const tree of props.fruitTrees) {
      if (Math.hypot(tree.position.x - x, tree.position.z - z) < 0.9) return false;
    }
    if (Math.hypot(props.scarecrow.position.x - x, props.scarecrow.position.z - z) < 1.1) return false;

    // Rapier overlap test at mid-pole height. Ignores the terrain trimesh.
    const { world, RAPIER, terrainCollider } = physics;
    const ball = new RAPIER.Ball(COLLIDER_R + 0.2);
    let hit = false;
    world.intersectionsWithShape(
      { x, y: h + POLE_H / 2, z },
      { x: 0, y: 0, z: 0, w: 1 },
      ball,
      (collider) => {
        if (terrainCollider && collider.handle === terrainCollider.handle) return true;
        hit = true;
        return false;
      },
    );
    return !hit;
  }
}

/** Soft round glow, white centre fading to transparent. Tinted by the sprite colour. */
function makeGlowTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}
