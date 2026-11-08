import { t } from '../i18n';
import type { Archipelago } from '../world/Archipelago';
import type { Net } from './Net';
import './net.css';

const REFRESH_S = 0.25;

/**
 * "👥 3 online · 1 nearby", under the island pill. Says "offline" only when joining is impossible.
 * When peers were found but could not connect, the pill explains it and a click shows a help note.
 * Hidden in ?solo.
 */
export class NetPill {
  private el = document.createElement('div');
  private help = document.createElement('div');
  private text = '';
  private timer = 0;
  private failing = false;

  constructor(
    private net: Net,
    private arch: Archipelago,
  ) {
    this.el.id = 'net-pill';
    this.el.hidden = net.solo;
    this.help.id = 'net-help';
    this.help.hidden = true;
    this.help.textContent = t('net.failedHelp');
    this.el.addEventListener('click', () => {
      if (this.failing) this.help.hidden = !this.help.hidden;
    });
    document.body.append(this.el, this.help);
  }

  /** Call every frame; refreshes the text a few times a second. */
  update(dt: number) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = REFRESH_S;

    const net = this.net;
    const failed = net.online === 0 && net.failedPeers.size > 0;
    let text: string;
    if (net.status === 'connecting') text = t('net.connecting');
    else if (net.status === 'offline') text = t('net.offline');
    else if (failed) text = t('net.failed', { n: net.failedPeers.size });
    else if (net.online === 0) text = t('net.zero');
    else text = t('net.online', { online: net.online, nearby: net.nearby(this.arch.id) });

    if (failed !== this.failing) {
      this.failing = failed;
      this.el.classList.toggle('net-pill--action', failed);
      if (!failed) this.help.hidden = true;
    }
    if (text !== this.text) {
      this.text = text;
      this.el.textContent = text;
    }

    const island = document.getElementById('island-pill');
    if (island) {
      const r = island.getBoundingClientRect();
      this.el.style.left = `${r.left}px`;
      this.el.style.top = `${r.bottom + 6}px`;
      this.help.style.left = `${r.left}px`;
      this.help.style.top = `${r.bottom + 6 + this.el.offsetHeight + 6}px`;
    }
  }
}
