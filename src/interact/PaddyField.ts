import * as THREE from 'three/webgpu';
import { ZONES, mulberry32, type Terrain } from '../world/Terrain';
import type { NatureAssets } from '../world/Assets';
import type { Player } from '../player/Player';
import type { Inventory } from '../ui/Inventory';
import type { Interactable } from './Interactable';

const PADDY = ZONES.paddy;
const WATER_Y = PADDY.h + 0.06;
const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);

/** Mud slows the player to this share of normal speed. */
export const MUD_SPEED = 0.75;
const HARVEST_RANGE = 1.8;
const FACING_MIN = -0.2;
const BEND_RANGE = 1.6;
/** Tilt target is BEND_BASE + BEND_EXTRA at the stalk's base, falling off to BEND_BASE at the edge. */
const BEND_BASE = 0.2;
const BEND_EXTRA = 0.4;
const SPRING_K = 90;
const SPRING_C = 11;
const STALK_H = 0.9;
const STUBBLE_H = 0.15;
const REGROW_TIME = 60;
const PUFF_TIME = 0.9;
const RIPE_CHANCE = 0.7;

const YOUNG_COLOR = new THREE.Color('#7fbf4d');
const RIPE_GREEN = new THREE.Color('#b5c25a');
const GOLD = new THREE.Color('#e2c25a');
const STUBBLE_COLOR = new THREE.Color('#9c7a4a');

const YOUNG = 0;
const RIPE = 1;
const STUB = 2;

const PUFF_GEO = new THREE.OctahedronGeometry(0.05);
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qTilt = new THREE.Quaternion();
const _qYaw = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _c = new THREE.Color();

/** True when (x, z) is inside the paddy rectangle. */
export function inPaddy(x: number, z: number) {
  return Math.abs(x - PADDY.x) < PADDY.w / 2 && Math.abs(z - PADDY.z) < PADDY.d / 2;
}

export interface PaddyDeps {
  scene: THREE.Scene;
  terrain: Terrain;
  assets: NatureAssets;
  player: Player;
  inventory: Inventory;
  /** Stalks are kept clear of this point (the scarecrow base). */
  avoid: THREE.Vector3;
}

interface Puff {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  vx: number;
  vy: number;
  vz: number;
  t: number;
}

/**
 * The flooded rice paddy: water, dikes, and a grid of rice stalks. Stalks bend away from
 * the player and spring back, ripe ones can be harvested, and cut ones regrow.
 * Each model part is one InstancedMesh; all parts share the same instance indices.
 */
export class PaddyField implements Interactable {
  readonly position = new THREE.Vector3();
  readonly radius = HARVEST_RANGE;
  private group = new THREE.Group();
  private meshes: THREE.InstancedMesh[] = [];
  private n = 0;
  private bx!: Float32Array;
  private by!: Float32Array;
  private bz!: Float32Array;
  private yaw!: Float32Array;
  /** Stubble height factor, 1 for a full stalk. */
  private hf!: Float32Array;
  private tilt!: Float32Array;
  private vel!: Float32Array;
  /** Horizontal direction the stalk leans toward, away from the player. */
  private dirX!: Float32Array;
  private dirZ!: Float32Array;
  private timer!: Float32Array;
  private ripeMix!: Float32Array;
  private state!: Uint8Array;
  private target = -1;
  private puffs: Puff[] = [];
  private matrixDirty = false;
  private colorDirty = false;

  constructor(private deps: PaddyDeps) {
    deps.scene.add(this.group);
    this.buildWater();

    const rand = mulberry32(99);
    const { x: px, z: pz, w, d } = PADDY;
    const spots: { x: number; y: number; z: number; yaw: number }[] = [];
    for (let x = px - w / 2 + 1; x <= px + w / 2 - 1; x += 0.8) {
      for (let z = pz - d / 2 + 1; z <= pz + d / 2 - 1; z += 0.8) {
        const jx = x + (rand() - 0.5) * 0.2;
        const jz = z + (rand() - 0.5) * 0.2;
        if (Math.hypot(jx - deps.avoid.x, jz - deps.avoid.z) < 1.2) continue;
        spots.push({ x: jx, y: deps.terrain.heightAt(jx, jz), z: jz, yaw: rand() * TAU });
      }
    }

    const n = (this.n = spots.length);
    this.bx = new Float32Array(n);
    this.by = new Float32Array(n);
    this.bz = new Float32Array(n);
    this.yaw = new Float32Array(n);
    this.hf = new Float32Array(n).fill(1);
    this.tilt = new Float32Array(n);
    this.vel = new Float32Array(n);
    this.dirX = new Float32Array(n).fill(1);
    this.dirZ = new Float32Array(n);
    this.timer = new Float32Array(n);
    this.ripeMix = new Float32Array(n);
    this.state = new Uint8Array(n);
    spots.forEach((s, i) => {
      this.bx[i] = s.x;
      this.by[i] = s.y;
      this.bz[i] = s.z;
      this.yaw[i] = s.yaw;
      this.state[i] = rand() < RIPE_CHANCE ? RIPE : YOUNG;
      this.timer[i] = this.state[i] === YOUNG ? rand() * REGROW_TIME : 0;
      this.ripeMix[i] = rand();
    });

    // Tinted by instance colour, so the model's own part colours are replaced with white.
    for (const part of deps.assets.crops_wheatStageB.parts) {
      const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, metalness: 0, flatShading: true });
      const mesh = new THREE.InstancedMesh(part.geometry, mat, n);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.meshes.push(mesh);
    }
    for (let i = 0; i < n; i++) {
      this.write(i);
      this.paint(i);
    }
    this.flush();
  }

  prompt(): string | null {
    return this.target >= 0 ? 'Harvest rice' : null;
  }

  /** Cuts the 4–8 nearest ripe stalks in front of the player. */
  interact() {
    if (this.target < 0) return;
    const { player, inventory } = this.deps;
    const p = player.position;
    const f = player.getFacing();
    const hits: { i: number; d: number }[] = [];
    for (let i = 0; i < this.n; i++) {
      if (this.state[i] !== RIPE) continue;
      const dx = this.bx[i] - p.x;
      const dz = this.bz[i] - p.z;
      const d = Math.hypot(dx, dz);
      if (d > HARVEST_RANGE) continue;
      if (d >= 0.01 && (dx * f.x + dz * f.z) / d <= FACING_MIN) continue;
      hits.push({ i, d });
    }
    hits.sort((a, b) => a.d - b.d);
    const n = Math.min(hits.length, 4 + Math.floor(Math.random() * 5));
    if (n === 0) return;

    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const { i } of hits.slice(0, n)) {
      this.state[i] = STUB;
      this.timer[i] = 0;
      this.hf[i] = STUBBLE_H;
      this.write(i);
      this.paint(i);
      cx += this.bx[i];
      cy += this.by[i];
      cz += this.bz[i];
    }
    this.flush();
    inventory.add('rice', n);
    this.puff(cx / n, cy / n + 0.5, cz / n);
    this.target = -1;
  }

  update(dt: number) {
    const { player } = this.deps;
    const p = player.position;
    const f = player.getFacing();
    let best = -1;
    let bestD = Infinity;

    for (let i = 0; i < this.n; i++) {
      const dx = this.bx[i] - p.x;
      const dz = this.bz[i] - p.z;
      const d = Math.hypot(dx, dz);
      const inFront = d < 0.01 || (dx * f.x + dz * f.z) / d > FACING_MIN;

      // Stalks near the player lean away from it, more the closer they are.
      let target = 0;
      if (d < BEND_RANGE) {
        target = BEND_BASE + BEND_EXTRA * (1 - d / BEND_RANGE);
        if (d > 0.05) {
          this.dirX[i] = dx / d;
          this.dirZ[i] = dz / d;
        } else {
          this.dirX[i] = -f.x;
          this.dirZ[i] = -f.z;
        }
      }

      // Damped spring back to upright once the player leaves.
      const tilt = this.tilt[i];
      const vel = this.vel[i];
      let nv = vel + ((target - tilt) * SPRING_K - vel * SPRING_C) * dt;
      let nt = tilt + nv * dt;
      if (target === 0 && Math.abs(nt) < 1e-3 && Math.abs(nv) < 1e-3) {
        nt = 0;
        nv = 0;
      }
      if (nt !== tilt || nv !== vel) {
        this.tilt[i] = nt;
        this.vel[i] = nv;
        this.write(i);
      }

      if (d <= HARVEST_RANGE && inFront && this.state[i] === RIPE && d < bestD) {
        best = i;
        bestD = d;
      }

      // Growth: stubble grows back to green, then green ripens to gold.
      const s = this.state[i];
      if (s === YOUNG) {
        this.timer[i] += dt;
        if (this.timer[i] >= REGROW_TIME) {
          this.state[i] = RIPE;
          this.timer[i] = 0;
          this.paint(i);
        }
      } else if (s === STUB) {
        this.timer[i] += dt;
        if (this.timer[i] >= REGROW_TIME) {
          this.state[i] = YOUNG;
          this.timer[i] = 0;
          this.hf[i] = 1;
        } else {
          this.hf[i] = STUBBLE_H + ((1 - STUBBLE_H) * this.timer[i]) / REGROW_TIME;
        }
        this.write(i);
        this.paint(i);
      }
    }

    this.target = best;
    if (best >= 0) this.position.set(this.bx[best], this.by[best], this.bz[best]);
    this.updatePuffs(dt);
    this.flush();
  }

  /** Writes stalk i's transform: base position, yaw, a tilt about its base, and the stubble height. */
  private write(i: number) {
    _qYaw.setFromAxisAngle(UP, this.yaw[i]);
    // Tilt axis is UP x dir, so a positive tilt leans the stalk toward dir.
    _axis.set(this.dirZ[i], 0, -this.dirX[i]);
    _qTilt.setFromAxisAngle(_axis, this.tilt[i]);
    _q.copy(_qTilt).multiply(_qYaw);
    _p.set(this.bx[i], this.by[i], this.bz[i]);
    _s.set(STALK_H, STALK_H * this.hf[i], STALK_H);
    _m.compose(_p, _q, _s);
    for (const m of this.meshes) m.setMatrixAt(i, _m);
    this.matrixDirty = true;
  }

  /** Sets stalk i's colour from its state: young green, ripe golden-green, or brown stubble. */
  private paint(i: number) {
    const s = this.state[i];
    if (s === STUB) _c.copy(STUBBLE_COLOR).lerp(YOUNG_COLOR, this.timer[i] / REGROW_TIME);
    else if (s === YOUNG) _c.copy(YOUNG_COLOR);
    else _c.copy(RIPE_GREEN).lerp(GOLD, 0.5 + 0.5 * this.ripeMix[i]);
    for (const m of this.meshes) m.setColorAt(i, _c);
    this.colorDirty = true;
  }

  private flush() {
    for (const m of this.meshes) {
      if (this.matrixDirty) m.instanceMatrix.needsUpdate = true;
      if (this.colorDirty && m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    this.matrixDirty = false;
    this.colorDirty = false;
  }

  /** Small yellow-green puff where stalks were cut. */
  private puff(x: number, y: number, z: number) {
    for (let k = 0; k < 10; k++) {
      const mat = new THREE.MeshBasicMaterial({ color: '#dfe36e', transparent: true, opacity: 0.9 });
      const mesh = new THREE.Mesh(PUFF_GEO, mat);
      mesh.position.set(x + (Math.random() - 0.5) * 0.4, y, z + (Math.random() - 0.5) * 0.4);
      this.group.add(mesh);
      this.puffs.push({
        mesh, mat,
        vx: (Math.random() - 0.5) * 0.8,
        vy: 0.9 + Math.random() * 0.7,
        vz: (Math.random() - 0.5) * 0.8,
        t: 0,
      });
    }
  }

  private updatePuffs(dt: number) {
    for (let k = this.puffs.length - 1; k >= 0; k--) {
      const pf = this.puffs[k];
      pf.t += dt;
      if (pf.t >= PUFF_TIME) {
        this.group.remove(pf.mesh);
        pf.mat.dispose();
        this.puffs.splice(k, 1);
        continue;
      }
      pf.mesh.position.x += pf.vx * dt;
      pf.mesh.position.y += pf.vy * dt;
      pf.mesh.position.z += pf.vz * dt;
      pf.mat.opacity = 0.9 * (1 - pf.t / PUFF_TIME);
    }
  }

  /** Muddy-teal water over the paddy, and low brown-green dikes around it (visual only, no colliders). */
  private buildWater() {
    const { x, z, w, d, h } = PADDY;
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(w - 1, d - 1).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({
        color: '#4f7f78', transparent: true, opacity: 0.72, roughness: 0.3, metalness: 0, flatShading: true,
      }),
    );
    water.position.set(x, WATER_Y, z);
    water.receiveShadow = true;
    this.group.add(water);

    const dikeMat = new THREE.MeshStandardMaterial({ color: '#6b6a3e', roughness: 1, flatShading: true });
    const DH = 0.25;
    const DW = 0.5;
    const y = h + DH / 2;
    const dike = (sx: number, sz: number, cx: number, cz: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, DH, sz), dikeMat);
      mesh.position.set(cx, y, cz);
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
    };
    dike(w, DW, x, z - d / 2 + DW / 2);
    dike(w, DW, x, z + d / 2 - DW / 2);
    dike(DW, d, x - w / 2 + DW / 2, z);
    // The east side faces spawn (origin), so it has a 2 m gap for the path.
    const half = (d - 2) / 2;
    dike(DW, half, x + w / 2 - DW / 2, z - 1 - half / 2);
    dike(DW, half, x + w / 2 - DW / 2, z + 1 + half / 2);
  }
}
