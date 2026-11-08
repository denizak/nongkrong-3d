import { ROWS, COLS, type Archipelago } from '../world/Archipelago';

/**
 * "🏝️ Island 12 / 50 · 7 visited". Sits in the top-left column, directly below the clock pill.
 * In touch mode the text is shorter and the inventory row is moved clear of the column.
 */
export class IslandPill {
  private el = document.createElement('div');
  private text = '';

  constructor(private arch: Archipelago) {
    this.el.id = 'island-pill';
    document.body.append(this.el);
    arch.onChange(() => this.update());
    const clock = document.getElementById('clock-pill');
    if (clock) new ResizeObserver(() => this.place(clock)).observe(clock);
    this.update();
  }

  private update() {
    const visited = this.arch.visited.size;
    const touch = document.documentElement.classList.contains('touch');
    const showVisited = !touch && visited > 0;
    const text = `🏝️ Island ${this.arch.id} / ${COLS * ROWS}${showVisited ? ` · ${visited} visited` : ''}`;
    if (text !== this.text) {
      this.text = text;
      this.el.textContent = text;
    }
    const clock = document.getElementById('clock-pill');
    if (clock) this.place(clock);
  }

  private place(clock: HTMLElement) {
    const c = clock.getBoundingClientRect();
    this.el.style.left = `${c.left}px`;
    this.el.style.top = `${c.bottom + 8}px`;
    // Right edge of the top-left column. The inventory row keeps clear of it (see style.css and touch.css).
    const right = Math.max(c.right, this.el.getBoundingClientRect().right);
    document.documentElement.style.setProperty('--hud-col', `${right + 8}px`);
  }
}
