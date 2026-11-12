import { t } from '../i18n';
import type { JoinError, JoinRoomConfig, MessageAction, Room, TurnServerConfig } from 'trystero';
import { decodeLook, encodeLook, makeLook, randomLook, type Look } from '../player/Look';
import type { Pose } from '../player/CharacterModel';
import { ISLAND_COUNT, inProxyWindow } from '../world/Islands';
import { deriveRoom, generateSecret, inviteUrl, parseSecret, readHashSecret } from './room';

/**
 * Peer-to-peer presence over WebRTC. Trystero finds peers through Nostr relays and then connects them directly.
 * Everything here works in each player's own island frame; RemotePlayers does the placement.
 *
 * Wire format (all JSON, namespaces are the action names):
 *   st  [islandId, x, y, z, heading, speed, poseCode, fishing]   x, y, z in that island's local frame; poseCode 0 stand, 1 sit, 2 lie; fishing 0|1
 *   hi  { n: name, l: encodeLook(look) }                         sent to new peers, and broadcast on change
 *   ch  { t: text }                                              chat, rate limited per sender
 */

export const APP_ID = 'nongkrong-3d-v2';
const ROOM_ID = 'world';
/** localStorage key for the remembered private room secret. Public play has no entry. */
const ROOM_KEY = 'nongkrong.room';
export const MAX_NAME = 20;
export const MAX_CHAT = 80;
const CHAT_GAP_MS = 1500;
/** A peer with no state for this long loses its avatar (the connection may still be up). */
export const STALE_MS = 15000;
/** Snapshots older than this are dropped, except the newest two. */
const KEEP_MS = 1000;
const NAME_KEY = 'nongkrong.name';
const WORDS = ['Kelapa', 'Mangga', 'Pisang', 'Nanas', 'Jeruk', 'Pandan', 'Melati', 'Kenari', 'Ombak', 'Pelangi'];
const FAKE_RADIUS = 4;
const FAKE_SPEED = 2;
/** Nostr relays used to find peers. Passed explicitly (full wss URLs) so one dead relay cannot stall joining. */
export const RELAY_URLS = [
  'wss://denizakya.xyz/nostr',
  'wss://nos.lol',
  'wss://relay.grigic.org',
  'wss://relay.degmods.com',
  'wss://relay.aarpia.com',
  'wss://nostr.rblb.it',
  'wss://relay.layer.systems',
  'wss://nostr.red5d.dev',
  'wss://relay.nostr.dev.br',
];
/** Offline only if no relay socket is open this long after joining. */
const RELAY_TIMEOUT_MS = 12000;
const WATCH_MS = 500;

/**
 * 'connecting': joining, no relay open yet. 'online': at least one relay open (peers may or may not be connected).
 * 'offline': joining threw, or no relay opened in time.
 */
export type NetStatus = 'off' | 'connecting' | 'online' | 'offline';
export type PoseCode = 0 | 1 | 2;
const POSES: Pose[] = ['stand', 'sit', 'lie'];

/** What the local player reports each tick. */
export interface NetSelf {
  /** Island id of the live island (see Islands.ts). */
  island: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
  pose: Pose;
  fishing: boolean;
}

export interface Snapshot {
  /** Local receive time (performance.now, ms). */
  t: number;
  /** The island the peer was on, in its local coordinates below. */
  island: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
  pose: Pose;
  fishing: boolean;
}

export interface RemotePeer {
  id: string;
  name: string;
  look: Look;
  snaps: Snapshot[];
  /** performance.now of the last state (or fake update). */
  lastState: number;
  lastChat: number;
  fake: boolean;
  /** Fake peers only: angle around the local player. */
  angle: number;
  /** Fake peers only: the pose they report. */
  fakePose: Pose;
}

export interface PeerView {
  id: string;
  name: string;
  island: number | null;
  pos: { x: number; y: number; z: number } | null;
}

type StateMsg = [number, number, number, number, number, number, number, number];
type HiMsg = { n: string; l: string };
type ChatMsg = { t: string };

/** Trims, drops control characters and truncates. */
function clean(s: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Validates an incoming state message. Returns null for anything malformed. */
function parseState(d: unknown): Omit<Snapshot, 't'> | null {
  if (!Array.isArray(d) || d.length < 8) return null;
  const [island, x, y, z, heading, speed, pose, fishing] = d;
  if (!Number.isInteger(island) || (island as number) < 0 || (island as number) >= ISLAND_COUNT) return null;
  if (!isNum(x) || !isNum(y) || !isNum(z) || !isNum(heading) || !isNum(speed)) return null;
  if (Math.abs(x) >= 200 || Math.abs(z) >= 200 || Math.abs(y) >= 100) return null;
  if (Math.abs(heading) > 1000 || speed < 0 || speed > 50) return null;
  if (pose !== 0 && pose !== 1 && pose !== 2) return null;
  if (fishing !== 0 && fishing !== 1) return null;
  return {
    island: island as number,
    x,
    y,
    z,
    heading,
    speed,
    pose: POSES[pose as number],
    fishing: fishing === 1,
  };
}

/** The look used for peers whose look is missing or invalid. */
const DEFAULT_LOOK = makeLook(0, '#f08a6c', '#3b434c');

/**
 * TURN servers from build-time env (VITE_TURN_URLS, comma separated; optional VITE_TURN_USERNAME and
 * VITE_TURN_CREDENTIAL). Null when unset, so the game uses STUN only.
 */
export function turnServers(): TurnServerConfig[] | null {
  const urls = (import.meta.env.VITE_TURN_URLS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (urls.length === 0) return null;
  return [
    {
      urls,
      username: import.meta.env.VITE_TURN_USERNAME || undefined,
      credential: import.meta.env.VITE_TURN_CREDENTIAL || undefined,
    },
  ];
}

export type RoomKind = 'public' | 'private';

/** Stores a private room secret so the room survives reloads without the link. Storage blocked: ignored. */
function storeRoom(secret: string) {
  try {
    localStorage.setItem(ROOM_KEY, secret);
  } catch {
    // Storage blocked: this visit still uses the room.
  }
}

/**
 * The private room for this visit: the fragment wins (and is remembered), else the remembered secret, else null
 * (the public world).
 */
function resolveSecret(): string | null {
  const fromHash = readHashSecret(location);
  if (fromHash) {
    storeRoom(fromHash);
    return fromHash;
  }
  try {
    return parseSecret(localStorage.getItem(ROOM_KEY));
  } catch {
    return null;
  }
}

function newPeer(id: string, name: string, look: Look, fake = false): RemotePeer {
  return { id, name, look, snaps: [], lastState: 0, lastChat: -Infinity, fake, angle: Math.random() * Math.PI * 2, fakePose: 'stand' };
}

function loadName(): string {
  try {
    const saved = clean(localStorage.getItem(NAME_KEY) ?? '', MAX_NAME);
    if (saved) return saved;
  } catch {
    // Storage blocked: fall through to a random name for this session.
  }
  const word = WORDS[Math.floor(Math.random() * WORDS.length)];
  const name = `${word} ${10 + Math.floor(Math.random() * 90)}`;
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // Storage blocked: the name still works for this session.
  }
  return name;
}

export class Net {
  /** Networking is off entirely (?solo). */
  readonly solo: boolean;
  status: NetStatus = 'off';
  /** The local display name. */
  name: string;
  /** Known remote peers, including fake ones. Peers are added on join and removed on leave. */
  readonly remotes = new Map<string, RemotePeer>();
  /** Called when peers join or leave. */
  onChange: (() => void) | null = null;
  /** Called with a validated, rate-limited chat message from a peer. */
  onChat: ((peerId: string, text: string) => void) | null = null;
  /** Called with each joined Trystero room (again after a rejoin). Voice chat attaches here. */
  onRoom: ((room: Room) => void) | null = null;

  private room: Room | null = null;
  private peerId = '';
  private st: MessageAction<StateMsg> | null = null;
  private hi: MessageAction<HiMsg> | null = null;
  private ch: MessageAction<ChatMsg> | null = null;
  private sinceSend = 1;
  private lastSent: { key: string; moving: boolean } | null = null;
  private identityKey = '';
  private lastChatSent = -Infinity;
  private fakeCount = 0;
  private lastMe: NetSelf | null = null;
  private started = false;
  private retried = false;
  private sockets: () => Record<string, WebSocket> = () => ({});
  private startedAt = 0;
  private watchTimer = 0;
  /** Peers whose direct connection failed after signalling. Cleared when they connect or leave. */
  readonly failedPeers = new Set<string>();
  /** The latest per-peer connection error from Trystero (diagnostics). */
  lastError = '';
  /** Number of per-peer connection errors reported so far. */
  errorCount = 0;

  /** The private room secret, or null for the public world. Never logged, shown or exposed. */
  private readonly secret: string | null;

  constructor(private getLook: () => Look, opts: { solo?: boolean } = {}) {
    this.solo = !!opts.solo;
    this.secret = resolveSecret();
    this.name = loadName();
    if (!this.solo) window.addEventListener('online', () => void this.onNetworkBack());
  }

  /** The Trystero peer id of this player. Empty until joined. */
  get selfId(): string {
    return this.peerId;
  }

  /** 'private' when this visit is in an invite-link room (or a remembered one), else 'public'. */
  get roomKind(): RoomKind {
    return this.secret ? 'private' : 'public';
  }

  /** The invite link for the current private room, or null in the public world. */
  inviteLink(): string | null {
    return this.secret ? inviteUrl(this.secret, location.origin, import.meta.env.BASE_URL) : null;
  }

  /**
   * Moves to a new private room (a fresh secret unless given) by reloading the page. `flush` saves the game first.
   * The secret is stored and put in the fragment, so the reloaded page joins that room.
   */
  enterPrivateRoom(flush: () => void, secret: string = generateSecret()): void {
    if (!parseSecret(secret)) return;
    flush();
    storeRoom(secret);
    location.hash = `r=${secret}`;
    location.reload();
  }

  /** Back to the public world: forgets the private room, drops the fragment, saves, and reloads. */
  leavePrivateRoom(flush: () => void): void {
    try {
      localStorage.removeItem(ROOM_KEY);
    } catch {
      // Storage blocked: the fragment is still removed below.
    }
    history.replaceState(history.state, '', location.pathname + location.search);
    flush();
    location.reload();
  }

  /** Number of connected remote peers (fake ones included). */
  get online(): number {
    return this.remotes.size;
  }

  /** Connected peers whose last known island is within the proxy window of `island`, and who are not stale. */
  nearby(island: number): number {
    const now = performance.now();
    let n = 0;
    for (const p of this.remotes.values()) {
      const s = p.snaps[p.snaps.length - 1];
      if (!s || now - p.lastState > STALE_MS) continue;
      if (inProxyWindow(island, s.island)) n++;
    }
    return n;
  }

  /**
   * Joins the global room. Loads Trystero on demand so the game is not delayed. Joining that throws
   * leaves the status 'offline'; per-peer connection failures are only recorded (see onJoinError).
   */
  async start(): Promise<void> {
    if (this.started || this.solo) return;
    this.started = true;
    this.setStatus('connecting');
    try {
      const t = await import('trystero');
      this.sockets = () => t.getRelaySockets();
      const turn = turnServers();
      // Public: the fixed id and no password, as before. Private: a hashed id and a key derived from the secret.
      const priv = this.secret ? await deriveRoom(this.secret) : null;
      const config: JoinRoomConfig = {
        appId: APP_ID,
        relayConfig: { urls: RELAY_URLS },
        ...(priv ? { password: priv.password } : {}),
        ...(turn ? { turnConfig: turn } : {}),
      };
      const room = t.joinRoom(config, priv?.roomId ?? ROOM_ID, {
        onJoinError: (e) => this.onJoinError(e),
      });
      this.room = room;
      this.peerId = t.selfId;
      this.onRoom?.(room);
      this.st = room.makeAction<StateMsg>('st');
      this.hi = room.makeAction<HiMsg>('hi');
      this.ch = room.makeAction<ChatMsg>('ch');
      this.st.onMessage = (data, ctx) => this.onState(ctx.peerId, data);
      this.hi.onMessage = (data, ctx) => this.onHi(ctx.peerId, data);
      this.ch.onMessage = (data, ctx) => this.onChatMsg(ctx.peerId, data);
      room.onPeerJoin = (id) => this.onJoin(id);
      room.onPeerLeave = (id) => this.onLeave(id);
      window.addEventListener('pagehide', () => void room.leave().catch(() => {}), { once: true });
      this.startedAt = performance.now();
      this.startWatch();
    } catch (err) {
      console.warn('Multiplayer unavailable, playing offline.', err);
      this.setStatus('offline');
    }
  }

  /** Relay sockets this client uses, and whether each is open right now. */
  relayStates(): { url: string; open: boolean }[] {
    let socks: Record<string, WebSocket> = {};
    try {
      socks = this.sockets() ?? {};
    } catch {
      // Trystero not loaded yet: every relay counts as closed.
    }
    return RELAY_URLS.map((url) => ({ url, open: socks[url]?.readyState === WebSocket.OPEN }));
  }

  /** Polls the relays: 'online' once any is open, 'offline' if none opened within the timeout. */
  private startWatch() {
    window.clearInterval(this.watchTimer);
    this.watchTimer = window.setInterval(() => this.checkRelays(), WATCH_MS);
    this.checkRelays();
  }

  private checkRelays() {
    const anyOpen = this.relayStates().some((r) => r.open);
    if (anyOpen && this.status !== 'online') {
      this.setStatus('online');
    } else if (!anyOpen && this.status === 'connecting' && performance.now() - this.startedAt >= RELAY_TIMEOUT_MS) {
      this.setStatus('offline');
    }
  }

  /** Trystero reports a peer whose direct connection failed. The room itself still works. */
  private onJoinError(e: JoinError) {
    this.errorCount++;
    this.lastError = e.error;
    if (!this.failedPeers.has(e.peerId)) {
      this.failedPeers.add(e.peerId);
      console.warn(`Could not connect directly to player ${e.peerId}: ${e.error}`);
    }
    this.notify();
  }

  /** The browser came back online after we gave up: try joining again, once. */
  private async onNetworkBack() {
    if (this.status !== 'offline' || this.retried) return;
    this.retried = true;
    if (this.room) await this.room.leave().catch(() => {});
    this.room = null;
    this.st = null;
    this.hi = null;
    this.ch = null;
    this.remotes.clear();
    this.failedPeers.clear();
    this.started = false;
    await this.start();
  }

  /** Sets the display name (trimmed, max 20). Returns the accepted name, or null if it is empty. */
  setName(raw: string): string | null {
    const name = clean(raw, MAX_NAME);
    if (!name) return null;
    this.name = name;
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch {
      // Storage blocked: the name still works for this session.
    }
    return name;
  }

  /** Broadcasts a chat message. Dropped if sent too soon after the last one. */
  sendChat(raw: string) {
    const t = clean(raw, MAX_CHAT);
    const now = performance.now();
    if (!t || !this.ch || !this.room || now - this.lastChatSent < CHAT_GAP_MS) return;
    this.lastChatSent = now;
    this.ch.send({ t }).catch(() => {});
  }

  /** Called once per frame with the local state. Sends at 10 Hz while moving, 2 Hz while still. */
  tick(dt: number, me: NetSelf) {
    this.lastMe = me;

    const identity = `${this.name}|${encodeLook(this.getLook())}`;
    if (identity !== this.identityKey) {
      this.identityKey = identity;
      this.broadcastHi();
    }

    this.sinceSend += dt;
    const moving = me.speed > 0.1;
    const key = `${me.island},${me.pose},${me.fishing ? 1 : 0}`;
    const changed = !this.lastSent || key !== this.lastSent.key || moving !== this.lastSent.moving;
    const interval = moving ? 0.1 : 0.5;
    if (this.st && this.room && this.remotes.size > 0 && (this.sinceSend >= interval || (changed && this.sinceSend >= 0.1))) {
      this.sinceSend = 0;
      this.lastSent = { key, moving };
      const msg: StateMsg = [
        me.island,
        round(me.x, 1000),
        round(me.y, 1000),
        round(me.z, 1000),
        round(me.heading, 1000),
        round(me.speed, 100),
        POSES.indexOf(me.pose),
        me.fishing ? 1 : 0,
      ];
      this.st.send(msg).catch(() => {});
    }

    this.updateFakes(dt, me);
  }

  /** Dev: adds a local fake peer that walks in a circle around the player. Returns its id. */
  debugFakePeer(): string {
    const n = ++this.fakeCount;
    const id = `fake-${n}`;
    this.remotes.set(id, newPeer(id, t('net.pal', { n }), randomLook(), true));
    this.notify();
    return id;
  }

  /** Dev: sets the pose a fake peer reports (stand, sit or lie). */
  debugSetFakePose(id: string, pose: Pose): boolean {
    const p = this.remotes.get(id);
    if (!p?.fake) return false;
    p.fakePose = pose;
    return true;
  }

  /** Dev: the connected peers and where they are. */
  peers(): PeerView[] {
    return [...this.remotes.values()].map((p) => {
      const s = p.snaps[p.snaps.length - 1];
      return {
        id: p.id,
        name: p.name,
        island: s ? s.island : null,
        pos: s ? { x: s.x, y: s.y, z: s.z } : null,
      };
    });
  }

  /** Stores a snapshot for a peer and prunes old ones. */
  pushSnapshot(p: RemotePeer, s: Snapshot) {
    p.snaps.push(s);
    p.lastState = s.t;
    while (p.snaps.length > 2 && p.snaps[0].t < s.t - KEEP_MS) p.snaps.shift();
  }

  private updateFakes(dt: number, me: NetSelf) {
    const now = performance.now();
    for (const p of this.remotes.values()) {
      if (!p.fake) continue;
      p.angle += dt * (FAKE_SPEED / FAKE_RADIUS);
      const a = p.angle;
      this.pushSnapshot(p, {
        t: now,
        island: me.island,
        x: me.x + Math.cos(a) * FAKE_RADIUS,
        y: me.y,
        z: me.z + Math.sin(a) * FAKE_RADIUS,
        // Velocity is (-sin a, cos a) for increasing a.
        heading: Math.atan2(-Math.sin(a), Math.cos(a)),
        speed: FAKE_SPEED,
        pose: p.fakePose,
        fishing: false,
      });
    }
  }

  private onJoin(id: string) {
    if (!this.remotes.has(id)) this.remotes.set(id, newPeer(id, t('net.friend'), DEFAULT_LOOK));
    this.failedPeers.delete(id);
    if (this.status !== 'online') this.setStatus('online');
    this.hi?.send(this.hiPayload(), { target: id }).catch(() => {});
    this.notify();
  }

  private onLeave(id: string) {
    this.remotes.delete(id);
    this.failedPeers.delete(id);
    this.notify();
  }

  private onState(id: string, data: unknown) {
    const s = parseState(data);
    const p = this.remotes.get(id);
    if (!s || !p) return;
    this.pushSnapshot(p, { ...s, t: performance.now() });
  }

  private onHi(id: string, data: unknown) {
    const p = this.remotes.get(id);
    if (!p || !data || typeof data !== 'object') return;
    const d = data as Partial<HiMsg>;
    const name = typeof d.n === 'string' ? clean(d.n, MAX_NAME) : '';
    p.name = name || t('net.friend');
    p.look = (typeof d.l === 'string' ? decodeLook(d.l) : null) ?? DEFAULT_LOOK;
  }

  private onChatMsg(id: string, data: unknown) {
    const p = this.remotes.get(id);
    if (!p || !data || typeof data !== 'object') return;
    const raw = (data as Partial<ChatMsg>).t;
    if (typeof raw !== 'string') return;
    const now = performance.now();
    if (now - p.lastChat < CHAT_GAP_MS) return;
    const text = clean(raw, MAX_CHAT);
    if (!text) return;
    p.lastChat = now;
    this.onChat?.(id, text);
  }

  private hiPayload(): HiMsg {
    return { n: this.name, l: encodeLook(this.getLook()) };
  }

  private broadcastHi() {
    if (!this.hi || !this.room) return;
    this.hi.send(this.hiPayload()).catch(() => {});
  }

  private setStatus(s: NetStatus) {
    this.status = s;
    this.notify();
  }

  private notify() {
    this.onChange?.();
  }

  /** The local player's last reported state, for dev tools. */
  get me(): NetSelf | null {
    return this.lastMe;
  }
}

function round(v: number, scale: number): number {
  return Math.round(v * scale) / scale;
}
