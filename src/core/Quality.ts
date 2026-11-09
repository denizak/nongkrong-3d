/**
 * Graphics quality tiers. One place decides how much the scene costs: pixel ratio, antialiasing, shadows,
 * real point lights, proxy islands, vegetation density, rain, fireflies, stars, fog, and a few cheap extras.
 *
 * The tier is picked once per load: ?q=high|medium|low wins, then the saved choice, then a device guess.
 * Things that can change live (shadows, lights, pixel ratio, proxies, flowers, rain, fireflies, stars, fog,
 * blob shadows, minimap rate) read `quality.knobs` each frame or are re-applied by main.ts. Things that are
 * built into geometry (antialias, rice spacing, water shader) need a reload.
 */

export type Tier = 'high' | 'medium' | 'low';
export const TIERS: readonly Tier[] = ['high', 'medium', 'low'];
export const QUALITY_KEY = 'nongkrong.quality';

export interface Knobs {
  /** Upper bound on devicePixelRatio. */
  pixelCap: number;
  /** Extra multiplier on the pixel ratio (1 = none). */
  renderScale: number;
  /** Built at renderer creation: needs a reload to change. */
  antialias: boolean;
  /** Sun shadow map side in texels. 0 turns shadows off. */
  shadowSize: number;
  /** Half side of the sun's shadow frustum (m). */
  shadowHalf: number;
  /** Real point lights from torches (nearest to the player). The plaza campfire light is not counted. */
  torchLights: number;
  /** Islands within this distance (m) of the live island are drawn as proxies. */
  proxyRange: number;
  /** Share of the flowers drawn (applied live by instance count). */
  flowerShare: number;
  /** Multiplier on rice stalk spacing. Built at island build: needs a reload. */
  riceMul: number;
  /** Rain streaks. */
  rain: number;
  fireflies: number;
  stars: number;
  /** Fog far distance in clear weather (m). */
  fogFar: number;
  /** Soft dark discs under players instead of real shadows. */
  blobShadows: boolean;
  /** Proxy islands use a terrain with half the vertices. */
  decimateProxies: boolean;
  /** Seconds between minimap redraws. */
  minimapPeriod: number;
  /** Water shader drops its second streak term. Built into the material: needs a reload. */
  waterLite: boolean;
}

export function knobsFor(tier: Tier, highCap: number): Knobs {
  switch (tier) {
    case 'high':
      return {
        pixelCap: highCap, renderScale: 1, antialias: true,
        shadowSize: 2048, shadowHalf: 28, torchLights: 12, proxyRange: 320,
        flowerShare: 1, riceMul: 1, rain: 1500, fireflies: 60, stars: 600, fogFar: 260,
        blobShadows: false, decimateProxies: false, minimapPeriod: 0.1, waterLite: false,
      };
    case 'medium':
      return {
        pixelCap: 1.25, renderScale: 1, antialias: false,
        shadowSize: 1024, shadowHalf: 22, torchLights: 4, proxyRange: 260,
        flowerShare: 0.5, riceMul: 1.6 / 1.2, rain: 700, fireflies: 30, stars: 300, fogFar: 260,
        blobShadows: false, decimateProxies: true, minimapPeriod: 0.1, waterLite: false,
      };
    case 'low':
      return {
        pixelCap: 1.0, renderScale: 0.85, antialias: false,
        shadowSize: 0, shadowHalf: 0, torchLights: 2, proxyRange: 200,
        flowerShare: 0.25, riceMul: 2.2 / 1.2, rain: 300, fireflies: 12, stars: 150, fogFar: 200,
        blobShadows: true, decimateProxies: true, minimapPeriod: 0.2, waterLite: true,
      };
  }
}

export const isTier = (v: unknown): v is Tier => v === 'high' || v === 'medium' || v === 'low';

/** Next tier in the Q-key cycle: high, medium, low, high. */
export function nextTier(tier: Tier): Tier {
  return tier === 'high' ? 'medium' : tier === 'medium' ? 'low' : 'high';
}

/** One step down, stopping at low. */
export function lowerTier(tier: Tier): Tier {
  return tier === 'high' ? 'medium' : 'low';
}

export type Source = 'url' | 'saved' | 'auto' | 'manual';

class QualityState {
  private _tier: Tier = 'high';
  private _source: Source = 'auto';
  /** Cap for the high tier's pixel ratio: 1.5, or 2 with ?hq. */
  highCap = 1.5;
  knobs: Knobs = knobsFor('high', 1.5);

  get tier(): Tier {
    return this._tier;
  }

  get source(): Source {
    return this._source;
  }

  /** Sets the tier and rebuilds the knobs. Returns true when the tier changed. */
  set(tier: Tier, source: Source, save: boolean): boolean {
    const changed = tier !== this._tier;
    this._tier = tier;
    this._source = source;
    this.knobs = knobsFor(tier, this.highCap);
    if (save) writeSaved(tier);
    return changed;
  }

  /** Renderer pixel ratio for a device pixel ratio under the current knobs. */
  pixelRatio(dpr: number): number {
    return Math.min(dpr, this.knobs.pixelCap) * this.knobs.renderScale;
  }
}

/** The live quality state. Read `quality.knobs` wherever a knob is needed. */
export const quality = new QualityState();

/** Picks the tier for this load and sets it. Call before the renderer is created. */
export function initQuality(params: URLSearchParams): void {
  quality.highCap = params.has('hq') ? 2 : 1.5;
  const fromUrl = params.get('q')?.toLowerCase();
  if (isTier(fromUrl)) {
    quality.set(fromUrl, 'url', false);
    return;
  }
  const saved = readSaved();
  if (saved) {
    quality.set(saved, 'saved', false);
    return;
  }
  quality.set(autoTier(), 'auto', true);
}

function readSaved(): Tier | null {
  try {
    const v = localStorage.getItem(QUALITY_KEY);
    return isTier(v) ? v : null;
  } catch {
    return null;
  }
}

function writeSaved(tier: Tier) {
  try {
    localStorage.setItem(QUALITY_KEY, tier);
  } catch {
    // Storage blocked: the choice lasts for this load only.
  }
}

/** Touch input, from the pointer type or the touch point count. */
export function isTouchDevice(): boolean {
  return matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
}

/**
 * First-load guess. Any of these starts at low: a coarse pointer, 4 GB of memory or less, a touch device with
 * 6 cores or fewer, or a mobile user agent. Other touch devices and integrated GPUs start at medium. The rest
 * start at high. The auto-downgrade in main.ts can still step the tier down later.
 */
export function autoTier(): Tier {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const coarse = matchMedia('(pointer: coarse)').matches;
  const touch = isTouchDevice();
  const mobileUA = /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(navigator.userAgent);
  const lowMemory = nav.deviceMemory !== undefined && nav.deviceMemory <= 4;
  const fewCores = touch && navigator.hardwareConcurrency <= 6;
  if (coarse || lowMemory || fewCores || mobileUA) return 'low';
  if (touch || integratedGpu()) return 'medium';
  return 'high';
}

/** True when the WebGL renderer string names an integrated GPU (Intel, Mali, Adreno, PowerVR). */
function integratedGpu(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return false;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /Intel|Mali|Adreno|PowerVR|Vivante/i.test(name);
  } catch {
    return false;
  }
}

const WINDOW_S = 3;
const WARMUP_S = 2;
const SPIKE_S = 0.2;
const BAD_FPS = 40;
const BAD_WINDOWS = 3;
const SETTLE_S = 2;

/**
 * Rolling frame-rate check for auto-downgrade. Measures 3 s windows after a 2 s warm-up. Three windows in a
 * row under 40 fps asks for one step down. Frames longer than 200 ms are skipped, and nothing is measured
 * while the tab is hidden or right after an island shift or a tier change (see pause()).
 */
export class FrameMonitor {
  private clock = 0;
  private quietUntil = WARMUP_S;
  private winTime = 0;
  private winFrames = 0;
  private bad = 0;

  /** Call once per frame with the raw frame time in seconds. Returns true when the tier should step down. */
  tick(raw: number, hidden: boolean): boolean {
    if (hidden) {
      this.resetWindow();
      this.bad = 0;
      return false;
    }
    this.clock += raw;
    if (raw > SPIKE_S || this.clock < this.quietUntil) return false;

    this.winTime += raw;
    this.winFrames++;
    if (this.winTime < WINDOW_S) return false;

    const fps = this.winFrames / this.winTime;
    this.resetWindow();
    this.bad = fps < BAD_FPS ? this.bad + 1 : 0;
    if (this.bad < BAD_WINDOWS) return false;
    this.bad = 0;
    this.pause(SETTLE_S);
    return true;
  }

  /** Stops measuring for a while: after an island shift or a tier change. */
  pause(seconds: number) {
    this.quietUntil = Math.max(this.quietUntil, this.clock + seconds);
    this.resetWindow();
  }

  private resetWindow() {
    this.winTime = 0;
    this.winFrames = 0;
  }
}
