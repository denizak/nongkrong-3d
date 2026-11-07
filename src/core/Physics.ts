import type RAPIER from '@dimforge/rapier3d-compat';
import type * as THREE from 'three/webgpu';

/** The Rapier module. Loaded lazily so its wasm sits in its own chunk. */
export type Rapier = typeof RAPIER;

/** Thin wrapper around the Rapier world: gravity, static colliders and stepping. */
export class Physics {
  /** Rapier's runtime classes (ColliderDesc, Ray, ...). Other modules reach them through here. */
  readonly RAPIER: Rapier;
  readonly world: RAPIER.World;
  /** The terrain trimesh collider, set by addTerrain. */
  terrainCollider: RAPIER.Collider | null = null;
  /** Collider handles the camera ray stops at, besides the terrain (e.g. the bamboo clump). */
  cameraBlockers = new Set<number>();

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

  /** Static trimesh collider built from the terrain's world-space vertices and indices. */
  addTerrain(mesh: THREE.Mesh) {
    const geo = mesh.geometry;
    const positions = geo.getAttribute('position').array as Float32Array;
    const indices = new Uint32Array(geo.index!.array);
    this.terrainCollider = this.world.createCollider(this.RAPIER.ColliderDesc.trimesh(positions, indices));
  }

  /** Immovable collider at a world position (no rigid body needed). */
  addStatic(desc: RAPIER.ColliderDesc, x: number, y: number, z: number) {
    this.world.createCollider(desc.setTranslation(x, y, z));
  }

  /** Immovable collider that also blocks the camera ray. */
  addCameraBlocker(desc: RAPIER.ColliderDesc, x: number, y: number, z: number) {
    const collider = this.world.createCollider(desc.setTranslation(x, y, z));
    this.cameraBlockers.add(collider.handle);
  }
}
