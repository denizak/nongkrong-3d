import * as THREE from 'three/webgpu';
import { quality } from '../core/Quality';

/** What the panel reads from the game. Only used with ?perf. */
export interface PerfSources {
  renderer: THREE.WebGPURenderer;
  scene: THREE.Scene;
  backend: string;
  visibleProxies: () => number;
  shadowText: () => string;
  /** Draw calls issued by nested render() calls (the shadow maps) during the current frame. */
  shadowDraws: () => number;
}

/** Per-frame renderer counters, also exported as window.nongkrongPerf. */
export interface PerfCounters {
  /** Draw calls this frame, shadow pass included. */
  calls: number;
  /** Triangles this frame, shadow pass included. */
  triangles: number;
}

/** Frames kept for the 1% low (about 5 s at 60 fps). */
const RING = 300;
/** Frames averaged for the fps and frame time figures. */
const RECENT = 60;

/**
 * Small monospace readout under the pills, shown with ?perf. frame() runs every frame; the text refreshes once a
 * second. Renderer counters are for the last rendered frame (info.autoReset is on, so they are per-frame values).
 */
export class PerfPanel {
  private el = document.createElement('pre');
  private ring = new Float32Array(RING);
  private head = 0;
  private filled = 0;
  private sinceText = 0;
  private counters: PerfCounters = { calls: 0, triangles: 0 };
  private passes = 0;
  private shadowCalls = 0;

  constructor(private src: PerfSources) {
    this.el.id = 'perf-panel';
    document.body.append(this.el);
  }

  /**
   * Call once per frame, after renderer.render(), with the raw frame time in seconds.
   * info.render.drawCalls / triangles / frameCalls are reset by the animation loop at the start of each frame
   * (info.autoReset), so after render() they hold this frame's totals. info.render.calls is cumulative and is not used.
   */
  frame(raw: number) {
    const info = this.src.renderer.info.render;
    this.counters.calls = info.drawCalls;
    this.counters.triangles = info.triangles;
    this.passes = info.frameCalls;
    this.shadowCalls = this.src.shadowDraws();
    (window as Window & { nongkrongPerf?: PerfCounters }).nongkrongPerf = this.counters;
    this.ring[this.head] = raw;
    this.head = (this.head + 1) % RING;
    if (this.filled < RING) this.filled++;
    this.sinceText += raw;
    if (this.sinceText < 1) return;
    this.sinceText = 0;
    this.el.textContent = this.lines().join('\n');
  }

  private lines(): string[] {
    const n = this.filled;
    // Average of the last RECENT frames, and the 99th percentile frame time over the whole ring.
    const recent = Math.min(RECENT, n);
    let sum = 0;
    for (let i = 1; i <= recent; i++) sum += this.ring[(this.head - i + RING) % RING];
    const avg = recent ? sum / recent : 0;
    const sorted = Array.from(this.ring.subarray(0, n)).sort((a, b) => b - a);
    const p99 = sorted[Math.min(n - 1, Math.floor(n * 0.01))] ?? 0;

    const { calls, triangles } = this.counters;
    const k = quality.knobs;
    const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? '?';
    return [
      `fps ${avg > 0 ? (1 / avg).toFixed(1) : '-'}  1% low ${p99 > 0 ? (1 / p99).toFixed(1) : '-'}`,
      `frame ${(avg * 1000).toFixed(1)} ms  worst ${(p99 * 1000).toFixed(0)} ms (1%)`,
      `backend ${this.src.backend}`,
      `tier ${quality.tier} (${quality.source})  antialias ${k.antialias ? 'on' : 'off'}`,
      `dpr ${window.devicePixelRatio.toFixed(2)}  pixel ratio ${this.src.renderer.getPixelRatio().toFixed(2)}`,
      `drawing ${this.src.renderer.domElement.width}x${this.src.renderer.domElement.height}`,
      `draw calls ${calls}  triangles ${formatCount(triangles)}`,
      `  main ${calls - this.shadowCalls}  shadow ${this.shadowCalls}  render passes ${this.passes}`,
      `shadows ${this.src.shadowText()}  point lights ${this.countLights()}`,
      `proxies ${this.src.visibleProxies()}  rain ${k.rain}  fireflies ${k.fireflies}`,
      `memory ${mem} GB  cores ${navigator.hardwareConcurrency}`,
    ];
  }

  /** Visible point lights in the scene, counted once a second. */
  private countLights(): number {
    let n = 0;
    this.src.scene.traverseVisible((o) => {
      if ((o as THREE.PointLight).isPointLight) n++;
    });
    return n;
  }
}

function formatCount(n: number): string {
  return n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}k` : String(n);
}
