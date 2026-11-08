import type { Input } from '../core/Input';
import type { Player } from '../player/Player';
import type { Interactable, InteractContext } from './Interactable';

/** Items slightly behind the player still count (dot product above this). */
const FACING_MIN = -0.2;

/** Finds the nearest usable interactable in front of the player and runs it on E. */
export class InteractionSystem {
  /** Always active (fishing and the like). */
  private fixed: Interactable[] = [];
  /** Belong to the live island: fruit trees, paddy, scarecrow. Replaced on each island switch. */
  private island: Interactable[] = [];
  private promptEl = document.getElementById('prompt')!;

  constructor(
    private input: Input,
    private player: Player,
    private ctx: InteractContext,
  ) {}

  add(item: Interactable) {
    this.fixed.push(item);
  }

  /** The live island changed: its interactables replace the previous island's. */
  setActive(items: Interactable[]) {
    this.island = items;
  }

  private get items(): Interactable[] {
    return this.island.length ? [...this.fixed, ...this.island] : this.fixed;
  }

  update(dt: number) {
    const p = this.player.position;
    const f = this.player.getFacing();
    // No prompts or interactions while sitting or lying down.
    const posed = this.player.pose !== 'stand';
    let best: Interactable | null = null;
    let bestText = '';
    let bestDist = Infinity;
    // A locked item (e.g. an active fishing session) takes over all prompts and presses.
    const locked = this.items.find((i) => i.isLocked?.());

    for (const item of this.items) {
      item.update?.(dt);
      const text = item.prompt();
      if (text === null || posed) continue;
      if (locked && item !== locked) continue;
      const dx = item.position.x - p.x;
      const dz = item.position.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > item.radius) continue;
      if (d > 0.01 && (dx * f.x + dz * f.z) / d <= FACING_MIN) continue;
      if (d < bestDist) {
        bestDist = d;
        best = item;
        bestText = text;
      }
    }

    const pressed = this.input.consumeInteract();
    if (pressed && best) best.interact(this.ctx);

    if (best) {
      // Touch players have no E key; the Action button uses the hand icon.
      const key = document.documentElement.classList.contains('touch') ? '✋' : 'E —';
      this.promptEl.textContent = `${key} ${bestText}`;
      this.promptEl.classList.add('show');
    } else {
      this.promptEl.classList.remove('show');
    }
  }
}
