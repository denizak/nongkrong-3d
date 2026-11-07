import RAPIER from '@dimforge/rapier3d-compat';
import type * as THREE from 'three/webgpu';

/** Thin wrapper around the Rapier world: gravity, static colliders and stepping. */
export class Physics {
  readonly world: RAPIER.World;
  /** The terrain trimesh collider, set by addTerrain. */
  terrainCollider: RAPIER.Collider | null = null;
  /** Collider handles the camera ray stops at, besides the terrain (e.g. the bamboo clump). */
  cameraBlockers = new Set<number>();

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  }

  static async create() {
    await RAPIER.init();
    return new Physics();
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
    this.terrainCollider = this.world.createCollider(RAPIER.ColliderDesc.trimesh(positions, indices));
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
