import * as THREE from 'three/webgpu';
import './chat.css';
import type { Input } from '../core/Input';
import type { Player } from '../player/Player';

/** Anchor heights above the player's feet, in metres, by pose. */
const HEIGHT_STAND = 2.3;
const HEIGHT_SIT = 1.5;
const HEIGHT_LIE = 1.1;

const MAX_LENGTH = 80;
const BASE_MS = 3000;
const MS_PER_CHAR = 60;
const MAX_MS = 9000;
const FADE_MS = 400;

const isEditable = (el: Element | null) =>
  el instanceof HTMLInputElement ||
  el instanceof HTMLTextAreaElement ||
  (el instanceof HTMLElement && el.isContentEditable);

/**
 * Press Enter to type a short message; Enter again shows it in a speech bubble
 * above the character's head. Only DOM is used, so no scene objects are added.
 */
export class ChatBubble {
  private field = document.createElement('input');
  private bubble = document.createElement('div');
  private body = document.createElement('div');
  private open = false;
  private visible = false;
  private fadeTimer = 0;
  private hideTimer = 0;
  private anchor = new THREE.Vector3();
  private local = new THREE.Vector3();

  constructor(
    private camera: THREE.Camera,
    private player: Player,
    private controls: Input,
  ) {
    const f = this.field;
    f.type = 'text';
    f.className = 'chat-input';
    f.maxLength = MAX_LENGTH;
    f.placeholder = 'Say something…';
    f.autocomplete = 'off';
    f.setAttribute('aria-label', 'Chat message');

    this.bubble.className = 'chat-bubble';
    this.bubble.style.display = 'none';
    this.body.className = 'chat-bubble-body';
    this.bubble.append(this.body);
    document.body.append(f, this.bubble);

    // Enter opens the box, unless the player is already typing in some other field.
    window.addEventListener('keydown', (e) => {
      if (e.repeat || this.open || this.controls.typing) return;
      if (e.code !== 'Enter' && e.code !== 'NumpadEnter') return;
      if (isEditable(document.activeElement)) return;
      e.preventDefault();
      this.openBox();
    });

    // Keys typed into the box stay inside it, so game shortcuts never see them.
    f.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.isComposing) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        this.submit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });
    f.addEventListener('blur', () => this.close());

    window.addEventListener('pointerdown', (e) => {
      if (this.open && e.target instanceof HTMLCanvasElement) this.close();
    });

    // Mention the shortcut in the existing HUD help line.
    const help = document.querySelector<HTMLElement>('#hud .help');
    if (help) help.textContent = `${help.textContent?.trimEnd() ?? ''} · Enter — chat`;
  }

  private openBox() {
    this.open = true;
    this.controls.typing = true;
    this.field.value = '';
    this.field.classList.add('show');
    this.field.focus();
  }

  private close() {
    if (!this.open) return;
    this.open = false;
    this.controls.typing = false;
    this.field.classList.remove('show');
    if (document.activeElement === this.field) this.field.blur();
  }

  private submit() {
    const text = this.field.value.trim();
    this.close();
    if (text) this.say(text);
  }

  /** Shows `text` in a speech bubble above the character, replacing any current one. */
  say(text: string) {
    const t = text.trim().slice(0, MAX_LENGTH);
    if (!t) return;

    window.clearTimeout(this.fadeTimer);
    window.clearTimeout(this.hideTimer);
    this.body.textContent = t;
    this.body.classList.remove('pop');
    void this.body.offsetWidth; // restart the pop-in animation
    this.body.classList.add('pop');
    this.bubble.classList.remove('fade');
    this.bubble.style.display = 'block';
    this.visible = true;

    const ms = Math.min(MAX_MS, BASE_MS + MS_PER_CHAR * t.length);
    this.fadeTimer = window.setTimeout(() => this.bubble.classList.add('fade'), ms);
    this.hideTimer = window.setTimeout(() => {
      this.visible = false;
      this.bubble.style.display = 'none';
    }, ms + FADE_MS);
  }

  /** Call once per frame after the camera has been updated. */
  update() {
    if (!this.visible) return;

    const pose = this.player.pose;
    const h = pose === 'sit' ? HEIGHT_SIT : pose === 'lie' ? HEIGHT_LIE : HEIGHT_STAND;
    const p = this.player.position;
    this.anchor.set(p.x, p.y + h, p.z);

    // Behind the camera: camera space looks down -Z, so a positive z means behind.
    this.camera.updateMatrixWorld();
    this.local.copy(this.anchor).applyMatrix4(this.camera.matrixWorldInverse);
    if (this.local.z >= 0) {
      this.bubble.style.visibility = 'hidden';
      return;
    }

    this.local.copy(this.anchor).project(this.camera);
    const x = (this.local.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-this.local.y * 0.5 + 0.5) * window.innerHeight;
    this.bubble.style.visibility = 'visible';
    this.bubble.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
  }
}
