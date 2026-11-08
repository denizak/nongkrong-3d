import * as THREE from 'three/webgpu';
import { WATER_LEVEL, type Terrain } from './Terrain';
import { isTyping } from './DayNight';

const STREAKS = 1500;
/** Side of the square box of rain around the camera, in metres. */
const BOX = 30;
const RAIN_HEIGHT = 14;
const FALL_SPEED = 14;
const WIND = { x: 1.6, z: 0.7 };
const FADE_SECONDS = 20;
const RIPPLES = 28;
const RIPPLE_RATE = 7;
const RIPPLE_REACH = 14;
const ROLL_EVERY: [number, number] = [4, 8];
const ROLL_CHANCE = 0.3;
const STORM_HOURS: [number, number] = [1, 3];

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const wrap = (v: number, m: number) => ((v % m) + m) % m;

interface Ripple {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  age: number;
  life: number;
  active: boolean;
}

/**
 * Random rain. Every 4 to 8 game hours there is a 30% chance of a storm lasting 1 to 3 game hours.
 * The rainAmount fades over about 20 s. setRain() forces it on or off for testing.
 */
export class Weather {
  /** 0 dry, 1 full rain. Fades in and out over about 20 s. */
  rainAmount = 0;
  private target = false;
  /** Game hours of rain left; Infinity when forced on by setRain(true). */
  private hoursLeft = 0;
  private untilRoll = rand(ROLL_EVERY[0], ROLL_EVERY[1]);

  private streaks: THREE.InstancedMesh;
  private streakOff = new Float32Array(STREAKS * 3);
  private ripples: Ripple[] = [];
  private rippleAcc = 0;

  constructor(
    scene: THREE.Scene,
    private terrain: Terrain,
  ) {
    // Streak orientation is the same for every drop, so build it once and only move the translation.
    const fall = new THREE.Vector3(WIND.x, -FALL_SPEED, WIND.z).normalize();
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), fall);
    const template = new THREE.Matrix4().compose(new THREE.Vector3(), quat, new THREE.Vector3(1, 1, 1));

    const geo = new THREE.BoxGeometry(0.012, 0.5, 0.012);
    const mat = new THREE.MeshBasicMaterial({ color: '#c8d6e4', transparent: true, opacity: 0.25, depthWrite: false });
    this.streaks = new THREE.InstancedMesh(geo, mat, STREAKS);
    this.streaks.frustumCulled = false;
    this.streaks.visible = false;
    const arr = this.streaks.instanceMatrix.array as Float32Array;
    for (let i = 0; i < STREAKS; i++) {
      arr.set(template.elements, i * 16);
      this.streakOff[i * 3] = rand(0, BOX);
      this.streakOff[i * 3 + 1] = rand(0, RAIN_HEIGHT);
      this.streakOff[i * 3 + 2] = rand(0, BOX);
    }
    scene.add(this.streaks);

    const ringGeo = new THREE.RingGeometry(0.8, 1, 28).rotateX(-Math.PI / 2);
    for (let i = 0; i < RIPPLES; i++) {
      const rmat = new THREE.MeshBasicMaterial({ color: '#e8fbff', transparent: true, opacity: 0, depthWrite: false });
      const mesh = new THREE.Mesh(ringGeo, rmat);
      mesh.visible = false;
      scene.add(mesh);
      this.ripples.push({ mesh, mat: rmat, age: 0, life: 1, active: false });
    }

    window.addEventListener('keydown', (e) => {
      if (e.code !== 'KeyR' || e.repeat || isTyping()) return;
      this.setRain(!this.target);
    });
  }

  /** Hides every ripple, e.g. after the island changes. */
  clearRipples() {
    this.ripples.forEach((p) => this.hideRipple(p));
  }

  /** True while a storm is on (the fade may still be in progress). */
  get raining(): boolean {
    return this.target;
  }

  /** Forces rain on (until switched off) or off. Automatic rolls resume once it is off. */
  setRain(on: boolean) {
    this.target = on;
    this.hoursLeft = on ? Infinity : 0;
  }

  /** Per-frame update. `hours` is the game time that passed this frame (DayNight.hoursThisFrame). */
  update(dt: number, focus: THREE.Vector3, hours: number) {
    this.updateSchedule(hours);

    const step = dt / FADE_SECONDS;
    const goal = this.target ? 1 : 0;
    this.rainAmount = goal > this.rainAmount
      ? Math.min(goal, this.rainAmount + step)
      : Math.max(goal, this.rainAmount - step);

    const r = this.rainAmount;
    if (r < 0.01) {
      this.streaks.visible = false;
      this.ripples.forEach((p) => this.hideRipple(p));
      return;
    }
    this.streaks.visible = true;
    (this.streaks.material as THREE.MeshBasicMaterial).opacity = 0.25 * r;
    this.moveStreaks(dt, focus, r);
    this.updateRipples(dt, focus, r);
  }

  private updateSchedule(hours: number) {
    if (!this.target) {
      this.untilRoll -= hours;
      if (this.untilRoll <= 0) {
        this.untilRoll = rand(ROLL_EVERY[0], ROLL_EVERY[1]);
        if (Math.random() < ROLL_CHANCE) {
          this.target = true;
          this.hoursLeft = rand(STORM_HOURS[0], STORM_HOURS[1]);
        }
      }
    } else if (this.hoursLeft !== Infinity) {
      this.hoursLeft -= hours;
      if (this.hoursLeft <= 0) this.target = false;
    }
  }

  /** Recycles drops inside a box around the camera. Only the translation column changes per frame. */
  private moveStreaks(dt: number, focus: THREE.Vector3, r: number) {
    const arr = this.streaks.instanceMatrix.array as Float32Array;
    const off = this.streakOff;
    const cx = focus.x;
    const cz = focus.z;
    const baseY = focus.y - 2;
    const dx = WIND.x * dt;
    const dz = WIND.z * dt;
    // Heavier rain falls a little faster.
    const fall = FALL_SPEED * dt * (0.8 + 0.4 * r);
    for (let i = 0; i < STREAKS; i++) {
      const j = i * 3;
      const ox = off[j] + dx;
      let oy = off[j + 1] - fall;
      const oz = off[j + 2] + dz;
      if (oy < 0) oy += RAIN_HEIGHT;
      off[j] = ox;
      off[j + 1] = oy;
      off[j + 2] = oz;
      const b = i * 16;
      arr[b + 12] = cx + wrap(ox - cx + BOX / 2, BOX) - BOX / 2;
      arr[b + 13] = baseY + oy;
      arr[b + 14] = cz + wrap(oz - cz + BOX / 2, BOX) - BOX / 2;
    }
    this.streaks.instanceMatrix.needsUpdate = true;
  }

  /** Ripples on water near the player (pond and sea, where the ground is below the water line). */
  private updateRipples(dt: number, focus: THREE.Vector3, r: number) {
    this.rippleAcc += dt * RIPPLE_RATE * r;
    while (this.rippleAcc >= 1) {
      this.rippleAcc -= 1;
      this.spawnRipple(focus);
    }
    for (const p of this.ripples) {
      if (!p.active) continue;
      p.age += dt;
      if (p.age >= p.life) {
        this.hideRipple(p);
        continue;
      }
      const k = p.age / p.life;
      p.mesh.scale.setScalar(0.2 + 1.6 * (1 - (1 - k) * (1 - k)));
      p.mat.opacity = 0.5 * (1 - k) * r;
    }
  }

  private spawnRipple(focus: THREE.Vector3) {
    const slot = this.ripples.find((p) => !p.active);
    if (!slot) return;
    for (let tries = 0; tries < 5; tries++) {
      const a = rand(0, Math.PI * 2);
      const d = rand(2, RIPPLE_REACH);
      const x = focus.x + Math.cos(a) * d;
      const z = focus.z + Math.sin(a) * d;
      if (this.terrain.heightAt(x, z) >= WATER_LEVEL - 0.2) continue;
      slot.active = true;
      slot.age = 0;
      slot.life = rand(0.8, 1.3);
      slot.mesh.position.set(x, WATER_LEVEL + 0.08, z);
      slot.mesh.visible = true;
      return;
    }
  }

  private hideRipple(p: Ripple) {
    p.active = false;
    p.mesh.visible = false;
    p.mat.opacity = 0;
  }
}
