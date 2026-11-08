import * as THREE from 'three/webgpu';
import type RAPIER from '@dimforge/rapier3d-compat';
import { instanceModel, type NatureAssets, type NatureName } from './Assets';

/** A zero-scale matrix: the instance is still in its InstancedMesh, but draws nothing. */
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

/** One scattered prop or plant: where it is (local to its island), its transform, and the colliders that belong to it. */
export interface Instance {
  readonly name: NatureName;
  readonly x: number;
  readonly z: number;
  readonly matrix: THREE.Matrix4;
  /** The InstancedMesh of each part of its model, set at flush. */
  batch: THREE.InstancedMesh[] | null;
  index: number;
  colliders: RAPIER.Collider[];
  hidden: boolean;
}

export interface InstanceOpts {
  shadow?: boolean;
  wind?: number;
  jitter?: () => number;
}

/**
 * Instanced scenery of one island that can be hidden at runtime. Each instance keeps its matrix, so hiding it
 * scales it to zero and showing it puts the matrix back. Its colliders are switched off while hidden.
 */
export class Scatter {
  private pending: Instance[] = [];
  private placed: Instance[] = [];

  /** Queues an instance at local (x, z). It is drawn at the next flush. */
  add(name: NatureName, matrix: THREE.Matrix4, x: number, z: number): Instance {
    const inst: Instance = { name, x, z, matrix, batch: null, index: 0, colliders: [], hidden: false };
    this.pending.push(inst);
    return inst;
  }

  /** Builds the instanced meshes for every queued instance, one set per model. */
  flush(parent: THREE.Object3D, assets: NatureAssets, optsOf: (name: NatureName) => InstanceOpts) {
    const byName = new Map<NatureName, Instance[]>();
    for (const inst of this.pending) {
      const list = byName.get(inst.name);
      if (list) list.push(inst);
      else byName.set(inst.name, [inst]);
    }
    for (const [name, list] of byName) {
      const meshes = instanceModel(parent, assets[name], list.map((i) => i.matrix), optsOf(name));
      list.forEach((inst, i) => {
        inst.batch = meshes;
        inst.index = i;
        this.placed.push(inst);
      });
    }
    this.pending = [];
  }

  /**
   * Hides the instances whose local (x, z) passes `test`, and shows the rest. Null shows everything. Only the
   * instances that change state are touched.
   */
  setHidden(test: ((x: number, z: number) => boolean) | null) {
    const dirty = new Set<THREE.InstancedMesh>();
    for (const inst of this.placed) {
      const want = test !== null && test(inst.x, inst.z);
      if (want === inst.hidden || !inst.batch) continue;
      inst.hidden = want;
      for (const mesh of inst.batch) {
        mesh.setMatrixAt(inst.index, want ? HIDDEN : inst.matrix);
        dirty.add(mesh);
      }
      for (const c of inst.colliders) c.setEnabled(!want);
    }
    for (const mesh of dirty) mesh.instanceMatrix.needsUpdate = true;
  }
}
