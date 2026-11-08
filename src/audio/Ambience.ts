import * as THREE from 'three/webgpu';
import type { Synth } from './Synth';

/** Ocean waves, breeze and distant birds. Loudness follows the player's distance from the middle of the island, and is at the coast's full level on a bridge. */
const COAST_NEAR = 35;
const COAST_FAR = 60;
const WAVE_INLAND = 0.12;
const BIRD_RANGE: [number, number] = [12, 30];
const CRICKETS = 3;

/** Weather and time of day, read from the game each frame. Both 0 to 1. */
export interface WorldState {
  rain: number;
  night: number;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const smooth = (t: number) => t * t * (3 - 2 * t);

interface Chirper {
  chirp(at: THREE.Vector3, volume: number): void;
}

interface Cricket {
  pan: StereoPannerNode;
  next: number;
}

export class Ambience {
  private waves: GainNode | null = null;
  private breeze: GainNode | null = null;
  private started = false;
  private swellT = 0;
  private swellPeriod = rand(6, 10);
  private breezeT = 0;
  private nextBird = rand(4, 12);
  /** 0 inland, 1 at the coast. */
  private coast = 0;
  private rain: GainNode | null = null;
  private hiss: GainNode | null = null;
  private thunderT = rand(20, 45);
  private cricketBus: GainNode | null = null;
  private crickets: Cricket[] = [];

  constructor(
    private ctx: AudioContext,
    private noise: AudioBuffer,
    private bus: AudioNode,
    private sfx: Chirper,
    private synth: Synth,
  ) {}

  start() {
    if (this.started) return;
    this.started = true;
    const now = this.ctx.currentTime;

    // Waves: looping noise through a 600 Hz lowpass, swelling slowly.
    const wSrc = this.ctx.createBufferSource();
    wSrc.buffer = this.noise;
    wSrc.loop = true;
    const wLp = this.ctx.createBiquadFilter();
    wLp.type = 'lowpass';
    wLp.frequency.value = 600;
    this.waves = this.ctx.createGain();
    this.waves.gain.value = 0;
    wSrc.connect(wLp).connect(this.waves).connect(this.bus);
    wSrc.start(now, rand(0, 1));

    // Breeze: bandpassed noise with a slow random level.
    const bSrc = this.ctx.createBufferSource();
    bSrc.buffer = this.noise;
    bSrc.loop = true;
    const bBp = this.ctx.createBiquadFilter();
    bBp.type = 'bandpass';
    bBp.frequency.value = 600;
    bBp.Q.value = 0.6;
    this.breeze = this.ctx.createGain();
    this.breeze.gain.value = 0.03;
    bSrc.connect(bBp).connect(this.breeze).connect(this.bus);
    bSrc.start(now, rand(0, 1));

    // Rain: looping noise through a 2.5 kHz lowpass, with a bandpassed hiss on top.
    const rSrc = this.ctx.createBufferSource();
    rSrc.buffer = this.noise;
    rSrc.loop = true;
    const rLp = this.ctx.createBiquadFilter();
    rLp.type = 'lowpass';
    rLp.frequency.value = 2500;
    this.rain = this.ctx.createGain();
    this.rain.gain.value = 0;
    rSrc.connect(rLp).connect(this.rain).connect(this.bus);
    rSrc.start(now, rand(0, 1));

    const hSrc = this.ctx.createBufferSource();
    hSrc.buffer = this.noise;
    hSrc.loop = true;
    const hBp = this.ctx.createBiquadFilter();
    hBp.type = 'bandpass';
    hBp.frequency.value = 6000;
    hBp.Q.value = 0.7;
    this.hiss = this.ctx.createGain();
    this.hiss.gain.value = 0;
    hSrc.connect(hBp).connect(this.hiss).connect(this.bus);
    hSrc.start(now, rand(0, 1));

    // Crickets: a few sources, each with its own stereo position.
    this.cricketBus = this.ctx.createGain();
    this.cricketBus.gain.value = 0;
    this.cricketBus.connect(this.bus);
    for (let i = 0; i < CRICKETS; i++) {
      const pan = this.ctx.createStereoPanner();
      pan.connect(this.cricketBus);
      this.crickets.push({ pan, next: rand(0, 2) });
    }
  }

  /** Called per frame with the player's position. `onBridge` is true on a bridge, where the sea is always close. */
  update(dt: number, player: THREE.Vector3, world: WorldState, onBridge = false) {
    if (!this.started || !this.waves || !this.breeze || !this.rain || !this.hiss || !this.cricketBus) return;
    const d = Math.hypot(player.x, player.z);
    this.coast = onBridge ? 1 : smooth(THREE.MathUtils.clamp((d - COAST_NEAR) / (COAST_FAR - COAST_NEAR), 0, 1));
    const now = this.ctx.currentTime;

    // Wave swell: a slow sine whose period is re-picked every cycle.
    this.swellT += dt / this.swellPeriod;
    if (this.swellT >= 1) {
      this.swellT -= 1;
      this.swellPeriod = rand(6, 10);
    }
    const swell = 0.55 + 0.45 * (0.5 - 0.5 * Math.cos(this.swellT * Math.PI * 2));
    const level = WAVE_INLAND + (1 - WAVE_INLAND) * this.coast;
    this.waves.gain.setTargetAtTime(level * swell * 0.5, now, 0.1);

    // Breeze: a new random level every few seconds.
    this.breezeT -= dt;
    if (this.breezeT <= 0) {
      this.breezeT = rand(3, 6);
      this.breeze.gain.setTargetAtTime(rand(0.02, 0.07), now, 1.5);
    }

    // Birds: every 4 to 12 s, somewhere around the listener, quieter near the coast.
    // Birds slow down with the light: the rate is scaled by 1 - nightFactor.
    this.nextBird -= dt * (1 - world.night);
    if (this.nextBird <= 0) {
      this.nextBird = rand(4, 12);
      const a = Math.random() * Math.PI * 2;
      const r = rand(BIRD_RANGE[0], BIRD_RANGE[1]);
      const at = new THREE.Vector3(player.x + Math.sin(a) * r, player.y + rand(1, 4), player.z + Math.cos(a) * r);
      this.sfx.chirp(at, 0.5 * (1 - 0.6 * this.coast));
    }

    // Rain loop follows the weather; thunder is a rare rumble while it pours.
    this.rain.gain.setTargetAtTime(world.rain * 0.32, now, 0.5);
    this.hiss.gain.setTargetAtTime(world.rain * 0.1, now, 0.5);
    if (world.rain > 0.5) {
      this.thunderT -= dt;
      if (this.thunderT <= 0) {
        this.thunderT = rand(25, 60);
        this.synth.thunder(this.bus, now + rand(0.2, 1.5), 0.5 * world.rain);
      }
    }

    // Crickets: volume follows the night, each source starts a burst every 1.2 to 3 s.
    this.cricketBus.gain.setTargetAtTime(0.14 * world.night, now, 0.8);
    if (world.night > 0.05) {
      for (const c of this.crickets) {
        c.next -= dt;
        if (c.next > 0) continue;
        c.next = rand(1.2, 3);
        c.pan.pan.value = rand(-0.9, 0.9);
        this.synth.cricketBurst(c.pan, now + 0.01, rand(0.6, 1));
      }
    }
  }
}
