import { ISLANDS, MAIN_ID, NORMAL_COUNT, centreOf, islandAt, legacyOwnerOfCell, type IslandDef } from './Islands';

/** Where the player crossed into a neighbour, and the offset to apply to their local position. */
export interface ShiftInfo {
  id: number;
  dx: number;
  dz: number;
}

/** Visited islands, by the registry's ids. Version 2; version 1 stored ids of the old grid (see Islands.ts). */
const VISITED_KEY = 'nongkrong.visited2';
const LEGACY_VISITED_KEY = 'nongkrong.visited';
/** The oldest grid was 5 columns wide; its ids were row * 5 + col + 1. */
const LEGACY_COLS = 5;

/**
 * The archipelago and the live island. Gameplay always works in the live island's local coordinates
 * (origin at its centre). This class knows which island is live, which islands were visited, and when
 * the player has crossed into a neighbour.
 */
export class Archipelago {
  /** The live island's id. */
  id: number = MAIN_ID;
  readonly visited = new Set<number>();
  /** Full island change (state, physics, visuals). Set by main. */
  switchTo: (id: number, x: number, z: number) => void = () => {};
  private listeners = new Set<(id: number) => void>();

  constructor() {
    for (const id of loadVisited()) this.visited.add(id);
  }

  /** The live island's definition. */
  get def(): IslandDef {
    return ISLANDS[this.id];
  }

  /** Normal islands on the grid (the main island is not counted). */
  get total(): number {
    return NORMAL_COUNT;
  }

  /** Subscribes to island changes. Returns an unsubscribe function. */
  onChange(fn: (id: number) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Makes `id` the live island, marks it visited and tells the listeners. Does not move anything physical. */
  setCurrent(id: number) {
    this.id = id;
    this.visited.add(id);
    saveVisited(this.visited);
    for (const fn of this.listeners) fn(id);
  }

  /**
   * Checks the live island's local position against its region. When the player is standing on another
   * island, returns that island and the offset that keeps the same world position in the new local frame.
   * Empty water and the edge of the grid return null.
   */
  shiftFor(x: number, z: number): ShiftInfo | null {
    const here = centreOf(this.id);
    const there = islandAt(x + here.x, z + here.z);
    if (!there || there.id === this.id) return null;
    const next = centreOf(there.id);
    return { id: there.id, dx: here.x - next.x, dz: here.z - next.z };
  }

  /** Dev helper: moves the player to that island's spawn with a full state save and load. */
  teleportTo(id: number) {
    if (!ISLANDS[id]) throw new Error(`No island with id ${id}`);
    this.switchTo(id, 0, 0);
  }

}

/** Per-island progress that survives leaving the island. Plain data so it can be saved as JSON. */
export interface TreeState {
  /** 1 for a mango still hanging, 0 for one picked. */
  h: number[];
  /** Seconds into the regrow timer. */
  r: number;
}

export interface PaddyState {
  /** Stalk state per instance (young, ripe, stubble). */
  s: number[];
  /** Per-stalk timer in seconds. */
  t: number[];
  /** Per-stalk stubble height factor. */
  f: number[];
}

export interface IslandState {
  trees: TreeState[];
  paddy: PaddyState;
}

/** Saved state of every island the player has changed, keyed by island id. Missing ids mean a fresh island. */
export class IslandStates {
  private map = new Map<number, IslandState>();

  get(id: number): IslandState | undefined {
    return this.map.get(id);
  }

  set(id: number, state: IslandState) {
    this.map.set(id, state);
  }

  clear() {
    this.map.clear();
  }

  toJSON(): Record<string, IslandState> {
    const out: Record<string, IslandState> = {};
    for (const [id, state] of this.map) out[id] = state;
    return out;
  }

  /**
   * Replaces the map from saved JSON. Anything malformed is skipped. With `legacy`, the keys are ids of the
   * old grid: each one maps to its cell, and only cells that are normal islands on the new grid are kept.
   */
  load(raw: unknown, legacy = false) {
    this.clear();
    if (!raw || typeof raw !== 'object') return;
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const old = Number(key);
      const v = value as Partial<IslandState> | null;
      if (!Number.isInteger(old) || !v || !Array.isArray(v.trees) || !v.paddy || !Array.isArray(v.paddy.s)) continue;
      const id = legacy ? legacyId(old) : old;
      if (id === null || !ISLANDS[id]) continue;
      this.map.set(id, v as IslandState);
    }
  }
}

/** The new id for an id of the old grid, or null when that cell is not a normal island now. */
function legacyId(oldId: number): number | null {
  const col = (oldId - 1) % LEGACY_COLS;
  const row = Math.floor((oldId - 1) / LEGACY_COLS);
  const id = legacyOwnerOfCell(col, row);
  return id !== null && id !== MAIN_ID ? id : null;
}

function loadVisited(): number[] {
  try {
    const raw = localStorage.getItem(VISITED_KEY);
    if (raw !== null) {
      const list = JSON.parse(raw);
      return Array.isArray(list) ? list.filter((n) => Number.isInteger(n) && ISLANDS[n]) : [];
    }
    // First run on version 2: carry over the normal islands visited on the old grid.
    const legacy = JSON.parse(localStorage.getItem(LEGACY_VISITED_KEY) ?? '[]');
    if (!Array.isArray(legacy)) return [];
    return legacy.map((n) => (Number.isInteger(n) ? legacyId(n) : null)).filter((n): n is number => n !== null);
  } catch {
    return [];
  }
}

function saveVisited(set: Set<number>) {
  try {
    localStorage.setItem(VISITED_KEY, JSON.stringify([...set]));
  } catch {
    // Storage blocked: the count just won't persist.
  }
}
