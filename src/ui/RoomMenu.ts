import './room.css';
import { t } from '../i18n';
import type { Net } from '../net/Net';

/**
 * The 🔒 pill and its menu. Public: create a private room. Private: copy or share the invite link, or go back to
 * the public world. Switching rooms reloads the page; `flush` saves the game first. In ?solo the pill is hidden.
 */
export class RoomMenu {
  private pill = document.createElement('button');
  private menu = document.createElement('div');
  private field = document.createElement('input');

  constructor(
    private net: Net,
    private flush: () => void,
  ) {
    this.pill.id = 'room-toggle';
    this.pill.className = 'room-pill';
    this.pill.type = 'button';
    this.pill.textContent = '🔒';
    this.pill.title = t('room.title');
    this.pill.setAttribute('aria-label', t('room.title'));
    this.pill.setAttribute('aria-expanded', 'false');
    this.pill.hidden = net.solo;
    this.pill.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });

    this.menu.id = 'room-menu';
    this.menu.hidden = true;
    this.build();

    document.body.append(this.pill, this.menu);
    document.addEventListener('click', (e) => {
      const target = e.target as Node;
      if (!this.menu.hidden && !this.menu.contains(target) && !this.pill.contains(target)) this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && !this.menu.hidden) this.close();
    });
  }

  private build() {
    const title = document.createElement('div');
    title.className = 'r-title';
    title.textContent = t('room.title');
    this.menu.append(title);

    if (this.net.roomKind === 'public') {
      this.menu.append(this.text(t('room.publicText')), this.button(t('room.create'), () => this.create()));
      return;
    }

    this.menu.append(this.text(t('room.privateText')));
    this.menu.append(this.button(t('room.copy'), (b) => void this.copy(b)));
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      this.menu.append(this.button(t('room.share'), () => this.share()));
    }
    this.menu.append(this.button(t('room.back'), () => this.net.leavePrivateRoom(this.flush)));

    this.field.className = 'r-field';
    this.field.readOnly = true;
    this.field.hidden = true;
    this.field.setAttribute('aria-label', t('room.field'));
    this.menu.append(this.field);

    const note = document.createElement('div');
    note.className = 'r-note';
    note.textContent = t('room.note');
    this.menu.append(note);
  }

  private text(s: string): HTMLDivElement {
    const p = document.createElement('div');
    p.className = 'r-text';
    p.textContent = s;
    return p;
  }

  private button(label: string, onClick: (b: HTMLButtonElement) => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'r-btn';
    b.textContent = label;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick(b);
    });
    return b;
  }

  private create() {
    if (!window.confirm(t('room.confirm'))) return;
    this.net.enterPrivateRoom(this.flush);
  }

  /** Clipboard first. If the browser refuses, the link goes into a selectable field instead. */
  private async copy(b: HTMLButtonElement) {
    const link = this.net.inviteLink();
    if (!link) return;
    const label = b.textContent;
    try {
      await navigator.clipboard.writeText(link);
      b.textContent = t('room.copied');
      window.setTimeout(() => (b.textContent = label), 1500);
    } catch {
      this.field.value = link;
      this.field.hidden = false;
      this.field.focus();
      this.field.select();
    }
  }

  private share() {
    const url = this.net.inviteLink();
    if (!url) return;
    navigator.share({ title: 'Nongkrong 3D', url }).catch(() => {});
  }

  private toggle() {
    if (this.menu.hidden) this.open();
    else this.close();
  }

  private open() {
    this.menu.hidden = false;
    this.pill.setAttribute('aria-expanded', 'true');
  }

  private close() {
    this.menu.hidden = true;
    this.pill.setAttribute('aria-expanded', 'false');
  }
}
