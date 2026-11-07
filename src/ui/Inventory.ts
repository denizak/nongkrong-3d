import { SPECIES, fishItemId } from '../interact/FishSpecies';

const KEY = 'nongkrong.inventory';

const ITEMS: Record<string, { icon: string; name: string }> = {
  mango: { icon: '🥭', name: 'Mango' },
  rice: { icon: '🌾', name: 'Rice' },
  ...Object.fromEntries(SPECIES.map((s) => [fishItemId(s), { icon: s.emoji, name: s.name }])),
};

/** Item counts, saved to localStorage, shown in the top bar with a toast on pickup. */
export class Inventory {
  private counts: Record<string, number>;
  private bar = document.getElementById('inventory')!;
  private toasts = document.getElementById('toasts')!;

  constructor() {
    this.counts = this.load();
    this.render();
  }

  get(id: string) {
    return this.counts[id] ?? 0;
  }

  add(id: string, n = 1) {
    this.counts[id] = this.get(id) + n;
    this.save();
    this.render();
    this.toast(`+${n} ${ITEMS[id]?.name ?? id}`);
  }

  private load(): Record<string, number> {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
      const out: Record<string, number> = {};
      for (const [id, n] of Object.entries(raw)) if (typeof n === 'number' && n > 0) out[id] = n;
      return out;
    } catch {
      return {};
    }
  }

  private save() {
    localStorage.setItem(KEY, JSON.stringify(this.counts));
  }

  private render() {
    const slots = Object.entries(this.counts)
      .filter(([, n]) => n > 0)
      .map(([id, n]) => {
        const slot = document.createElement('span');
        slot.className = 'slot';
        const item = ITEMS[id];
        slot.textContent = `${item?.icon ?? '•'} ${item?.name ?? id} ×${n}`;
        return slot;
      });
    this.bar.replaceChildren(...slots);
    this.bar.classList.toggle('show', slots.length > 0);
  }

  toast(text: string) {
    const el = document.createElement('div');
    el.textContent = text;
    this.toasts.append(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 300);
    }, 1200);
  }
}
