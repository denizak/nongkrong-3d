import type { Input } from '../core/Input';
import type { Player } from '../player/Player';
import type { Interactable, InteractContext } from './Interactable';

/** Items slightly behind the player still count (dot product above this). */
const FACING_MIN = -0.2;

/** Finds the nearest usable interactable in front of the player and runs it on E. */
export class InteractionSystem {
  private items: Interactable[] = [];
  private promptEl = document.getElementById('prompt')!;

  constructor(
    private input: Input,
    private player: Player,
    private ctx: InteractContext,
  ) {}

  add(item: Interactable) {
    this.items.push(item);
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
      this.promptEl.textContent = `E — ${bestText}`;
      this.promptEl.classList.add('show');
    } else {
      this.promptEl.classList.remove('show');
    }
  }
}
