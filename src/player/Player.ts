import * as THREE from 'three/webgpu';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Ground } from '../world/Terrain';
import type { Physics } from '../core/Physics';
import type { CharacterModel, Pose } from './CharacterModel';

const WALK_SPEED = 4;
const RUN_SPEED = 7.5;
const GRAVITY = 9.81;
/** The player can wade into shallow water but not deeper than this. */
const MIN_GROUND = -0.45;
/** Capsule: 0.5 half-height of the cylinder part plus a 0.35 radius, so 1.7 m tall. */
const CAPSULE_HALF = 0.5;
const CAPSULE_RADIUS = 0.35;
/** Distance from the capsule centre down to the feet. */
const FOOT_OFFSET = CAPSULE_HALF + CAPSULE_RADIUS;
/** Placeholder body only: how far it drops when sitting, and how far it lifts when lying down. */
const SIT_DROP = 0.4;
const LIE_LIFT = 0.35;

/**
 * The character: a kinematic capsule moved by Rapier's character controller,
 * with a glTF model if one is available or a primitive placeholder body.
 */
export class Player {
  readonly object = new THREE.Group();
  readonly position = this.object.position;
  readonly collider: RAPIER.Collider;
  private rigid: RAPIER.RigidBody;
  private controller: RAPIER.KinematicCharacterController;
  private body = new THREE.Group();
  private heading = 0;
  private bobPhase = 0;
  private speed = 0;
  private vy = 0;
  private _pose: Pose = 'stand';
  private sitAmt = 0;
  private lieAmt = 0;
  /** Scales walking and running speed, e.g. 0.75 in mud. */
  speedMultiplier = 1;

  constructor(
    private terrain: Ground,
    physics: Physics,
    private model: CharacterModel | null,
    /** True on the live island's bridges (local coordinates). */
    private onBridge: (x: number, z: number) => boolean = () => false,
  ) {
    if (model) {
      this.body.add(model.root);
    } else {
      this.buildPlaceholder();
    }
    this.object.add(this.body);

    const start = terrain.heightAt(0, 0);
    this.position.set(0, start, 0);
    const { world, RAPIER } = physics;
    this.rigid = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, start + FOOT_OFFSET, 0),
    );
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(CAPSULE_HALF, CAPSULE_RADIUS),
      this.rigid,
    );

    this.controller = world.createCharacterController(0.05);
    this.controller.enableAutostep(0.4, 0.2, false);
    this.controller.enableSnapToGround(0.5);
    this.controller.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
  }

  private buildPlaceholder() {
    const skin = new THREE.MeshStandardMaterial({ color: '#f2b07e', flatShading: true });
    const shirt = new THREE.MeshStandardMaterial({ color: '#ef6f5e', flatShading: true });
    const dark = new THREE.MeshStandardMaterial({ color: '#3a2f2a' });

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 0.55, 4, 10), shirt);
    torso.position.y = 0.66;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.36, 14, 10), skin);
    head.position.y = 1.48;
    const eyeGeo = new THREE.SphereGeometry(0.05, 8, 6);
    const eyeL = new THREE.Mesh(eyeGeo, dark);
    eyeL.position.set(-0.13, 1.52, 0.32);
    const eyeR = eyeL.clone();
    eyeR.position.x = 0.13;
    const hat = new THREE.Mesh(
      new THREE.ConeGeometry(0.62, 0.32, 12),
      new THREE.MeshStandardMaterial({ color: '#e3c26f', flatShading: true }),
    );
    hat.position.y = 1.86;

    this.body.add(torso, head, eyeL, eyeR, hat);
    this.body.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
  }

  /**
   * Computes this frame's movement and queues it on the kinematic body.
   * Call physics.step() afterwards, then sync().
   */
  update(
    dt: number,
    move: { x: number; y: number },
    running: boolean,
    basis: { forward: THREE.Vector3; right: THREE.Vector3 },
  ) {
    // Any movement input stands a sitting or lying character back up.
    if (this._pose !== 'stand' && Math.hypot(move.x, move.y) > 0.01) this.setPose('stand');
    const posed = this._pose !== 'stand';

    const dir = new THREE.Vector3()
      .addScaledVector(basis.forward, move.y)
      .addScaledVector(basis.right, move.x);
    const amount = posed ? 0 : Math.min(1, dir.length());
    const target = amount * (running ? RUN_SPEED : WALK_SPEED) * this.speedMultiplier;
    this.speed = THREE.MathUtils.damp(this.speed, target, 12, dt);

    let dx = 0;
    let dz = 0;
    if (amount > 0.01) {
      dir.normalize();
      // Rotate toward the movement direction along the shortest arc.
      const want = Math.atan2(dir.x, dir.z);
      let diff = want - this.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.heading += diff * (1 - Math.exp(-dt * 14));

      dx = dir.x * this.speed * dt;
      dz = dir.z * this.speed * dt;
    }

    // Water and world-edge rule, checked per axis so the player slides along shorelines.
    const x = this.position.x;
    const z = this.position.z;
    if (!this.canMoveTo(x, z, x + dx, z)) dx = 0;
    if (!this.canMoveTo(x + dx, z, x + dx, z + dz)) dz = 0;

    // Gravity: keep a small downward push while grounded so snap-to-ground works.
    this.vy = this.controller.computedGrounded() ? -1 : this.vy - GRAVITY * dt;

    this.controller.computeColliderMovement(this.collider, { x: dx, y: this.vy * dt, z: dz });
    const m = this.controller.computedMovement();
    const t = this.rigid.translation();
    this.rigid.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });

    this.object.rotation.y = this.heading;
    // On a bridge the ground is the deck, not the water below it, so use the body's own height.
    const groundY = this.onBridge(this.position.x, this.position.z)
      ? this.position.y
      : this.terrain.heightAt(this.position.x, this.position.z);
    this.model?.update(dt, this.speed, groundY);

    // Pose blend for the placeholder body; the glTF model handles its own pose.
    this.sitAmt = THREE.MathUtils.damp(this.sitAmt, this._pose === 'sit' ? 1 : 0, 8, dt);
    this.lieAmt = THREE.MathUtils.damp(this.lieAmt, this._pose === 'lie' ? 1 : 0, 8, dt);
    const lie = this.model ? 0 : this.lieAmt;

    // Little hop while moving so it doesn't feel like a sliding pawn.
    this.bobPhase += dt * this.speed * 2.2;
    const moving = Math.min(1, this.speed / WALK_SPEED);
    const hop = Math.abs(Math.sin(this.bobPhase)) * 0.12 * moving;
    const tilt = 0.08 * moving * (this.speed / RUN_SPEED);
    this.body.position.y = hop + (this.model ? 0 : -SIT_DROP * this.sitAmt + LIE_LIFT * lie);
    this.body.rotation.x = tilt * (1 - lie) - (Math.PI / 2) * lie;
  }

  /** Current horizontal speed in m/s, as used for the walk and run clips. */
  get currentSpeed() {
    return this.speed;
  }

  /** Heading in radians, as saved and restored. */
  get headingAngle() {
    return this.heading;
  }

  /** Teleports the character to (x, z) on the ground, facing heading. Used when restoring a save. */
  place(x: number, z: number, heading: number) {
    // On a bridge, start a little above the water and let gravity settle the body onto the deck.
    const ground = this.terrain.heightAt(x, z);
    const y = this.onBridge(x, z) ? Math.max(0, ground) + 2 : ground;
    this.heading = heading;
    this.object.rotation.y = heading;
    this.position.set(x, y, z);
    this.rigid.setTranslation({ x, y: y + FOOT_OFFSET, z }, true);
    this.vy = 0;
  }

  get pose(): Pose {
    return this._pose;
  }

  setPose(p: Pose) {
    if (p === this._pose) return;
    this._pose = p;
    this.model?.setPose(p);
  }

  /** Moves the body by an island shift, keeping its pose and heading. */
  shiftBy(dx: number, dz: number) {
    const t = this.rigid.translation();
    this.rigid.setTranslation({ x: t.x + dx, y: t.y, z: t.z + dz }, true);
    this.position.x += dx;
    this.position.z += dz;
  }

  /** Sit or lie down, or stand up if already in that pose. */
  togglePose(p: 'sit' | 'lie') {
    this.setPose(this._pose === p ? 'stand' : p);
  }

  /** Horizontal unit vector the character faces. */
  getFacing(): THREE.Vector3 {
    return new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
  }

  /** Copies the physics result back to the visual position (feet at the ground). */
  sync() {
    const t = this.rigid.translation();
    this.position.set(t.x, t.y - FOOT_OFFSET, t.z);
  }

  /** True if a spot (local coordinates) is land, shallow water or a bridge. */
  isWalkable(x: number, z: number): boolean {
    return !this.blocked(x, z);
  }

  /** A player already in deep water can move uphill rather than being trapped by the shoreline rule. */
  private canMoveTo(x: number, z: number, nextX: number, nextZ: number): boolean {
    if (!this.blocked(nextX, nextZ)) return true;
    return this.blocked(x, z) && this.terrain.heightAt(nextX, nextZ) >= this.terrain.heightAt(x, z) - 0.001;
  }

  private blocked(x: number, z: number) {
    return this.terrain.heightAt(x, z) < MIN_GROUND && !this.onBridge(x, z);
  }
}
