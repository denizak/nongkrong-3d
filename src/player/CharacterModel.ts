import * as THREE from 'three/webgpu';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { applyLook, bobAntenna, loadLook, type Look } from './Look';

const MODEL_URL = `${import.meta.env.BASE_URL}models/character.glb`;
const TARGET_HEIGHT = 1.8;
const FADE = 0.25;
const POSE_FADE = 0.3;
const LIE_FADE = 0.4;
/** Playback speed of idle while sitting, so the ground sit breathes slowly. */
const SIT_TIME_SCALE = 0.6;
/** Playback speed of idle while lying face down, so it breathes slowly. */
const PRONE_TIME_SCALE = 0.35;
/**
 * Sign of the torso lean about the character's right axis. With right = forward × up,
 * a positive angle tips the top of the body backward, so +1 leans back.
 */
const SIT_LEAN_SIGN = 1;

/**
 * Relaxed ground-sit tuning. Read every frame, so it can be changed live from the console
 * (window.game.sit). Angles in degrees, lengths in metres.
 */
export const SIT = {
  /** Hips bone height above the ground while seated. */
  hipHeight: 0.12,
  /** Upper body lean back, degrees. */
  leanBackDeg: 15,
  /** Knee lift above the horizontal thigh, degrees. */
  kneeBendDeg: 20,
  /** Lateral spread of the knees and feet, metres. */
  legSpread: 0.12,
  /** Height of the feet above the ground. */
  footY: 0.05,
  /** Elbow: behind the shoulder, below it, and out to the side. */
  elbowBack: 0.12,
  elbowOut: 0.16,
  elbowDown: 0.12,
  /** Palm target: behind the hips, out to the side, height above the ground. */
  handBack: 0.28,
  handOut: 0.24,
  handY: 0.09,
};

/**
 * Belly-down pose tuning. Read every frame, so it can be changed live from the console
 * (window.game.prone). Angles in degrees, lengths in metres.
 */
export const PRONE = {
  /** Whole-body tip from standing. 90 lies flat; less props the chest up. */
  tipDeg: 55,
  /** Neck pitch. Negative turns the face forward. */
  headPitchDeg: 75,
  /** Extra lift added to the computed height that puts the belly on the ground. */
  liftExtra: -0.65,
  /** Elbow target: forward from the shoulder, inward toward the centre line, height above ground. */
  elbowFwd: 0.28,
  elbowIn: 0.1,
  elbowY: 0.06,
  /** Chin target: in front of the head, below it, spread sideways so the hands sit side by side. */
  chinFwd: 0.14,
  chinDown: 0.31,
  chinSide: 0.07,
  /** Lazy leg kick: lower legs raised this far from straight back, swinging by kickAmpDeg. */
  kickBaseDeg: 70,
  kickAmpDeg: 15,
  kickSpeed: 2,
};

const rad = (deg: number) => (deg * Math.PI) / 180;

export type Pose = 'stand' | 'sit' | 'lie';

/**
 * Rest measurements taken once from the local robot, per unit of model scale: where the feet sit
 * (scene y offset) and the pivot-space bounds. Both scale linearly with the model's scale, so a clone with any
 * look can use them without re-measuring its own (skinned) vertices.
 */
export interface RestProfile {
  feetPerScale: number;
  unitBounds: THREE.Box3;
}

/** How a clone is set up: the normalisation factor and the rest profile from the local robot. */
interface CloneSetup {
  scale: number;
  rest: RestProfile;
}

const _boundsPoint = new THREE.Vector3();

/**
 * Calls fn with the world position of every visible mesh vertex, at rest (current bones; skinned meshes use
 * their rest pose). Call with fresh world matrices. Used instead of Box3.setFromObject, which is wrong on clones.
 */
function forEachVertex(root: THREE.Object3D, fn: (x: number, y: number, z: number) => void) {
  const v = new THREE.Vector3();
  root.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isMesh || !mesh.visible) return;
    // Skinned vertices read the bone matrices, which only update on render. A fresh clone has never rendered.
    if (mesh.isSkinnedMesh) mesh.skeleton.update();
    const pos = mesh.geometry.attributes.position;
    const e = mesh.matrixWorld.elements;
    for (let i = 0; i < pos.count; i++) {
      if (mesh.isSkinnedMesh) mesh.getVertexPosition(i, v);
      else v.fromBufferAttribute(pos, i);
      fn(e[0] * v.x + e[4] * v.y + e[8] * v.z + e[12], e[1] * v.x + e[5] * v.y + e[9] * v.z + e[13], e[2] * v.x + e[6] * v.y + e[10] * v.z + e[14]);
    }
  });
}

/**
 * Skinned clone of a model with its own material instances. Geometry and textures stay shared with the
 * source, so a clone's dispose() can only free what it owns and never touches the local player.
 */
function cloneModel(source: THREE.Group): THREE.Group {
  const copy = cloneSkinned(source) as THREE.Group;
  copy.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => m.clone()) : mesh.material.clone();
  });
  return copy;
}
type Clip = 'idle' | 'walk' | 'run';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _fwd = new THREE.Vector3();
const _left = new THREE.Vector3();
const _right = new THREE.Vector3();

/** Finds a bone by its dot-less name (GLTFLoader strips dots), falling back to the dotted name. */
function findBone(scene: THREE.Object3D, base: string, side = ''): THREE.Object3D | null {
  const names = side ? [`${base}${side}`, `${base}.${side}`] : [base];
  for (const n of names) {
    const o = scene.getObjectByName(n);
    if (o) return o;
  }
  return null;
}

/** Rotate `bone` so the direction bone→child points toward `target` (world), blended by w. */
function aimBone(bone: THREE.Object3D, child: THREE.Object3D, target: THREE.Vector3, w: number) {
  bone.updateWorldMatrix(true, false);
  child.updateWorldMatrix(false, false);
  const from = _a.setFromMatrixPosition(child.matrixWorld).sub(_b.setFromMatrixPosition(bone.matrixWorld)).normalize();
  const to = target.clone().sub(_b).normalize();
  const delta = _q.setFromUnitVectors(from, to);
  bone.parent!.getWorldQuaternion(_pq);
  // local' = parentWorld^-1 * delta * parentWorld * local
  const local = _pq.clone().invert().multiply(delta).multiply(_pq).multiply(bone.quaternion);
  bone.quaternion.slerp(local, w);
  bone.updateWorldMatrix(false, true);
}

/**
 * Like aimBone, but for a bone with no child to aim at: points its local `axis` (e.g. +Y,
 * the Blender bone direction) at `target` (world), blended by w.
 */
function aimAxis(bone: THREE.Object3D, axis: THREE.Vector3, target: THREE.Vector3, w: number) {
  bone.updateWorldMatrix(true, false);
  const from = axis.clone().applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion())).normalize();
  const origin = new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld);
  const to = target.clone().sub(origin).normalize();
  const delta = new THREE.Quaternion().setFromUnitVectors(from, to);
  bone.parent!.getWorldQuaternion(_pq);
  const local = _pq.clone().invert().multiply(delta).multiply(_pq).multiply(bone.quaternion);
  bone.quaternion.slerp(local, w);
  bone.updateWorldMatrix(false, true);
}

/** Rotate a bone around a world axis by angle, blended by w. */
function rotateWorld(bone: THREE.Object3D, axis: THREE.Vector3, angle: number, w: number) {
  bone.parent!.getWorldQuaternion(_pq);
  const delta = new THREE.Quaternion().setFromAxisAngle(axis, angle * w);
  bone.quaternion.premultiply(_pq.clone().invert().multiply(delta).multiply(_pq));
  bone.updateWorldMatrix(false, true);
}

interface Limb {
  upper: THREE.Object3D;
  lower: THREE.Object3D;
  palm: THREE.Object3D;
  /** +1 for the character's left side, -1 for the right. */
  side: number;
}

interface ProneRig {
  neck: THREE.Object3D;
  head: THREE.Object3D;
  arms: Limb[];
  legs: { lower: THREE.Object3D; phase: number }[];
  /** Every bone the prone pose writes to. */
  bones: THREE.Object3D[];
}

interface SitRig {
  hips: THREE.Object3D;
  abdomen: THREE.Object3D;
  arms: Limb[];
  /** Thigh and shin lengths measured in the bind pose. */
  legs: { upper: THREE.Object3D; lower: THREE.Object3D; side: number; thigh: number; shin: number }[];
  /** Height of the Hips bone above the feet in the bind pose, in model space. */
  hipsBindY: number;
  /** Every bone the sit pose rotates. */
  bones: THREE.Object3D[];
}

/** Optional glTF character with idle/walk/run clips, crossfaded by speed, plus sit and prone poses. */
export class CharacterModel {
  readonly root = new THREE.Group();
  /** Pivot at the feet. The prone tip rotates here so the model falls forward onto its front. */
  private tip = new THREE.Group();
  private mixer: THREE.AnimationMixer;
  private actions: Partial<Record<Clip, THREE.AnimationAction>> = {};
  private current: THREE.AnimationAction | null = null;
  private pose: Pose = 'stand';
  /** Blend weight of the sit pose, 0 standing to 1 seated. */
  private sitAmt = 0;
  /** Blend weight of the prone pose, 0 standing to 1 lying. */
  private lieAmt = 0;
  /** Model bounds in pivot space (feet at the origin), taken before any tip. */
  private bounds = new THREE.Box3();
  private prone: ProneRig | null = null;
  private sit: SitRig | null = null;
  /** Bind quaternions of the posed bones, and the ones the Idle clip doesn't drive. */
  private restQuat = new Map<THREE.Object3D, THREE.Quaternion>();
  private freeBones: THREE.Object3D[] = [];
  private poseDirty = false;
  private time = 0;
  private scene: THREE.Object3D;
  /** The look currently applied to this model. */
  private _look: Look;
  /** Bind pose of every bone, so setLook can re-measure from rest. */
  private bindPose: { bone: THREE.Object3D; position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 }[] = [];
  private lookTime = 0;
  /** Normalisation factor to TARGET_HEIGHT, before the look's type scale. */
  readonly baseScale: number;

  /** Untouched copy of the loaded model, cloned for remote players. Set by load(). */
  private static template: { scene: THREE.Group; animations: THREE.AnimationClip[]; setup: CloneSetup } | null = null;
  /** Rest measurements. Local robots take them from their own vertices; clones copy them from the local robot. */
  private restProfile: RestProfile | null = null;

  /**
   * `clone` is set for remote clones: the local robot's normalisation factor and rest profile. Clones never
   * measure their own skinned vertices, which read as the wrong height before their first render.
   */
  private constructor(gltf: Pick<GLTF, 'scene' | 'animations'>, look?: Look, clone?: CloneSetup) {
    this.scene = gltf.scene;
    this.root.add(this.tip);
    this.tip.add(gltf.scene);
    gltf.scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });

    // Scale to the target height, then apply the saved look. applyLook stands the feet on y = 0,
    // since its whole-model scale can change the height.
    if (clone) {
      gltf.scene.scale.setScalar(clone.scale);
      this.restProfile = clone.rest;
    } else {
      const size = new THREE.Box3().setFromObject(gltf.scene);
      gltf.scene.scale.setScalar(TARGET_HEIGHT / Math.max(1e-3, size.max.y - size.min.y));
    }
    // The base factor, before applyLook's per-type scale. Clones start from this.
    this.baseScale = gltf.scene.scale.x;
    gltf.scene.traverse((o) => {
      if ((o as THREE.Bone).isBone) {
        this.bindPose.push({ bone: o, position: o.position.clone(), quaternion: o.quaternion.clone(), scale: o.scale.clone() });
      }
    });
    this._look = look ?? loadLook();
    applyLook(gltf.scene, this._look);
    this.settleFeet();

    // Measure the bind pose before any animation touches the bones.
    this.measure();
    if (!this.restProfile) this.restProfile = this.measureRest();

    this.mixer = new THREE.AnimationMixer(gltf.scene);
    // Pick each state's clip by name, independent of the order in the file.
    const pick = (exact: RegExp, loose: RegExp) => {
      const clips = gltf.animations.filter((c) => !/jump/i.test(c.name));
      const clip = clips.find((c) => exact.test(c.name)) ?? clips.find((c) => loose.test(c.name));
      return clip ? this.mixer.clipAction(clip) : undefined;
    };
    this.actions.idle = pick(/^idle$/i, /idle/i);
    this.actions.walk = pick(/^walk(ing)?$/i, /walk/i);
    this.actions.run = pick(/^run(ning)?$/i, /run/i);

    // Idle drives some quaternion tracks. The mixer resets those each frame; the rest must be reset by hand.
    const driven = new Set(
      (this.actions.idle?.getClip().tracks ?? [])
        .filter((t) => t.name.endsWith('.quaternion'))
        .map((t) => t.name.slice(0, -'.quaternion'.length)),
    );
    const posed = new Set([...(this.prone?.bones ?? []), ...(this.sit?.bones ?? [])]);
    for (const bone of posed) {
      this.restQuat.set(bone, bone.quaternion.clone());
      if (!driven.has(bone.name)) this.freeBones.push(bone);
    }

    this.current = this.actions.idle ?? null;
    this.current?.play();
  }

  /**
   * Puts the lowest rest-pose vertex on the ground (y = 0 in the pivot). Measured in world space from the
   * vertices, so it is right for clones too. Box3 gave a 1.15 m error on clones.
   */
  private settleFeet() {
    if (this.restProfile) {
      this.scene.position.y = this.restProfile.feetPerScale * this.scene.scale.x;
      this.scene.updateWorldMatrix(true, true);
      return;
    }
    this.scene.position.y = 0;
    this.scene.updateWorldMatrix(true, true);
    const tipY = this.tip.matrixWorld.elements[13];
    let low = Infinity;
    forEachVertex(this.scene, (_x, y) => {
      if (y < low) low = y;
    });
    this.scene.position.y = -(low - tipY);
    this.scene.updateWorldMatrix(true, true);
  }

  /** Measures the bind pose: pivot-space bounds, and the prone and sit bones and lengths. Tip must be identity. */
  private measure() {
    if (this.restProfile) {
      const s = this.scene.scale.x;
      this.bounds.min.copy(this.restProfile.unitBounds.min).multiplyScalar(s);
      this.bounds.max.copy(this.restProfile.unitBounds.max).multiplyScalar(s);
    } else {
      this.bounds.makeEmpty();
      forEachVertex(this.scene, (x, y, z) => this.bounds.expandByPoint(_boundsPoint.set(x, y, z)));
    }
    this.prone = this.findProneRig(this.scene);
    this.sit = this.findSitRig(this.scene);
  }

  /** Rest measurements of this model, shared with clones. */
  get rest(): RestProfile {
    return this.restProfile!;
  }

  /** Measures the rest profile of a local robot, in units of its current scale. */
  private measureRest(): RestProfile {
    const s = this.scene.scale.x;
    return {
      feetPerScale: this.scene.position.y / s,
      unitBounds: new THREE.Box3(this.bounds.min.clone().divideScalar(s), this.bounds.max.clone().divideScalar(s)),
    };
  }

  /** The look currently worn by this model. */
  get look(): Look {
    return this._look;
  }

  /**
   * Changes the look: re-applies it and re-measures the bind pose, so sit and prone stay correct
   * at the new scale. Safe at any time; the next frame blends the poses back in.
   */
  setLook(look: Look) {
    this._look = look;
    // Measure from rest: undo the tip (prone tip and lift) and the bone poses from the last frame.
    const tipRot = this.tip.rotation.x;
    const tipY = this.tip.position.y;
    this.tip.rotation.x = 0;
    this.tip.position.y = 0;
    for (const p of this.bindPose) {
      p.bone.position.copy(p.position);
      p.bone.quaternion.copy(p.quaternion);
      p.bone.scale.copy(p.scale);
    }
    applyLook(this.scene, look);
    this.settleFeet();
    this.measure();
    this.tip.rotation.x = tipRot;
    this.tip.position.y = tipY;
  }

  /** Per-frame look effects, such as the antenna bob. Called from update(). */
  private updateLook(dt: number) {
    this.lookTime += dt;
    bobAntenna(this.scene, this.lookTime);
  }

  /** Finds the bones used by the prone pose; null if the model lacks any of them. */
  private findProneRig(scene: THREE.Object3D): ProneRig | null {
    const missing: string[] = [];
    const get = (base: string, side = '') => {
      const o = findBone(scene, base, side);
      if (!o) missing.push(`${base}${side}`);
      return o;
    };
    const neck = get('Neck');
    const head = get('Head');
    const armL = { upper: get('UpperArm', 'L'), lower: get('LowerArm', 'L'), palm: get('Palm2', 'L') };
    const armR = { upper: get('UpperArm', 'R'), lower: get('LowerArm', 'R'), palm: get('Palm2', 'R') };
    const legL = get('LowerLeg', 'L');
    const legR = get('LowerLeg', 'R');
    if (missing.length > 0) {
      console.warn('Prone pose: missing bones, arms/legs will not be posed:', missing.join(', '));
      return null;
    }
    const n = neck!;
    const h = head!;
    const armLimbs = [
      { upper: armL.upper!, lower: armL.lower!, palm: armL.palm!, side: 1 },
      { upper: armR.upper!, lower: armR.lower!, palm: armR.palm!, side: -1 },
    ];
    const bones = [
      n,
      armL.upper!, armL.lower!, armL.palm!,
      armR.upper!, armR.lower!, armR.palm!,
      legL!, legR!,
    ];
    return {
      bones,
      neck: n,
      head: h,
      arms: armLimbs,
      legs: [
        { lower: legL!, phase: 0 },
        { lower: legR!, phase: Math.PI },
      ],
    };
  }

  /**
   * Finds the bones used by the ground sit and measures the bind pose: hips height, and
   * thigh and shin lengths. Returns null if the model lacks any of them.
   */
  private findSitRig(scene: THREE.Object3D): SitRig | null {
    const hips = findBone(scene, 'Hips');
    const abdomen = findBone(scene, 'Abdomen');
    const arms: Limb[] = [];
    const legs: { upper: THREE.Object3D; lower: THREE.Object3D; foot: THREE.Object3D | null; side: number }[] = [];
    let complete = !!hips && !!abdomen;
    for (const [s, side] of [['L', 1], ['R', -1]] as const) {
      const upper = findBone(scene, 'UpperArm', s);
      const lower = findBone(scene, 'LowerArm', s);
      const palm = findBone(scene, 'Palm2', s);
      if (upper && lower && palm) arms.push({ upper, lower, palm, side });
      else complete = false;
      const thigh = findBone(scene, 'UpperLeg', s);
      const shin = findBone(scene, 'LowerLeg', s);
      if (thigh && shin) legs.push({ upper: thigh, lower: shin, foot: findBone(scene, 'Foot', s), side });
      else complete = false;
    }
    if (!complete || !hips || !abdomen) {
      console.warn('Sit pose: missing bones, sitting will only switch to the idle clip.');
      return null;
    }

    scene.updateWorldMatrix(true, true);
    const at = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
    const hipsBindY = at(hips).y;
    const legsMeasured = legs.map((l) => {
      const thigh = at(l.upper).distanceTo(at(l.lower));
      const measured = l.foot ? at(l.lower).distanceTo(at(l.foot)) : 0;
      // Foot bones are IK targets; fall back to a proportion of the thigh if the bind pose has no usable distance.
      return { upper: l.upper, lower: l.lower, side: l.side, thigh, shin: measured > 1e-4 ? measured : 0.9 * thigh };
    });
    return {
      hips,
      abdomen,
      arms,
      legs: legsMeasured,
      hipsBindY,
      bones: [
        abdomen,
        ...arms.flatMap((a) => [a.upper, a.lower]),
        ...legsMeasured.flatMap((l) => [l.upper, l.lower]),
      ],
    };
  }

  /**
   * Loads the model if models/character.glb exists (under BASE_URL). Vite's dev server answers
   * missing files with index.html, so the content type is checked too.
   * Returns null when there is no model and the primitive body should be used.
   */
  /** `onDone` runs once the attempt finishes, whether or not the model loaded. */
  static async load(onDone?: () => void): Promise<CharacterModel | null> {
    try {
      const head = await fetch(MODEL_URL, { method: 'HEAD' });
      const type = head.headers.get('content-type') ?? '';
      if (!head.ok || type.includes('text/html')) return null;
      const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
      // The constructor rescales and reparents the scene, so keep a pristine copy for remote clones.
      const template = { scene: cloneModel(gltf.scene), animations: gltf.animations, setup: { scale: 1, rest: null as unknown as RestProfile } };
      const model = new CharacterModel(gltf);
      template.setup = { scale: model.baseScale, rest: model.rest };
      CharacterModel.template = template;
      return model;
    } catch (err) {
      console.warn('Character model not loaded, using placeholder body.', err);
      return null;
    } finally {
      onDone?.();
    }
  }

  /**
   * A new robot wearing `look`, for another player: a skinned clone of the loaded model with its own
   * mixer and poses. Returns null when the model did not load (the caller uses a placeholder).
   */
  static cloneFor(look: Look): CharacterModel | null {
    const t = CharacterModel.template;
    if (!t) return null;
    return new CharacterModel({ scene: cloneModel(t.scene), animations: t.animations }, look, t.setup);
  }

  /**
   * Stops the mixer and frees this instance's materials. Geometry is shared with the template, so it stays.
   * Only for clones made by cloneFor; the local player's model is never disposed.
   */
  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.scene);
    this.root.removeFromParent();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.dispose();
    });
  }

  /** Switches pose: sit or lie down on the idle clip (slowed), or stand up. */
  setPose(p: Pose) {
    this.pose = p;
    const idle = this.actions.idle;
    if (idle) idle.timeScale = p === 'lie' ? PRONE_TIME_SCALE : p === 'sit' ? SIT_TIME_SCALE : 1;
    if (p === 'stand') return;
    if (idle) this.crossTo(idle, p === 'lie' ? LIE_FADE : POSE_FADE);
  }

  /** Picks the clip from the player's speed (m/s) and crossfades to it. groundY is the terrain under the character. */
  update(dt: number, speed: number, groundY: number) {
    this.time += dt;
    this.updateLook(dt);
    this.mixer.update(dt);

    // Sit and lie never overlap: each one waits until the other has faded out.
    const sitWant = this.pose === 'sit' && this.lieAmt < 0.01 ? 1 : 0;
    const lieWant = this.pose === 'lie' && this.sitAmt < 0.01 ? 1 : 0;
    this.sitAmt = THREE.MathUtils.damp(this.sitAmt, sitWant, 10, dt);
    this.lieAmt = THREE.MathUtils.damp(this.lieAmt, lieWant, 10, dt);

    // Seated, the Hips bone sits at SIT.hipHeight above the ground. The bind-pose hips height gives the offset.
    this.root.position.y = this.sitAmt * (SIT.hipHeight - (this.sit?.hipsBindY ?? 0));

    // Tipping by θ maps (y, z) to y' = y·cosθ − z·sinθ. Lift the lowest corner onto the ground.
    const tipRad = rad(PRONE.tipDeg);
    const b = this.bounds;
    let lowest = Infinity;
    for (const y of [b.min.y, b.max.y]) {
      for (const z of [b.min.z, b.max.z]) lowest = Math.min(lowest, y * Math.cos(tipRad) - z * Math.sin(tipRad));
    }
    const lift = Math.max(0, -lowest) + PRONE.liftExtra;
    this.tip.rotation.x = tipRad * this.lieAmt;
    this.tip.position.y = lift * this.lieAmt;

    if (this.sitAmt > 0.001 || this.lieAmt > 0.001) {
      // Undriven bones would compound their aim every frame, so start each frame from rest.
      this.resetFreeBones();
      this.updateBasis();
      this.aimSit(groundY);
      this.aimProne(groundY);
      this.poseDirty = true;
    } else if (this.poseDirty) {
      this.resetFreeBones();
      this.poseDirty = false;
    }
    if (this.pose !== 'stand') return;

    const want: Clip = speed < 0.3 ? 'idle' : speed < 5.5 ? 'walk' : 'run';
    const next = this.actions[want] ?? this.actions.idle;
    if (next) this.crossTo(next, FADE);
  }

  /** Copies the rest quaternion back into posed bones that the Idle clip doesn't drive. */
  private resetFreeBones() {
    for (const bone of this.freeBones) bone.quaternion.copy(this.restQuat.get(bone)!);
  }

  /** Sets the character's horizontal forward, left and right directions in world space from the root's facing. */
  private updateBasis() {
    this.root.updateWorldMatrix(true, false);
    this.root.getWorldDirection(_fwd);
    _fwd.y = 0;
    _fwd.normalize();
    _left.crossVectors(_up, _fwd).normalize(); // character's left
    _right.crossVectors(_fwd, _up).normalize(); // character's right
  }

  /** Poses the torso, arms and legs for sitting on the ground, blended by sitAmt. */
  private aimSit(groundY: number) {
    const rig = this.sit;
    if (!rig) return;
    const w = this.sitAmt;

    // Lean the upper body back. Rotating Abdomen moves everything above it.
    rotateWorld(rig.abdomen, _right, rad(SIT_LEAN_SIGN * SIT.leanBackDeg), w);

    const hips = rig.hips.getWorldPosition(new THREE.Vector3());
    const bend = rad(SIT.kneeBendDeg);
    for (const leg of rig.legs) {
      // The model's left (side +1) lies along -right, so the sign along right is -side.
      const sideR = -leg.side;
      const hip = leg.upper.getWorldPosition(new THREE.Vector3());
      const knee = hip
        .addScaledVector(_fwd, leg.thigh * Math.cos(bend))
        .addScaledVector(_up, leg.thigh * Math.sin(bend))
        .addScaledVector(_right, (sideR * SIT.legSpread) / 2);
      aimBone(leg.upper, leg.lower, knee, w);

      // The lower leg has no child to aim at, so its local +Y (the bone direction) points at the foot.
      const foot = leg.lower.getWorldPosition(new THREE.Vector3()).addScaledVector(_fwd, leg.shin);
      foot.y = groundY + SIT.footY;
      foot.addScaledVector(_right, (sideR * SIT.legSpread) / 2);
      aimAxis(leg.lower, _up, foot, w);
    }

    for (const arm of rig.arms) {
      const sideR = -arm.side;
      const shoulder = arm.upper.getWorldPosition(new THREE.Vector3());
      const elbow = shoulder
        .addScaledVector(_fwd, -SIT.elbowBack)
        .addScaledVector(_up, -SIT.elbowDown)
        .addScaledVector(_right, sideR * SIT.elbowOut);
      const palm = hips.clone().addScaledVector(_fwd, -SIT.handBack).addScaledVector(_right, sideR * SIT.handOut);
      palm.y = groundY + SIT.handY;
      aimBone(arm.upper, arm.lower, elbow, w);
      aimBone(arm.lower, arm.palm, palm, w);
    }
  }

  /** Poses arms, head and legs in world space on top of the animation, blended by lieAmt. */
  private aimProne(groundY: number) {
    const rig = this.prone;
    if (!rig) return;
    const w = this.lieAmt;

    rotateWorld(rig.neck, _right, rad(PRONE.headPitchDeg), w);

    const head = rig.head.getWorldPosition(new THREE.Vector3());
    for (const arm of rig.arms) {
      const shoulder = arm.upper.getWorldPosition(new THREE.Vector3());
      const elbow = shoulder
        .addScaledVector(_fwd, PRONE.elbowFwd)
        .addScaledVector(_left, -arm.side * PRONE.elbowIn);
      elbow.y = groundY + PRONE.elbowY;
      const chin = head
        .clone()
        .addScaledVector(_fwd, PRONE.chinFwd)
        .addScaledVector(_up, -PRONE.chinDown)
        .addScaledVector(_left, arm.side * PRONE.chinSide);
      aimBone(arm.upper, arm.lower, elbow, w);
      aimBone(arm.lower, arm.palm, chin, w);
    }

    for (const leg of rig.legs) {
      // Negative pitch swings the lower leg up and back.
      const kick = -(rad(PRONE.kickBaseDeg) + Math.sin(this.time * PRONE.kickSpeed + leg.phase) * rad(PRONE.kickAmpDeg));
      rotateWorld(leg.lower, _right, kick, w);
    }
  }

  private crossTo(next: THREE.AnimationAction, fade: number) {
    if (next === this.current) return;
    this.current?.fadeOut(fade);
    next.reset().fadeIn(fade).play();
    this.current = next;
  }
}
