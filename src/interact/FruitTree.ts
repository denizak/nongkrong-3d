import { t } from '../i18n';
import * as THREE from 'three/webgpu';
import type { FruitTree as FruitTreeSite } from '../world/Props';
import type { Interactable, InteractContext } from './Interactable';
import type { Pickups } from './Pickups';
import type { TreeState } from '../world/Archipelago';
import { sfx } from '../audio/AudioManager';

const SHAKE_TIME = 0.8;
/** Fruit lets go this far into the shake. */
const DROP_AT = 0.4;
const MAX_DROP = 3;
const REGROW_TIME = 45;
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

/** A fruit tree: shake it to knock down 1–3 mangoes, which regrow slowly. */
export class FruitTree implements Interactable {
  readonly position: THREE.Vector3;
  readonly radius = 2.2;
  private object: THREE.Object3D;
  private fruit: THREE.InstancedMesh;
  /** Original fruit instance matrices, used to hide and restore them. */
  private rest: THREE.Matrix4[] = [];
  private hanging: boolean[] = [];
  private shakeT = -1;
  private pendingDrops = 0;
  private regrow = 0;
  private pickups: Pickups | null = null;

  constructor(site: FruitTreeSite) {
    this.position = site.position;
    this.object = site.object;
    this.fruit = site.fruit;
    for (let i = 0; i < this.fruit.count; i++) {
      const m = new THREE.Matrix4();
      this.fruit.getMatrixAt(i, m);
      this.rest.push(m);
      this.hanging.push(true);
    }
  }

  /** Which mangoes hang and the regrow timer, for saving this island. */
  getState(): TreeState {
    return { h: this.hanging.map((on) => (on ? 1 : 0)), r: Math.round(this.regrow * 100) / 100 };
  }

  /** Restores the fruit and regrow timer. Without an argument, the full tree comes back. */
  setState(st?: TreeState) {
    this.shakeT = -1;
    this.pendingDrops = 0;
    this.object.rotation.set(0, this.object.rotation.y, 0);
    this.regrow = st?.r ?? 0;
    this.hanging.forEach((_on, i) => this.setHanging(i, st ? st.h[i] === 1 : true));
  }

  prompt(): string | null {
    if (this.shakeT >= 0) return null;
    return this.hangingCount() > 0 ? t('prompt.shake') : null;
  }

  interact(ctx: InteractContext) {
    if (this.shakeT >= 0 || this.hangingCount() === 0) return;
    this.pickups = ctx.pickups;
    this.shakeT = 0;
    sfx.play('rustle', { at: this.position });
    this.pendingDrops = 1 + Math.floor(Math.random() * MAX_DROP);
  }

  update(dt: number) {
    this.updateShake(dt);
    if (this.hangingCount() < this.rest.length) {
      this.regrow += dt;
      if (this.regrow >= REGROW_TIME) {
        this.regrow = 0;
        const gone = this.indices(false);
        this.setHanging(gone[Math.floor(Math.random() * gone.length)], true);
      }
    } else {
      this.regrow = 0;
    }
  }

  /** Damped sine wobble around the trunk base; fruit drops at DROP_AT. */
  private updateShake(dt: number) {
    if (this.shakeT < 0) return;
    const prev = this.shakeT;
    this.shakeT += dt;
    const t = Math.min(this.shakeT, SHAKE_TIME);
    const env = Math.exp(-t * 3);
    const w = Math.PI * 2 * 3.5;
    this.object.rotation.z = Math.sin(t * w) * 0.07 * env;
    this.object.rotation.x = Math.sin(t * w * 0.9 + 1) * 0.04 * env;

    if (prev < DROP_AT && this.shakeT >= DROP_AT) this.dropFruit();
    if (this.shakeT >= SHAKE_TIME) {
      this.shakeT = -1;
      this.object.rotation.set(0, this.object.rotation.y, 0);
    }
  }

  private dropFruit() {
    if (!this.pickups) return;
    this.object.updateMatrixWorld(true);
    const open = this.indices(true);
    const n = Math.min(this.pendingDrops, open.length);
    for (let k = 0; k < n; k++) {
      const idx = open.splice(Math.floor(Math.random() * open.length), 1)[0];
      const local = new THREE.Vector3().setFromMatrixPosition(this.rest[idx]);
      this.pickups.spawn(this.object.localToWorld(local));
      this.setHanging(idx, false);
    }
    this.pendingDrops = 0;
  }

  private setHanging(i: number, on: boolean) {
    this.hanging[i] = on;
    this.fruit.setMatrixAt(i, on ? this.rest[i] : HIDDEN);
    this.fruit.instanceMatrix.needsUpdate = true;
  }

  private indices(hanging: boolean) {
    const out: number[] = [];
    this.hanging.forEach((h, i) => h === hanging && out.push(i));
    return out;
  }

  private hangingCount() {
    return this.hanging.filter(Boolean).length;
  }
}
