/**
 * The island registry: where every island's centre is, which island a world point is on, and how far the
 * map and the proxies reach. The layout is a seeded scatter, so every player sees the same archipelago.
 * All positions here are world coordinates. Gameplay code works in the live island's local frame,
 * where the origin is that island's centre.
 */
import { mulberry32 } from './Terrain';

export const MAIN_ID = 0;
export const NORMAL_COUNT = 49;
export const ISLAND_COUNT = NORMAL_COUNT + 1;

/** Seed of the layout. Changing it moves every island, so saved island positions only mean something with the same seed. */
export const LAYOUT_SEED = 20261108;
/** Closest two normal islands may be, and the closest a normal island may be to the main island (m). */
const MIN_GAP = 185;
const MIN_FROM_MAIN = 330;
/** Every island has another island (the main one included) this close or closer, so bridges stay short. */
const MAX_NEIGHBOUR = 260;
/** The region the normal islands are drawn in: an ellipse with these semi-axes (m), its edge wobbling by this share. */
const REGION_RX = 1100;
const REGION_RZ = 850;
const REGION_WOBBLE = 0.12;

/** A point counts as on an island while it is this close to the centre: the main island's reach and the normal one's (m). */
export const MAIN_REACH = 250;
export const NORMAL_REACH = 140;
/** The main island wins a contested point this many metres earlier (its radius is about 120 m, a normal one's about 70 m). */
const MAIN_BIAS = 120;

/** Islands whose centre is within this many metres of the live island are drawn as proxies. */
export const PROXY_RANGE = 320;

/** Half the width of the map image of each kind, in metres (the terrain squares are 380 m and 170 m). */
export const NORMAL_HALF = 90;
export const MAIN_HALF = 180;

export type IslandKind = 'main' | 'normal';

export interface Vec2 {
  x: number;
  z: number;
}

export interface IslandDef {
  readonly id: number;
  readonly kind: IslandKind;
  readonly centerWorld: Vec2;
  /** Half the width of the island's map image, in metres. */
  readonly half: number;
  /** Proper name of the island (a real small Indonesian island). Not translated. */
  readonly name: string;
}

/** Names of the normal islands, in id order: the nearest island to the main one is id 1. */
const NORMAL_NAMES: readonly string[] = [
  'Pramuka', 'Tidung', 'Pari', 'Untung Jawa', 'Bidadari', 'Onrust', 'Kelor', 'Pulau Sepa', 'Pulau Macan', 'Karimunjawa',
  'Gili Trawangan', 'Gili Meno', 'Gili Air', 'Gili Nanggu', 'Gili Kedis', 'Gili Labak', 'Nusa Lembongan', 'Nusa Ceningan',
  'Menjangan', 'Derawan', 'Maratua', 'Kakaban', 'Sangalaki', 'Rubiah', 'Pulau Weh', 'Bunaken', 'Siladen', 'Lihaga',
  'Togean', 'Hoga', 'Tomia', 'Kaledupa', 'Banda Neira', 'Pulau Run', 'Pulau Ai', 'Pulau Hatta', 'Padar', 'Kanawa',
  'Seraya', 'Rinca', 'Arborek', 'Kri', 'Mansuar', 'Wayag', 'Lengkuas', 'Kepayang', 'Pahawang', 'Penyengat', 'Sempu',
];
const MAIN_NAME = 'Pulau Nongkrong';

const dist = (a: Vec2, b: Vec2) => Math.hypot(b.x - a.x, b.z - a.z);

/**
 * Bridson's Poisson-disc fill of the region around the main island. Each new point is at least MIN_GAP from every
 * other point and at least MIN_FROM_MAIN from the origin. Returns a near-maximal set, usually more than needed.
 */
function fillRegion(rand: () => number): Vec2[] {
  const p2 = rand() * Math.PI * 2;
  const p3 = rand() * Math.PI * 2;
  const p5 = rand() * Math.PI * 2;
  // Boundary radius as a multiple of the ellipse: three wobbles of different frequencies.
  const edge = (theta: number) => 1 + REGION_WOBBLE * (0.6 * Math.sin(2 * theta + p2) + 0.3 * Math.sin(3 * theta + p3) + 0.1 * Math.sin(5 * theta + p5));
  const inRegion = (p: Vec2) => {
    const u = p.x / REGION_RX;
    const v = p.z / REGION_RZ;
    return Math.hypot(u, v) <= edge(Math.atan2(v, u));
  };
  const origin: Vec2 = { x: 0, z: 0 };
  const pts: Vec2[] = [];
  const ok = (p: Vec2) => inRegion(p) && dist(p, origin) >= MIN_FROM_MAIN && pts.every((q) => dist(p, q) >= MIN_GAP);

  for (let tries = 0; tries < 5000 && pts.length === 0; tries++) {
    const p = { x: (rand() * 2 - 1) * REGION_RX, z: (rand() * 2 - 1) * REGION_RZ };
    if (ok(p)) pts.push(p);
  }
  const active = [...pts];
  while (active.length > 0) {
    const i = Math.floor(rand() * active.length);
    const from = active[i];
    let placed = false;
    for (let k = 0; k < 30 && !placed; k++) {
      const a = rand() * Math.PI * 2;
      const r = MIN_GAP * (1 + rand());
      const p = { x: from.x + Math.cos(a) * r, z: from.z + Math.sin(a) * r };
      if (ok(p)) {
        pts.push(p);
        active.push(p);
        placed = true;
      }
    }
    if (!placed) active.splice(i, 1);
  }
  return pts;
}

/**
 * The normal islands' centres: a seeded fill, cut to the NORMAL_COUNT nearest the main island. A fill that breaks
 * the neighbour limit is retried with the next sub-seed, so the result is the same on every machine.
 */
function layoutCentres(): Vec2[] {
  const origin: Vec2 = { x: 0, z: 0 };
  for (let attempt = 0; attempt < 500; attempt++) {
    const pts = fillRegion(mulberry32(LAYOUT_SEED + attempt * 7919))
      .sort((a, b) => dist(a, origin) - dist(b, origin))
      .slice(0, NORMAL_COUNT);
    if (pts.length < NORMAL_COUNT) continue;
    const all = [origin, ...pts];
    const isolated = pts.some((p) => all.every((q) => q === p || dist(p, q) > MAX_NEIGHBOUR));
    if (!isolated) return pts;
  }
  throw new Error('Could not lay out the archipelago');
}

const NORMAL_CENTRES = layoutCentres();

const mainDef: IslandDef = { id: MAIN_ID, kind: 'main', centerWorld: { x: 0, z: 0 }, half: MAIN_HALF, name: MAIN_NAME };

/** Every island, index = id. The main island is id 0; normals are numbered 1..49 by distance from the main island. */
export const ISLANDS: readonly IslandDef[] = [
  mainDef,
  ...NORMAL_CENTRES.map((centre, i) => ({
    id: i + 1,
    kind: 'normal' as const,
    centerWorld: centre,
    half: NORMAL_HALF,
    name: NORMAL_NAMES[i],
  })),
];
if (ISLANDS.length !== ISLAND_COUNT) throw new Error(`Expected ${ISLAND_COUNT} islands, built ${ISLANDS.length}`);

/** The main island's centre (the origin). Kept under this name for the pier. */
export const MAIN_CENTRE: Readonly<Vec2> = ISLANDS[MAIN_ID].centerWorld;

/** Shown name: names already starting with Pulau, Gili or Nusa are used as they are, others get "Pulau ". */
export function displayName(id: number): string {
  const name = ISLANDS[id].name;
  return /^(Pulau|Gili|Nusa)\b/.test(name) ? name : `Pulau ${name}`;
}

export function islandById(id: number): IslandDef | null {
  return ISLANDS[id] ?? null;
}

export function centreOf(id: number): Vec2 {
  return ISLANDS[id].centerWorld;
}

/** Distance from island `id` to the nearest other island's centre (m). */
export function nearestDistance(id: number): number {
  const c = centreOf(id);
  let best = Infinity;
  for (const def of ISLANDS) if (def.id !== id) best = Math.min(best, dist(c, def.centerWorld));
  return best;
}

/** The box that holds every island's map image, with a margin for the labels. Metres, world coordinates. */
export const MAP_BOUNDS = (() => {
  const pad = 150;
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const def of ISLANDS) {
    x0 = Math.min(x0, def.centerWorld.x - def.half);
    z0 = Math.min(z0, def.centerWorld.z - def.half);
    x1 = Math.max(x1, def.centerWorld.x + def.half);
    z1 = Math.max(z1, def.centerWorld.z + def.half);
  }
  return { x0: x0 - pad, z0: z0 - pad, x1: x1 + pad, z1: z1 + pad };
})();

/** Spatial buckets of island centres, so a lookup only checks the islands nearby. */
const BUCKET = Math.max(MAIN_REACH, NORMAL_REACH) + 10;
const bucketKey = (bx: number, bz: number) => bx * 100003 + bz;
const buckets = new Map<number, number[]>();
for (const def of ISLANDS) {
  const key = bucketKey(Math.floor(def.centerWorld.x / BUCKET), Math.floor(def.centerWorld.z / BUCKET));
  const list = buckets.get(key);
  if (list) list.push(def.id);
  else buckets.set(key, [def.id]);
}

/**
 * The island a world point is on: the nearest centre (a Voronoi cell), with the main island's distance reduced
 * by MAIN_BIAS, and only within each island's reach. Null for open sea.
 */
export function islandAt(x: number, z: number): IslandDef | null {
  const bx = Math.floor(x / BUCKET);
  const bz = Math.floor(z / BUCKET);
  let best: IslandDef | null = null;
  let bestScore = Infinity;
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      const ids = buckets.get(bucketKey(bx + i, bz + j));
      if (!ids) continue;
      for (const id of ids) {
        const def = ISLANDS[id];
        const d = Math.hypot(x - def.centerWorld.x, z - def.centerWorld.z);
        const main = def.kind === 'main';
        if (d > (main ? MAIN_REACH : NORMAL_REACH)) continue;
        const score = main ? d - MAIN_BIAS : d;
        if (score < bestScore) {
          bestScore = score;
          best = def;
        }
      }
    }
  }
  return best;
}

/** True when island `other` is close enough to the live island `from` to be drawn as a proxy. */
export function inProxyWindow(from: number, other: number): boolean {
  const a = centreOf(from);
  const b = centreOf(other);
  return Math.hypot(b.x - a.x, b.z - a.z) <= PROXY_RANGE;
}

/**
 * The layout before the scatter, kept only so old saves (grid cells, and the grid's island ids) still load.
 * The old grid was 6 columns by 9 rows, with the main island on a 2 x 2 block at cols 2-3, rows 3-4 and the
 * bottom-right corner empty. Its normal islands were numbered row by row. The ids did not change, so only
 * saved cells need this table.
 */
const OLD_COLS = 6;
const OLD_ROWS = 9;
const OLD_MAIN = { col: 2, row: 3, span: 2 };
const OLD_EMPTY = { col: 5, row: 8 };
const oldOwner = new Map<number, number>();
{
  let id = 1;
  for (let row = 0; row < OLD_ROWS; row++) {
    for (let col = 0; col < OLD_COLS; col++) {
      const inMain = col >= OLD_MAIN.col && col < OLD_MAIN.col + OLD_MAIN.span && row >= OLD_MAIN.row && row < OLD_MAIN.row + OLD_MAIN.span;
      const empty = col === OLD_EMPTY.col && row === OLD_EMPTY.row;
      if (inMain) oldOwner.set(col * 100 + row, MAIN_ID);
      else if (!empty) oldOwner.set(col * 100 + row, id++);
    }
  }
}

/** The old grid's owner of a cell: an island id (the main island's block counts as main), or null for empty or outside cells. */
export function legacyOwnerOfCell(col: number, row: number): number | null {
  return oldOwner.get(col * 100 + row) ?? null;
}

/**
 * Migration helper for saves made on the old grid: the island at that cell if it is a normal island,
 * otherwise the main island.
 */
export function islandIdForLegacyCell(col: number, row: number): number {
  const id = legacyOwnerOfCell(col, row);
  return id !== null && id !== MAIN_ID ? id : MAIN_ID;
}
