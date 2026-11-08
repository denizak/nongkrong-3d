import * as THREE from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/**
 * Robot looks: one of five builds, a body colour for the 'Main' material and a trim colour for
 * the 'Grey' material. Everything here is procedural, so any instance of the robot model can wear one.
 */

export type RobotType = 0 | 1 | 2 | 3 | 4;

export interface Look {
  type: RobotType;
  /** Body colour, hex. Recolours the 'Main' material. */
  body: string;
  /** Trim colour, hex. Recolours the 'Grey' material. */
  trim: string;
  /** Friendly label, e.g. "Coral Sprout". */
  name: string;
}

const STORAGE_KEY = 'nongkrong.look';

/** Soft, saturated body colours. */
export const BODY_PALETTE: { name: string; hex: string }[] = [
  { name: 'Coral', hex: '#f08a6c' },
  { name: 'Mint', hex: '#7fd6b5' },
  { name: 'Sky', hex: '#7cc4ef' },
  { name: 'Lilac', hex: '#b9a2e6' },
  { name: 'Sunflower', hex: '#f2c94c' },
  { name: 'Tangerine', hex: '#f5964a' },
  { name: 'Teal', hex: '#3fa8a0' },
  { name: 'Rose', hex: '#ee8fb0' },
  { name: 'Lime', hex: '#b5d86a' },
  { name: 'Peach', hex: '#f7b98f' },
  { name: 'Cobalt', hex: '#4a6fd0' },
  { name: 'Plum', hex: '#8e5a8f' },
  { name: 'Sand', hex: '#d9be8c' },
  { name: 'Cherry', hex: '#d64d5b' },
  { name: 'Jade', hex: '#3f9e6e' },
  { name: 'Slate', hex: '#6f7f94' },
];

/** Neutrals and metals for the trim. */
export const TRIM_PALETTE: { name: string; hex: string }[] = [
  { name: 'Light grey', hex: '#d4d8dd' },
  { name: 'Gunmetal', hex: '#3b434c' },
  { name: 'Cream', hex: '#f4ead2' },
  { name: 'Brass', hex: '#b8893a' },
];

interface TypeSpec {
  name: string;
  /** Whole-model scale, applied on top of the 1.8 m base. */
  scale: number;
  /** Head bone scale (uniform). */
  headScale: number;
}

const TYPES: Record<RobotType, TypeSpec> = {
  0: { name: 'Classic', scale: 1, headScale: 1 },
  1: { name: 'Sprout', scale: 0.92, headScale: 1.22 },
  2: { name: 'Antenna', scale: 1.06, headScale: 1 },
  3: { name: 'Captain', scale: 1, headScale: 1 },
  4: { name: 'Explorer', scale: 1, headScale: 1.08 },
};

/** Accessories are built at natural size, then scaled about their attachment point so they read next to the big head. */
const ACCESSORY_SCALE = 1.6;
/** Bright accent for the antenna ball. Unlit and untone-mapped, so it reads as glowing. */
const ANTENNA_ACCENT = new THREE.MeshBasicMaterial({ color: '#ffd23f', toneMapped: false });

const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];

/** Relative luminance of a hex colour, 0 (black) to 1 (white). */
function luminance(hex: string): number {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

function bodyName(hex: string): string {
  return BODY_PALETTE.find((b) => b.hex.toLowerCase() === hex.toLowerCase())?.name ?? 'Custom';
}

function nameFor(type: RobotType, body: string): string {
  return `${bodyName(body)} ${TYPES[type].name}`;
}

/** Builds a look from parts. Name is derived from the body colour and type. */
export function makeLook(type: RobotType, body: string, trim: string): Look {
  return { type, body: body.toLowerCase(), trim: trim.toLowerCase(), name: nameFor(type, body) };
}

/** A random type and body colour, with a trim that contrasts with the body. */
export function randomLook(): Look {
  const type = Math.floor(Math.random() * 5) as RobotType;
  const body = pick(BODY_PALETTE).hex;
  const bodyL = luminance(body);
  const contrasting = TRIM_PALETTE.filter((t) => Math.abs(luminance(t.hex) - bodyL) >= 0.25);
  const trim = pick(contrasting.length > 0 ? contrasting : TRIM_PALETTE).hex;
  return makeLook(type, body, trim);
}

/** Compact form for storage and multiplayer: "type-bodyhex-trimhex", e.g. "3-f08a6c-3b434c". */
export function encodeLook(look: Look): string {
  return `${look.type}-${look.body.replace('#', '')}-${look.trim.replace('#', '')}`.toLowerCase();
}

/** Parses encodeLook output. Returns null if the string is not a valid look. */
export function decodeLook(str: string): Look | null {
  const m = /^([0-4])-([0-9a-f]{6})-([0-9a-f]{6})$/i.exec(str.trim());
  if (!m) return null;
  return makeLook(Number(m[1]) as RobotType, `#${m[2]}`, `#${m[3]}`);
}

/** The saved look. On first visit (or if the save is unreadable) a random one is generated and stored. */
export function loadLook(): Look {
  try {
    const look = decodeLook(localStorage.getItem(STORAGE_KEY) ?? '');
    if (look) return look;
  } catch {
    // Storage blocked: fall through to a random look for this session.
  }
  const look = randomLook();
  saveLook(look);
  return look;
}

export function saveLook(look: Look): void {
  try {
    localStorage.setItem(STORAGE_KEY, encodeLook(look));
  } catch {
    // Storage full or blocked: the look still works for this session.
  }
}

// Per-owner copies of the Main and Grey materials, so recolouring never touches the shared originals.
const ownCopies = new WeakMap<THREE.Object3D, Map<THREE.Material, THREE.Material>>();
// Accessory caches: shared by every instance, so rerolling never leaks geometry or materials.
const geoCache = new Map<string, THREE.BufferGeometry>();
const matCache = new Map<string, THREE.Material>();
// Antenna group per robot root, so updateLook can bob it.
const antennas = new WeakMap<THREE.Object3D, THREE.Object3D>();

function geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

function std(hex: string): THREE.MeshStandardMaterial {
  const key = `std:${hex}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: hex, flatShading: true, roughness: 0.75 });
    matCache.set(key, m);
  }
  return m as THREE.MeshStandardMaterial;
}

function mesh(g: THREE.BufferGeometry, m: THREE.Material, pos: number[] = [0, 0, 0], rot: number[] = [0, 0, 0], scale: number[] = [1, 1, 1]) {
  const o = new THREE.Mesh(g, m);
  o.position.fromArray(pos);
  o.rotation.set(rot[0], rot[1], rot[2]);
  o.scale.fromArray(scale);
  return o;
}

/** Finds a bone by name. Meshes can share a bone's name, so only Bone objects count. */
function findBone(root: THREE.Object3D, name: string): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (!found && (o as THREE.Bone).isBone && o.name === name) found = o;
  });
  return found;
}

/** Finds a mesh by its node name (the GLB has a 'Head' mesh as well as a 'Head' bone). */
function findMesh(root: THREE.Object3D, name: string): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  root.traverse((o) => {
    if (!found && (o as THREE.Mesh).isMesh && o.name === name) found = o as THREE.Mesh;
  });
  return found;
}

/** Owner-specific copy of a Main or Grey material, or the original for any other material. */
function recolour(owner: THREE.Object3D, mat: THREE.Material, look: Look): THREE.Material {
  const source: THREE.Material = mat.userData.lookSource ?? mat;
  const hex = source.name === 'Main' ? look.body : source.name === 'Grey' ? look.trim : null;
  if (!hex) return mat;
  let copies = ownCopies.get(owner);
  if (!copies) {
    copies = new Map();
    ownCopies.set(owner, copies);
  }
  let own = copies.get(source);
  if (!own) {
    own = source.clone();
    own.userData.lookSource = source;
    copies.set(source, own);
  }
  (own as THREE.MeshStandardMaterial).color.set(hex);
  return own;
}

/**
 * A wrapper on `bone` in which 1 unit is 1 metre, upright and aligned with the character root.
 * The bone's world scale (the armature carries a large internal scale) and rotation are cancelled,
 * so children can be placed in metres in the root's frame. Call while the pose is at rest.
 */
function metricWrapper(root: THREE.Object3D, bone: THREE.Object3D): THREE.Group {
  const boneScale = bone.getWorldScale(new THREE.Vector3());
  const boneQuat = bone.getWorldQuaternion(new THREE.Quaternion());
  const rootQuat = root.getWorldQuaternion(new THREE.Quaternion());
  const wrap = new THREE.Group();
  wrap.scale.setScalar(1 / ((boneScale.x + boneScale.y + boneScale.z) / 3));
  wrap.quaternion.copy(boneQuat.invert().multiply(rootQuat));
  bone.add(wrap);
  return wrap;
}

/** Converts a world point to the frame of `bone`'s metric wrapper: metres, relative to the bone origin, in the root's orientation. */
function toMetric(root: THREE.Object3D, bone: THREE.Object3D, world: THREE.Vector3): THREE.Vector3 {
  const origin = bone.getWorldPosition(new THREE.Vector3());
  const rootInv = root.getWorldQuaternion(new THREE.Quaternion()).invert();
  return world.clone().sub(origin).applyQuaternion(rootInv);
}

/**
 * Adds `obj` under a metric wrapper at local position `at` (metres) and tags the wrapper so the next
 * applyLook removes it. Returns the wrapper.
 */
function accessory(wrap: THREE.Object3D, obj: THREE.Object3D, at: THREE.Vector3): THREE.Object3D {
  obj.position.copy(at);
  obj.scale.setScalar(ACCESSORY_SCALE);
  wrap.add(obj);
  wrap.userData.lookAccessory = true;
  wrap.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  return wrap;
}

/** Radius of the head in metres, from the 'Head' mesh's horizontal bounds, scaled by the head bone. */
function headRadius(root: THREE.Object3D, head: THREE.Object3D, headScale: number): number {
  const headMesh = findMesh(root, 'Head');
  if (!headMesh) return 0.15;
  const box = new THREE.Box3().setFromObject(headMesh);
  const lo = toMetric(root, head, box.min);
  const hi = toMetric(root, head, box.max);
  return (Math.max(Math.abs(hi.x - lo.x), Math.abs(hi.z - lo.z)) / 2) * headScale;
}

/** Top of the head in the head wrapper's metric frame. Uses the 'Head' mesh's bounds, scaled by the head bone. */
function headTop(root: THREE.Object3D, head: THREE.Object3D, headScale: number): THREE.Vector3 {
  const headMesh = findMesh(root, 'Head');
  if (!headMesh) return new THREE.Vector3(0, 0.5, 0);
  const box = new THREE.Box3().setFromObject(headMesh);
  const c = box.getCenter(new THREE.Vector3());
  const top = toMetric(root, head, new THREE.Vector3(c.x, box.max.y, c.z));
  top.y *= headScale;
  return top;
}

// Accessory builders. Each returns a group whose origin is the accessory's anchor point. Sizes are metres.

function sproutAccessory(): THREE.Object3D {
  const g = new THREE.Group();
  const stem = geo('sprout-stem', () => new THREE.CylinderGeometry(0.015, 0.02, 0.25, 6));
  const leaf = geo('sprout-leaf', () => new THREE.SphereGeometry(1, 8, 5));
  g.add(mesh(stem, std('#4f9a3a'), [0, 0.125, 0]));
  g.add(mesh(leaf, std('#6fc24b'), [0.08, 0.27, 0], [0, 0, 0.4], [0.1, 0.02, 0.05]));
  g.add(mesh(leaf, std('#6fc24b'), [-0.08, 0.27, 0], [0, 0, -0.4], [0.1, 0.02, 0.05]));
  return g;
}

function antennaAccessory(): THREE.Object3D {
  const g = new THREE.Group();
  const rod = geo('antenna-rod', () => new THREE.CylinderGeometry(0.012, 0.012, 0.35, 5));
  const ball = geo('antenna-ball', () => new THREE.SphereGeometry(0.07, 8, 6));
  g.add(mesh(rod, std('#2d323c'), [0, 0.175, 0]));
  g.add(mesh(ball, ANTENNA_ACCENT, [0, 0.42, 0]));
  return g;
}

function captainAccessory(): THREE.Object3D {
  const g = new THREE.Group();
  const crown = geo('cap-crown', () => new THREE.CylinderGeometry(0.21, 0.22, 0.14, 10));
  const visor = geo('cap-visor', () => new THREE.CircleGeometry(0.12, 10, 0, Math.PI));
  const badge = geo('cap-badge', () => new THREE.SphereGeometry(0.03, 6, 4));
  g.add(mesh(crown, std('#f4f4f0'), [0, 0.07, 0]));
  // Half-disc visor, lying flat and pointing forward (+Z is the character's front).
  const v = mesh(visor, std('#2b2f36'), [0, 0.01, 0.2], [Math.PI / 2, 0, 0]);
  (v.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  g.add(v);
  g.add(mesh(badge, std('#e8b93a'), [0, 0.08, 0.215]));
  return g;
}

function neckerchief(): THREE.Object3D {
  const g = new THREE.Group();
  const ring = geo('neckerchief-ring', () => new THREE.TorusGeometry(0.15, 0.03, 6, 12));
  const tail = geo('neckerchief-tail', () => new THREE.ConeGeometry(0.04, 0.12, 5));
  g.add(mesh(ring, std('#d8423b'), [0, 0, 0], [Math.PI / 2, 0, 0]));
  g.add(mesh(tail, std('#d8423b'), [0, -0.09, 0.15], [Math.PI, 0, 0]));
  return g;
}

/** Straw hat. The brim is a flat disc reaching 1.5 head radii out, so it clearly sticks out past the head. */
function explorerHat(headRadius: number): THREE.Object3D {
  const g = new THREE.Group();
  const straw = '#e0c06a';
  const brimR = (headRadius * 1.5) / ACCESSORY_SCALE;
  const brim = geo(`hat-brim-${brimR.toFixed(3)}`, () => new THREE.CylinderGeometry(brimR, brimR, 0.06, 16));
  g.add(mesh(brim, std(straw), [0, 0, 0]));
  g.add(mesh(geo('hat-crown', () => new THREE.CylinderGeometry(0.22, 0.25, 0.12, 12)), std(straw), [0, 0.09, 0]));
  g.add(mesh(geo('hat-band', () => new THREE.CylinderGeometry(0.255, 0.255, 0.03, 12)), std('#4a3420'), [0, 0.045, 0]));
  return g;
}

function explorerPack(look: Look): THREE.Object3D {
  const g = new THREE.Group();
  const body = geo('pack-body', () => new RoundedBoxGeometry(0.35, 0.4, 0.18, 3, 0.04));
  const flap = geo('pack-flap', () => new RoundedBoxGeometry(0.37, 0.14, 0.04, 2, 0.015));
  const strap = geo('pack-strap', () => new THREE.BoxGeometry(0.03, 0.36, 0.04));
  g.add(mesh(body, std(look.trim)));
  g.add(mesh(flap, std('#7a5230'), [0, 0.12, -0.105]));
  g.add(mesh(strap, std('#7a5230'), [0.2, 0, 0]));
  g.add(mesh(strap, std('#7a5230'), [-0.2, 0, 0]));
  return g;
}

/**
 * Makes `root` wear `look`. Works on any robot instance (the model, or a clone for another player):
 * per-instance material copies, colours, bone scales, whole-model scale with the feet kept on the
 * ground, and the type's accessories. Call it before any pose code measures the bones, or re-measure after.
 */
export function applyLook(root: THREE.Object3D, look: Look): void {
  const type = TYPES[look.type];

  // Remove the accessories from the previous look.
  const old: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o.userData.lookAccessory) old.push(o);
  });
  for (const o of old) o.removeFromParent();
  antennas.delete(root);

  // Colours on per-instance copies of Main and Grey.
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.material = Array.isArray(m.material)
      ? m.material.map((x) => recolour(root, x, look))
      : recolour(root, m.material, look);
  });

  // Uniform bone scale on the head. Bones start at scale 1, so the value is set absolutely.
  const head = findBone(root, 'Head');
  head?.scale.setScalar(type.headScale);

  // Whole-model scale about the model's base scale. The base is stored on userData, so clones keep it.
  const base = (root.userData.lookBase ??= { scale: root.scale.toArray(), y: root.position.y }) as {
    scale: number[];
    y: number;
  };
  root.scale.fromArray(base.scale).multiplyScalar(type.scale);
  root.position.y = base.y;
  const box = new THREE.Box3().setFromObject(root);
  const parentY = root.parent ? root.parent.getWorldPosition(new THREE.Vector3()).y : 0;
  root.position.y = base.y - (box.min.y - parentY);

  // Accessories, placed in metres from the bones and meshes at rest.
  root.updateWorldMatrix(true, true);
  const added: THREE.Object3D[] = [];
  const add = (wrap: THREE.Object3D | null) => {
    if (wrap) added.push(wrap);
  };
  if (head) {
    switch (look.type) {
      case 1: {
        const w = metricWrapper(root, head);
        add(accessory(w, sproutAccessory(), headTop(root, head, type.headScale)));
        break;
      }
      case 2: {
        const w = metricWrapper(root, head);
        const group = antennaAccessory();
        add(accessory(w, group, headTop(root, head, type.headScale)));
        antennas.set(root, group);
        break;
      }
      case 3: {
        const w = metricWrapper(root, head);
        add(accessory(w, captainAccessory(), headTop(root, head, type.headScale).add(new THREE.Vector3(0, -0.03, 0))));
        const neck = findBone(root, 'Neck');
        if (neck) {
          // Neck bone origin is the neck joint, just above the shoulders.
          const nw = metricWrapper(root, neck);
          add(accessory(nw, neckerchief(), new THREE.Vector3(0, -0.07, 0)));
        }
        break;
      }
      case 4: {
        const w = metricWrapper(root, head);
        const hat = explorerHat(headRadius(root, head, type.headScale));
        add(accessory(w, hat, headTop(root, head, type.headScale).add(new THREE.Vector3(0, -0.03, 0))));
        const torso = findBone(root, 'Torso');
        const torsoMesh = findMesh(root, 'Torso');
        if (torso && torsoMesh) {
          // Behind the torso: centred on its height, just outside its back face.
          const tb = new THREE.Box3().setFromObject(torsoMesh);
          const centre = toMetric(root, torso, tb.getCenter(new THREE.Vector3()));
          const backZ = toMetric(root, torso, new THREE.Vector3(0, 0, tb.min.z)).z;
          const tw = metricWrapper(root, torso);
          // The pack is 0.18 m deep and scaled about its centre, so its centre sits half its scaled depth behind the back.
          add(accessory(tw, explorerPack(look), new THREE.Vector3(0, centre.y, backZ - 0.09 * ACCESSORY_SCALE)));
        }
        break;
      }
      default:
        break;
    }
  }

  if (import.meta.env.DEV) {
    // Dev check: accessories should be metre-sized and near the head, not tens of metres away.
    const rootY = root.getWorldPosition(new THREE.Vector3()).y;
    for (const a of added) {
      const b = new THREE.Box3().setFromObject(a);
      const size = b.getSize(new THREE.Vector3());
      const c = b.getCenter(new THREE.Vector3());
      if (Math.max(size.x, size.y, size.z) > 1.5 || c.y - rootY > 2.5) {
        console.warn(
          `Robot accessory out of range: size ${size.toArray().map((v) => v.toFixed(2)).join(' x ')} m, ` +
            `centre ${(c.y - rootY).toFixed(2)} m above root (look ${look.name})`,
        );
      }
    }
  }
}

/** Gentle sway of the antenna and bob of its glowing ball. Call once per frame; `t` is seconds. */
export function bobAntenna(root: THREE.Object3D, t: number): void {
  const antenna = antennas.get(root);
  if (!antenna) return;
  antenna.rotation.z = Math.sin(t * 2.2) * 0.07;
  const ball = antenna.children[1];
  if (ball) ball.position.y = 0.42 + Math.sin(t * 4) * 0.01;
}
