import * as THREE from 'three/webgpu';
import { createNoise2D } from 'simplex-noise';

/** Simple seeded PRNG so the island looks the same every load. */
export function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Anything that can answer "how high is the ground here" in a local frame. */
export interface Ground {
  heightAt(x: number, z: number): number;
}

/** Named areas of an island, in its local frame. */
export interface Zones {
  spawn: { x: number; z: number; r: number; h: number };
  pond: { x: number; z: number; r: number; depth: number };
  paddy: { x: number; z: number; w: number; d: number; h: number };
  hill: { x: number; z: number; r: number; h: number };
}

/** The normal island's zones. The main island uses scaleZones(ZONES, MAIN_SCALE). */
export const ZONES: Zones = {
  spawn: { x: 0, z: 0, r: 9, h: 1.6 },
  pond: { x: 10, z: 22, r: 9, depth: -1.4 },
  paddy: { x: -24, z: -18, w: 22, d: 16, h: 1.1 },
  hill: { x: 30, z: -26, r: 16, h: 5 },
};

/** Positions and sizes scaled by k. Heights and depths stay the same. */
export function scaleZones(z: Zones, k: number): Zones {
  return {
    spawn: { ...z.spawn, x: z.spawn.x * k, z: z.spawn.z * k, r: z.spawn.r * k },
    pond: { ...z.pond, x: z.pond.x * k, z: z.pond.z * k, r: z.pond.r * k },
    paddy: { ...z.paddy, x: z.paddy.x * k, z: z.paddy.z * k, w: z.paddy.w * k, d: z.paddy.d * k },
    hill: { ...z.hill, x: z.hill.x * k, z: z.hill.z * k, r: z.hill.r * k },
  };
}

export const WATER_LEVEL = 0;

/** What a generator needs to know about one island kind. */
export interface ShapeSpec {
  kind: 'normal' | 'main';
  /** Linear scale of the island shape relative to the normal island. Areas grow with scale squared. */
  scale: number;
  /** Side of the terrain square (m) and cells per side. */
  size: number;
  segments: number;
  zones: Zones;
  /** Orchard centre and radius, for fruit trees and the torches around them. */
  orchard: { x: number; z: number; r: number };
  /**
   * Reference coast radius (m) for the ambience and the sand bands: 62 m for a normal island, scaled with
   * the shape for the main island.
   */
  coastR: number;
}

export const NORMAL_SPEC: ShapeSpec = {
  kind: 'normal',
  scale: 1,
  size: 170,
  segments: 170,
  zones: ZONES,
  orchard: { x: -14, z: 12, r: 6 },
  coastR: 62,
};

const SAND = new THREE.Color('#ecd9a0');
const WET_SAND = new THREE.Color('#c9b27a');
const GRASS = new THREE.Color('#7ccb52');
const GRASS_DARK = new THREE.Color('#58ab45');
const PADDY = new THREE.Color('#8f9b4c');
const MUD = new THREE.Color('#7d6a45');

/** Height of the sea floor away from any island (m). */
export const DEEP = -3.5;
/** Land counts as coast once it drops below this height (m). */
export const COAST_H = 0.5;

/**
 * Terrain for one island kind: a square heightfield with a coastline, a grassy hill, a flat spawn,
 * a rice terrace and a pond basin. The shape is the same for every kind; `spec.scale` stretches the
 * coastline and the zones. Coordinates are local: the island centre is (0, 0).
 */
export class Terrain implements Ground {
  readonly size: number;
  readonly segments: number;
  readonly mesh: THREE.Mesh;
  readonly zones: Zones;
  /** Reference coast radius (m), from the spec. See ShapeSpec.coastR. */
  readonly coastR: number;
  private heights: Float32Array;
  private noise = createNoise2D(mulberry32(7));

  constructor(readonly spec: ShapeSpec) {
    this.size = spec.size;
    this.segments = spec.segments;
    this.zones = spec.zones;
    const n = this.segments + 1;
    const cell = this.size / this.segments;
    const half = this.size / 2;

    this.heights = new Float32Array(n * n);
    const positions = new Float32Array(n * n * 3);
    const colors = new Float32Array(n * n * 3);
    const c = new THREE.Color();

    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const idx = j * n + i;
        const x = -half + i * cell;
        const z = -half + j * cell;
        const h = this.computeHeight(x, z);
        this.heights[idx] = h;
        positions.set([x, h, z], idx * 3);
        this.colorAt(x, z, h, c);
        colors.set([c.r, c.g, c.b], idx * 3);
      }
    }

    // Two triangles per cell, split along the (i, j+1)–(i+1, j) diagonal.
    const indices = new Uint32Array(this.segments * this.segments * 6);
    let k = 0;
    for (let j = 0; j < this.segments; j++) {
      for (let i = 0; i < this.segments; i++) {
        const a = j * n + i;
        const b = (j + 1) * n + i;
        const cc = (j + 1) * n + i + 1;
        const d = j * n + i + 1;
        indices[k++] = a; indices[k++] = b; indices[k++] = d;
        indices[k++] = b; indices[k++] = cc; indices[k++] = d;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.95,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = `terrain-${spec.kind}`;
    this.mesh.receiveShadow = true;

    this.coastR = spec.coastR;
  }

  private fbm(x: number, z: number) {
    let amp = 1;
    let freq = 1 / 40;
    let sum = 0;
    for (let o = 0; o < 4; o++) {
      sum += this.noise(x * freq, z * freq) * amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum;
  }

  /** Analytic height used to build the grid. */
  private computeHeight(x: number, z: number) {
    const { zones: { hill, spawn, paddy, pond }, spec } = this;
    const K = spec.scale;
    // Island mask with a wobbly coastline. The mask radius grows with the scale; the wobble does not.
    const coast = this.noise(x / 30 + 100, z / 30) * 0.12;
    const d = Math.hypot(x, z) / (66 * K) + coast;
    const island = smoothstep(1.0, 0.7, d);

    let h = lerp(DEEP, 1.4, island) + this.fbm(x, z) * 0.9 * island;

    // A grassy hill.
    const hd = Math.hypot(x - hill.x, z - hill.z) / hill.r;
    h += Math.exp(-hd * hd * 2) * hill.h * island;

    // Flat spawn area.
    const sd = Math.hypot(x - spawn.x, z - spawn.z);
    h = lerp(h, spawn.h, smoothstep(spawn.r, spawn.r * 0.4, sd));

    // Flat paddy terrace (rounded rectangle).
    const px = Math.max(0, Math.abs(x - paddy.x) - paddy.w / 2);
    const pz = Math.max(0, Math.abs(z - paddy.z) - paddy.d / 2);
    h = lerp(h, paddy.h, smoothstep(5, 0, Math.hypot(px, pz)));

    // Pond basin, dips below the water plane so the shared water fills it.
    const pd = Math.hypot(x - pond.x, z - pond.z) + this.noise(x / 6, z / 6) * 1.2;
    h = lerp(h, pond.depth, smoothstep(pond.r, pond.r * 0.35, pd));

    return h;
  }

  private colorAt(x: number, z: number, h: number, out: THREE.Color) {
    const { paddy, pond } = this.zones;
    const inPaddyRect =
      Math.abs(x - paddy.x) < paddy.w / 2 && Math.abs(z - paddy.z) < paddy.d / 2;
    const nearPond = Math.hypot(x - pond.x, z - pond.z) < pond.r + 1.5;
    // Sand only along the coastline, not in inland dips.
    const coastal = Math.hypot(x, z) > 44 * this.spec.scale && !nearPond;

    if (h < WATER_LEVEL - 0.1) {
      out.copy(nearPond ? MUD : WET_SAND);
    } else if (h < 0.5 && coastal) {
      out.copy(SAND);
    } else if (inPaddyRect) {
      out.copy(PADDY);
    } else {
      const v = this.noise(x / 12 + 50, z / 12) * 0.5 + 0.5;
      out.copy(GRASS).lerp(GRASS_DARK, v);
      if (h < 0.8 && coastal) out.lerp(SAND, smoothstep(0.8, 0.5, h));
    }
    // Tiny per-vertex jitter makes flat shading read as "low-poly".
    const j = (this.noise(x * 0.9, z * 0.9) * 0.5 + 0.5) * 0.06 - 0.03;
    out.offsetHSL(0, 0, j);
  }

  /** Height of the rendered surface at (x, z), matching the mesh triangles. Outside the square: deep water. */
  heightAt(x: number, z: number): number {
    const half = this.size / 2;
    const cell = this.size / this.segments;
    const gx = (x + half) / cell;
    const gz = (z + half) / cell;
    const i = Math.floor(gx);
    const j = Math.floor(gz);
    if (i < 0 || j < 0 || i >= this.segments || j >= this.segments) return DEEP;
    const fx = gx - i;
    const fz = gz - j;
    const n = this.segments + 1;
    const ha = this.heights[j * n + i];
    const hb = this.heights[(j + 1) * n + i];
    const hc = this.heights[(j + 1) * n + i + 1];
    const hd = this.heights[j * n + i + 1];
    if (fx + fz <= 1) return ha + (hd - ha) * fx + (hb - ha) * fz;
    return hc + (hb - hc) * (1 - fx) + (hd - hc) * (1 - fz);
  }
}

