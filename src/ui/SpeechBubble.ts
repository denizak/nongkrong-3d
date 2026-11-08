import * as THREE from 'three/webgpu';
import './chat.css';

const MAX_LENGTH = 80;
const BASE_MS = 3000;
const MS_PER_CHAR = 60;
const MAX_MS = 9000;
const FADE_MS = 400;

const _local = new THREE.Vector3();
const _ndc = new THREE.Vector3();

/**
 * Projects a world point onto an absolutely positioned element (the element's bottom centre sits on the point).
 * Hides it when the point is behind the camera or farther than maxDist. Returns true when it is shown.
 */
export function placeOn(el: HTMLElement, world: THREE.Vector3, camera: THREE.Camera, maxDist = Infinity): boolean {
  _local.copy(world).applyMatrix4(camera.matrixWorldInverse);
  // Camera space looks down -Z, so a positive z means behind.
  if (_local.z >= 0 || world.distanceTo(camera.position) > maxDist) {
    el.style.visibility = 'hidden';
    return false;
  }
  _ndc.copy(world).project(camera);
  const x = (_ndc.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-_ndc.y * 0.5 + 0.5) * window.innerHeight;
  el.style.visibility = 'visible';
  el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
  return true;
}

/**
 * A speech bubble that can float above any anchor. say() shows text for a length-based time, then fades.
 * The caller positions it each frame with place(). Only DOM is used.
 */
export class SpeechBubble {
  readonly el = document.createElement('div');
  private body = document.createElement('div');
  private active = false;
  private fadeTimer = 0;
  private hideTimer = 0;

  constructor() {
    this.el.className = 'chat-bubble';
    this.el.style.display = 'none';
    this.body.className = 'chat-bubble-body';
    this.el.append(this.body);
    document.body.append(this.el);
  }

  /** True while the bubble has text to show (including the fade-out). */
  get showing() {
    return this.active;
  }

  /** Shows `text`, replacing any current one. */
  say(text: string) {
    const t = text.trim().slice(0, MAX_LENGTH);
    if (!t) return;

    window.clearTimeout(this.fadeTimer);
    window.clearTimeout(this.hideTimer);
    this.body.textContent = t;
    this.body.classList.remove('pop');
    void this.body.offsetWidth; // restart the pop-in animation
    this.body.classList.add('pop');
    this.el.classList.remove('fade');
    this.el.style.display = 'block';
    this.active = true;

    const ms = Math.min(MAX_MS, BASE_MS + MS_PER_CHAR * t.length);
    this.fadeTimer = window.setTimeout(() => this.el.classList.add('fade'), ms);
    this.hideTimer = window.setTimeout(() => {
      this.active = false;
      this.el.style.display = 'none';
    }, ms + FADE_MS);
  }

  /** Puts the bubble's tail on `world`. Does nothing while the bubble is idle. */
  place(world: THREE.Vector3, camera: THREE.Camera) {
    if (this.active) placeOn(this.el, world, camera);
  }

  destroy() {
    window.clearTimeout(this.fadeTimer);
    window.clearTimeout(this.hideTimer);
    this.el.remove();
  }
}
