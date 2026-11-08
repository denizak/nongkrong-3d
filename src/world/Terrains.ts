import { islandAt, type IslandKind } from './Islands';
import { Terrain, DEEP, NORMAL_SPEC, type Ground } from './Terrain';
import { MainTerrain } from './MainTerrain';

/** One terrain per island kind, built once. Heights in world coordinates come from the island that owns the point. */
export class Terrains {
  readonly normal = new Terrain(NORMAL_SPEC);
  readonly main = new MainTerrain();

  of(kind: IslandKind): Terrain {
    return kind === 'main' ? this.main : this.normal;
  }

  /** Ground height at a world point: the owning island's local height, or deep water where no island is. */
  heightAtWorld = (x: number, z: number): number => {
    const def = islandAt(x, z);
    if (!def) return DEEP;
    return this.of(def.kind).heightAt(x - def.centerWorld.x, z - def.centerWorld.z);
  };
}

/**
 * The live island's ground, for code that works in local coordinates (player, props, pickups, weather).
 * Switching islands repoints `active`; everything holding this object follows.
 */
export class LiveGround implements Ground {
  active: Terrain;

  constructor(initial: Terrain) {
    this.active = initial;
  }

  heightAt(x: number, z: number): number {
    return this.active.heightAt(x, z);
  }
}
