import type RAPIER from '@dimforge/rapier3d-compat';
import type * as THREE from 'three/webgpu';

/** The Rapier module. Loaded lazily so its wasm sits in its own chunk. */
export type Rapier = typeof RAPIER;

/**
 * Thin wrapper around the Rapier world: gravity, static colliders and stepping.
 * Every static collider carries a tag (the island kind it belongs to). Only the tags in the active set
 * are enabled, so the colliders of the other island kind are invisible to the player and to queries.
 */
export class Physics {
  /** Rapier's runtime classes (ColliderDesc, Ray, ...). Other modules reach them through here. */
  readonly RAPIER: Rapier;
  readonly world: RAPIER.World;
  /** The live island's terrain trimesh collider. Set by main on each island switch. */
  terrainCollider: RAPIER.Collider | null = null;
  /** Collider handles the camera ray stops at, besides the terrain (e.g. the bamboo clump). */
  cameraBlockers = new Set<number>();
  /** Tag given to colliders created from now on (set while building an island kind). */
  tag = 'static';

  private tracked: Array<{ collider: RAPIER.Collider; tag: string }> = [];
  private enabledTags: Set<string> | null = null;

  private constructor(R: Rapier) {
    this.RAPIER = R;
    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
  }

  /** Loads and initialises Rapier. Runs in parallel with the model loads. */
  static async create() {
    const R = (await import('@dimforge/rapier3d-compat')).default;
    await R.init();
    return new Physics(R);
  }

  step(dt: number) {
    if (dt <= 0) return;
    this.world.timestep = dt;
    this.world.step();
  }

  /** Enables the colliders whose tag is in `tags` and disables the rest. Steps the world so queries see it. */
  setActiveTags(tags: Set<string>) {
    this.enabledTags = tags;
    for (const t of this.tracked) t.collider.setEnabled(tags.has(t.tag));
    this.world.step();
  }

  private track(collider: RAPIER.Collider): RAPIER.Collider {
    this.tracked.push({ collider, tag: this.tag });
    if (this.enabledTags && !this.enabledTags.has(this.tag)) collider.setEnabled(false);
    return collider;
  }

  /** Static trimesh collider built from the terrain's local vertices and indices. Returns it for the caller to keep. */
  addTerrain(mesh: THREE.Mesh): RAPIER.Collider {
    const geo = mesh.geometry;
    const positions = geo.getAttribute('position').array as Float32Array;
    const indices = new Uint32Array(geo.index!.array);
    return this.track(this.world.createCollider(this.RAPIER.ColliderDesc.trimesh(positions, indices)));
  }

  /** Immovable collider at a local position (no rigid body needed). */
  addStatic(desc: RAPIER.ColliderDesc, x: number, y: number, z: number) {
    this.track(this.world.createCollider(desc.setTranslation(x, y, z)));
  }

  /** Immovable collider that also blocks the camera ray. */
  addCameraBlocker(desc: RAPIER.ColliderDesc, x: number, y: number, z: number) {
    const collider = this.track(this.world.createCollider(desc.setTranslation(x, y, z)));
    this.cameraBlockers.add(collider.handle);
  }
}
