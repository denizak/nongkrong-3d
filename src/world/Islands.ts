/**
 * The island registry: the grid, every island's centre and region, which island a world point is on,
 * and which islands touch. Normal islands sit one per cell; the main island is a 2x2 block of cells.
 * All positions here are world coordinates. Gameplay code works in the live island's local frame,
 * where the origin is that island's centre.
 */

/** Grid size in cells (columns east, rows south). */
export const COLS = 6;
export const ROWS = 9;
/** Metres between cell centres. */
export const SPACING = 180;

export const MAIN_ID = 0;
/** The main island's block: cols 2 to 3, rows 3 to 4. */
const MAIN_COL = 2;
const MAIN_ROW = 3;
const MAIN_SPAN = 2;
/** The bottom-right corner cell is empty water. */
const EMPTY_CELL: Readonly<Cell> = { col: 5, row: 8 };

/** Half-extent of a normal island's region (its 180 m cell) and of the main island's (360 m block). */
export const NORMAL_HALF = SPACING / 2;
export const MAIN_HALF = (MAIN_SPAN * SPACING) / 2;
/** Centre of the main block: halfway across its two cells on each axis (2.5 S, 3.5 S). */
export const MAIN_CENTRE: Readonly<Vec2> = { x: (MAIN_COL + (MAIN_SPAN - 1) / 2) * SPACING, z: (MAIN_ROW + (MAIN_SPAN - 1) / 2) * SPACING };

/** Islands whose centre is within this many metres of the live island are drawn as proxies. */
export const PROXY_RANGE = 300;

export const NORMAL_COUNT = COLS * ROWS - MAIN_SPAN * MAIN_SPAN - 1;
export const ISLAND_COUNT = NORMAL_COUNT + 1;

export type IslandKind = 'main' | 'normal';

export interface Cell {
  col: number;
  row: number;
}

export interface Vec2 {
  x: number;
  z: number;
}

export interface IslandDef {
  readonly id: number;
  readonly kind: IslandKind;
  readonly centerWorld: Vec2;
  /** Half the width of the region, in metres. */
  readonly half: number;
  /** Proper name of the island (a real small Indonesian island). Not translated. */
  readonly name: string;
  /** Grid cells this island occupies. */
  readonly cells: readonly Cell[];
}

function isMainCell(c: Cell): boolean {
  return c.col >= MAIN_COL && c.col < MAIN_COL + MAIN_SPAN && c.row >= MAIN_ROW && c.row < MAIN_ROW + MAIN_SPAN;
}

function isEmptyCell(c: Cell): boolean {
  return c.col === EMPTY_CELL.col && c.row === EMPTY_CELL.row;
}

const cellCentre = (c: Cell): Vec2 => ({ x: c.col * SPACING, z: c.row * SPACING });

const mainCells: Cell[] = [];
for (let r = 0; r < MAIN_SPAN; r++) for (let c = 0; c < MAIN_SPAN; c++) mainCells.push({ col: MAIN_COL + c, row: MAIN_ROW + r });

/** Names of the normal islands, in id order (id 1 first, row by row). */
const NORMAL_NAMES: readonly string[] = [
  'Pramuka', 'Tidung', 'Pari', 'Untung Jawa', 'Bidadari', 'Onrust', 'Kelor', 'Pulau Sepa', 'Pulau Macan', 'Karimunjawa',
  'Gili Trawangan', 'Gili Meno', 'Gili Air', 'Gili Nanggu', 'Gili Kedis', 'Gili Labak', 'Nusa Lembongan', 'Nusa Ceningan',
  'Menjangan', 'Derawan', 'Maratua', 'Kakaban', 'Sangalaki', 'Rubiah', 'Pulau Weh', 'Bunaken', 'Siladen', 'Lihaga',
  'Togean', 'Hoga', 'Tomia', 'Kaledupa', 'Banda Neira', 'Pulau Run', 'Pulau Ai', 'Pulau Hatta', 'Padar', 'Kanawa',
  'Seraya', 'Rinca', 'Arborek', 'Kri', 'Mansuar', 'Wayag', 'Lengkuas', 'Kepayang', 'Pahawang', 'Penyengat', 'Sempu',
];
const MAIN_NAME = 'Pulau Nongkrong';

function makeDef(id: number, kind: IslandKind, centre: Vec2, half: number, cells: Cell[], name: string): IslandDef {
  return { id, kind, centerWorld: centre, half, cells, name };
}

/** Every island, index = id. The main island is id 0; normals are numbered 1..49 row by row. */
export const ISLANDS: readonly IslandDef[] = (() => {
  const list: IslandDef[] = [makeDef(MAIN_ID, 'main', MAIN_CENTRE, MAIN_HALF, mainCells, MAIN_NAME)];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const cell = { col, row };
      if (isMainCell(cell) || isEmptyCell(cell)) continue;
      const id = list.length;
      list.push(makeDef(id, 'normal', cellCentre(cell), NORMAL_HALF, [cell], NORMAL_NAMES[id - 1]));
    }
  }
  if (list.length !== ISLAND_COUNT) throw new Error(`Expected ${ISLAND_COUNT} islands, built ${list.length}`);
  return list;
})();

/** Shown name: names already starting with Pulau, Gili or Nusa are used as they are, others get "Pulau ". */
export function displayName(id: number): string {
  const name = ISLANDS[id].name;
  return /^(Pulau|Gili|Nusa)\b/.test(name) ? name : `Pulau ${name}`;
}

const byCell = new Map<string, number>();
for (const def of ISLANDS) for (const c of def.cells) byCell.set(`${c.col},${c.row}`, def.id);

export function islandById(id: number): IslandDef | null {
  return ISLANDS[id] ?? null;
}

export function centreOf(id: number): Vec2 {
  return ISLANDS[id].centerWorld;
}

/** The island that owns a grid cell, or null for the empty corner and cells outside the grid. */
export function ownerOfCell(col: number, row: number): number | null {
  return byCell.get(`${col},${row}`) ?? null;
}

/** The island a world point lies on (inside its region), or null for water with no island. */
export function islandAt(x: number, z: number): IslandDef | null {
  if (Math.abs(x - MAIN_CENTRE.x) <= MAIN_HALF && Math.abs(z - MAIN_CENTRE.z) <= MAIN_HALF) return ISLANDS[MAIN_ID];
  const id = ownerOfCell(Math.round(x / SPACING), Math.round(z / SPACING));
  return id === null || id === MAIN_ID ? null : ISLANDS[id];
}

/** Islands whose regions share an edge with island `id`. */
export function neighborsOf(id: number): IslandDef[] {
  const out = new Set<number>();
  for (const c of ISLANDS[id].cells) {
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const other = ownerOfCell(c.col + dc, c.row + dr);
      if (other !== null && other !== id) out.add(other);
    }
  }
  return [...out].sort((a, b) => a - b).map((n) => ISLANDS[n]);
}

/** True when island `other` is close enough to the live island `from` to be drawn as a proxy. */
export function inProxyWindow(from: number, other: number): boolean {
  const a = centreOf(from);
  const b = centreOf(other);
  return Math.hypot(b.x - a.x, b.z - a.z) <= PROXY_RANGE;
}

/**
 * Migration helper for saves made on the old 5x10 grid: the island at that cell if it is a normal island
 * on the new grid, otherwise the main island.
 */
export function islandIdForLegacyCell(col: number, row: number): number {
  const id = ownerOfCell(col, row);
  return id !== null && id !== MAIN_ID ? id : MAIN_ID;
}
