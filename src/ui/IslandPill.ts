import { t } from '../i18n';
import { ISLAND_COUNT, displayName } from '../world/Islands';
import type { Archipelago } from '../world/Archipelago';

/**
 * "🏝️ Pulau Pramuka · 7/50 visited", with the progress part smaller. Sits in the top-left column, directly below the clock pill.
 * In touch mode the progress part is left out and the inventory row is moved clear of the column.
 */
export class IslandPill {
  private el = document.createElement('div');
  private key = '';

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
    const id = this.arch.id;
    const key = `${id}|${visited}|${touch}`;
    if (key !== this.key) {
      this.key = key;
      const name = document.createElement('span');
      name.textContent = t('island.pill', { name: displayName(id) });
      const nodes: Node[] = [name];
      if (!touch) {
        const progress = document.createElement('span');
        progress.className = 'progress';
        progress.textContent = t('island.progress', { n: visited, total: ISLAND_COUNT });
        nodes.push(progress);
      }
      this.el.replaceChildren(...nodes);
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
