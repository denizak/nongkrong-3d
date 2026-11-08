import './map.css';
import { t } from '../i18n';
import { displayName } from '../world/Islands';

/** Total time the card is shown (s), fade included. */
const SHOW_MS = 2500;
const FADE_MS = 400;

/** "Selamat datang di Gili Meno" card at the top centre, shown for 2.5 s when the player arrives on an island. */
export class IslandTitle {
  private el = document.createElement('div');
  private timers: number[] = [];

  constructor() {
    this.el.id = 'island-title';
    this.el.setAttribute('role', 'status');
    document.body.append(this.el);
  }

  show(id: number, first: boolean) {
    for (const h of this.timers) clearTimeout(h);
    const text = document.createElement('span');
    text.textContent = t('island.arrive', { name: displayName(id) });
    const nodes: Node[] = [text];
    if (first) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = t('island.new');
      nodes.push(tag);
    }
    this.el.replaceChildren(...nodes);
    // Restart the transition: drop the class, force a style flush, add it back.
    this.el.classList.remove('show');
    void this.el.offsetWidth;
    this.el.classList.add('show');
    this.timers = [
      window.setTimeout(() => this.el.classList.remove('show'), SHOW_MS - FADE_MS),
    ];
  }
}
