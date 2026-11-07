type Action = 'interact' | 'sit' | 'lie';
const KEY_ACTIONS: Record<string, Action> = { KeyE: 'interact', KeyC: 'sit', KeyZ: 'lie' };
const NO_MOVE = { x: 0, y: 0 };

/** Keyboard, mouse-drag and gamepad input, read once per frame. */
export class Input {
  private keys = new Set<string>();
  private _typing = false;
  /** Accumulated pointer drag (pixels) since last frame. */
  private dragX = 0;
  private dragY = 0;
  private wheel = 0;
  private dragging = false;
  /** Keyboard press edges waiting to be consumed. */
  private queued: Record<Action, boolean> = { interact: false, sit: false, lie: false };
  private padWas: Record<Action, boolean> = { interact: false, sit: false, lie: false };

  constructor(target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      // While typing in the chat box, game keys are ignored entirely.
      if (this._typing) return;
      this.keys.add(e.code);
      const action = KEY_ACTIONS[e.code];
      if (action && !e.repeat) this.queued[action] = true;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    target.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      target.setPointerCapture(e.pointerId);
    });
    target.addEventListener('pointerup', (e) => {
      this.dragging = false;
      target.releasePointerCapture(e.pointerId);
    });
    target.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.dragX += e.movementX;
      this.dragY += e.movementY;
    });
    target.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.wheel += e.deltaY;
      },
      { passive: false },
    );
  }

  /**
   * True while a text field owns the keyboard. Setting it on clears held keys and
   * queued presses, so the character stops moving the moment typing starts.
   */
  get typing(): boolean {
    return this._typing;
  }

  set typing(v: boolean) {
    this._typing = v;
    if (v) {
      this.keys.clear();
      this.queued = { interact: false, sit: false, lie: false };
    }
  }

  private down(...codes: string[]) {
    return codes.some((c) => this.keys.has(c));
  }

  private gamepad(): Gamepad | null {
    const pads = navigator.getGamepads?.() ?? [];
    for (const p of pads) if (p) return p;
    return null;
  }

  /** Movement intent: x = right, y = forward, each in [-1, 1]. */
  move(): { x: number; y: number } {
    if (this._typing) return NO_MOVE;
    let x = 0;
    let y = 0;
    if (this.down('KeyW', 'ArrowUp')) y += 1;
    if (this.down('KeyS', 'ArrowDown')) y -= 1;
    if (this.down('KeyD', 'ArrowRight')) x += 1;
    if (this.down('KeyA', 'ArrowLeft')) x -= 1;

    const pad = this.gamepad();
    if (pad) {
      const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
      x += dz(pad.axes[0] ?? 0);
      y -= dz(pad.axes[1] ?? 0);
    }
    const len = Math.hypot(x, y);
    return len > 1 ? { x: x / len, y: y / len } : { x, y };
  }

  running(): boolean {
    if (this._typing) return false;
    const pad = this.gamepad();
    return this.down('ShiftLeft', 'ShiftRight') || !!pad?.buttons[0]?.pressed;
  }

  /** True once per press of E or gamepad X (button 2); held buttons don't repeat. */
  consumeInteract(): boolean {
    return this.take('interact', 2);
  }

  /** True once per press of C or gamepad B (button 1). */
  consumeSit(): boolean {
    return this.take('sit', 1);
  }

  /** True once per press of Z or gamepad Y (button 3). */
  consumeLie(): boolean {
    return this.take('lie', 3);
  }

  private take(action: Action, button: number): boolean {
    if (this._typing) return false;
    const key = this.queued[action];
    this.queued[action] = false;
    const now = !!this.gamepad()?.buttons[button]?.pressed;
    const pad = now && !this.padWas[action];
    this.padWas[action] = now;
    return key || pad;
  }

  /** Camera orbit delta for this frame (radians-ish units), then resets. */
  consumeLook(): { x: number; y: number; zoom: number } {
    if (this._typing) {
      this.dragX = this.dragY = this.wheel = 0;
      return { x: 0, y: 0, zoom: 0 };
    }
    let x = this.dragX * 0.005;
    let y = this.dragY * 0.005;
    const pad = this.gamepad();
    if (pad) {
      const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
      x += dz(pad.axes[2] ?? 0) * 0.04;
      y += dz(pad.axes[3] ?? 0) * 0.04;
    }
    const zoom = this.wheel * 0.01;
    this.dragX = this.dragY = this.wheel = 0;
    return { x, y, zoom };
  }
}
