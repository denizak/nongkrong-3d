import * as THREE from 'three/webgpu';
import { COLORS, COAST_H, DEEP, Terrain, WATER_LEVEL, lerp, smoothstep, type Hill, type Orchard, type Pond, type ShapeSpec, type Zones } from './Terrain';

/**
 * The main (start) island, with its own designed layout in local coordinates (origin = island centre, -z = north).
 *
 *   - a natural coast about 118 m from the centre, with a wide sandy beach along the south side (z > 60)
 *   - a flat village plaza at the centre; the spawn sits on its south edge, facing north
 *   - one big terraced paddy in the west, its dike gap facing the plaza
 *   - three ponds and three orchard clusters, and two grassy hills in the north
 *   - a wooden pier from the south beach (built by Bridges, see Beach.ts)
 */

/** Density reference: the main island has about 4.8 times the normal island's area, so counts scale by this squared. */
export const MAIN_SCALE = 2.2;
/** Mean shore radius (m) and how much it wobbles. */
const COAST_R = 118;
const COAST_WOBBLE = 0.1;
/** Sand covers the south side from this z on. */
export const BEACH_Z = 60;

export const PLAZA = { x: 0, z: 0, r: 22, h: 1.6 };
/** Plaza dirt, a sandy brown. */
const PLAZA_DIRT = new THREE.Color('#cdb08a');

export const PADDY = { x: -70, z: -10, w: 60, d: 34, h: 1.1 };
export const PONDS: Pond[] = [
  { x: 55, z: -35, r: 10, depth: -1.4 },
  { x: 40, z: 45, r: 10, depth: -1.4 },
  { x: -30, z: -75, r: 10, depth: -1.4 },
];
export const ORCHARDS: Orchard[] = [
  { x: -20, z: 35, r: 9, trees: 7 },
  { x: 75, z: 5, r: 9, trees: 8 },
  { x: 10, z: -60, r: 8, trees: 6 },
];
const HILLS: Hill[] = [
  { x: 78, z: -60, r: 24, h: 4.5 },
  { x: -72, z: -62, r: 24, h: 4 },
];
/** Huts ring the plaza at this radius, with the doors facing the centre. */
export const HUT_RING_R = 30;
/** Keep-out circle around the plaza, for props: the plaza, the hut ring and the paths between them. */
const PLAZA_KEEP_R = 36;

/** Where a player arriving on the main island appears: the plaza's south edge, facing north. */
const START = { x: 0, z: 18, heading: Math.PI };

const ZONES: Zones = {
  spawn: { x: PLAZA.x, z: PLAZA.z, r: PLAZA.r, h: PLAZA.h },
  ponds: PONDS,
  paddy: PADDY,
  hills: HILLS,
};

/** Unit vector from (x, z) toward the plaza centre. */
function towardPlaza(x: number, z: number) {
  const d = Math.hypot(x, z) || 1;
  return { x: -x / d, z: -z / d };
}

/** Torch spots: 4 around the plaza, one on the plaza side of each pond and orchard, 2 at the paddy gap and 1 by the scarecrow. */
function torchSpots(): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const deg of [30, 150, 210, 330]) {
    const a = (deg * Math.PI) / 180;
    out.push([PLAZA.x + Math.cos(a) * 24, PLAZA.z + Math.sin(a) * 24]);
  }
  for (const p of PONDS) {
    const t = towardPlaza(p.x, p.z);
    out.push([p.x + t.x * (p.r + 2), p.z + t.z * (p.r + 2)]);
  }
  for (const o of ORCHARDS) {
    const t = towardPlaza(o.x, o.z);
    out.push([o.x + t.x * (o.r + 1), o.z + t.z * (o.r + 1)]);
  }
  const eastX = PADDY.x + PADDY.w / 2 + 0.7;
  out.push([eastX, PADDY.z - 1.6], [eastX, PADDY.z + 1.6]);
  out.push([PADDY.x + 4 * MAIN_SCALE + 1.5, PADDY.z + 2 * MAIN_SCALE - 1.5]);
  return out;
}

const MAIN_SPEC: ShapeSpec = {
  kind: 'main',
  scale: MAIN_SCALE,
  size: 380,
  segments: 190,
  zones: ZONES,
  orchards: ORCHARDS,
  coastR: COAST_R,
  start: START,
  riceSpacing: 1.2,
  decoyScarecrows: [[PADDY.x - 20, PADDY.z - 8], [PADDY.x + 18, PADDY.z + 9]],
  torchSpots: torchSpots(),
};

/** Terrain for the main island. Its local origin is the island centre. */
export class MainTerrain extends Terrain {
  /** Local z of the shore straight south of the centre: the pier's landing. */
  readonly pierShoreZ: number;

  constructor() {
    super(MAIN_SPEC);
    this.spec.keepOut = (x, z) => this.keptOut(x, z);
    this.pierShoreZ = this.shoreZ(0);
  }

  /** First point going south from (x, BEACH_Z) where the ground drops below the coast height. */
  shoreZ(x: number): number {
    for (let z = BEACH_Z; z < 190; z += 0.5) {
      if (this.heightAt(x, z) < COAST_H) return z;
    }
    return 190;
  }

  /** Props and vegetation stay out of the plaza, the paths to it, and the pier. */
  private keptOut(x: number, z: number): boolean {
    if (Math.hypot(x - PLAZA.x, z - PLAZA.z) < PLAZA_KEEP_R) return true;
    const s = this.pierShoreZ;
    return Math.abs(x) < 6 && z > s - 12 && z < s + 36;
  }

  /** Radius (m) of the coast in the direction of (x, z): the wobbly shore. */
  private coastRadius(x: number, z: number): number {
    return COAST_R * (1 + COAST_WOBBLE * this.noise(x / 70 + 300, z / 70 - 150));
  }

  protected computeHeight(x: number, z: number): number {
    const d = Math.hypot(x, z) / this.coastRadius(x, z);
    const island = smoothstep(1.0, 0.78, d);
    let h = lerp(DEEP, 1.4, island) + this.fbm(x, z) * 0.9 * island;

    for (const hill of HILLS) {
      const hd = Math.hypot(x - hill.x, z - hill.z) / hill.r;
      h += Math.exp(-hd * hd * 2) * hill.h * island;
    }

    // South beach: a sandy shelf that runs from z = 60 to the water.
    const beach = smoothstep(BEACH_Z - 10, BEACH_Z + 25, z) * smoothstep(1.06, 0.95, d);
    h = lerp(h, 0.7 + 0.12 * this.noise(x / 20 + 7, z / 20 - 3), beach);

    // Village plaza: flat, with a soft edge.
    h = lerp(h, PLAZA.h, smoothstep(PLAZA.r + 3, PLAZA.r - 6, Math.hypot(x - PLAZA.x, z - PLAZA.z)));

    // Terraced paddy: three bands of ground running east to west, with ramps between them.
    const px = Math.max(0, Math.abs(x - PADDY.x) - PADDY.w / 2);
    const pz = Math.max(0, Math.abs(z - PADDY.z) - PADDY.d / 2);
    h = lerp(h, this.terraceHeight(z), smoothstep(5, 0, Math.hypot(px, pz)));

    for (const pond of PONDS) {
      const pd = Math.hypot(x - pond.x, z - pond.z) + this.noise(x / 6, z / 6) * 1.2;
      h = lerp(h, pond.depth, smoothstep(pond.r, pond.r * 0.35, pd));
    }
    return h;
  }

  /** Paddy ground height at depth z: three terraces, the middle one flooded with the lower one. */
  private terraceHeight(z: number): number {
    const band = PADDY.d / 3;
    const t = Math.min(2.999, Math.max(0, (z - (PADDY.z - PADDY.d / 2)) / band));
    const k = Math.floor(t);
    const f = t - k;
    const levels = [PADDY.h - 0.35, PADDY.h, PADDY.h + 0.35];
    return k < 2 ? lerp(levels[k], levels[k + 1], smoothstep(0.8, 1, f)) : levels[k];
  }

  protected colorAt(x: number, z: number, h: number, out: THREE.Color) {
    const inPaddy = Math.abs(x - PADDY.x) < PADDY.w / 2 && Math.abs(z - PADDY.z) < PADDY.d / 2;
    const nearPond = PONDS.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + 1.5);
    const plaza = Math.hypot(x - PLAZA.x, z - PLAZA.z) < PLAZA.r + 1.5;
    const sandy = !nearPond && !inPaddy && (z > BEACH_Z || Math.hypot(x, z) > 0.82 * COAST_R);

    if (h < WATER_LEVEL - 0.1) {
      out.copy(nearPond ? COLORS.MUD : COLORS.WET_SAND);
    } else if (plaza) {
      out.copy(PLAZA_DIRT);
    } else if (sandy && h < 0.95) {
      out.copy(COLORS.SAND);
    } else if (inPaddy) {
      out.copy(COLORS.PADDY);
    } else {
      const v = this.noise(x / 12 + 50, z / 12) * 0.5 + 0.5;
      out.copy(COLORS.GRASS).lerp(COLORS.GRASS_DARK, v);
    }
    const j = (this.noise(x * 0.9, z * 0.9) * 0.5 + 0.5) * 0.06 - 0.03;
    out.offsetHSL(0, 0, j);
  }
}

