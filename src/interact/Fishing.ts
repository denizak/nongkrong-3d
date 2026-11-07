import * as THREE from 'three/webgpu';
import { WATER_LEVEL } from '../world/Terrain';
import type { Player } from '../player/Player';
import type { Inventory } from '../ui/Inventory';
import type { Fishpedia } from '../ui/Fishpedia';
import { biteWindow, fishItemId, pickSpecies, type Species, type WaterKind } from './FishSpecies';

export type FishState = 'idle' | 'casting' | 'waiting' | 'nibble' | 'bite' | 'caught' | 'escaped' | 'reel';

const ROD_LEN = 1.6;
const CAST_TIME = 0.7;
const REEL_TIME = 0.6;
const RESULT_TIME = 1.2;
const SPLASH_TIME = 0.9;
/** Bobber rest height above the water, and how far the fish shadow sits below it. */
const FLOAT_Y = 0.03;
const SHADOW_DEPTH = 0.12;
/** Rod angle above horizontal: resting, and forward while casting. */
const REST_ANGLE = THREE.MathUtils.degToRad(50);
const CAST_ANGLE = THREE.MathUtils.degToRad(20);
const UP = new THREE.Vector3(0, 1, 0);

const _dir = new THREE.Vector3();
const _hand = new THREE.Vector3();
const _v = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qDir = new THREE.Quaternion();

export interface FishingDeps {
  scene: THREE.Scene;
  camera: THREE.Camera;
  player: Player;
  inventory: Inventory;
  pedia: Fishpedia;
  /** Right-hand bone to hold the rod; null for the placeholder body. */
  hand: THREE.Object3D | null;
}

/** Fishing state machine, plus its visuals: rod, bobber, line, fish shadow, splash rings and the "!" bubble. */
export class Fishing {
  state: FishState = 'idle';
  /** Countdown for the current state (counts up while casting). */
  private timer = 0;
  private resultTotal = REEL_TIME;
  private nibblesLeft = 0;
  private species: Species | null = null;
  private water: WaterKind = 'sea';
  private time = 0;
  private target = new THREE.Vector3();
  private castFrom = new THREE.Vector3();
  private tip = new THREE.Vector3();
  private reelFrom = new THREE.Vector3();
  private dip = 0;
  private tilt = 0;

  // Fish shadow: swims in along a lazy curve, then circles the bobber.
  private swimFrom = new THREE.Vector3();
  private ringStart = new THREE.Vector3();
  private swimSide = 1;
  private swimT = 0;
  private swimDur = 1;
  private circleA = 0;
  private circleR = 0.7;

  private holder: THREE.Object3D;
  private rod = new THREE.Group();
  private bobber = new THREE.Group();
  private line: THREE.Line;
  private shadow: THREE.Mesh;
  private bang: HTMLDivElement;
  private splashGeo = new THREE.RingGeometry(0.08, 0.12, 32).rotateX(-Math.PI / 2);
  private splashes: { mesh: THREE.Mesh; age: number }[] = [];

  constructor(private deps: FishingDeps) {
    const { scene, player, hand } = deps;
    this.holder = hand ?? player.object;

    // Rod: tapered pole with its base at the origin, plus a small reel.
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.03, ROD_LEN, 6).translate(0, ROD_LEN / 2, 0),
      new THREE.MeshStandardMaterial({ color: '#8b5a2b', flatShading: true }),
    );
    const reel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 0.05, 10),
      new THREE.MeshStandardMaterial({ color: '#9aa3a8', flatShading: true }),
    );
    reel.rotation.z = Math.PI / 2;
    reel.position.set(0.03, 0.2, 0);
    this.rod.add(pole, reel);
    this.rod.visible = false;
    this.holder.add(this.rod);

    // Bobber: red top, white bottom.
    const red = new THREE.MeshStandardMaterial({ color: '#e8453c', roughness: 0.4 });
    const white = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.4 });
    this.bobber.add(
      new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), red),
      new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), white),
    );
    this.bobber.visible = false;
    scene.add(this.bobber);

    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: '#f4f4f4' }));
    this.line.frustumCulled = false;
    this.line.visible = false;
    scene.add(this.line);

    // Unit sphere, scaled per fish into a flat ellipse.
    this.shadow = new THREE.Mesh(
      new THREE.SphereGeometry(1, 14, 8),
      new THREE.MeshBasicMaterial({ color: '#12343f', transparent: true, opacity: 0.4, depthWrite: false }),
    );
    this.shadow.visible = false;
    scene.add(this.shadow);

    this.bang = document.createElement('div');
    this.bang.className = 'fish-bang';
    this.bang.textContent = '!';
    document.body.append(this.bang);
  }

  /** True while a cast is in progress; the player is held in place. */
  get active() {
    return this.state !== 'idle';
  }

  /** True while the line is out and a movement or pose change would reel it in. */
  get canCancel() {
    return this.state === 'casting' || this.state === 'waiting' || this.state === 'nibble' || this.state === 'bite';
  }

  /** Label for the interaction prompt while fishing, or null when E does nothing. */
  prompt(): string | null {
    switch (this.state) {
      case 'casting':
      case 'waiting':
      case 'nibble':
        return 'Reel in';
      case 'bite':
        return 'Hook it!';
      default:
        return null;
    }
  }

  cast(target: THREE.Vector3, water: WaterKind) {
    this.target.copy(target);
    this.water = water;
    this.castFrom.copy(this.tip);
    this.bobber.position.copy(this.castFrom);
    this.bobber.visible = true;
    this.line.visible = true;
    this.state = 'casting';
    this.timer = 0;
  }

  /** E while fishing: reel in early, scare off a nibble, or hook a bite. */
  press() {
    switch (this.state) {
      case 'casting':
      case 'waiting':
        this.beginReel('reel', REEL_TIME);
        break;
      case 'nibble':
        this.escape('Too early!');
        break;
      case 'bite':
        this.catch();
        break;
    }
  }

  /** Movement or a pose change reels in, with no penalty. */
  cancel() {
    if (this.canCancel) this.beginReel('reel', REEL_TIME);
  }

  /** Dev helper: skips straight to the bite state. */
  debugForceBite() {
    if (this.canCancel) this.enterBite();
  }

  tick(dt: number) {
    this.time += dt;
    switch (this.state) {
      case 'casting':
        this.timer += dt;
        if (this.timer >= CAST_TIME) this.enterWaiting();
        break;
      case 'waiting':
        this.timer -= dt;
        if (this.timer <= 0) this.enterNibble();
        break;
      case 'nibble':
        this.timer -= dt;
        if (this.timer <= 0) {
          if (this.nibblesLeft > 0) {
            // Fake-out: a small dip, then a pause.
            this.nibblesLeft--;
            this.dip = 0.07;
            this.timer = 0.5 + Math.random() * 0.4;
          } else {
            this.enterBite();
          }
        }
        break;
      case 'bite':
        this.timer -= dt;
        if (this.timer <= 0) this.escape('It got away…');
        break;
      case 'caught':
      case 'escaped':
      case 'reel':
        this.timer -= dt;
        if (this.timer <= 0) this.setIdle();
        break;
    }

    this.updateShadow(dt);
    this.updateBobber(dt);
    this.updateRod(dt);
    this.updateLine();
    this.updateSplashes(dt);
    this.updateBang();
  }

  private enterWaiting() {
    this.state = 'waiting';
    this.timer = 2 + Math.random() * 4;
    this.spawnShadow(this.timer);
  }

  private enterNibble() {
    this.state = 'nibble';
    this.nibblesLeft = 1 + Math.floor(Math.random() * 3);
    this.timer = 0;
  }

  private enterBite() {
    this.species = pickSpecies(this.water);
    this.state = 'bite';
    this.timer = biteWindow(this.species);
    this.dip = 0.3;
    this.spawnSplash();
  }

  private catch() {
    const s = this.species!;
    const cm = Math.round(s.minCm + Math.random() * (s.maxCm - s.minCm));
    const isNew = this.deps.pedia.record(s, cm);
    this.deps.inventory.add(fishItemId(s));
    this.deps.pedia.showCatch(`You caught a ${s.name}! ${cm} cm`, isNew);
    this.beginReel('caught', RESULT_TIME);
  }

  private escape(msg: string) {
    this.deps.inventory.toast(msg);
    this.beginReel('escaped', RESULT_TIME);
  }

  /** Starts the reel-in phase: the bobber flies back to the rod tip, then the state goes idle. */
  private beginReel(state: FishState, duration: number) {
    this.state = state;
    this.timer = duration;
    this.resultTotal = duration;
    this.reelFrom.copy(this.bobber.position);
    this.dip = 0;
    this.shadow.visible = false;
  }

  private setIdle() {
    this.state = 'idle';
    this.species = null;
    this.rod.visible = false;
    this.bobber.visible = false;
    this.line.visible = false;
    this.shadow.visible = false;
  }

  /** Puts a fish shadow 3–4 m away; it swims toward the bobber along a lazy curve. */
  private spawnShadow(waitTotal: number) {
    const b = this.target;
    const a = Math.random() * Math.PI * 2;
    const r = 3 + Math.random();
    this.swimFrom.set(b.x + Math.sin(a) * r, WATER_LEVEL - SHADOW_DEPTH, b.z + Math.cos(a) * r);
    // The point 0.7 m from the bobber on the fish's side, where circling starts.
    const dx = this.swimFrom.x - b.x;
    const dz = this.swimFrom.z - b.z;
    const len = Math.hypot(dx, dz) || 1;
    this.ringStart.set(b.x + (dx / len) * 0.7, WATER_LEVEL - SHADOW_DEPTH, b.z + (dz / len) * 0.7);
    this.swimSide = Math.random() < 0.5 ? -1 : 1;
    this.swimDur = Math.min(2.5, waitTotal * 0.7);
    this.swimT = 0;
    this.circleA = Math.atan2(dz, dx);
    this.circleR = 0.7;
    const len2 = 0.4 + Math.random() * 0.5;
    this.shadow.scale.set(len2 * 0.22, 0.05, len2 / 2);
    this.shadow.position.copy(this.swimFrom);
    this.shadow.visible = true;
  }

  private updateShadow(dt: number) {
    if (!this.shadow.visible) return;
    const b = this.target;
    const p = this.shadow.position;
    let nx: number;
    let nz: number;
    if (this.swimT < this.swimDur) {
      this.swimT += dt;
      const k = Math.min(1, this.swimT / this.swimDur);
      const e = k * k * (3 - 2 * k);
      const rx = this.ringStart.x - this.swimFrom.x;
      const rz = this.ringStart.z - this.swimFrom.z;
      const len = Math.hypot(rx, rz) || 1;
      // Sideways bulge that is zero at both ends, so the path curves.
      const off = Math.sin(k * Math.PI) * this.swimSide * 0.9;
      nx = this.swimFrom.x + rx * e + (-rz / len) * off;
      nz = this.swimFrom.z + rz * e + (rx / len) * off;
    } else {
      // Circle the bobber; tighter during a bite.
      this.circleR = THREE.MathUtils.damp(this.circleR, this.state === 'bite' ? 0.25 : 0.7, 3, dt);
      this.circleA += dt * (this.state === 'bite' ? 2.5 : 0.8);
      nx = b.x + Math.cos(this.circleA) * this.circleR;
      nz = b.z + Math.sin(this.circleA) * this.circleR;
    }
    const dx = nx - p.x;
    const dz = nz - p.z;
    if (Math.abs(dx) + Math.abs(dz) > 1e-5) this.shadow.rotation.y = Math.atan2(dx, dz);
    p.set(nx, WATER_LEVEL - SHADOW_DEPTH, nz);
  }

  private updateBobber(dt: number) {
    this.dip = THREE.MathUtils.damp(this.dip, 0, 7, dt);
    const b = this.bobber.position;
    if (this.state === 'casting') {
      // Arc from the rod tip to the landing spot.
      const k = Math.min(1, this.timer / CAST_TIME);
      b.lerpVectors(this.castFrom, this.target, k);
      b.y += Math.sin(k * Math.PI) * (1.2 + this.castFrom.distanceTo(this.target) * 0.12);
    } else if (this.state === 'caught' || this.state === 'escaped' || this.state === 'reel') {
      const k = THREE.MathUtils.clamp(1 - this.timer / this.resultTotal, 0, 1);
      b.lerpVectors(this.reelFrom, this.tip, k);
    } else if (this.state !== 'idle') {
      // Gentle float, sinking on dips.
      b.set(this.target.x, WATER_LEVEL + FLOAT_Y + Math.sin(this.time * 2.2) * 0.012 - this.dip, this.target.z);
    }
    this.bobber.visible = this.state !== 'idle';
  }

  /** Holds the rod in the hand (or on the placeholder body) with its tip along the cast angle. */
  private updateRod(dt: number) {
    const { player, hand } = this.deps;
    this.rod.visible = this.state !== 'idle';
    this.tilt = THREE.MathUtils.damp(this.tilt, this.state === 'casting' ? 1 : 0, 8, dt);
    let angle = REST_ANGLE + (CAST_ANGLE - REST_ANGLE) * this.tilt;
    if (this.state === 'bite') angle += Math.sin(this.time * 40) * 0.05;

    const f = player.getFacing();
    if (hand) {
      hand.getWorldPosition(_hand);
    } else {
      // Placeholder body: hand height, a little forward and to the right.
      _v.set(f.z, 0, -f.x);
      _hand.copy(player.position).add(_v.set(0, 1, 0)).addScaledVector(f, 0.25).addScaledVector(_v.set(f.z, 0, -f.x), 0.25);
    }
    _dir.copy(f).multiplyScalar(Math.cos(angle)).addScaledVector(UP, Math.sin(angle));

    // The rod is a child of the holder, so convert the world pose into its local space.
    this.holder.getWorldQuaternion(_q);
    this.holder.getWorldScale(_scale);
    this.rod.position.copy(this.holder.worldToLocal(_v.copy(_hand)));
    this.rod.quaternion.copy(_q).invert().multiply(_qDir.setFromUnitVectors(UP, _dir));
    this.rod.scale.setScalar(1 / _scale.x);
    this.tip.copy(_hand).addScaledVector(_dir, ROD_LEN);
  }

  private updateLine() {
    const pos = this.line.geometry.attributes.position as THREE.BufferAttribute;
    const b = this.bobber.position;
    pos.setXYZ(0, this.tip.x, this.tip.y, this.tip.z);
    pos.setXYZ(1, b.x, b.y + 0.05, b.z);
    pos.needsUpdate = true;
    this.line.visible = this.state !== 'idle';
  }

  private spawnSplash() {
    const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false });
    const mesh = new THREE.Mesh(this.splashGeo, mat);
    mesh.position.set(this.bobber.position.x, WATER_LEVEL + 0.02, this.bobber.position.z);
    this.deps.scene.add(mesh);
    this.splashes.push({ mesh, age: 0 });
  }

  /** Expanding, fading rings on the water. */
  private updateSplashes(dt: number) {
    for (let i = this.splashes.length - 1; i >= 0; i--) {
      const s = this.splashes[i];
      s.age += dt;
      const k = s.age / SPLASH_TIME;
      if (k >= 1) {
        this.deps.scene.remove(s.mesh);
        (s.mesh.material as THREE.Material).dispose();
        this.splashes.splice(i, 1);
        continue;
      }
      s.mesh.scale.setScalar(1 + k * 4);
      (s.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k);
    }
  }

  /** "!" bubble above the player's head during a bite. */
  private updateBang() {
    const show = this.state === 'bite';
    this.bang.classList.toggle('show', show);
    if (!show) return;
    _v.copy(this.deps.player.position).add(_dir.set(0, 2.3, 0)).project(this.deps.camera);
    this.bang.style.left = `${(_v.x * 0.5 + 0.5) * window.innerWidth}px`;
    this.bang.style.top = `${(-_v.y * 0.5 + 0.5) * window.innerHeight}px`;
  }
}
