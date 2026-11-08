import { ISLANDS, MAIN_ID, type IslandKind } from './Islands';
import type { Terrains } from './Terrains';

/** Metres per baked pixel. */
export const SHAPE_STEP = 3;
/** Land is anything above this height (m). */
export const LAND_MIN = 0.2;
/** Sand is land at or below this height (m); the rest of the land is grass. */
export const SAND_MAX = 0.6;
const SAND: readonly [number, number, number] = [232, 214, 160];
const GRASS: readonly [number, number, number] = [140, 191, 107];
/** Rows baked before yielding to the browser. */
const ROWS_PER_SLICE = 12;

const nextTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Top-down island shapes for the minimap and the full map. One image per island kind (the normal islands are
 * identical), baked once from the terrain heights in chunks so the start does not stall. Transparent where there
 * is no land; the image covers the island's region (`half` metres each way from its centre).
 */
export class IslandShapes {
  private images: Partial<Record<IslandKind, HTMLCanvasElement>> = {};
  /** True once both kinds are baked. Until then `get` returns null. */
  ready = false;
  readonly done: Promise<void>;

  constructor(terrains: Terrains) {
    this.done = this.bake(terrains).then(() => {
      this.ready = true;
    });
  }

  get(kind: IslandKind): HTMLCanvasElement | null {
    return this.images[kind] ?? null;
  }

  private async bake(terrains: Terrains) {
    // Sample one island of each kind: id 1 is a normal island, id 0 is the main island.
    for (const def of [ISLANDS[1], ISLANDS[MAIN_ID]]) {
      this.images[def.kind] = await this.bakeOne(terrains, def.centerWorld.x, def.centerWorld.z, def.half);
    }
  }

  private async bakeOne(terrains: Terrains, cx: number, cz: number, half: number) {
    const n = Math.round((2 * half) / SHAPE_STEP);
    const canvas = document.createElement('canvas');
    canvas.width = n;
    canvas.height = n;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(n, n);
    const d = img.data;
    for (let j = 0; j < n; j++) {
      const z = cz - half + (j + 0.5) * SHAPE_STEP;
      for (let i = 0; i < n; i++) {
        const x = cx - half + (i + 0.5) * SHAPE_STEP;
        const h = terrains.heightAtWorld(x, z);
        if (h <= LAND_MIN) continue;
        const c = h <= SAND_MAX ? SAND : GRASS;
        const o = (j * n + i) * 4;
        d[o] = c[0];
        d[o + 1] = c[1];
        d[o + 2] = c[2];
        d[o + 3] = 255;
      }
      if (j % ROWS_PER_SLICE === ROWS_PER_SLICE - 1) await nextTurn();
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }
}
