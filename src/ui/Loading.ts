import { t } from '../i18n';
import type { Look } from '../player/Look';

/** localStorage keys the game writes when the player picks a name or look. */
const NAME_KEY = 'nongkrong.name';
const LOOK_KEY = 'nongkrong.look';

/** True when this browser already has a saved name or look, so the player has been here before. */
function isReturningVisitor(): boolean {
  try {
    return localStorage.getItem(NAME_KEY) !== null || localStorage.getItem(LOOK_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * Fills a translated template ({name}, {lookName}) into a line. The player name goes in a <b> and is
 * set with textContent, so it is never parsed as HTML.
 */
function fillPlayingLine(line: HTMLElement, template: string, name: string, lookName: string) {
  line.replaceChildren();
  const re = /\{(name|lookName)\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) {
    if (m.index > last) line.append(template.slice(last, m.index));
    if (m[1] === 'name') {
      const b = document.createElement('b');
      b.textContent = name;
      line.append(b);
    } else {
      line.append(lookName);
    }
    last = re.lastIndex;
  }
  if (last < template.length) line.append(template.slice(last));
}

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
  /** Read once at construction, before this visit saves anything. */
  private returning = isReturningVisitor();
  private lookBox: HTMLDivElement | null = null;
  private compactRow: HTMLDivElement | null = null;
  private playingLine: HTMLDivElement | null = null;
  private fullCard: HTMLDivElement | null = null;
  private fullInner: HTMLDivElement | null = null;
  private playerName = '';
  private lookName = '';

  /**
   * Adds the character card above the start button: a body/trim swatch, the look's name and a Shuffle
   * button. Hidden until ready(). Returning visitors see a compact "Playing as" line with an Edit button
   * instead, and the full card opens when they press it. Returns the function to call when the look changes.
   */
  addLook(look: Look, onShuffle: () => void): (look: Look) => void {
    const box = document.createElement('div');
    box.className = 'look';
    box.hidden = true;

    // Compact line for returning visitors: small swatch, "Playing as <name> · <look>", Edit.
    const compact = document.createElement('div');
    compact.className = 'look-compact';
    const miniSwatch = document.createElement('div');
    miniSwatch.className = 'swatch mini';
    const playing = document.createElement('div');
    playing.className = 'playing';
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'look-edit';
    edit.textContent = t('loading.edit');
    edit.addEventListener('click', () => this.expand());
    compact.append(miniSwatch, playing, edit);

    // Full card: swatch, look name and shuffle. The name box is added later by addNameField.
    const full = document.createElement('div');
    full.className = 'look-full';
    const inner = document.createElement('div');
    inner.className = 'look-inner';
    const swatch = document.createElement('div');
    swatch.className = 'swatch';
    const name = document.createElement('div');
    name.className = 'look-name';
    const shuffle = document.createElement('button');
    shuffle.type = 'button';
    shuffle.className = 'shuffle';
    shuffle.textContent = t('loading.shuffle');
    shuffle.addEventListener('click', onShuffle);
    inner.append(swatch, name, shuffle);
    full.append(inner);

    box.append(compact, full);
    this.button.before(box);
    this.lookBox = box;
    this.compactRow = compact;
    this.playingLine = playing;
    this.fullCard = full;
    this.fullInner = inner;

    if (this.returning) {
      full.classList.add('collapsed');
      inner.setAttribute('inert', '');
    } else {
      compact.hidden = true;
    }

    const paint = (l: Look) => {
      const bg = `conic-gradient(${l.body} 0 50%, ${l.trim} 50% 100%)`;
      swatch.style.background = bg;
      miniSwatch.style.background = bg;
      name.textContent = l.name;
      this.lookName = l.name;
      this.renderPlayingLine();
    };
    paint(look);
    return paint;
  }

  /** Opens the full card in place of the compact line. It stays open for the rest of this page load. */
  private expand() {
    if (!this.compactRow || !this.fullCard || !this.fullInner) return;
    this.compactRow.hidden = true;
    this.fullCard.classList.remove('collapsed');
    this.fullInner.removeAttribute('inert');
  }

  private renderPlayingLine() {
    if (this.playingLine) fillPlayingLine(this.playingLine, t('loading.playingAs'), this.playerName, this.lookName);
  }

  /** Adds a name box under the look card. onCommit gets the typed text and returns the accepted name. */
  addNameField(initial: string, onCommit: (raw: string) => string): void {
    if (!this.fullInner) return;
    this.playerName = initial;
    const label = document.createElement('label');
    label.className = 'name-field';
    label.textContent = t('loading.name');
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'name-input';
    input.maxLength = 20;
    input.value = initial;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = t('loading.namePlaceholder');
    label.append(input);
    input.addEventListener('change', () => {
      input.value = onCommit(input.value);
      this.playerName = input.value;
      this.renderPlayingLine();
    });
    this.fullInner.append(label);
    this.renderPlayingLine();
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
    this.setProgress(1, t('loading.ready'));
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
        // Typing in the name box is not a start press.
        if (e.target instanceof HTMLInputElement) return;
        // Enter or Space on the Edit button presses that button instead of starting.
        if (e.target instanceof HTMLButtonElement && e.target.classList.contains('look-edit')) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!e.repeat) start();
      };
      this.button.addEventListener('click', start);
      window.addEventListener('keydown', onKey, true);
    });
  }
}
