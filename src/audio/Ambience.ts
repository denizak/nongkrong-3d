import * as THREE from 'three/webgpu';

/** Ocean waves, breeze and distant birds. Loudness follows the player's distance from the middle of the island. */
const COAST_NEAR = 35;
const COAST_FAR = 60;
const WAVE_INLAND = 0.12;
const BIRD_RANGE: [number, number] = [12, 30];

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const smooth = (t: number) => t * t * (3 - 2 * t);

interface Chirper {
  chirp(at: THREE.Vector3, volume: number): void;
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

  constructor(
    private ctx: AudioContext,
    private noise: AudioBuffer,
    private bus: AudioNode,
    private sfx: Chirper,
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
  }

  /** Called per frame with the player's position. */
  update(dt: number, player: THREE.Vector3) {
    if (!this.started || !this.waves || !this.breeze) return;
    const d = Math.hypot(player.x, player.z);
    this.coast = smooth(THREE.MathUtils.clamp((d - COAST_NEAR) / (COAST_FAR - COAST_NEAR), 0, 1));
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
    this.nextBird -= dt;
    if (this.nextBird <= 0) {
      this.nextBird = rand(4, 12);
      const a = Math.random() * Math.PI * 2;
      const r = rand(BIRD_RANGE[0], BIRD_RANGE[1]);
      const at = new THREE.Vector3(player.x + Math.sin(a) * r, player.y + rand(1, 4), player.z + Math.cos(a) * r);
      this.sfx.chirp(at, 0.5 * (1 - 0.6 * this.coast));
    }
  }
}
