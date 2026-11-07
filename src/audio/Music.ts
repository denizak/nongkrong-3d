/**
 * Original generative cozy loop: ukulele plucks (Karplus-Strong), a soft bass, a light shaker
 * and sparse marimba phrases. ~90 BPM, F – Dm – Bb – C, one bar per chord.
 * A 16th-note grid is scheduled with a lookahead timer, so CPU use stays low.
 */

const BPM = 90;
const STEP = 60 / BPM / 4;
const STEPS_PER_BAR = 16;
const LOOKAHEAD = 0.12;
const TICK_MS = 25;
const FADE_IN = 3;

const mtof = (m: number) => 440 * 2 ** ((m - 69) / 12);
const rand = (a: number, b: number) => a + Math.random() * (b - a);

interface Chord {
  /** Ukulele strings G4 C4 E4 A4 (re-entrant tuning), as MIDI notes. */
  strings: number[];
  bass: number;
}

const CHORDS: Chord[] = [
  { strings: [69, 60, 65, 69], bass: 41 }, // F
  { strings: [69, 62, 65, 69], bass: 38 }, // Dm
  { strings: [70, 62, 65, 70], bass: 34 }, // Bb
  { strings: [67, 60, 64, 72], bass: 36 }, // C
];

/** Strum pattern in 16th steps within the bar: [step, direction, velocity]. */
const STRUMS: [number, 'D' | 'U', number][] = [
  [0, 'D', 1],
  [4, 'U', 0.6],
  [6, 'D', 0.75],
  [10, 'U', 0.6],
  [12, 'D', 0.9],
  [14, 'U', 0.5],
];
const BASS_STEPS = [0, 8];
const SHAKER_STEPS = [2, 6, 10, 14];
/** F major pentatonic, F4 up to F5 and a bit above. */
const PENTA = [65, 67, 69, 72, 74, 77, 79];

export class Music {
  private out: GainNode;
  private plucks = new Map<number, AudioBuffer>();
  private timer = 0;
  private nextStepTime = 0;
  private step = 0;
  private barsToMelody = 2;
  /** Melody notes keyed by the step they start on. */
  private notes = new Map<number, { midi: number; steps: number; vel: number }[]>();

  constructor(
    private ctx: AudioContext,
    private noise: AudioBuffer,
    dest: AudioNode,
  ) {
    // Fade-in gain sits between the sources and the music bus.
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(dest);
    for (const chord of CHORDS) for (const m of chord.strings) if (!this.plucks.has(m)) this.plucks.set(m, this.renderPluck(m));
  }

  start() {
    const now = this.ctx.currentTime;
    this.out.gain.setValueAtTime(0, now);
    this.out.gain.linearRampToValueAtTime(1, now + FADE_IN);
    this.nextStepTime = now + 0.2;
    this.timer = window.setInterval(() => this.pump(), TICK_MS);
  }

  stop() {
    window.clearInterval(this.timer);
  }

  private pump() {
    const now = this.ctx.currentTime;
    // After a background-tab pause, restart a little ahead instead of bursting.
    if (this.nextStepTime < now) this.nextStepTime = now + 0.05;
    while (this.nextStepTime < now + LOOKAHEAD) {
      this.scheduleStep(this.step, this.nextStepTime);
      this.nextStepTime += STEP;
      this.step++;
    }
  }

  private scheduleStep(step: number, t: number) {
    const s = step % STEPS_PER_BAR;
    const bar = Math.floor(step / STEPS_PER_BAR);
    const chord = CHORDS[bar % 4];

    if (s === 0) {
      // A melody phrase every 2 to 4 bars, never every bar.
      this.barsToMelody--;
      if (this.barsToMelody <= 0) {
        this.phrase(step + [0, 4, 8][Math.floor(Math.random() * 3)]);
        this.barsToMelody = 2 + Math.floor(Math.random() * 3);
      }
    }

    for (const [st, dir, vel] of STRUMS) if (st === s) this.strum(chord, dir, t, vel);
    if (BASS_STEPS.includes(s)) this.bass(chord.bass, t);
    if (SHAKER_STEPS.includes(s)) this.shaker(t);
    const notes = this.notes.get(step);
    if (notes) {
      this.notes.delete(step);
      for (const n of notes) this.marimba(n.midi, t, n.steps * STEP, n.vel);
    }
  }

  /** Down or up strum: each string a few ms after the last, with a little velocity variation. */
  private strum(chord: Chord, dir: 'D' | 'U', t: number, vel: number) {
    const order = dir === 'D' ? [0, 1, 2, 3] : [3, 2, 1, 0];
    order.forEach((si, k) => {
      const midi = chord.strings[si];
      const src = this.ctx.createBufferSource();
      src.buffer = this.plucks.get(midi) ?? null;
      const g = this.ctx.createGain();
      g.gain.value = 0.28 * vel * rand(0.85, 1.15);
      src.connect(g).connect(this.out);
      src.start(t + k * 0.012);
    });
  }

  /** Pre-rendered Karplus-Strong pluck: a noise burst circulating through a short averaging delay line. */
  private renderPluck(midi: number): AudioBuffer {
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * 2);
    const N = Math.max(2, Math.round(sr / mtof(midi)));
    const ring = new Float32Array(N);
    for (let i = 0; i < N; i++) ring[i] = Math.random() * 2 - 1;
    const data = new Float32Array(len);
    const decay = 0.996;
    for (let n = 0; n < len; n++) {
      const k = n % N;
      const v = ring[k];
      // Fade the tail a little so the buffer ends softly.
      data[n] = v * (1 - n / len);
      ring[k] = decay * 0.5 * (v + ring[(k + 1) % N]);
    }
    const buf = this.ctx.createBuffer(1, len, sr);
    buf.copyToChannel(data, 0);
    return buf;
  }

  /** Soft sine bass with a faint octave triangle. */
  private bass(midi: number, t: number) {
    const f = mtof(midi);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    g.connect(this.out);
    const sine = this.ctx.createOscillator();
    sine.type = 'sine';
    sine.frequency.value = f;
    sine.connect(g);
    sine.start(t);
    sine.stop(t + 1);
    const tri = this.ctx.createOscillator();
    tri.type = 'triangle';
    tri.frequency.value = f * 2;
    const tg = this.ctx.createGain();
    tg.gain.value = 0.05;
    tri.connect(tg).connect(g);
    tri.start(t);
    tri.stop(t + 0.4);
  }

  /** Light shaker tick: a very short highpassed noise burst. */
  private shaker(t: number) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const g = this.ctx.createGain();
    const v = rand(0.035, 0.06);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(hp).connect(g).connect(this.out);
    src.start(t, rand(0, 1), 0.06);
  }

  /** Marimba-like note: a sine with a fast exponential decay and a quiet octave-up partial. */
  private marimba(midi: number, t: number, dur: number, vel: number) {
    const f = mtof(midi);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2 * vel, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.5, dur * 1.6));
    g.connect(this.out);
    const a = this.ctx.createOscillator();
    a.type = 'sine';
    a.frequency.value = f;
    a.connect(g);
    a.start(t);
    a.stop(t + 1.2);
    const b = this.ctx.createOscillator();
    b.type = 'sine';
    b.frequency.value = f * 4;
    const bg = this.ctx.createGain();
    bg.gain.value = 0.12;
    b.connect(bg).connect(g);
    b.start(t);
    b.stop(t + 0.3);
  }

  /** A short random 4–8 note walk over the pentatonic, starting at `step`, lasting at most two bars. */
  private phrase(step: number) {
    const count = 4 + Math.floor(Math.random() * 5);
    let idx = 2 + Math.floor(Math.random() * 3);
    let at = step;
    for (let i = 0; i < count; i++) {
      if (at - step > 28) break;
      const steps = [2, 4, 4, 6][Math.floor(Math.random() * 4)];
      const list = this.notes.get(at) ?? [];
      list.push({ midi: PENTA[idx], steps, vel: rand(0.7, 1) });
      this.notes.set(at, list);
      at += steps;
      const move = [-2, -1, -1, 1, 1, 2][Math.floor(Math.random() * 6)];
      idx = Math.min(PENTA.length - 1, Math.max(0, idx + move));
    }
  }
}
