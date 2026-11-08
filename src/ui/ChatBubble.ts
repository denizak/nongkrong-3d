import { t } from '../i18n';
import * as THREE from 'three/webgpu';
import './chat.css';
import type { Input } from '../core/Input';
import type { Player } from '../player/Player';
import { sfx } from '../audio/AudioManager';
import { SpeechBubble } from './SpeechBubble';

/** Anchor heights above the player's feet, in metres, by pose. */
const HEIGHT_STAND = 2.3;
const HEIGHT_SIT = 1.5;
const HEIGHT_LIE = 1.1;

const MAX_LENGTH = 80;

const isEditable = (el: Element | null) =>
  el instanceof HTMLInputElement ||
  el instanceof HTMLTextAreaElement ||
  (el instanceof HTMLElement && el.isContentEditable);

/**
 * Press Enter to type a short message; Enter again shows it in a speech bubble
 * above the character's head. "/name X" changes the name instead of sending.
 */
export class ChatBubble {
  private field = document.createElement('input');
  private bubble = new SpeechBubble();
  private open = false;
  private anchor = new THREE.Vector3();
  /** Called with each message sent from the box (not /name commands). */
  onSend: ((text: string) => void) | null = null;
  /** Called with the argument of "/name ...". */
  onName: ((name: string) => void) | null = null;

  constructor(
    private camera: THREE.Camera,
    private player: Player,
    private controls: Input,
  ) {
    const f = this.field;
    f.type = 'text';
    f.className = 'chat-input';
    f.maxLength = MAX_LENGTH;
    f.placeholder = t('chat.placeholder');
    f.autocomplete = 'off';
    f.enterKeyHint = 'go';
    f.setAttribute('aria-label', t('chat.aria'));
    document.body.append(f);

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
    if (help) help.textContent = `${help.textContent?.trimEnd() ?? ''}${t('help.chat')}`;
  }

  /** Opens the chat box from a button (the touch Chat button). Does nothing if it is already open. */
  openChat() {
    if (!this.open && !this.controls.typing) this.openBox();
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
    if (!text) return;
    const name = /^\/(?:name|nama)(?:\s+(.*))?$/i.exec(text);
    if (name) {
      this.onName?.(name[1] ?? '');
      return;
    }
    sfx.play('blip');
    this.say(text);
    this.onSend?.(text);
  }

  /** Shows `text` in a speech bubble above the character, replacing any current one. */
  say(text: string) {
    this.bubble.say(text);
  }

  /** Call once per frame after the camera has been updated. */
  update() {
    if (!this.bubble.showing) return;

    const pose = this.player.pose;
    const h = pose === 'sit' ? HEIGHT_SIT : pose === 'lie' ? HEIGHT_LIE : HEIGHT_STAND;
    const p = this.player.position;
    this.anchor.set(p.x, p.y + h, p.z);
    this.camera.updateMatrixWorld();
    this.bubble.place(this.anchor, this.camera);
  }
}
