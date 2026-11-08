import { t } from '../i18n';
import type { Input } from '../core/Input';
import type { Inventory } from '../ui/Inventory';
import type { Loading } from '../ui/Loading';
import type { CharacterModel } from './CharacterModel';
import { loadLook, makeLook, randomLook, saveLook, type Look, type RobotType } from './Look';

const isEditable = (el: Element | null) =>
  el instanceof HTMLInputElement ||
  el instanceof HTMLTextAreaElement ||
  (el instanceof HTMLElement && el.isContentEditable);

interface Deps {
  model: CharacterModel | null;
  input: Input;
  inventory: Inventory;
  loading: Loading;
}

/**
 * Rerolls and saves the player's robot look. K rerolls in game, the loading card has a Shuffle button,
 * and touch mode gets a dice button by the sound pill. Everything goes through apply(), which also
 * updates the live model.
 */
export class LookControls {
  private _current: Look;
  private paint: ((look: Look) => void) | null;
  private inGame = false;

  constructor(private deps: Deps) {
    this._current = deps.model?.look ?? loadLook();
    this.paint = deps.loading.addLook(this._current, () => this.reroll());

    window.addEventListener('game:start', () => {
      this.inGame = true;
    });
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'KeyK' || e.repeat || !this.inGame) return;
      if (this.deps.input.typing || isEditable(document.activeElement)) return;
      this.reroll();
    });

    // Mention the shortcut in the existing HUD help line.
    const help = document.querySelector<HTMLElement>('#hud .help');
    if (help) help.textContent = `${help.textContent?.trimEnd() ?? ''}${t('help.robot')}`;

    if (document.documentElement.classList.contains('touch')) this.buildTouchButton();
  }

  /** The look the player is wearing. */
  get current(): Look {
    return this._current;
  }

  /** Picks a new random look, avoiding the same type and body colour as the current one where possible. */
  reroll() {
    let next = randomLook();
    for (let i = 0; i < 8 && next.type === this._current.type && next.body === this._current.body; i++) {
      next = randomLook();
    }
    this.apply(next);
  }

  /** Sets an exact look. Colours are hex strings, e.g. '#f08a6c'. */
  set(type: RobotType, body: string, trim: string) {
    this.apply(makeLook(type, body, trim));
  }

  private apply(look: Look) {
    this._current = look;
    saveLook(look);
    this.deps.model?.setLook(look);
    this.paint?.(look);
    this.deps.inventory.toast(t('look.you', { name: look.name }));
  }

  private buildTouchButton() {
    const b = document.createElement('button');
    b.id = 'look-dice';
    b.type = 'button';
    b.title = t('look.new');
    b.setAttribute('aria-label', t('look.new'));
    b.textContent = '🎲';
    b.addEventListener('click', () => this.reroll());
    document.body.append(b);
  }
}
