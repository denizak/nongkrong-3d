import type { Net } from './Net';
import { turnServers } from './Net';

/**
 * Diagnostics for `?netdebug`: a small panel (1 Hz) and window.nongkrongNet for the console.
 * Does nothing without the query parameter.
 */
export class NetDebug {
  constructor(net: Net) {
    if (!new URLSearchParams(location.search).has('netdebug')) return;

    const win = window as Window & { nongkrongNet?: unknown };
    win.nongkrongNet = {
      get status() {
        return net.status;
      },
      get failedPeers() {
        return [...net.failedPeers];
      },
      get lastError() {
        return net.lastError;
      },
    };

    const el = document.createElement('pre');
    el.id = 'net-debug';
    document.body.append(el);
    const render = () => {
      const relays = net.relayStates();
      const lines = [
        `status      ${net.status}`,
        `selfId      ${net.selfId || '-'}`,
        `peers       ${net.online}`,
        `failed      ${net.failedPeers.size} (errors ${net.errorCount})`,
        `lastError   ${net.lastError.slice(0, 160) || '-'}`,
        `turn        ${turnServers() ? 'configured' : 'not set (STUN only)'}`,
        `navigator   ${navigator.onLine ? 'online' : 'offline'}`,
        'relays:',
        ...relays.map((r) => `  ${r.open ? 'open  ' : 'closed'} ${r.url}`),
      ];
      el.textContent = lines.join('\n');
    };
    render();
    window.setInterval(render, 1000);
  }
}
