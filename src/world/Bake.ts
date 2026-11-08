import * as THREE from 'three/webgpu';

/**
 * Static geometry baking. Every mesh costs one draw call, so static scenery is flattened into a few
 * big geometries: each instance is written out with its transform (and instance colour) baked in,
 * and everything that shares a look goes into one mesh.
 */

/** Collects triangles, optionally with a per-vertex colour, into one non-indexed geometry. */
export class MeshBaker {
  private pos: number[] = [];
  private nrm: number[] = [];
  private col: number[] = [];
  private v = new THREE.Vector3();
  private n = new THREE.Vector3();
  private normalMatrix = new THREE.Matrix3();

  constructor(private readonly coloured: boolean) {}

  get empty(): boolean {
    return this.pos.length === 0;
  }

  /** Appends `geo` under `matrix`. A coloured baker needs `color` for each piece. */
  add(geo: THREE.BufferGeometry, matrix: THREE.Matrix4, color?: THREE.Color) {
    const pos = geo.getAttribute('position');
    const nrm = geo.getAttribute('normal');
    const index = geo.index;
    const count = index ? index.count : pos.count;
    this.normalMatrix.getNormalMatrix(matrix);
    for (let i = 0; i < count; i++) {
      const k = index ? index.getX(i) : i;
      this.v.fromBufferAttribute(pos, k).applyMatrix4(matrix);
      this.pos.push(this.v.x, this.v.y, this.v.z);
      if (nrm) {
        this.n.fromBufferAttribute(nrm, k).applyMatrix3(this.normalMatrix).normalize();
        this.nrm.push(this.n.x, this.n.y, this.n.z);
      } else {
        this.nrm.push(0, 1, 0);
      }
      if (this.coloured) this.col.push(color?.r ?? 1, color?.g ?? 1, color?.b ?? 1);
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    if (this.coloured) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** One baked piece of scenery: a geometry and the material it draws with. */
export interface Baked {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

interface Bucket {
  baker: MeshBaker;
  material: THREE.Material;
  coloured: boolean;
}

/** Plain standard material: no maps, emission, transparency or node overrides, so its colour can live in vertices. */
function isPlainStandard(m: THREE.Material): m is THREE.MeshStandardMaterial {
  const node = m as THREE.Material & { positionNode?: unknown; colorNode?: unknown };
  return (
    (m as THREE.MeshStandardMaterial).isMeshStandardMaterial === true &&
    !m.transparent && m.opacity === 1 &&
    !(m as THREE.MeshStandardMaterial).map &&
    !(m as THREE.MeshStandardMaterial).emissiveMap &&
    (m as THREE.MeshStandardMaterial).emissive.getHex() === 0 &&
    !node.positionNode && !node.colorNode
  );
}

/**
 * Flattens every visible Mesh and InstancedMesh under `root` into one geometry per look. Plain standard
 * materials become vertex-coloured buckets, one per roughness, metalness, flat-shading and side, with
 * each instance's colour baked in. Anything else keeps its own material in its own bucket. Transforms
 * are relative to `root`. Subtrees for which `skip` returns true are left out.
 */
export function bakeStatic(root: THREE.Object3D, skip: (o: THREE.Object3D) => boolean): Baked[] {
  root.updateWorldMatrix(true, true);
  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map<string, Bucket>();
  const rel = new THREE.Matrix4();
  const inst = new THREE.Matrix4();
  const tmp = new THREE.Color();
  const col = new THREE.Color();

  const bucketFor = (m: THREE.Material): Bucket => {
    if (isPlainStandard(m)) {
      const key = `std|${m.roughness}|${m.metalness}|${m.flatShading}|${m.side}`;
      let b = buckets.get(key);
      if (!b) {
        const material = new THREE.MeshStandardMaterial({
          vertexColors: true, roughness: m.roughness, metalness: m.metalness, flatShading: m.flatShading, side: m.side,
        });
        b = { baker: new MeshBaker(true), material, coloured: true };
        buckets.set(key, b);
      }
      return b;
    }
    const key = `mat|${m.uuid}`;
    let b = buckets.get(key);
    if (!b) {
      b = { baker: new MeshBaker(false), material: m, coloured: false };
      buckets.set(key, b);
    }
    return b;
  };

  const emit = (o: THREE.Mesh | THREE.InstancedMesh) => {
    if (Array.isArray(o.material)) return;
    const mat = o.material;
    const b = bucketFor(mat);
    rel.multiplyMatrices(rootInv, o.matrixWorld);
    const base = (mat as THREE.MeshStandardMaterial).color;
    if ((o as THREE.InstancedMesh).isInstancedMesh) {
      const im = o as THREE.InstancedMesh;
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, inst);
        col.copy(base ?? tmp.setScalar(1));
        if (b.coloured && im.instanceColor) col.multiply(im.getColorAt(i, tmp));
        b.baker.add(im.geometry, inst.premultiply(rel), b.coloured ? col : undefined);
      }
    } else {
      col.copy(base ?? tmp.setScalar(1));
      b.baker.add(o.geometry, rel, b.coloured ? col : undefined);
    }
  };

  const visit = (o: THREE.Object3D) => {
    if (!o.visible || skip(o)) return;
    if ((o as THREE.Mesh).isMesh) emit(o as THREE.Mesh);
    for (const c of o.children) visit(c);
  };
  for (const c of root.children) visit(c);

  const out: Baked[] = [];
  for (const b of buckets.values()) {
    if (!b.baker.empty) out.push({ geometry: b.baker.build(), material: b.material });
  }
  return out;
}
