import * as THREE from 'three/webgpu';
import { CharacterModel, type Pose } from '../player/CharacterModel';
import { encodeLook, type Look } from '../player/Look';
import { centreOf, inProxyWindow } from '../world/Islands';
import { SpeechBubble, placeOn } from '../ui/SpeechBubble';
import { STALE_MS, type Net, type RemotePeer, type Snapshot } from './Net';
import './net.css';

/** Render this far behind the newest snapshot, so there is usually a pair to interpolate between. */
const DELAY_MS = 120;
const MAX_RENDER = 24;
const NAME_RANGE = 60;
/** Name tag and bubble heights above the feet, by pose (metres). The bubble sits above the name tag. */
const NAME_H: Record<Pose, number> = { stand: 2.05, sit: 1.25, lie: 0.95 };
const BUBBLE_H: Record<Pose, number> = { stand: 2.6, sit: 1.8, lie: 1.45 };

interface Sample {
  island: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
  pose: Pose;
  fishing: boolean;
}

interface Placeholder {
  group: THREE.Group;
  body: THREE.Mesh;
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
}

interface Avatar {
  peer: RemotePeer;
  anchor: THREE.Group;
  model: CharacterModel | null;
  placeholder: Placeholder | null;
  nameTag: HTMLDivElement;
  nameShown: string;
  bubble: SpeechBubble;
  pose: Pose | null;
  lookKey: string;
}

const _pos = new THREE.Vector3();

/**
 * Interpolates a peer's snapshots at time `t`. Each snapshot is first expressed in the frame of the newest
 * snapshot's island, so a change of island mid-buffer does not make the avatar jump.
 */
export function sampleAt(snaps: Snapshot[], t: number): Sample | null {
  const n = snaps.length;
  if (n === 0) return null;
  const last = snaps[n - 1];
  let a = last;
  let b = last;
  if (t <= snaps[0].t) {
    a = b = snaps[0];
  } else if (t < last.t) {
    for (let i = 0; i < n - 1; i++) {
      if (t < snaps[i + 1].t) {
        a = snaps[i];
        b = snaps[i + 1];
        break;
      }
    }
  }
  const span = b.t - a.t;
  const k = span > 0 ? THREE.MathUtils.clamp((t - a.t) / span, 0, 1) : 1;
  // Express the older snapshot in the newer one's island frame (centre to centre).
  const ca = centreOf(a.island);
  const cb = centreOf(b.island);
  const ax = a.x + (ca.x - cb.x);
  const az = a.z + (ca.z - cb.z);
  // Shortest arc between headings.
  const dh = Math.atan2(Math.sin(b.heading - a.heading), Math.cos(b.heading - a.heading));
  return {
    island: b.island,
    x: THREE.MathUtils.lerp(ax, b.x, k),
    y: THREE.MathUtils.lerp(a.y, b.y, k),
    z: THREE.MathUtils.lerp(az, b.z, k),
    heading: a.heading + dh * k,
    speed: THREE.MathUtils.lerp(a.speed, b.speed, k),
    pose: b.pose,
    fishing: b.fishing,
  };
}

/** Simple stand-in body, used only when the robot model did not load. */
function buildPlaceholder(look: Look): Placeholder {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: look.body, flatShading: true });
  const headMat = new THREE.MeshStandardMaterial({ color: look.trim, flatShading: true });
  const bodyGeo = new THREE.CapsuleGeometry(0.3, 0.7, 4, 8);
  const headGeo = new THREE.SphereGeometry(0.28, 12, 8);
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.95;
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.y = 1.7;
  group.add(body, head);
  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  return { group, body, geometries: [bodyGeo, headGeo], materials: [bodyMat, headMat] };
}

/**
 * Remote players as robots: one avatar per peer with a recent state, placed relative to the local island.
 * Only peers whose island is within the proxy window are drawn. Each has a name tag and a speech bubble.
 */
export class RemotePlayers {
  private avatars = new Map<string, Avatar>();

  constructor(
    private scene: THREE.Scene,
    private net: Net,
  ) {
    net.onChat = (id, text) => this.say(id, text);
  }

  /** Shows a chat line above a peer's avatar. */
  say(peerId: string, text: string) {
    const p = this.net.remotes.get(peerId);
    if (!p) return;
    this.ensure(p).bubble.say(text);
  }

  /**
   * Call once per frame. `me` is the live island id and the local position. `now` is performance.now().
   */
  update(dt: number, camera: THREE.Camera, me: { island: number; pos: THREE.Vector3 }, now = performance.now()) {
    camera.updateMatrixWorld();
    const renderT = now - DELAY_MS;

    // Drop avatars whose peer left or went quiet.
    for (const id of [...this.avatars.keys()]) {
      const p = this.net.remotes.get(id);
      if (!p || p.snaps.length === 0 || now - p.lastState > STALE_MS) this.remove(id);
    }

    // Candidates: fresh peers in the proxy window, placed in my island frame.
    const cands: { peer: RemotePeer; s: Sample; x: number; z: number; d: number }[] = [];
    for (const p of this.net.remotes.values()) {
      if (p.snaps.length === 0 || now - p.lastState > STALE_MS) continue;
      const s = sampleAt(p.snaps, renderT);
      if (!s) continue;
      if (!inProxyWindow(me.island, s.island)) continue;
      const cs = centreOf(s.island);
      const cm = centreOf(me.island);
      const x = s.x + (cs.x - cm.x);
      const z = s.z + (cs.z - cm.z);
      cands.push({ peer: p, s, x, z, d: Math.hypot(x - me.pos.x, z - me.pos.z) });
    }
    cands.sort((a, b) => a.d - b.d);

    const shown = new Set<string>();
    for (const c of cands.slice(0, MAX_RENDER)) {
      const av = this.ensure(c.peer);
      shown.add(c.peer.id);
      this.place(av, c.s, c.x, c.z, dt, camera);
    }
    // Everything else is out of range: hide it, keep the model so it can come back quickly.
    for (const [id, av] of this.avatars) {
      if (shown.has(id)) continue;
      av.anchor.visible = false;
      av.nameTag.style.visibility = 'hidden';
      av.bubble.el.style.visibility = 'hidden';
    }
  }

  private place(av: Avatar, s: Sample, x: number, z: number, dt: number, camera: THREE.Camera) {
    av.anchor.visible = true;
    av.anchor.position.set(x, s.y, z);
    av.anchor.rotation.y = s.heading;

    if (av.pose !== s.pose) {
      av.pose = s.pose;
      av.model?.setPose(s.pose);
    }
    if (av.model) {
      av.model.update(dt, s.speed, s.y);
    } else if (av.placeholder) {
      // Placeholder pose: lower the stand-in when seated, tip it over when lying down.
      const ph = av.placeholder.group;
      ph.scale.y = s.pose === 'sit' ? 0.75 : 1;
      ph.rotation.x = s.pose === 'lie' ? -Math.PI / 2 : 0;
      ph.position.y = s.pose === 'lie' ? 0.3 : 0;
      av.placeholder.body.position.y = 0.95 + Math.abs(Math.sin(performance.now() * 0.01 * s.speed)) * 0.08 * Math.min(1, s.speed / 4);
    }

    const label = `${s.fishing ? '🎣 ' : ''}${av.peer.name}`;
    if (label !== av.nameShown) {
      av.nameShown = label;
      av.nameTag.textContent = label;
    }
    _pos.set(x, s.y + NAME_H[s.pose], z);
    placeOn(av.nameTag, _pos, camera, NAME_RANGE);

    _pos.set(x, s.y + BUBBLE_H[s.pose], z);
    av.bubble.place(_pos, camera);
  }

  /** The avatar for a peer, created on first use. Recolours it if the peer's look changed. */
  private ensure(p: RemotePeer): Avatar {
    const key = encodeLook(p.look);
    let av = this.avatars.get(p.id);
    if (av) {
      if (av.lookKey !== key) {
        av.lookKey = key;
        if (av.model) av.model.setLook(p.look);
        else if (av.placeholder) {
          (av.placeholder.body.material as THREE.MeshStandardMaterial).color.set(p.look.body);
        }
      }
      return av;
    }

    const anchor = new THREE.Group();
    anchor.name = `remote:${p.id}`;
    anchor.visible = false;
    const model = CharacterModel.cloneFor(p.look);
    let placeholder: Placeholder | null = null;
    if (model) {
      anchor.add(model.root);
    } else {
      placeholder = buildPlaceholder(p.look);
      anchor.add(placeholder.group);
    }
    this.scene.add(anchor);

    const nameTag = document.createElement('div');
    nameTag.className = 'name-tag';
    nameTag.style.visibility = 'hidden';
    document.body.append(nameTag);

    av = {
      peer: p,
      anchor,
      model,
      placeholder,
      nameTag,
      nameShown: '',
      bubble: new SpeechBubble(),
      pose: null,
      lookKey: key,
    };
    this.avatars.set(p.id, av);
    return av;
  }

  private remove(id: string) {
    const av = this.avatars.get(id);
    if (!av) return;
    this.avatars.delete(id);
    av.model?.dispose();
    if (av.placeholder) {
      for (const g of av.placeholder.geometries) g.dispose();
      for (const m of av.placeholder.materials) m.dispose();
    }
    av.anchor.removeFromParent();
    av.nameTag.remove();
    av.bubble.destroy();
  }
}
