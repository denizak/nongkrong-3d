import './quality.css';
import { t } from '../i18n';
import { quality, nextTier, TIERS, type Tier } from '../core/Quality';
import { isTyping } from '../world/DayNight';

/**
 * The ⚙️ pill and its small menu (High, Medium, Low). Q cycles the tiers. `apply` changes the tier, saves it and
 * returns true when something needs a reload to show in full (antialias, rice spacing, water shader).
 */
export class QualityMenu {
  private pill = document.createElement('button');
  private menu = document.createElement('div');
  private hint = document.createElement('div');
  private opts = new Map<Tier, HTMLButtonElement>();
  private needsReload = false;

  constructor(
    private apply: (tier: Tier) => boolean,
    private say: (msg: string) => void,
  ) {
    this.pill.id = 'quality-toggle';
    this.pill.className = 'quality-pill';
    this.pill.type = 'button';
    this.pill.textContent = '⚙️';
    this.pill.title = t('quality.title');
    this.pill.setAttribute('aria-label', t('quality.title'));
    this.pill.setAttribute('aria-expanded', 'false');
    this.pill.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });
    document.body.append(this.pill);

    this.menu.id = 'quality-menu';
    this.menu.hidden = true;
    const title = document.createElement('div');
    title.className = 'q-title';
    title.textContent = t('quality.menu');
    this.menu.append(title);
    for (const tier of TIERS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'q-opt';
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.choose(tier);
      });
      this.opts.set(tier, b);
      this.menu.append(b);
    }
    this.hint.className = 'q-hint';
    this.hint.hidden = true;
    this.hint.textContent = t('quality.reloadHint');
    const reload = document.createElement('button');
    reload.type = 'button';
    reload.className = 'q-reload';
    reload.textContent = t('quality.reload');
    reload.addEventListener('click', () => location.reload());
    this.hint.append(document.createElement('br'), reload);
    this.menu.append(this.hint);
    document.body.append(this.menu);

    document.addEventListener('click', (e) => {
      const target = e.target as Node;
      if (!this.menu.hidden && !this.menu.contains(target) && !this.pill.contains(target)) this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && !this.menu.hidden) this.close();
      if (e.code !== 'KeyQ' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTyping()) return;
      this.choose(nextTier(quality.tier), true);
    });

    const help = document.querySelector<HTMLElement>('#hud .help');
    if (help) help.textContent = `${help.textContent?.trimEnd() ?? ''}${t('help.quality')}`;
    this.refresh();
  }

  /** Shows or hides the reload hint. True means a build-time knob differs from what is on screen. */
  setNeedsReload(needs: boolean) {
    this.needsReload = needs;
    this.refresh();
  }

  private toggle() {
    if (this.menu.hidden) this.open();
    else this.close();
  }

  private open() {
    this.menu.hidden = false;
    this.pill.setAttribute('aria-expanded', 'true');
    this.refresh();
  }

  private close() {
    this.menu.hidden = true;
    this.pill.setAttribute('aria-expanded', 'false');
  }

  private choose(tier: Tier, fromKey = false) {
    this.needsReload = this.apply(tier);
    this.refresh();
    const msg = t('quality.set', { tier: t(`quality.${tier}`) });
    this.say(fromKey && this.needsReload ? `${msg} · ${t('quality.reloadHint')}` : msg);
  }

  private refresh() {
    for (const [tier, b] of this.opts) {
      const on = tier === quality.tier;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
      b.textContent = '';
      const label = document.createElement('span');
      label.textContent = t(`quality.${tier}`);
      const mark = document.createElement('span');
      mark.textContent = on ? '✓' : '';
      b.append(label, mark);
    }
    this.hint.hidden = !this.needsReload;
  }
}
