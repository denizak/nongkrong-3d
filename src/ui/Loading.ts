import type { Look } from '../player/Look';

/**
 * Full-screen loading overlay. Its markup and CSS live in index.html so it shows before any JS runs.
 * Progress goes through setProgress; ready() swaps the bar for a start button.
 */
export class Loading {
  private root = document.getElementById('loading')!;
  private track = document.getElementById('loading-track')!;
  private fill = document.getElementById('loading-fill')!;
  private label = document.getElementById('loading-label')!;
  private button = document.getElementById('loading-start') as HTMLButtonElement;
  private started = false;
  private lookBox: HTMLDivElement | null = null;

  /**
   * Adds the character card above the start button: a body/trim swatch, the look's name and a Shuffle
   * button. Hidden until ready(). Returns the function to call when the look changes.
   */
  addLook(look: Look, onShuffle: () => void): (look: Look) => void {
    const box = document.createElement('div');
    box.className = 'look';
    box.hidden = true;
    const swatch = document.createElement('div');
    swatch.className = 'swatch';
    const name = document.createElement('div');
    name.className = 'look-name';
    const shuffle = document.createElement('button');
    shuffle.type = 'button';
    shuffle.className = 'shuffle';
    shuffle.textContent = '🎲 Shuffle';
    shuffle.addEventListener('click', onShuffle);
    box.append(swatch, name, shuffle);
    this.button.before(box);
    this.lookBox = box;

    const paint = (l: Look) => {
      swatch.style.background = `conic-gradient(${l.body} 0 50%, ${l.trim} 50% 100%)`;
      name.textContent = l.name;
    };
    paint(look);
    return paint;
  }

  setProgress(value: number, label?: string) {
    const v = Math.min(1, Math.max(0, value));
    this.fill.style.width = `${Math.round(v * 100)}%`;
    if (label !== undefined) this.label.textContent = label;
  }

  fail(message: string) {
    this.label.textContent = message;
    this.label.classList.add('error');
  }

  /**
   * Shows the "Click to start" button (click, Enter or Space). Resolves once the player starts;
   * the overlay fades out over 0.6 s and game:start is dispatched. The keypress is consumed so
   * it does not reach the game or the chat box.
   */
  ready(): Promise<void> {
    this.setProgress(1, 'Ready');
    this.track.hidden = true;
    this.label.hidden = true;
    if (this.lookBox) this.lookBox.hidden = false;
    this.button.hidden = false;
    this.button.focus({ preventScroll: true });

    return new Promise((resolve) => {
      const start = () => {
        if (this.started) return;
        this.started = true;
        window.removeEventListener('keydown', onKey, true);
        this.button.disabled = true;
        this.root.classList.add('fading');
        window.setTimeout(() => this.root.remove(), 620);
        window.dispatchEvent(new Event('game:start'));
        resolve();
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.code !== 'Enter' && e.code !== 'Space') return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!e.repeat) start();
      };
      this.button.addEventListener('click', start);
      window.addEventListener('keydown', onKey, true);
    });
  }
}
