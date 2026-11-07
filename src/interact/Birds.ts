import * as THREE from 'three/webgpu';
import { ZONES } from '../world/Terrain';

const TAU = Math.PI * 2;
const MAX_BIRDS = 6;
const FLEE_RANGE = 4;
const SKY_RADIUS = 60;
const LEAVE_RANGE = 40;
const BODY_Y = 0.12;

type BirdState = 'move' | 'perch' | 'flee';

interface Bird {
  root: THREE.Group;
  body: THREE.Mesh;
  head: THREE.Group;
  wingL: THREE.Group;
  wingR: THREE.Group;
  state: BirdState;
  /** Seconds in the current state. */
  t: number;
  dur: number;
  from: THREE.Vector3;
  ctrl: THREE.Vector3;
  to: THREE.Vector3;
  yaw: number;
  targetYaw: number;
  turnAt: number;
  hopAt: number;
  stayLeft: number;
  vel: THREE.Vector3;
  phase: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Small flocks of low-poly birds that land in the paddy, peck, and flee when scared. */
export class Birds {
  private birds: Bird[] = [];
  private nextFlock = 20 + Math.random() * 20;
  private centre = new THREE.Vector3(ZONES.paddy.x, ZONES.paddy.h, ZONES.paddy.z);
  private bodyGeo = new THREE.SphereGeometry(0.1, 8, 6);
  private headGeo = new THREE.SphereGeometry(0.065, 8, 6);
  private beakGeo = new THREE.ConeGeometry(0.025, 0.07, 4).rotateX(Math.PI / 2);
  private wingGeo = new THREE.BufferGeometry();
  private bodyMat = new THREE.MeshStandardMaterial({ color: '#4a4540', flatShading: true });
  private headMat = new THREE.MeshStandardMaterial({ color: '#3b3632', flatShading: true });
  private beakMat = new THREE.MeshStandardMaterial({ color: '#d9a441', flatShading: true });
  private wingMat = new THREE.MeshStandardMaterial({ color: '#6b5e52', flatShading: true, side: THREE.DoubleSide });

  constructor(private scene: THREE.Scene) {
    this.wingGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0.07, -0.24, 0, 0.01, -0.02, 0, -0.1], 3),
    );
    this.wingGeo.computeVertexNormals();
  }

  /** Birds currently alive. */
  get count() {
    return this.birds.length;
  }

  /** Brings in a flock of 3–6 (capped at MAX_BIRDS alive). Returns how many spawned. */
  spawnFlock(): number {
    const n = Math.min(MAX_BIRDS - this.birds.length, 3 + Math.floor(Math.random() * 4));
    if (n <= 0) return 0;
    const a0 = Math.random() * TAU;
    for (let k = 0; k < n; k++) {
      const a = a0 + (Math.random() - 0.5) * 0.6;
      const from = new THREE.Vector3(
        this.centre.x + Math.cos(a) * SKY_RADIUS,
        20 + Math.random() * 4,
        this.centre.z + Math.sin(a) * SKY_RADIUS,
      );
      const bird = this.make(from);
      this.scene.add(bird.root);
      this.birds.push(bird);
      this.start(bird, this.spot(), 4 + Math.random() * 1.5, 12);
    }
    return n;
  }

  /** Every bird not already fleeing takes off in a random outward direction. */
  scareAll() {
    for (const b of this.birds) {
      if (b.state !== 'flee') this.takeOff(b, this.outward(b.root.position));
    }
  }

  update(dt: number, player: THREE.Vector3) {
    this.nextFlock -= dt;
    if (this.nextFlock <= 0) {
      this.spawnFlock();
      this.nextFlock = 20 + Math.random() * 20;
    }

    // Walking within reach of any bird scares the whole flock.
    for (const b of this.birds) {
      if (b.state !== 'flee' && Math.hypot(b.root.position.x - player.x, b.root.position.z - player.z) < FLEE_RANGE) {
        this.scareAll();
        break;
      }
    }

    for (let k = this.birds.length - 1; k >= 0; k--) {
      const b = this.birds[k];
      b.t += dt;
      if (b.state === 'move') this.moveBird(b, dt);
      else if (b.state === 'perch') this.perchBird(b, dt);
      else if (this.fleeBird(b, dt)) {
        this.scene.remove(b.root);
        this.birds.splice(k, 1);
      }
    }
  }

  private make(at: THREE.Vector3): Bird {
    const root = new THREE.Group();
    root.position.copy(at);
    const body = new THREE.Mesh(this.bodyGeo, this.bodyMat);
    body.position.y = BODY_Y;
    body.scale.set(1, 0.9, 1.5);
    const head = new THREE.Group();
    head.position.set(0, BODY_Y + 0.05, 0.13);
    const skull = new THREE.Mesh(this.headGeo, this.headMat);
    skull.position.z = 0.02;
    const beak = new THREE.Mesh(this.beakGeo, this.beakMat);
    beak.position.set(0, -0.01, 0.1);
    head.add(skull, beak);
    const wingL = new THREE.Group();
    wingL.position.set(-0.06, BODY_Y + 0.04, 0);
    wingL.add(new THREE.Mesh(this.wingGeo, this.wingMat));
    const wingR = new THREE.Group();
    wingR.position.set(0.06, BODY_Y + 0.04, 0);
    const rightWing = new THREE.Mesh(this.wingGeo, this.wingMat);
    rightWing.rotation.y = Math.PI;
    wingR.add(rightWing);
    root.add(body, head, wingL, wingR);
    const yaw = Math.random() * TAU;
    root.rotation.y = yaw;
    return {
      root, body, head, wingL, wingR,
      state: 'perch', t: 0, dur: 1,
      from: new THREE.Vector3(), ctrl: new THREE.Vector3(), to: new THREE.Vector3(),
      yaw, targetYaw: yaw, turnAt: 0, hopAt: 0, stayLeft: 0,
      vel: new THREE.Vector3(), phase: Math.random() * TAU,
    };
  }

  /** Random landing spot in the paddy, or a short hop from `near`. */
  private spot(near?: THREE.Vector3) {
    const { paddy } = ZONES;
    const hw = paddy.w / 2 - 1.5;
    const hd = paddy.d / 2 - 1.5;
    let x: number;
    let z: number;
    if (near) {
      x = near.x + (Math.random() - 0.5) * 2.5;
      z = near.z + (Math.random() - 0.5) * 2.5;
    } else {
      x = paddy.x + (Math.random() * 2 - 1) * hw;
      z = paddy.z + (Math.random() * 2 - 1) * hd;
    }
    return new THREE.Vector3(clamp(x, paddy.x - hw, paddy.x + hw), paddy.h + 0.1, clamp(z, paddy.z - hd, paddy.z + hd));
  }

  /** Starts a curved move (quadratic bezier) from the bird's position to `to`. */
  private start(b: Bird, to: THREE.Vector3, dur: number, arc: number) {
    b.from.copy(b.root.position);
    b.to.copy(to);
    b.ctrl.lerpVectors(b.from, to, 0.5);
    b.ctrl.y += arc;
    b.ctrl.x += (Math.random() - 0.5) * arc;
    b.ctrl.z += (Math.random() - 0.5) * arc;
    b.dur = dur;
    b.t = 0;
    b.state = 'move';
  }

  private moveBird(b: Bird, dt: number) {
    const u = Math.min(1, b.t / b.dur);
    const e = u * u * (3 - 2 * u);
    const it = 1 - e;
    const { from, ctrl, to } = b;
    b.root.position.set(
      it * it * from.x + 2 * it * e * ctrl.x + e * e * to.x,
      it * it * from.y + 2 * it * e * ctrl.y + e * e * to.y,
      it * it * from.z + 2 * it * e * ctrl.z + e * e * to.z,
    );
    // The curve's tangent gives the heading.
    const tx = 2 * it * (ctrl.x - from.x) + 2 * e * (to.x - ctrl.x);
    const tz = 2 * it * (ctrl.z - from.z) + 2 * e * (to.z - ctrl.z);
    this.face(b, Math.atan2(tx, tz), dt);
    this.flap(b, 0.7, 16, dt);
    b.head.rotation.x = 0.1;
    b.body.position.y = BODY_Y;
    if (u >= 1) {
      b.state = 'perch';
      b.stayLeft = 25 + Math.random() * 20;
      b.turnAt = 1 + Math.random() * 2;
      b.hopAt = 3 + Math.random() * 4;
    }
  }

  private perchBird(b: Bird, dt: number) {
    b.stayLeft -= dt;
    if (b.stayLeft <= 0) {
      this.takeOff(b, this.outward(b.root.position));
      return;
    }
    b.turnAt -= dt;
    if (b.turnAt <= 0) {
      b.targetYaw = Math.random() * TAU;
      b.turnAt = 1.5 + Math.random() * 2.5;
    }
    this.face(b, b.targetYaw, dt);
    b.hopAt -= dt;
    if (b.hopAt <= 0) {
      this.start(b, this.spot(b.root.position), 0.5, 0.4);
      b.hopAt = 3 + Math.random() * 4;
      return;
    }
    // Pecking: the head dips in bursts and the body bobs with it.
    const peck = Math.max(0, Math.sin(b.t * 6 + b.phase)) ** 3;
    b.head.rotation.x = peck * 0.9;
    b.body.position.y = BODY_Y - peck * 0.03;
    this.flap(b, 0.05, 1.5, dt);
  }

  /** Returns true once the bird is far enough away to be removed. */
  private fleeBird(b: Bird, dt: number) {
    b.vel.y += 1.5 * dt;
    b.root.position.addScaledVector(b.vel, dt);
    this.face(b, Math.atan2(b.vel.x, b.vel.z), dt);
    this.flap(b, 1, 22, dt);
    b.head.rotation.x = 0;
    b.body.position.y = BODY_Y;
    const far = Math.hypot(b.root.position.x - this.centre.x, b.root.position.z - this.centre.z) > LEAVE_RANGE;
    return far || b.t > 20;
  }

  private takeOff(b: Bird, dir: THREE.Vector3) {
    b.state = 'flee';
    b.t = 0;
    b.vel.set(dir.x * 9, 5, dir.z * 9);
  }

  /** Random horizontal direction pointing away from the paddy centre. */
  private outward(p: THREE.Vector3) {
    const a = Math.atan2(p.x - this.centre.x, p.z - this.centre.z) + (Math.random() - 0.5) * 1;
    return new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
  }

  private face(b: Bird, target: number, dt: number) {
    const d = Math.atan2(Math.sin(target - b.yaw), Math.cos(target - b.yaw));
    b.yaw += d * (1 - Math.exp(-dt * 8));
    b.root.rotation.y = b.yaw;
  }

  /** Wings flap symmetrically; the amplitude is in radians. */
  private flap(b: Bird, amp: number, rate: number, dt: number) {
    b.phase += dt * rate;
    const s = Math.sin(b.phase) * amp;
    b.wingL.rotation.z = -s;
    b.wingR.rotation.z = s;
  }
}
