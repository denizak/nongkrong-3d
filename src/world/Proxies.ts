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
  terrainMat: THREE.Material;
  live: LiveRoot;
}

interface Proxy {
  object: THREE.Group;
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

  constructor(
    private scene: THREE.Scene,
    roots: Record<IslandKind, LiveRoot>,
  ) {
    const bake = (live: LiveRoot): Template => {
      const shared = bakeStatic(
        live.root,
        (o) => o === live.terrain || o === live.torches || SYNC_NAMES.has(o.name) || STRIP_NAMES.has(o.name),
      );
      return { shared, terrainGeo: live.terrain.geometry, terrainMat: live.terrain.material as THREE.Material, live };
    };
    this.templates = { normal: bake(roots.normal), main: bake(roots.main) };
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
      if (def.id === current) continue;
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
    const terrain = new THREE.Mesh(t.terrainGeo, t.terrainMat);
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
    const proxy: Proxy = { object, kind, pairs };
    this.items.set(id, proxy);
    return proxy;
  }
}

function collectNamed(root: THREE.Object3D): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (SYNC_NAMES.has(o.name)) out.push(o);
  });
  return out;
}
