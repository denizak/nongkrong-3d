/** Grid of islands: COLS x ROWS cells, SPACING metres apart. Row grows toward the south (+z). */
export const COLS = 5;
export const ROWS = 10;
export const SPACING = 180;
export const START_CELL: Readonly<Cell> = { col: 2, row: 4 };

export interface Cell {
  col: number;
  row: number;
}

export type Side = 'E' | 'W' | 'N' | 'S';

/** Island number, 1..50, row by row. */
export function islandId(cell: Cell): number {
  return cell.row * COLS + cell.col + 1;
}

/** Where the player crossed into a neighbour, and the offset to apply to their local position. */
export interface ShiftInfo {
  cell: Cell;
  dx: number;
  dz: number;
}

const VISITED_KEY = 'nongkrong.visited';

/**
 * The grid and the current island. Gameplay always works in the current island's local
 * coordinates; this class only knows which cell is live and who its neighbours are.
 */
export class Archipelago {
  cell: Cell = { ...START_CELL };
  readonly visited = new Set<number>();
  /** Full island change (state, physics, visuals). Set by main. */
  switchTo: (cell: Cell, x: number, z: number) => void = () => {};
  private listeners = new Set<(cell: Cell) => void>();

  constructor() {
    for (const id of loadVisited()) this.visited.add(id);
  }

  get id(): number {
    return islandId(this.cell);
  }

  get total(): number {
    return COLS * ROWS;
  }

  inGrid(col: number, row: number): boolean {
    return col >= 0 && col < COLS && row >= 0 && row < ROWS;
  }

  /** The neighbouring cell on one side, or null when the grid ends there. */
  neighbor(side: Side, cell: Cell = this.cell): Cell | null {
    const col = cell.col + (side === 'E' ? 1 : side === 'W' ? -1 : 0);
    const row = cell.row + (side === 'S' ? 1 : side === 'N' ? -1 : 0);
    return this.inGrid(col, row) ? { col, row } : null;
  }

  hasNeighbor(side: Side, cell: Cell = this.cell): boolean {
    return this.neighbor(side, cell) !== null;
  }

  /** Subscribes to cell changes. Returns an unsubscribe function. */
  onChange(fn: (cell: Cell) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Makes `cell` the live island, marks it visited and tells the listeners. Does not move anything physical. */
  setCell(cell: Cell) {
    this.cell = { col: cell.col, row: cell.row };
    this.visited.add(this.id);
    saveVisited(this.visited);
    for (const fn of this.listeners) fn(this.cell);
  }

  /** Checks the local position against the island edges. Returns a shift when the player has crossed into an existing neighbour. */
  shiftFor(x: number, z: number): ShiftInfo | null {
    const h = SPACING / 2;
    const { col, row } = this.cell;
    if (x > h && this.hasNeighbor('E')) return { cell: { col: col + 1, row }, dx: -SPACING, dz: 0 };
    if (x < -h && this.hasNeighbor('W')) return { cell: { col: col - 1, row }, dx: SPACING, dz: 0 };
    if (z > h && this.hasNeighbor('S')) return { cell: { col, row: row + 1 }, dx: 0, dz: -SPACING };
    if (z < -h && this.hasNeighbor('N')) return { cell: { col, row: row - 1 }, dx: 0, dz: SPACING };
    return null;
  }

  /** Dev helper: moves the player to that island's spawn with a full state save and load. */
  teleport(col: number, row: number) {
    if (!this.inGrid(col, row)) throw new Error(`No island at col ${col}, row ${row}`);
    this.switchTo({ col, row }, 0, 0);
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

  /** Replaces the map from saved JSON. Anything malformed is skipped. */
  load(raw: unknown) {
    this.clear();
    if (!raw || typeof raw !== 'object') return;
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const id = Number(key);
      const v = value as Partial<IslandState> | null;
      if (Number.isInteger(id) && v && Array.isArray(v.trees) && v.paddy && Array.isArray(v.paddy.s)) {
        this.map.set(id, v as IslandState);
      }
    }
  }
}

function loadVisited(): number[] {
  try {
    const raw = JSON.parse(localStorage.getItem(VISITED_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((n) => Number.isInteger(n)) : [];
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
