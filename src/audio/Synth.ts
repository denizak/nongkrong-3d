/** Procedural one-shot sounds built from Web Audio nodes. Each writes into a given output node. */

export type SynthName = 'rustle' | 'whoosh' | 'plop' | 'splash' | 'flutter' | 'chirp' | 'blip';
export const SYNTH_NAMES: readonly SynthName[] = ['rustle', 'whoosh', 'plop', 'splash', 'flutter', 'chirp', 'blip'];

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class Synth {
  constructor(
    private ctx: AudioContext,
    /** Shared white-noise buffer, used by every noise-based sound. */
    private noise: AudioBuffer,
  ) {}

  play(name: SynthName, out: AudioNode, t: number, vol: number) {
    switch (name) {
      case 'rustle': return this.rustle(out, t, vol);
      case 'whoosh': return this.whoosh(out, t, vol);
      case 'plop': return this.plop(out, t, vol);
      case 'splash': return this.splash(out, t, vol);
      case 'flutter': return this.flutter(out, t, vol);
      case 'chirp': return this.chirp(out, t, vol);
      case 'blip': return this.blip(out, t, vol);
    }
  }

  /** Short gain envelope: fast attack, exponential decay to silence. */
  private env(out: AudioNode, t: number, peak: number, attack: number, dur: number) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(out);
    return g;
  }

  private noiseSrc(t: number, dur: number, offsetMax = 0.5) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.start(t, rand(0, offsetMax), dur);
    return src;
  }

  /** Leaves and grass: a bandpassed noise burst. */
  private rustle(out: AudioNode, t: number, vol: number) {
    const src = this.noiseSrc(t, 0.45);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = rand(1800, 2800);
    bp.Q.value = 0.8;
    src.connect(bp).connect(this.env(out, t, 0.5 * vol, 0.03, 0.4));
    src.stop(t + 0.45);
  }

  /** Fishing cast: a noise sweep from low to high. */
  private whoosh(out: AudioNode, t: number, vol: number) {
    const src = this.noiseSrc(t, 0.7);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(400, t);
    bp.frequency.exponentialRampToValueAtTime(2400, t + 0.5);
    const g = this.env(out, t, 0.6 * vol, 0.15, 0.6);
    src.connect(bp).connect(g);
    src.stop(t + 0.7);
  }

  /** Bobber landing: a quick sine drop 600 to 150 Hz plus a little noise. */
  private plop(out: AudioNode, t: number, vol: number) {
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, t);
    osc.frequency.exponentialRampToValueAtTime(150, t + 0.12);
    osc.connect(this.env(out, t, 0.7 * vol, 0.004, 0.12));
    osc.start(t);
    osc.stop(t + 0.13);

    const src = this.noiseSrc(t, 0.05);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1200;
    src.connect(lp).connect(this.env(out, t, 0.2 * vol, 0.002, 0.05));
    src.stop(t + 0.05);
  }

  /** Bite or catch: bright noise with a fast decay. */
  private splash(out: AudioNode, t: number, vol: number) {
    const src = this.noiseSrc(t, 0.4);
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1800;
    hp.Q.value = 0.6;
    src.connect(hp).connect(this.env(out, t, 0.7 * vol, 0.005, 0.35));
    src.stop(t + 0.4);
  }

  /** Birds taking off: noise through a bandpass with a fast amplitude wobble. */
  private flutter(out: AudioNode, t: number, vol: number) {
    const src = this.noiseSrc(t, 0.55);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3200;
    bp.Q.value = 2.5;
    // Wobble gain: 0.5 plus a 0.5 sine at about 22 Hz, so it swings between silence and full.
    const wobble = this.ctx.createGain();
    wobble.gain.value = 0.5;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 22;
    const depth = this.ctx.createGain();
    depth.gain.value = 0.5;
    lfo.connect(depth).connect(wobble.gain);
    lfo.start(t);
    lfo.stop(t + 0.6);
    src.connect(bp).connect(wobble).connect(this.env(out, t, 0.5 * vol, 0.05, 0.5));
    src.stop(t + 0.55);
  }

  /** Bird song: 1 to 3 quick sine sweeps between 2.5 and 5 kHz. */
  private chirp(out: AudioNode, t: number, vol: number) {
    const count = 1 + Math.floor(Math.random() * 3);
    let at = t;
    for (let i = 0; i < count; i++) {
      const dur = rand(0.07, 0.1);
      const f0 = rand(2500, 4000);
      const f1 = Math.min(5000, f0 + rand(600, 1400));
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f0, at);
      osc.frequency.exponentialRampToValueAtTime(f1, at + dur);
      osc.connect(this.env(out, at, 0.3 * vol, 0.008, dur));
      osc.start(at);
      osc.stop(at + dur + 0.01);
      at += dur + rand(0.06, 0.1);
    }
  }

  /** Soft UI pop: a short rising sine. */
  private blip(out: AudioNode, t: number, vol: number) {
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, t);
    osc.frequency.exponentialRampToValueAtTime(880, t + 0.07);
    osc.connect(this.env(out, t, 0.25 * vol, 0.008, 0.12));
    osc.start(t);
    osc.stop(t + 0.13);
  }
}
