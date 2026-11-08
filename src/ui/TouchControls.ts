import { t } from '../i18n';
import './touch.css';
import type { Input } from '../core/Input';
import type { Fishpedia } from './Fishpedia';
import type { ChatBubble } from './ChatBubble';

/** Joystick radius in px; the knob never travels further than this. */
const STICK_R = 55;
const STICK_BASE = 120;
const DEADZONE = 0.12;
/** Past this fraction of the radius the character runs. */
const RUN_AT = 0.85;
/** Left share of the screen is the joystick zone; the rest is the camera zone. */
const LEFT_SHARE = 0.45;
/** Touches above this y (px) are treated as HUD and ignored. */
const HUD_BAND = 120;
/** Camera drag, in drag px per touch px (Input scales drag px to radians). */
const LOOK_SENS = 1.8;
/** Pinch, in wheel units per touch px of finger spread change. */
const PINCH_SENS = 3;

interface Deps {
  input: Input;
  fishpedia: Fishpedia;
  chat: ChatBubble;
}

interface Tracked {
  kind: 'stick' | 'look';
  x: number;
  y: number;
}

/**
 * Touch controls: a virtual joystick on the left, camera drag and pinch on the right,
 * and round buttons bottom-right. Only active on touch devices, or with ?touch in the URL.
 */
export class TouchControls {
  readonly enabled: boolean;
  private input: Input;
  private fishpedia: Fishpedia;
  private chat: ChatBubble;
  private tracked = new Map<number, Tracked>();
  private stickId = -1;
  private stickX = 0;
  private stickY = 0;
  private stickBase!: HTMLDivElement;
  private stickKnob!: HTMLDivElement;
  private pinchDist = 0;

  constructor(deps: Deps) {
    this.input = deps.input;
    this.fishpedia = deps.fishpedia;
    this.chat = deps.chat;
    this.enabled = TouchControls.isTouchDevice();
    if (!this.enabled) return;

    document.documentElement.classList.add('touch');
    this.input.setTouchMode(true);
    this.buildDom();
    this.shortenHelp();

    window.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);

    // Lift the chat box above the on-screen keyboard when it opens.
    const vv = window.visualViewport;
    const lift = () => {
      const field = document.querySelector<HTMLElement>('.chat-input');
      if (!field || !vv) return;
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      field.style.bottom = kb > 0 ? `${kb + 24}px` : '';
    };
    vv?.addEventListener('resize', lift);
    vv?.addEventListener('scroll', lift);
  }

  /** True on coarse-pointer or touch-capable devices, or when the URL has ?touch. */
  static isTouchDevice(): boolean {
    if (new URLSearchParams(location.search).has('touch')) return true;
    return window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  }

  private buildDom() {
    const layer = document.createElement('div');
    layer.id = 'touch-layer';
    this.stickBase = document.createElement('div');
    this.stickBase.className = 'stick-base';
    this.stickKnob = document.createElement('div');
    this.stickKnob.className = 'stick-knob';
    this.stickBase.append(this.stickKnob);
    layer.append(this.stickBase);
    document.body.append(layer);

    const cluster = document.createElement('div');
    cluster.id = 'touch-buttons';
    const row1 = document.createElement('div');
    row1.className = 'row';
    const row2 = document.createElement('div');
    row2.className = 'row';
    row1.append(
      this.button('💬', t('touch.chat'), () => this.chat.openChat()),
      this.button('📖', t('touch.fish'), () => this.fishpedia.toggle()),
      this.button('🪑', t('touch.sit'), () => this.input.pressSit()),
    );
    row2.append(
      this.button('😴', t('touch.lie'), () => this.input.pressLie()),
      this.button('✋', t('touch.action'), () => this.input.pressInteract(), 'big'),
    );
    cluster.append(row1, row2);
    document.body.append(cluster);
  }

  private button(icon: string, label: string, onTap: () => void, extra = ''): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `touch-btn ${extra}`.trim();
    b.setAttribute('aria-label', label);
    const i = document.createElement('span');
    i.textContent = icon;
    const l = document.createElement('span');
    l.className = 'lbl';
    l.textContent = label;
    b.append(i, l);
    // Visual press state on pointer down; the action runs on click, which is a user gesture
    // (needed so the chat box can open the mobile keyboard).
    const up = () => b.classList.remove('down');
    b.addEventListener('pointerdown', () => b.classList.add('down'));
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('pointerleave', up);
    b.addEventListener('click', onTap);
    return b;
  }

  /** One-time hint toast for touch players. Shown for 6 s, then faded out. */
  showHint() {
    if (!this.enabled) return;
    const el = document.createElement('div');
    el.className = 'touch-hint';
    el.textContent = t('touch.hint');
    document.body.append(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 600);
    }, 6000);
  }

  private shortenHelp() {
    const help = document.querySelector<HTMLElement>('#hud .help');
    if (help) help.textContent = t('touch.hint');
  }

  private inCanvasZone(e: PointerEvent): boolean {
    return e.target instanceof HTMLCanvasElement && e.clientY >= HUD_BAND;
  }

  private onDown = (e: PointerEvent) => {
    if (!this.inCanvasZone(e) || this.tracked.has(e.pointerId)) return;
    const onLeft = e.clientX < window.innerWidth * LEFT_SHARE;
    if (onLeft) {
      if (this.stickId >= 0) return;
      this.stickId = e.pointerId;
      this.stickX = e.clientX;
      this.stickY = e.clientY;
      this.tracked.set(e.pointerId, { kind: 'stick', x: e.clientX, y: e.clientY });
      this.stickBase.style.transform = `translate(${e.clientX - STICK_BASE / 2}px, ${e.clientY - STICK_BASE / 2}px)`;
      this.stickKnob.style.transform = 'translate(0px, 0px)';
      this.stickBase.classList.add('show');
      return;
    }
    this.tracked.set(e.pointerId, { kind: 'look', x: e.clientX, y: e.clientY });
    const looks = this.looks();
    if (looks.length === 2) this.pinchDist = this.spread(looks);
  }

  private onMove = (e: PointerEvent) => {
    const p = this.tracked.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;

    if (p.kind === 'stick') {
      this.moveStick(e.clientX, e.clientY);
      return;
    }
    const looks = this.looks();
    if (looks.length >= 2) {
      // Pinch: spreading the fingers zooms in (negative wheel units), pinching out zooms out.
      const d = this.spread(looks);
      if (this.pinchDist > 0) this.input.addZoom((this.pinchDist - d) * PINCH_SENS);
      this.pinchDist = d;
    } else {
      this.input.addLook(dx * LOOK_SENS, dy * LOOK_SENS);
    }
  }

  private onUp = (e: PointerEvent) => {
    const p = this.tracked.get(e.pointerId);
    if (!p) return;
    this.tracked.delete(e.pointerId);
    if (p.kind === 'stick') {
      this.stickId = -1;
      this.stickBase.classList.remove('show');
      this.input.setTouchMove(0, 0, false);
    } else if (this.looks().length < 2) {
      this.pinchDist = 0;
    }
  }

  private moveStick(x: number, y: number) {
    const dx = x - this.stickX;
    const dy = y - this.stickY;
    const d = Math.hypot(dx, dy);
    const c = Math.min(d, STICK_R);
    const k = d > 0 ? c / d : 0;
    this.stickKnob.style.transform = `translate(${(dx * k).toFixed(1)}px, ${(dy * k).toFixed(1)}px)`;

    // n is the push as a fraction of the radius. Map past the deadzone onto [0, 1].
    const n = c / STICK_R;
    let mx = 0;
    let my = 0;
    if (n > DEADZONE) {
      const m = (n - DEADZONE) / (1 - DEADZONE);
      mx = (dx / d) * m;
      my = -(dy / d) * m; // screen y grows downward; forward is up
    }
    this.input.setTouchMove(mx, my, n >= RUN_AT);
  }

  private looks(): Tracked[] {
    return [...this.tracked.values()].filter((t) => t.kind === 'look');
  }

  private spread(pts: Tracked[]): number {
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }
}
