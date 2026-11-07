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
