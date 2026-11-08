import { t } from '../i18n';
import type { Archipelago } from '../world/Archipelago';
import type { Net } from './Net';
import './net.css';

const REFRESH_S = 0.25;

/** "👥 3 online · 1 nearby", under the island pill. Says "offline" if joining failed. Hidden in ?solo. */
export class NetPill {
  private el = document.createElement('div');
  private text = '';
  private timer = 0;

  constructor(
    private net: Net,
    private arch: Archipelago,
  ) {
    this.el.id = 'net-pill';
    this.el.hidden = net.solo;
    document.body.append(this.el);
  }

  /** Call every frame; refreshes the text a few times a second. */
  update(dt: number) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = REFRESH_S;

    const net = this.net;
    let text: string;
    if (net.status === 'connecting') text = t('net.connecting');
    else if (net.status === 'offline') text = t('net.offline');
    else text = t('net.online', { online: net.online, nearby: net.nearby(this.arch.id) });
    if (text !== this.text) {
      this.text = text;
      this.el.textContent = text;
    }

    const island = document.getElementById('island-pill');
    if (island) {
      const r = island.getBoundingClientRect();
      this.el.style.left = `${r.left}px`;
      this.el.style.top = `${r.bottom + 6}px`;
    }
  }
}
