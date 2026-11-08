import * as THREE from 'three/webgpu';
import { SPACING, type Archipelago } from './Archipelago';
import { bakeStatic } from './Bake';

/** Objects whose visibility or transform must follow the live island in each proxy. */
const SYNC_NAMES = new Set(['torch-group', 'torch-flame', 'bridge-flames']);
/** Paddy stalks and flowers are too heavy to copy eight times, so proxies drop them. */
const STRIP_NAMES = new Set(['rice', 'vegetation']);

/** The parts of the live island that proxies handle one by one, rather than baking. */
export interface LiveParts {
  /** The island group. Its other static scenery is baked once and shared by every proxy. */
  island: THREE.Group;
  terrain: THREE.Object3D;
  /** Cloned per proxy, since each proxy shows its own bridges. */
  bridges: THREE.Object3D;
  /** Cloned per proxy and synced to the live torches every frame. */
  torches: THREE.Object3D;
}

interface Proxy {
  dc: number;
  dr: number;
  object: THREE.Group;
  bridgeE: THREE.Object3D | null;
  bridgeN: THREE.Object3D | null;
  /** [live, proxy] pairs of SYNC_NAMES objects, matched by traversal order. */
  pairs: Array<[THREE.Object3D, THREE.Object3D]>;
}

/**
 * Static copies of the live island at the eight surrounding grid offsets. Each one is shown only
 * when its cell exists. Proxies cast no shadows, have no point lights and skip rice and flowers.
 * The island's props, paddy and scarecrow are baked into a few meshes once, and all proxies share
 * that geometry, so each proxy costs only a handful of draw calls.
 */
export class Proxies {
  private items: Proxy[] = [];

  constructor(scene: THREE.Scene, live: LiveParts) {
    const shared = bakeStatic(
      live.island,
      (o) =>
        o === live.terrain || o === live.bridges || o === live.torches ||
        SYNC_NAMES.has(o.name) || STRIP_NAMES.has(o.name),
    );
    const liveSync = [...collectNamed(live.bridges), ...collectNamed(live.torches)];

    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dc === 0 && dr === 0) continue;
        const object = new THREE.Group();
        object.name = `proxy ${dc},${dr}`;
        object.position.set(dc * SPACING, 0, dr * SPACING);

        for (const s of shared) object.add(new THREE.Mesh(s.geometry, s.material));
        const terrain = live.terrain.clone();
        const bridges = live.bridges.clone(true);
        const torches = live.torches.clone(true);

        const lights: THREE.Light[] = [];
        torches.traverse((o) => {
          if ((o as THREE.Light).isLight) lights.push(o as THREE.Light);
        });
        for (const l of lights) l.removeFromParent();
        object.add(terrain, bridges, torches);
        object.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) o.castShadow = false;
        });

        const cloneSync = [...collectNamed(bridges), ...collectNamed(torches)];
        const pairs = liveSync.map((live, i) => [live, cloneSync[i]] as [THREE.Object3D, THREE.Object3D]);
        scene.add(object);
        this.items.push({
          dc, dr, object,
          bridgeE: bridges.getObjectByName('bridgeE') ?? null,
          bridgeN: bridges.getObjectByName('bridgeN') ?? null,
          pairs,
        });
      }
    }
  }

  get count(): number {
    return this.items.length;
  }

  /** Cell change: show only the proxies whose cell exists, and each one's own bridges where the next cell exists. */
  onCell(arch: Archipelago) {
    for (const p of this.items) {
      const col = arch.cell.col + p.dc;
      const row = arch.cell.row + p.dr;
      p.object.visible = arch.inGrid(col, row);
      if (p.bridgeE) p.bridgeE.visible = arch.inGrid(col + 1, row);
      if (p.bridgeN) p.bridgeN.visible = arch.inGrid(col, row - 1);
    }
  }

  /** Per frame: copy the live torch and bridge lantern state into the visible proxies. */
  sync() {
    for (const p of this.items) {
      if (!p.object.visible) continue;
      for (const [live, copy] of p.pairs) {
        copy.visible = live.visible;
        copy.quaternion.copy(live.quaternion);
        copy.scale.copy(live.scale);
      }
    }
  }
}

function collectNamed(root: THREE.Object3D): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (SYNC_NAMES.has(o.name)) out.push(o);
  });
  return out;
}
