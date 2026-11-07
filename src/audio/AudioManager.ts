import * as THREE from 'three/webgpu';
import type { Player } from '../player/Player';
import { ZONES } from '../world/Terrain';
import { Synth, SYNTH_NAMES, type SynthName } from './Synth';
import { Music } from './Music';
import { Ambience } from './Ambience';
import './audio.css';

/** Decoded OGG samples in public/audio. Variants like step_grass_0..4 can be played by base name. */
const SAMPLES = [
  'step_grass_0', 'step_grass_1', 'step_grass_2', 'step_grass_3', 'step_grass_4',
  'step_sand_0', 'step_sand_1', 'step_sand_2', 'step_sand_3', 'step_sand_4',
  'thud_0', 'thud_1', 'thud_2',
  'pop_0', 'pop_1', 'pop_2',
  'knock_0', 'knock_1', 'knock_2',
  'jingle_steel_00', 'jingle_steel_03', 'jingle_steel_05', 'jingle_steel_08', 'jingle_steel_12',
  'jingle_pizzi_00', 'jingle_pizzi_02', 'jingle_pizzi_04',
];

/** Synthesized stand-ins for samples that fail to load or decode. */
const FALLBACK: Record<string, SynthName> = {
  step_grass: 'rustle',
  step_sand: 'rustle',
  thud: 'plop',
  pop: 'blip',
  knock: 'plop',
  jingle_steel: 'blip',
  jingle_pizzi: 'blip',
};

const MUTE_KEY = 'nongkrong.audio';
const SPATIAL_MAX = 45;
const SPATIAL_REF = 6;
const WALK_STEP = 0.42;
const RUN_STEP = 0.29;

export interface PlayOpts {
  volume?: number;
  rate?: number;
  rateJitter?: number;
  /** World position for simple stereo panning and distance falloff. */
  at?: THREE.Vector3;
}

function makeNoise(ctx: AudioContext, seconds: number): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/**
 * Owns the AudioContext and everything that makes sound. The context is created on the first
 * pointerdown or keydown (browsers block audio before that), and nothing plays before then.
 * Samples are fetched and decoded at startup with an OfflineAudioContext, which needs no gesture.
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private ambienceBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private synth: Synth | null = null;
  private music: Music | null = null;
  private ambience: Ambience | null = null;
  private noise: AudioBuffer | null = null;
  private buffers = new Map<string, AudioBuffer>();
  /** Loaded variants grouped by base name, e.g. step_grass -> [step_grass_0, ...]. */
  private groups = new Map<string, string[]>();
  private failed: string[] = [];
  private muted = readMuted();
  private pill: HTMLButtonElement;
  private listenerPos = new THREE.Vector3();
  private listenerFwd = new THREE.Vector3(0, 0, -1);
  private listenerRight = new THREE.Vector3(1, 0, 0);
  private lastPos = new THREE.Vector3();
  private hasLast = false;
  private speed = 0;
  private stepTimer = 0;
  /** Resolves once every sample has been loaded or has failed. */
  readonly ready: Promise<void>;

  constructor() {
    this.ready = this.loadSamples();
    this.pill = document.createElement('button');
    this.pill.id = 'audio-toggle';
    this.pill.className = 'audio-pill';
    this.pill.type = 'button';
    this.pill.title = 'Sound on or off (M)';
    this.pill.addEventListener('click', () => this.toggleMute());
    document.body.append(this.pill);
    this.syncPill();

    // Mention the shortcut in the existing HUD help line.
    const help = document.querySelector<HTMLElement>('#hud .help');
    if (help) help.textContent = `${help.textContent?.trimEnd() ?? ''} · M — mute`;

    const gesture = () => this.unlock();
    window.addEventListener('pointerdown', gesture);
    window.addEventListener('keydown', gesture);
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  /** Dev and test handle: what has unlocked, what is muted, and which samples loaded or failed. */
  debugState() {
    return { unlocked: this.ctx !== null, muted: this.muted, loaded: this.buffers.size, failed: [...this.failed] };
  }

  get muteState() {
    return this.muted;
  }

  toggleMute() {
    this.muted = !this.muted;
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? 'muted' : 'on');
    } catch {
      // Storage can be blocked; the toggle still works for this page.
    }
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.05);
    this.syncPill();
  }

  /**
   * Plays a sample or synth sound. `name` can be a base name (e.g. 'step_grass') to pick a random
   * variant. Sounds with `at` are panned and attenuated relative to the camera.
   */
  play(name: string, opts: PlayOpts = {}) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const vol = opts.volume ?? 1;
    const head = this.voice(opts.at, vol);
    if (!head) return;
    const t = ctx.currentTime;

    const key = this.pick(name);
    if (key) {
      const src = ctx.createBufferSource();
      src.buffer = this.buffers.get(key)!;
      const jitter = opts.rateJitter ?? 0;
      src.playbackRate.value = (opts.rate ?? 1) * (1 + (Math.random() * 2 - 1) * jitter);
      src.connect(head);
      src.start(t);
      return;
    }

    const base = name.replace(/_\d+$/, '');
    const synthName = (SYNTH_NAMES as readonly string[]).includes(name)
      ? (name as SynthName)
      : FALLBACK[base] ?? FALLBACK[name];
    if (synthName && this.synth) this.synth.play(synthName, head, t, vol);
  }

  /** Bird chirp used by the ambience loop. */
  chirp(at: THREE.Vector3, volume: number) {
    this.play('chirp', { at, volume });
  }

  /** Called once per frame from main with the player and the active camera. */
  update(dt: number, player: Player, camera: THREE.Camera) {
    camera.getWorldDirection(this.listenerFwd);
    this.listenerFwd.y = 0;
    if (this.listenerFwd.lengthSq() < 1e-6) this.listenerFwd.set(0, 0, -1);
    this.listenerFwd.normalize();
    // Right-hand side of the forward vector on the ground plane.
    this.listenerRight.set(-this.listenerFwd.z, 0, this.listenerFwd.x);
    camera.getWorldPosition(this.listenerPos);

    if (!this.ctx) return;
    this.ambience?.update(dt, player.position);
    this.updateFootsteps(dt, player);
  }

  private async loadSamples() {
    const Ctor = window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
    const base = `${import.meta.env.BASE_URL}audio/`;
    const decoder = Ctor ? new Ctor(1, 1, 44100) : null;
    await Promise.all(
      SAMPLES.map(async (name) => {
        try {
          if (!decoder) throw new Error('no decoder');
          const res = await fetch(`${base}${name}.ogg`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.arrayBuffer();
          const buf = await decode(decoder, data);
          this.buffers.set(name, buf);
        } catch {
          // Skipped silently; a synth fallback covers it when one exists.
          this.failed.push(name);
        }
      }),
    );
    for (const name of SAMPLES) {
      if (!this.buffers.has(name)) continue;
      const group = name.replace(/_\d+$/, '');
      this.groups.set(group, [...(this.groups.get(group) ?? []), name]);
    }
  }

  /** Creates the context on a user gesture and starts the music and ambience. */
  private unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(ctx.destination);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.35;
    this.musicBus.connect(this.master);
    this.ambienceBus = ctx.createGain();
    this.ambienceBus.gain.value = 0.5;
    this.ambienceBus.connect(this.master);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.8;
    this.sfxBus.connect(this.master);

    this.noise = makeNoise(ctx, 2);
    this.synth = new Synth(ctx, this.noise);
    this.music = new Music(ctx, this.noise, this.musicBus);
    this.music.start();
    this.ambience = new Ambience(ctx, this.noise, this.ambienceBus, this);
    this.ambience.start();
    if (ctx.state === 'suspended') void ctx.resume();
    this.syncPill();
  }

  /** Head of a voice chain: gain, then a stereo panner when `at` is given, then the sfx bus. Null when out of range. */
  private voice(at: THREE.Vector3 | undefined, vol: number): GainNode | null {
    if (!this.ctx || !this.sfxBus) return null;
    const g = this.ctx.createGain();
    if (!at) {
      g.gain.value = vol;
      g.connect(this.sfxBus);
      return g;
    }
    const dx = at.x - this.listenerPos.x;
    const dy = at.y - this.listenerPos.y;
    const dz = at.z - this.listenerPos.z;
    const d = Math.hypot(dx, dy, dz);
    if (d >= SPATIAL_MAX) return null;
    // Inverse falloff, faded out over the last few metres so the cut-off is not abrupt.
    const edge = THREE.MathUtils.clamp((SPATIAL_MAX - d) / 7, 0, 1);
    g.gain.value = vol * (1 / (1 + d / SPATIAL_REF)) * edge;

    // Horizontal angle from the camera's forward direction; pan = sin(angle).
    const side = dx * this.listenerRight.x + dz * this.listenerRight.z;
    const front = dx * this.listenerFwd.x + dz * this.listenerFwd.z;
    const pan = Math.sin(Math.atan2(side, front));
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = THREE.MathUtils.clamp(pan, -1, 1);
    g.connect(panner).connect(this.sfxBus);
    return g;
  }

  /** Picks a loaded sample for `name`: exact name first, then a random variant of the base name. */
  private pick(name: string): string | null {
    if (this.buffers.has(name)) return name;
    const group = this.groups.get(name);
    if (!group || group.length === 0) return null;
    return group[Math.floor(Math.random() * group.length)];
  }

  /** Footsteps by measured ground speed: walk every 0.42 s, run every 0.29 s. Silent while sitting or lying. */
  private updateFootsteps(dt: number, player: Player) {
    const p = player.position;
    if (this.hasLast && dt > 0) {
      const v = Math.hypot(p.x - this.lastPos.x, p.z - this.lastPos.z) / dt;
      this.speed += (v - this.speed) * Math.min(1, dt * 10);
    }
    this.lastPos.copy(p);
    this.hasLast = true;

    const moving = this.speed > 0.8 && player.pose === 'stand';
    if (!moving) {
      this.stepTimer = 0;
      return;
    }
    this.stepTimer -= dt;
    if (this.stepTimer > 0) return;
    const running = this.speed > 5.5;
    this.stepTimer = running ? RUN_STEP : WALK_STEP;

    const z = ZONES.paddy;
    if (Math.abs(p.x - z.x) < z.w / 2 && Math.abs(p.z - z.z) < z.d / 2) {
      // Paddy mud: a softer, slower step with a wet plop on top.
      this.play('step_grass', { volume: 0.45, rate: 0.8, rateJitter: 0.08 });
      this.play('plop', { volume: 0.2 });
    } else if (Math.hypot(p.x, p.z) > 44 && p.y < 0.9) {
      this.play('step_sand', { volume: running ? 0.7 : 0.55, rateJitter: 0.1 });
    } else {
      this.play('step_grass', { volume: running ? 0.7 : 0.55, rateJitter: 0.1 });
    }
  }

  private onKey(e: KeyboardEvent) {
    if (e.code !== 'KeyM' || e.repeat) return;
    // Typing in the chat box should not toggle mute.
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return;
    this.toggleMute();
  }

  private syncPill() {
    this.pill.textContent = this.muted ? '🔇' : '🔊';
    this.pill.classList.toggle('off', this.muted);
  }
}

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === 'muted';
  } catch {
    return false;
  }
}

function decode(ctx: BaseAudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    // Older Safari uses the callback form only and returns undefined.
    const p = ctx.decodeAudioData(data, resolve, reject) as Promise<AudioBuffer> | undefined;
    p?.catch(reject);
  });
}

/** The game-wide audio manager. Import it wherever a sound is needed. */
export const sfx = new AudioManager();
