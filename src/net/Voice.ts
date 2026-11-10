import * as THREE from 'three/webgpu';
import { t } from '../i18n';
import { quality } from '../core/Quality';
import { centreOf, type Vec2 } from '../world/Islands';
import { placeOn } from '../ui/SpeechBubble';
import { STALE_MS, type Net, type Snapshot } from './Net';
import { VOICE_CAP, VOICE_CAP_LOW, parseVc, selectAudioPeers, voiceGain, voicePan } from './voiceMath';
import { voiceIcon } from './voiceIcon';
import type { MessageAction, Room } from 'trystero';
import type { AudioManager } from '../audio/AudioManager';
import type { Input } from '../core/Input';
import '../ui/voice.css';

/**
 * Proximity voice chat. Hold V (or hold the touch mic) to talk, or switch to open mic. Your voice is sent only to
 * players within 20 m of you, in world distance, and heard only within 20 m of the speaker, panned left or right.
 *
 * Loaded only when networking is on (not ?solo). Trystero carries the audio as WebRTC media streams; the received
 * streams go through the game's AudioContext, through a per-peer gain and stereo panner, into the voice bus.
 */

const SETTINGS_KEY = 'nongkrong.voice';
/** How often the send set is recomputed, and how often gains are updated (s). */
const SEND_EVERY = 0.5;
const GAIN_EVERY = 0.1;
/** Gain and pan smoothing time constant (s). */
const SMOOTH_S = 0.08;
/** The mic is released after this long without talking (s), so the browser's recording indicator goes away. */
const TALK_IDLE_S = 30;
/** While talking, the speaking flag is re-sent this often (ms), so a lost 'vc' message cannot leave a stale icon. */
const KEEPALIVE_MS = 1000;
/** A speaking flag from 'vc' expires this long after the last 'on' message (ms). */
const VC_FRESH_MS = 2500;
/** Speech on received audio: RMS above this counts, and holds the icon for SPEAK_HOLD_MS. */
const SPEECH_RMS = 0.02;
const SPEAK_HOLD_MS = 500;
const MIC: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  video: false,
};

type Mode = 'hold' | 'open';
type MicState = 'idle' | 'talking' | 'blocked';

interface Settings {
  mode: Mode;
  volume: number;
  muted: boolean;
}

interface Fake {
  /** Dev only: distance (m) and angle (rad, positive is to the right of the camera) from the local player. */
  dist: number;
  angle: number;
  cleanup: () => void;
}

/** One received voice: the stream and the nodes that play it. */
interface Link {
  id: string;
  stream: MediaStream;
  el: HTMLAudioElement;
  src: MediaStreamAudioSourceNode;
  gain: GainNode;
  panner: StereoPannerNode;
  analyser: AnalyserNode;
  buf: Float32Array<ArrayBuffer>;
  fake: Fake | null;
  target: number;
  pan: number;
  dist: number;
}

interface Me {
  island: number;
  pos: { x: number; y: number; z: number };
}

export interface VoiceDeps {
  net: Net;
  audio: AudioManager;
  input: Input;
  /** Shows a one-line message (a toast). */
  say: (msg: string) => void;
}

const isEditable = (el: EventTarget | null) =>
  el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable);

function loadSettings(): Settings {
  const fallback: Settings = { mode: 'hold', volume: 1, muted: false };
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as Partial<Settings> | null;
    if (!raw || typeof raw !== 'object') return fallback;
    return {
      mode: raw.mode === 'open' ? 'open' : 'hold',
      volume: typeof raw.volume === 'number' && Number.isFinite(raw.volume) ? Math.min(1, Math.max(0, raw.volume)) : 1,
      muted: raw.muted === true,
    };
  } catch {
    return fallback;
  }
}

function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // Storage blocked: the choice lasts for this page.
  }
}

function div(cls: string, text = ''): HTMLDivElement {
  const el = document.createElement('div');
  el.className = cls;
  el.textContent = text;
  return el;
}

function optButton(label: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'v-opt';
  b.textContent = label;
  return b;
}

export class Voice {
  /** False when the browser lacks WebRTC or Web Audio, or after a failure. Then the pill is hidden and nothing runs. */
  enabled: boolean;
  private net: Net;
  private audio: AudioManager;
  private input: Input;
  private say: (msg: string) => void;
  private settings: Settings = loadSettings();

  private room: Room | null = null;
  private vc: MessageAction<{ s: number }> | null = null;
  private ctx: AudioContext | null = null;
  private bus: GainNode | null = null;

  /** My microphone, or null when released. Its track is enabled only while talking. */
  private stream: MediaStream | null = null;
  private acquiring = false;
  private blocked = false;
  /** The player is holding V or the mic button (or toggled open mic on). */
  private wantTalk = false;
  private talking = false;
  /** Peers my stream is currently added to. */
  private sending = new Set<string>();
  private clock = 0;
  private lastTalkEnd = 0;
  private lastVcSent = 0;

  private links = new Map<string, Link>();
  private pending = new Map<string, MediaStream>();
  /** Last time each peer said 'vc s:1' (performance.now, ms). */
  private vcOn = new Map<string, number>();
  /** Speech detected on received audio until this time (performance.now, ms). */
  private speakUntil = new Map<string, number>();
  /** Peers I muted for this session. I neither hear them nor send to them. */
  private mutedPeers = new Set<string>();
  private fakeCount = 0;

  /** Listener frame, on the ground plane: forward (fx, fz) and right (rx, rz), and my world position. */
  private fx = 0;
  private fz = -1;
  private rx = 1;
  private rz = 0;
  private me: Me = { island: 0, pos: { x: 0, y: 0, z: 0 } };
  private gainAcc = 0;
  private sendAcc = 0;
  private readonly dir = new THREE.Vector3();
  private readonly anchor = new THREE.Vector3();

  private micBtns = new Set<HTMLButtonElement>();
  private pill: HTMLButtonElement | null = null;
  private menu: HTMLDivElement | null = null;
  private selfIcon: HTMLDivElement | null = null;
  private modeBtns = new Map<Mode, HTMLButtonElement>();
  private muteBtn: HTMLButtonElement | null = null;
  private volEl: HTMLInputElement | null = null;
  private hintEl: HTMLDivElement | null = null;
  private blockedEl: HTMLDivElement | null = null;

  constructor(deps: VoiceDeps) {
    this.net = deps.net;
    this.audio = deps.audio;
    this.input = deps.input;
    this.say = deps.say;
    const hasAudio = typeof (window.AudioContext ?? (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext) === 'function';
    this.enabled = typeof RTCPeerConnection !== 'undefined' && hasAudio;
    if (!this.enabled) return;
    try {
      if (!navigator.mediaDevices?.getUserMedia) this.blocked = true;
      this.buildUi();
      this.audio.onUnlock(() => this.onAudio());
      window.addEventListener('keydown', this.onKeyDown);
      window.addEventListener('keyup', this.onKeyUp);
      window.addEventListener('blur', () => this.release());
      this.net.onRoom = (room) => this.attach(room);
      const help = document.querySelector<HTMLElement>('#hud .help');
      if (help) help.textContent = `${help.textContent?.trimEnd() ?? ''}${t('help.voice')}`;
      this.refresh();
    } catch {
      this.disable();
    }
  }

  /** True while I am talking (mic on and V held, or open mic on). */
  get talkingNow(): boolean {
    return this.talking;
  }

  /** True when this peer's voice is speaking now: a fresh 'vc' flag, or speech detected on their audio. */
  isSpeaking(id: string): boolean {
    if (!this.enabled || this.mutedPeers.has(id)) return false;
    const now = performance.now();
    const on = this.vcOn.get(id);
    if (on !== undefined && now - on < VC_FRESH_MS) return true;
    return (this.speakUntil.get(id) ?? 0) > now;
  }

  isPeerMuted(id: string): boolean {
    return this.mutedPeers.has(id);
  }

  /** Mutes or unmutes one player for this session. Returns the new muted state. */
  togglePeerMute(id: string): boolean {
    if (this.mutedPeers.has(id)) this.mutedPeers.delete(id);
    else this.mutedPeers.add(id);
    this.syncSend();
    return this.mutedPeers.has(id);
  }

  /**
   * Wires a touch button as the mic. Hold mode: press to talk, release to stop. Open mic: each tap toggles.
   * Pressing starts from the pointer handler directly, so the mic prompt counts as a user gesture.
   */
  attachMicButton(btn: HTMLButtonElement) {
    if (!this.enabled) return;
    this.micBtns.add(btn);
    btn.addEventListener('pointerdown', () => {
      if (this.settings.mode === 'hold') this.press();
    });
    const end = () => {
      if (this.settings.mode === 'hold') this.release();
    };
    btn.addEventListener('pointerup', end);
    btn.addEventListener('pointercancel', end);
    btn.addEventListener('pointerleave', end);
    btn.addEventListener('click', () => {
      if (this.settings.mode === 'open') this.tap();
    });
    this.refresh();
  }

  /** Call once per frame, after the camera and the local player are updated. */
  update(dt: number, camera: THREE.Camera, me: Me) {
    if (!this.enabled) return;
    this.clock += dt;
    this.me = me;
    camera.updateMatrixWorld();
    camera.getWorldDirection(this.dir);
    let fx = this.dir.x;
    let fz = this.dir.z;
    const len = Math.hypot(fx, fz);
    if (len < 1e-6) {
      fx = 0;
      fz = -1;
    } else {
      fx /= len;
      fz /= len;
    }
    this.fx = fx;
    this.fz = fz;
    this.rx = -fz;
    this.rz = fx;

    this.gainAcc += dt;
    if (this.gainAcc >= GAIN_EVERY) {
      this.gainAcc = 0;
      this.applyGains();
    }
    this.sendAcc += dt;
    if (this.sendAcc >= SEND_EVERY) {
      this.sendAcc = 0;
      this.tickSlow();
    }
    if (this.selfIcon) {
      if (this.talking) {
        this.anchor.set(me.pos.x, me.pos.y + 2.6, me.pos.z);
        placeOn(this.selfIcon, this.anchor, camera, 60);
      } else {
        this.selfIcon.style.visibility = 'hidden';
      }
    }
  }

  /** Starts talking: the mic is requested on the first press (a user gesture). */
  press() {
    if (!this.enabled) return;
    this.audio.unlockNow();
    this.wantTalk = true;
    if (!this.stream && !this.blocked) this.acquire();
    if (this.stream) this.setTalking(true);
    this.refresh();
  }

  release() {
    this.wantTalk = false;
    this.setTalking(false);
    this.refresh();
  }

  /** Open mic: toggles talking on or off. */
  tap() {
    if (this.wantTalk) this.release();
    else this.press();
  }

  /** Dev and test handle: a fake remote speaker routed through the same receiving graph as a real peer. */
  debugFakeSpeaker(distance: number, angle: number) {
    const ctx = this.ctx;
    if (!this.enabled || !ctx) return null;
    const id = `fake-voice-${++this.fakeCount}`;
    const osc = ctx.createOscillator();
    osc.frequency.value = 220;
    const dest = ctx.createMediaStreamDestination();
    osc.connect(dest);
    osc.start();
    const fake: Fake = {
      dist: distance,
      angle,
      cleanup: () => {
        try {
          osc.stop();
        } catch {
          // Not started: nothing to stop.
        }
        osc.disconnect();
      },
    };
    this.attachStream(id, dest.stream, fake);
    const link = this.links.get(id);
    return link ? { id, oscillator: osc, destination: dest, gainNode: link.gain, pannerNode: link.panner, analyser: link.analyser } : null;
  }

  /** Dev and test handle: the current gain, pan and distance for a received voice. */
  debugGain(id: string) {
    const L = this.links.get(id);
    if (!L) return null;
    return {
      gain: L.gain.gain.value,
      target: L.target,
      pan: L.panner.pan.value,
      panTarget: L.pan,
      distance: L.dist,
      bus: this.bus?.gain.value ?? null,
      speaking: this.isSpeaking(id),
    };
  }

  debugStopFake(id: string) {
    this.teardown(id);
  }

  // ---- Keyboard ------------------------------------------------------------

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.enabled || e.code !== 'KeyV' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (this.input.typing || isEditable(e.target)) return;
    if (this.settings.mode === 'open') this.tap();
    else this.press();
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (!this.enabled || e.code !== 'KeyV') return;
    if (this.settings.mode === 'hold') this.release();
  };

  // ---- Microphone ----------------------------------------------------------

  /**
   * Requests the mic. Called synchronously from the gesture handler, so the browser counts it as a user action.
   */
  private acquire() {
    const md = navigator.mediaDevices;
    if (this.acquiring || this.stream) return;
    if (!md?.getUserMedia) {
      this.setBlocked();
      return;
    }
    this.acquiring = true;
    let req: Promise<MediaStream>;
    try {
      req = md.getUserMedia(MIC);
    } catch {
      this.acquiring = false;
      this.setBlocked();
      return;
    }
    req.then(
      (s) => {
        this.acquiring = false;
        if (!this.enabled) {
          for (const tr of s.getTracks()) tr.stop();
          return;
        }
        this.stream = s;
        for (const tr of s.getAudioTracks()) tr.enabled = false;
        this.lastTalkEnd = this.clock;
        this.syncSend();
        if (this.wantTalk) this.setTalking(true);
        this.refresh();
      },
      () => {
        this.acquiring = false;
        this.setBlocked();
      },
    );
  }

  private setBlocked() {
    if (!this.blocked) this.say(t('voice.blockedToast'));
    this.blocked = true;
    this.wantTalk = false;
    this.setTalking(false);
    this.refresh();
  }

  /** Stops the mic, removes it from every peer it was sent to, and releases the device. */
  private stopMic() {
    const s = this.stream;
    if (!s) return;
    this.stream = null;
    this.setTalking(false);
    if (this.room && this.sending.size > 0) {
      try {
        this.room.removeStream(s, { target: [...this.sending] });
      } catch {
        // The peers are gone or the connection is closing: nothing to remove.
      }
    }
    this.sending.clear();
    for (const tr of s.getTracks()) tr.stop();
    this.refresh();
  }

  private setTalking(on: boolean) {
    const want = on && !!this.stream && !this.blocked;
    const track = this.stream?.getAudioTracks()[0];
    if (track) track.enabled = want;
    if (want === this.talking) return;
    this.talking = want;
    if (!want) this.lastTalkEnd = this.clock;
    this.sendVc(want);
    this.refresh();
  }

  /** Tells everyone whether I am talking. One byte per change, plus a keepalive while talking. */
  private sendVc(on: boolean) {
    this.lastVcSent = performance.now();
    try {
      this.vc?.send({ s: on ? 1 : 0 }).catch(() => {});
    } catch {
      // Not connected yet: the next change will carry the state.
    }
  }

  // ---- Who gets my voice ---------------------------------------------------

  /** My world position on the ground plane. Local positions are relative to the live island's centre. */
  private worldMe(): Vec2 {
    const c = centreOf(this.me.island);
    return { x: c.x + this.me.pos.x, z: c.z + this.me.pos.z };
  }

  /**
   * Makes the set of peers receiving my stream match the nearest peers within 20 m (stopping at 24 m, see
   * selectAudioPeers). Muted, failed and stale peers are excluded.
   */
  private syncSend() {
    const room = this.room;
    if (!room || !this.stream) {
      this.sending.clear();
      return;
    }
    const me = this.worldMe();
    const now = performance.now();
    const dists: Record<string, number> = {};
    for (const p of this.net.remotes.values()) {
      if (p.fake || this.mutedPeers.has(p.id) || this.net.failedPeers.has(p.id)) continue;
      const s = p.snaps[p.snaps.length - 1];
      if (!s || now - p.lastState > STALE_MS) continue;
      dists[p.id] = worldDistance(s, me);
    }
    const cap = quality.tier === 'low' ? VOICE_CAP_LOW : VOICE_CAP;
    const want = selectAudioPeers(dists, this.sending, cap);
    const add = [...want].filter((id) => !this.sending.has(id));
    const drop = [...this.sending].filter((id) => !want.has(id));
    try {
      if (drop.length > 0) {
        room.removeStream(this.stream, { target: drop });
        for (const id of drop) this.sending.delete(id);
      }
      if (add.length > 0) {
        for (const p of room.addStream(this.stream, { target: add })) p.catch(() => {});
        for (const id of add) this.sending.add(id);
      }
    } catch {
      this.disable();
    }
  }

  // ---- Receiving -----------------------------------------------------------

  private attach(room: Room) {
    if (!this.enabled) return;
    this.dropAllLinks();
    this.sending.clear();
    try {
      if (typeof room.addStream !== 'function' || typeof room.removeStream !== 'function') throw new Error('no media');
      this.vc = room.makeAction<{ s: number }>('vc');
      this.vc.onMessage = (data, ctx) => this.onVc(ctx.peerId, data);
      room.onPeerStream = (stream, peerId) => this.onPeerStream(stream, peerId);
      this.room = room;
    } catch {
      this.disable();
    }
  }

  private onPeerStream(stream: MediaStream, id: string) {
    if (!this.enabled || this.net.failedPeers.has(id)) return;
    if (!this.ctx) {
      this.pending.set(id, stream);
      return;
    }
    this.attachStream(id, stream, null);
  }

  private onVc(id: string, data: unknown) {
    const on = parseVc(data);
    if (on === null || !this.net.remotes.has(id)) return;
    if (on) this.vcOn.set(id, performance.now());
    else this.vcOn.delete(id);
  }

  /** Builds the receiving graph for one peer: stream, gain, stereo panner, and the voice bus. */
  private attachStream(id: string, stream: MediaStream, fake: Fake | null) {
    const ctx = this.ctx;
    const bus = this.bus;
    if (!ctx || !bus) return;
    const old = this.links.get(id);
    if (old && old.stream === stream) return;
    if (old) this.teardown(id);
    try {
      // A muted, detached element keeps the remote WebRTC stream flowing in Chrome. The sound itself comes from the graph.
      const el = new Audio();
      el.muted = true;
      el.srcObject = stream;
      void el.play().catch(() => {});
      const src = ctx.createMediaStreamSource(stream);
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const panner = ctx.createStereoPanner();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      src.connect(gain);
      gain.connect(panner);
      panner.connect(bus);
      this.links.set(id, {
        id,
        stream,
        el,
        src,
        gain,
        panner,
        analyser,
        buf: new Float32Array(new ArrayBuffer(analyser.fftSize * 4)),
        fake,
        target: 0,
        pan: 0,
        dist: Infinity,
      });
    } catch {
      // A stream with no audio, or no Web Audio: nothing to play.
    }
  }

  private teardown(id: string) {
    const L = this.links.get(id);
    if (!L) return;
    this.links.delete(id);
    L.el.pause();
    L.el.srcObject = null;
    L.src.disconnect();
    L.gain.disconnect();
    L.panner.disconnect();
    L.analyser.disconnect();
    L.fake?.cleanup();
    this.vcOn.delete(id);
    this.speakUntil.delete(id);
  }

  private dropAllLinks() {
    for (const id of [...this.links.keys()]) this.teardown(id);
    this.pending.clear();
    this.vcOn.clear();
    this.speakUntil.clear();
  }

  /** Sets each received voice's gain and pan from the speaker's distance and side. Also detects speech. */
  private applyGains() {
    const ctx = this.ctx;
    if (!ctx || this.links.size === 0) return;
    const me = this.worldMe();
    const now = performance.now();
    for (const L of this.links.values()) {
      let wx = 0;
      let wz = 0;
      let known = true;
      if (L.fake) {
        // Angle 0 is straight ahead of the camera, positive is to the right.
        const c = Math.cos(L.fake.angle);
        const s = Math.sin(L.fake.angle);
        wx = me.x + L.fake.dist * (c * this.fx + s * this.rx);
        wz = me.z + L.fake.dist * (c * this.fz + s * this.rz);
      } else {
        const p = this.net.remotes.get(L.id);
        const sn = p?.snaps[p.snaps.length - 1];
        if (!p || !sn || now - p.lastState > STALE_MS) {
          known = false;
        } else {
          const c = centreOf(sn.island);
          wx = c.x + sn.x;
          wz = c.z + sn.z;
        }
      }
      const dx = wx - me.x;
      const dz = wz - me.z;
      const d = known ? Math.hypot(dx, dz) : Infinity;
      const side = dx * this.rx + dz * this.rz;
      const front = dx * this.fx + dz * this.fz;
      const pan = known ? voicePan(side, front) : 0;
      const target = !known || this.mutedPeers.has(L.id) ? 0 : voiceGain(d);
      L.target = target;
      L.pan = pan;
      L.dist = d;
      L.gain.gain.setTargetAtTime(target, ctx.currentTime, SMOOTH_S);
      L.panner.pan.setTargetAtTime(pan, ctx.currentTime, SMOOTH_S);

      // Speech on the received audio, as a fallback to 'vc'. Only counted when the speaker can be heard.
      if (target > 0) {
        L.analyser.getFloatTimeDomainData(L.buf);
        let sum = 0;
        for (let i = 0; i < L.buf.length; i++) sum += L.buf[i] * L.buf[i];
        if (Math.sqrt(sum / L.buf.length) > SPEECH_RMS) this.speakUntil.set(L.id, now + SPEAK_HOLD_MS);
      }
    }
  }

  /** Every 0.5 s: drop links for players who left or failed, release an idle mic, refresh the send set. */
  private tickSlow() {
    for (const [id, L] of [...this.links]) {
      if (L.fake) continue;
      if (!this.net.remotes.has(id) || this.net.failedPeers.has(id)) this.teardown(id);
    }
    for (const id of [...this.pending.keys()]) {
      if (!this.net.remotes.has(id)) this.pending.delete(id);
    }
    if (this.stream && !this.wantTalk && this.clock - this.lastTalkEnd > TALK_IDLE_S) this.stopMic();
    if (this.talking && performance.now() - this.lastVcSent > KEEPALIVE_MS) this.sendVc(true);
    this.syncSend();
    this.refresh();
  }

  private onAudio() {
    this.ctx = this.audio.context;
    this.bus = this.audio.voiceBus;
    this.applyBus();
    for (const [id, s] of this.pending) this.attachStream(id, s, null);
    this.pending.clear();
  }

  private applyBus() {
    if (!this.bus || !this.ctx) return;
    this.bus.gain.setTargetAtTime(this.settings.muted ? 0 : this.settings.volume, this.ctx.currentTime, 0.05);
  }

  /** Turns voice off for good (after a failure). Stops the mic and removes the pill. */
  private disable() {
    this.enabled = false;
    try {
      this.stopMic();
    } catch {
      // Nothing more to release.
    }
    this.dropAllLinks();
    this.room = null;
    this.vc = null;
    this.pill?.remove();
    this.menu?.remove();
    this.selfIcon?.remove();
    this.pill = null;
    this.menu = null;
    this.selfIcon = null;
    for (const b of this.micBtns) b.hidden = true;
  }

  // ---- UI ------------------------------------------------------------------

  private buildUi() {
    const pill = document.createElement('button');
    pill.id = 'voice-toggle';
    pill.className = 'voice-pill';
    pill.type = 'button';
    pill.title = t('voice.title');
    pill.setAttribute('aria-label', t('voice.title'));
    pill.setAttribute('aria-expanded', 'false');
    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleMenu();
    });
    document.body.append(pill);
    this.pill = pill;

    const menu = document.createElement('div');
    menu.id = 'voice-menu';
    menu.hidden = true;
    this.hintEl = div('v-hint');
    const modes = div('v-modes');
    for (const m of ['hold', 'open'] as const) {
      const b = optButton(m === 'hold' ? t('voice.hold') : t('voice.open'));
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.setMode(m);
      });
      modes.append(b);
      this.modeBtns.set(m, b);
    }
    this.muteBtn = optButton(t('voice.muteAll'));
    this.muteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.settings.muted = !this.settings.muted;
      saveSettings(this.settings);
      this.applyBus();
      this.refresh();
    });
    const vol = div('v-vol');
    const volLabel = document.createElement('span');
    volLabel.textContent = t('voice.volume');
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.step = '5';
    slider.setAttribute('aria-label', t('voice.volume'));
    slider.addEventListener('click', (e) => e.stopPropagation());
    slider.addEventListener('input', () => {
      this.settings.volume = Number(slider.value) / 100;
      saveSettings(this.settings);
      this.applyBus();
    });
    this.volEl = slider;
    vol.append(volLabel, slider);
    this.blockedEl = div('v-blocked', t('voice.blocked'));
    menu.append(
      div('v-title', t('voice.menu')),
      this.hintEl,
      modes,
      this.muteBtn,
      vol,
      this.blockedEl,
      div('v-range', t('voice.range')),
      div('v-peer', t('voice.peerHint')),
    );
    document.body.append(menu);
    this.menu = menu;

    document.addEventListener('click', (e) => {
      if (menu.hidden) return;
      const target = e.target as Node;
      if (!menu.contains(target) && !pill.contains(target)) this.closeMenu();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && !menu.hidden) this.closeMenu();
    });

    this.selfIcon = voiceIcon('voice-self');
  }

  private toggleMenu() {
    if (!this.menu) return;
    if (this.menu.hidden) {
      this.menu.hidden = false;
      this.pill?.setAttribute('aria-expanded', 'true');
    } else {
      this.closeMenu();
    }
    this.refresh();
  }

  private closeMenu() {
    if (!this.menu) return;
    this.menu.hidden = true;
    this.pill?.setAttribute('aria-expanded', 'false');
  }

  private setMode(m: Mode) {
    if (this.settings.mode === m) return;
    this.release();
    this.settings.mode = m;
    saveSettings(this.settings);
    this.refresh();
  }

  /** Redraws the pill, the touch mic buttons and the menu from the current state. */
  private refresh() {
    if (!this.enabled) return;
    const state: MicState = this.blocked ? 'blocked' : this.talking ? 'talking' : 'idle';
    const icon = state === 'blocked' ? '🎤✖' : state === 'talking' ? '🎙️' : '🎤';
    if (this.pill) {
      if (this.pill.textContent !== icon) this.pill.textContent = icon;
      this.pill.classList.toggle('talking', state === 'talking');
      this.pill.classList.toggle('blocked', state === 'blocked');
    }
    for (const b of this.micBtns) {
      const span = b.querySelector('span');
      if (span && span.textContent !== icon) span.textContent = icon;
      b.classList.toggle('on', state === 'talking');
    }
    for (const [m, b] of this.modeBtns) {
      const on = m === this.settings.mode;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    }
    if (this.hintEl) this.hintEl.textContent = this.settings.mode === 'hold' ? t('voice.hintHold') : t('voice.hintOpen');
    if (this.muteBtn) {
      this.muteBtn.classList.toggle('on', this.settings.muted);
      this.muteBtn.textContent = this.settings.muted ? `${t('voice.muteAll')} ✓` : t('voice.muteAll');
    }
    if (this.volEl) {
      const v = String(Math.round(this.settings.volume * 100));
      if (this.volEl.value !== v) this.volEl.value = v;
    }
    if (this.blockedEl) this.blockedEl.hidden = !this.blocked;
  }
}

/** World distance (m) from me to a peer's latest snapshot. The snapshot's island centre is added to its local position. */
function worldDistance(s: Snapshot, me: Vec2): number {
  const c = centreOf(s.island);
  return Math.hypot(c.x + s.x - me.x, c.z + s.z - me.z);
}
