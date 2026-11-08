import { SPECIES, speciesName, type Species, type WaterKind } from '../interact/FishSpecies';
import { t } from '../i18n';
import { sfx } from '../audio/AudioManager';

const KEY = 'nongkrong.fishpedia';
const CARD_TIME = 2.6;

interface Entry {
  count: number;
  biggest: number;
}

function el(tag: string, cls = '', text = '') {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
}

/** Collection log of caught species (F to toggle), saved to localStorage, plus the catch popup card. */
export class Fishpedia {
  private entries: Record<string, Entry>;
  private panel = el('div');
  private card = el('div');
  private open = false;
  private cardTimer = 0;

  constructor() {
    this.entries = this.load();
    this.panel.id = 'fishpedia';
    this.card.id = 'catch-card';
    document.body.append(this.panel, this.card);
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyF' && !e.repeat) this.toggle();
    });
    this.render();
  }

  get isOpen() {
    return this.open;
  }

  toggle() {
    this.open = !this.open;
    sfx.play('blip', { volume: 0.7 });
    if (this.open) this.render();
    this.panel.classList.toggle('show', this.open);
  }

  /** Logs a catch. Returns true if it is the first time this species was caught. */
  record(s: Species, cm: number): boolean {
    const prev = this.entries[s.id];
    this.entries[s.id] = { count: (prev?.count ?? 0) + 1, biggest: Math.max(prev?.biggest ?? 0, cm) };
    this.save();
    this.render();
    return !prev;
  }

  showCatch(text: string, isNew: boolean) {
    this.card.replaceChildren(el('div', 'headline', text));
    if (isNew) this.card.append(el('div', 'sub', t('pedia.new')));
    this.card.classList.add('show');
    clearTimeout(this.cardTimer);
    this.cardTimer = window.setTimeout(() => this.card.classList.remove('show'), CARD_TIME * 1000);
  }

  private render() {
    const sections: [string, WaterKind][] = [
      [t('pedia.pond'), 'pond'],
      [t('pedia.sea'), 'sea'],
    ];
    const nodes: HTMLElement[] = [el('h2', '', t('pedia.title'))];
    for (const [label, water] of sections) {
      nodes.push(el('h3', '', label));
      for (const s of SPECIES.filter((sp) => sp.water === water)) {
        const e = this.entries[s.id];
        const row = el('div', 'row');
        row.append(
          el('span', '', e ? `${s.emoji} ${speciesName(s)}` : '❔ ???'),
          el('span', e ? 'info' : 'info unknown', e ? t('pedia.stats', { count: e.count, cm: e.biggest }) : t('pedia.unknown')),
        );
        nodes.push(row);
      }
    }
    this.panel.replaceChildren(...nodes);
  }

  private load(): Record<string, Entry> {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
      const out: Record<string, Entry> = {};
      for (const [id, e] of Object.entries(raw as Record<string, Entry>)) {
        if (e && e.count > 0) out[id] = { count: e.count, biggest: e.biggest };
      }
      return out;
    } catch {
      return {};
    }
  }

  private save() {
    localStorage.setItem(KEY, JSON.stringify(this.entries));
  }
}
