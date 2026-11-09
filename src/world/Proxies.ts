import * as THREE from 'three/webgpu';
import { bakeStatic, type Baked } from './Bake';
import { ISLANDS, centreOf, inProxyWindow, type IslandKind } from './Islands';
import { CAMPFIRE_FLAME } from './Plaza';

/** Objects whose visibility or transform must follow the live island in each proxy. */
const SYNC_NAMES = new Set(['torch-group', 'torch-flame']);
/** Paddy stalks and flowers are too heavy to copy for every proxy, so proxies drop them. */
const STRIP_NAMES = new Set(['rice', 'vegetation', CAMPFIRE_FLAME]);

/** A kind's live content root, with the parts proxies handle one by one. */
export interface LiveRoot {
  root: THREE.Group;
  terrain: THREE.Mesh;
  torches: THREE.Object3D;
}

/** Shared pieces of one island kind: the baked scenery, the terrain geometry and the torch template. */
interface Template {
  shared: Baked[];
  terrainGeo: THREE.BufferGeometry;
  /** The same terrain with every other vertex dropped (medium and low). */
  terrainGeoLite: THREE.BufferGeometry;
  terrainMat: THREE.Material;
  live: LiveRoot;
}

interface Proxy {
  object: THREE.Group;
  terrain: THREE.Mesh;
  kind: IslandKind;
  /** [live, proxy] pairs of SYNC_NAMES objects, matched by traversal order. */
  pairs: Array<[THREE.Object3D, THREE.Object3D]>;
}

/**
 * Static copies of the other islands near the live one (within PROXY_RANGE of its centre). Each island
 * kind is baked once, and all proxies of that kind share the geometry. A proxy is shown only while its
 * island is in range, and it is placed at (its centre minus the live centre). Proxies cast no shadows and
 * have no point lights; they skip rice and flowers.
 */
export class Proxies {
  private items = new Map<number, Proxy>();
  private templates: Record<IslandKind, Template>;
  private decimated = false;

  constructor(
    private scene: THREE.Scene,
    roots: Record<IslandKind, LiveRoot>,
  ) {
    const bake = (live: LiveRoot): Template => {
      const shared = bakeStatic(
        live.root,
        (o) => o === live.terrain || o === live.torches || SYNC_NAMES.has(o.name) || STRIP_NAMES.has(o.name),
      );
      const terrainGeo = live.terrain.geometry;
      return {
        shared,
        terrainGeo,
        terrainGeoLite: decimateTerrain(terrainGeo),
        terrainMat: live.terrain.material as THREE.Material,
        live,
      };
    };
    this.templates = { normal: bake(roots.normal), main: bake(roots.main) };
  }

  /** Proxy terrain with half the vertices (medium and low) or the full terrain (high). Applies to every proxy at once. */
  setDecimate(on: boolean) {
    this.decimated = on;
    for (const p of this.items.values()) {
      const t = this.templates[p.kind];
      p.terrain.geometry = on ? t.terrainGeoLite : t.terrainGeo;
    }
  }

  /** Number of proxies created so far (shown or hidden). */
  get count(): number {
    return this.items.size;
  }

  /** Number of proxies currently shown. */
  get visibleCount(): number {
    let n = 0;
    for (const p of this.items.values()) if (p.object.visible) n++;
    return n;
  }

  /** Live island changed: show the islands in range, placed relative to the new live centre. */
  update(current: number) {
    const here = centreOf(current);
    for (const def of ISLANDS) {
      if (def.id === current) {
        const existing = this.items.get(def.id);
        if (existing) existing.object.visible = false;
        continue;
      }
      const inRange = inProxyWindow(current, def.id);
      if (!inRange && !this.items.has(def.id)) continue;
      const proxy = this.items.get(def.id) ?? this.make(def.id);
      proxy.object.visible = inRange;
      if (inRange) proxy.object.position.set(def.centerWorld.x - here.x, 0, def.centerWorld.z - here.z);
    }
  }

  /** Per frame: copy the live torch state into the visible proxies. */
  sync() {
    for (const p of this.items.values()) {
      if (!p.object.visible) continue;
      for (const [live, copy] of p.pairs) {
        copy.visible = live.visible;
        copy.quaternion.copy(live.quaternion);
        copy.scale.copy(live.scale);
      }
    }
  }

  private make(id: number): Proxy {
    const kind = ISLANDS[id].kind;
    const t = this.templates[kind];
    const object = new THREE.Group();
    object.name = `proxy ${id}`;
    for (const s of t.shared) object.add(new THREE.Mesh(s.geometry, s.material));
    const terrain = new THREE.Mesh(this.decimated ? t.terrainGeoLite : t.terrainGeo, t.terrainMat);
    const torches = t.live.torches.clone(true);
    const lights: THREE.Light[] = [];
    torches.traverse((o) => {
      if ((o as THREE.Light).isLight) lights.push(o as THREE.Light);
    });
    for (const l of lights) l.removeFromParent();
    object.add(terrain, torches);
    object.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = false;
    });

    const liveSync = collectNamed(t.live.torches);
    const copySync = collectNamed(torches);
    const pairs = liveSync.map((live, i) => [live, copySync[i]] as [THREE.Object3D, THREE.Object3D]);
    this.scene.add(object);
    const proxy: Proxy = { object, terrain, kind, pairs };
    this.items.set(id, proxy);
    return proxy;
  }
}

/**
 * The terrain grid with every other vertex in each direction, so half the cells per side. Vertex positions and
 * colours come from the grid; the normals are recomputed. Falls back to the original when the grid is odd-sized.
 */
function decimateTerrain(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = geo.getAttribute('position');
  const col = geo.getAttribute('color');
  const n = Math.round(Math.sqrt(pos.count));
  const segments = n - 1;
  if (segments % 2 !== 0 || !col) return geo;
  const m = segments / 2 + 1;
  const P = new Float32Array(m * m * 3);
  const C = new Float32Array(m * m * 3);
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < m; i++) {
      const src = (j * 2) * n + i * 2;
      const dst = j * m + i;
      P.set([pos.getX(src), pos.getY(src), pos.getZ(src)], dst * 3);
      C.set([col.getX(src), col.getY(src), col.getZ(src)], dst * 3);
    }
  }
  const idx = new Uint32Array(segments * segments * 3 * 2);
  let k = 0;
  for (let j = 0; j < segments / 2; j++) {
    for (let i = 0; i < segments / 2; i++) {
      const a = j * m + i;
      const b = (j + 1) * m + i;
      const cc = (j + 1) * m + i + 1;
      const d = j * m + i + 1;
      idx[k++] = a; idx[k++] = b; idx[k++] = d;
      idx[k++] = b; idx[k++] = cc; idx[k++] = d;
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('color', new THREE.BufferAttribute(C, 3));
  out.setIndex(new THREE.BufferAttribute(idx.subarray(0, k), 1));
  out.computeVertexNormals();
  return out;
}

function collectNamed(root: THREE.Object3D): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (SYNC_NAMES.has(o.name)) out.push(o);
  });
  return out;
}
