import { t } from '../i18n';
import * as THREE from 'three/webgpu';
import { PointsNodeMaterial } from 'three/webgpu';
import { attribute, uniform } from 'three/tsl';
import type { Environment } from './Environment';
import { WATER_LEVEL, ZONES, type Ground, type Orchard, type Zones } from './Terrain';
import './daynight.css';


/** Real seconds for one full in-game day. */
export const DAY_SECONDS = 1200;
const START_HOUR = 9;
const SKY_EVERY = 0.25;
const SKY_SEGMENTS_R = 400;
const STAR_COUNT = 600;
const STAR_RADIUS = 380;
const MOON_DISTANCE = 330;
const FIREFLY_COUNT = 60;
const SUN_DISTANCE = 90;
/** Sun path: rises at 6:00, overhead at noon, sets at 18:00. */
const SUN_AZIMUTH_TILT = 0.8;
const SUN_Z = 0.35;

const RAIN_TOP = new THREE.Color('#5a6470');
const RAIN_HORIZON = new THREE.Color('#8a939c');
const RAIN_FOG = new THREE.Color('#7d8792');
const RAIN_LIGHT = new THREE.Color('#9aa6b4');
const RAIN_GROUND = new THREE.Color('#6f7880');
const FIREFLY_COLOR = new THREE.Color('#d8ff7a');

/** True while the user is typing, so game hotkeys stay out of the way. */
export function isTyping(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable);
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Lighting and sky colours at one hour of the day. */
interface Key {
  h: number;
  sun: THREE.Color;
  sunI: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiI: number;
  top: THREE.Color;
  horizon: THREE.Color;
  fog: THREE.Color;
  exposure: number;
}

interface KeySpec {
  h: number;
  sun: string;
  sunI: number;
  hemiSky: string;
  hemiGround: string;
  hemiI: number;
  top: string;
  horizon: string;
  fog: string;
  exposure: number;
}

/** Moonlit night: readable, cozy. Exposure stays at or above the day value (1.0 to 1.05). */
const NIGHT: Omit<KeySpec, 'h'> = {
  sun: '#a9bcff', sunI: 0.7, hemiSky: '#6f86c8', hemiGround: '#2a3a4a', hemiI: 0.8,
  top: '#0b1636', horizon: '#24365e', fog: '#24365e', exposure: 1.0,
};

/** Noon is the look the game had before the day/night cycle. */
const KEY_SPECS: KeySpec[] = [
  { h: 0, ...NIGHT },
  { h: 5, ...NIGHT },
  { h: 6.5, sun: '#ffa86a', sunI: 1.1, hemiSky: '#f2c3b8', hemiGround: '#7a6a6a', hemiI: 0.9, top: '#6f8fc8', horizon: '#f5b6a0', fog: '#f2b8a4', exposure: 1.0 },
  { h: 8, sun: '#ffe6c0', sunI: 2.2, hemiSky: '#e4f4ff', hemiGround: '#7fb35c', hemiI: 1.3, top: '#55afe8', horizon: '#dff3fb', fog: '#c6e9f7', exposure: 1.05 },
  { h: 12, sun: '#fff0d4', sunI: 2.6, hemiSky: '#d6f1ff', hemiGround: '#6fae4a', hemiI: 1.4, top: '#4fb3ea', horizon: '#c9eefc', fog: '#bfe7f7', exposure: 1.05 },
  { h: 17.5, sun: '#ffb35c', sunI: 2.2, hemiSky: '#ffe0b0', hemiGround: '#8a9a4a', hemiI: 1.15, top: '#4d9ad8', horizon: '#ffd09a', fog: '#f5cc9c', exposure: 1.05 },
  { h: 18.7, sun: '#ff8a6a', sunI: 0.6, hemiSky: '#b07aa8', hemiGround: '#4a5068', hemiI: 0.95, top: '#3a4f92', horizon: '#f58ca0', fog: '#e88a9a', exposure: 1.0 },
  { h: 20, ...NIGHT },
  { h: 24, ...NIGHT },
];

const KEYS: Key[] = KEY_SPECS.map((k) => ({
  h: k.h,
  sun: new THREE.Color(k.sun),
  sunI: k.sunI,
  hemiSky: new THREE.Color(k.hemiSky),
  hemiGround: new THREE.Color(k.hemiGround),
  hemiI: k.hemiI,
  top: new THREE.Color(k.top),
  horizon: new THREE.Color(k.horizon),
  fog: new THREE.Color(k.fog),
  exposure: k.exposure,
}));

interface Firefly {
  cx: number;
  cz: number;
  reach: number;
  phase: number;
  speed: number;
  blink: number;
  blinkPhase: number;
}

/**
 * Game clock, sun path, keyframed lighting, sky, stars, moon and fireflies.
 * Call update() once per frame after the environment has moved to the player.
 */
export class DayNight {
  /** Game hour, 0 to 24. */
  time = START_HOUR;
  /** Multiplier on the clock rate. 1 means one day per DAY_SECONDS. */
  speed = 1;
  /** Game hours that passed in the last update (used by Weather). */
  hoursThisFrame = 0;

  readonly stars: THREE.Points;
  readonly moon: THREE.Group;
  readonly fireflies: THREE.Points;

  private sunDir = new THREE.Vector3(0, 1, 0);
  private lightDir = new THREE.Vector3(0, 1, 0);
  private center = new THREE.Vector3();
  private fog: THREE.Fog;
  private bg: THREE.Color;
  private starsU = uniform(0);
  private skyTimer = 0;
  private pill: HTMLDivElement;
  private pillText = '';
  private moonMats: THREE.MeshBasicMaterial[] = [];
  private flies: Firefly[] = [];
  private flyPos = new Float32Array(FIREFLY_COUNT * 3);
  private flyCol = new Float32Array(FIREFLY_COUNT * 3);
  private flyBase = new Float32Array(FIREFLY_COUNT * 3);

  // Scratch colours, reused each frame.
  private cSun = new THREE.Color();
  private cHemiSky = new THREE.Color();
  private cHemiGround = new THREE.Color();
  private cTop = new THREE.Color();
  private cHorizon = new THREE.Color();
  private cFog = new THREE.Color();
  private cSky = new THREE.Color();
  /** Seconds of game-clock-independent time, for firefly motion. */
  private elapsed = 0;

  constructor(
    scene: THREE.Scene,
    private env: Environment,
    private terrain: Ground,
    private renderer: THREE.WebGPURenderer,
  ) {
    this.fog = scene.fog as THREE.Fog;
    this.bg = new THREE.Color();
    scene.background = this.bg;

    this.stars = this.buildStars();
    scene.add(this.stars);
    this.moon = this.buildMoon();
    scene.add(this.moon);

    const flies = this.buildFireflies();
    this.fireflies = flies;
    scene.add(flies);

    this.pill = document.createElement('div');
    this.pill.id = 'clock-pill';
    this.pill.className = 'clock-pill';
    document.body.append(this.pill);

    const help = document.querySelector<HTMLElement>('#hud .help');
    if (help) help.textContent = `${help.textContent?.trimEnd() ?? ''}${t('help.time')}`;

    window.addEventListener('keydown', (e) => {
      if (e.code !== 'KeyT' || e.repeat || isTyping()) return;
      this.advanceHour(1);
    });

    this.update(0, new THREE.Vector3(), 0);
  }

  /** Sets the clock to a game hour (wrapped into 0 to 24). */
  setTime(hour: number) {
    this.time = ((hour % 24) + 24) % 24;
  }

  advanceHour(h: number) {
    this.setTime(this.time + h);
  }

  /** 0 by day, 1 at deep night, with smooth dusk (18-20) and dawn (5-7) transitions. */
  get nightFactor(): number {
    const h = this.time;
    return h < 12 ? 1 - smoothstep(5, 7, h) : smoothstep(18, 20, h);
  }

  /** Per-frame update. `rain` is the weather's rainAmount, 0 to 1. */
  update(dt: number, focus: THREE.Vector3, rain: number) {
    this.elapsed += dt;
    this.hoursThisFrame = (dt * this.speed * 24) / DAY_SECONDS;
    this.setTime(this.time + this.hoursThisFrame);

    const night = this.nightFactor;
    this.updateSun(focus);
    this.updateLighting(rain);

    this.center.set(focus.x, 0, focus.z);
    this.env.sky.position.set(focus.x, 0, focus.z);

    this.skyTimer -= dt;
    if (this.skyTimer <= 0) {
      this.skyTimer = SKY_EVERY;
      this.recolourSky();
    }

    this.updateStars(night, rain);
    this.updateMoon(night, rain);
    if (night > 0.01) this.updateFireflies(night);
    this.fireflies.visible = night > 0.01;
    this.env.waterNight.value = night;
    this.updatePill(rain);
  }

  /** Sun direction from the clock. Below the horizon at night, the moon uses the opposite direction. */
  private updateSun(focus: THREE.Vector3) {
    const phi = ((this.time - 6) / 12) * Math.PI;
    const elev = Math.sin(phi);
    this.sunDir.set(-Math.cos(phi) * SUN_AZIMUTH_TILT, elev, SUN_Z).normalize();
    // The light switches to moonlight once the sun is about to set (or has set).
    const sunUp = elev > -0.02;
    this.lightDir.copy(this.sunDir);
    if (!sunUp) this.lightDir.negate();

    const sun = this.env.sun;
    sun.position.copy(focus).addScaledVector(this.lightDir, SUN_DISTANCE);
    sun.target.position.copy(focus);
  }

  private updateLighting(rain: number) {
    const h = this.time;
    let i = 0;
    while (i < KEYS.length - 2 && h >= KEYS[i + 1].h) i++;
    const a = KEYS[i];
    const b = KEYS[i + 1];
    const k = clamp((h - a.h) / (b.h - a.h), 0, 1);

    // Rain greys the light: sun and moon lose ~45% at full rain, the hemisphere light goes grey.
    const cSun = this.cSun.copy(a.sun).lerp(b.sun, k).lerp(RAIN_LIGHT, rain * 0.4);
    const sunI = lerp(a.sunI, b.sunI, k) * (1 - 0.45 * rain);
    const hemiI = lerp(a.hemiI, b.hemiI, k) * (1 - 0.35 * rain);
    this.cHemiSky.copy(a.hemiSky).lerp(b.hemiSky, k).lerp(RAIN_LIGHT, rain * 0.6);
    this.cHemiGround.copy(a.hemiGround).lerp(b.hemiGround, k).lerp(RAIN_GROUND, rain * 0.5);
    const exposure = lerp(a.exposure, b.exposure, k) * (1 - 0.05 * rain);

    const sun = this.env.sun;
    sun.color.copy(cSun);
    sun.intensity = sunI;
    this.env.hemi.color.copy(this.cHemiSky);
    this.env.hemi.groundColor.copy(this.cHemiGround);
    this.env.hemi.intensity = hemiI;
    this.renderer.toneMappingExposure = exposure;

    this.cTop.copy(a.top).lerp(b.top, k).lerp(RAIN_TOP, rain * 0.85);
    this.cHorizon.copy(a.horizon).lerp(b.horizon, k).lerp(RAIN_HORIZON, rain * 0.85);
    this.cFog.copy(a.fog).lerp(b.fog, k).lerp(RAIN_FOG, rain * 0.6);
    this.bg.copy(this.cHorizon);
    this.fog.color.copy(this.cFog);
    // Rain pulls the fog in.
    this.fog.near = lerp(70, 28, rain);
    this.fog.far = lerp(260, 150, rain);
  }

  /** Gradient sky: horizon colour at the rim, top colour at the zenith. Same maths as the original dome. */
  private recolourSky() {
    const geo = this.env.sky.geometry;
    const pos = geo.getAttribute('position');
    const col = geo.getAttribute('color') as THREE.BufferAttribute;
    const c = this.cSky;
    for (let i = 0; i < pos.count; i++) {
      const t = Math.max(0, pos.getY(i) / SKY_SEGMENTS_R);
      c.copy(this.cHorizon).lerp(this.cTop, Math.pow(t, 0.6));
      col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
  }

  private buildStars(): THREE.Points {
    const pos = new Float32Array(STAR_COUNT * 3);
    const col = new Float32Array(STAR_COUNT * 3);
    const size = new Float32Array(STAR_COUNT);
    for (let i = 0; i < STAR_COUNT; i++) {
      // Random point on the upper sky dome.
      const y = rand(0.04, 1);
      const r = Math.sqrt(1 - y * y);
      const a = rand(0, Math.PI * 2);
      pos.set([Math.cos(a) * r * STAR_RADIUS, y * STAR_RADIUS, Math.sin(a) * r * STAR_RADIUS], i * 3);
      const b = rand(0.55, 1);
      col.set([b, b, b * rand(0.92, 1)], i * 3);
      size[i] = rand(1.0, 2.4);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('starSize', new THREE.BufferAttribute(size, 1));

    const mat = new PointsNodeMaterial({ transparent: true, depthWrite: false, sizeAttenuation: false });
    mat.vertexColors = true;
    mat.sizeNode = attribute('starSize', 'float');
    mat.opacityNode = this.starsU;
    mat.fog = false;
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.visible = false;
    return pts;
  }

  private buildMoon(): THREE.Group {
    const group = new THREE.Group();
    const disc = new THREE.MeshBasicMaterial({ color: '#eef3ff', transparent: true, depthWrite: false, fog: false, opacity: 0 });
    const halo = new THREE.MeshBasicMaterial({ color: '#c9d9ff', transparent: true, depthWrite: false, fog: false, opacity: 0 });
    this.moonMats = [disc, halo];
    const discMesh = new THREE.Mesh(new THREE.CircleGeometry(11, 32), disc);
    const haloMesh = new THREE.Mesh(new THREE.CircleGeometry(20, 32), halo);
    haloMesh.position.z = -0.1;
    group.add(discMesh, haloMesh);
    group.visible = false;
    return group;
  }

  private updateStars(night: number, rain: number) {
    const on = night > 0.01;
    this.stars.visible = on;
    if (!on) return;
    this.starsU.value = night * (1 - 0.8 * rain);
    this.stars.position.copy(this.center);
  }

  private updateMoon(night: number, rain: number) {
    // Moon sits opposite the sun, so it is up only when the sun is down.
    const moonDir = this.sunDir.clone().negate();
    const up = night > 0.01 && moonDir.y > 0.02;
    this.moon.visible = up;
    if (!up) return;
    this.moon.position.copy(this.center).addScaledVector(moonDir, MOON_DISTANCE);
    this.moon.lookAt(this.center);
    const o = night * (1 - rain);
    this.moonMats[0].opacity = o * 0.95;
    this.moonMats[1].opacity = o * 0.18;
  }

  /** Fireflies in three clusters: pond, orchard and the paddy edges. */
  private buildFireflies(zones: Zones = ZONES, orchards: Orchard[] = [{ x: -14, z: 12, r: 6, trees: 8 }]): THREE.Points {
    const flies: Firefly[] = [];
    for (let i = 0; i < FIREFLY_COUNT; i++) {
      flies.push({
        cx: 0, cz: 0, reach: 1,
        phase: rand(0, Math.PI * 2),
        speed: rand(0.6, 1.2),
        blink: rand(0.8, 2.0),
        blinkPhase: rand(0, Math.PI * 2),
      });
    }
    this.flies = flies;
    this.scatterFireflies(zones, orchards);
    for (let i = 0; i < FIREFLY_COUNT; i++) FIREFLY_COLOR.toArray(this.flyBase, i * 3);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.flyPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.flyCol, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.35,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.visible = false;
    return pts;
  }

  /** The live island changed: scatter the firefly clusters around its pond, orchard and paddy. */
  setIsland(zones: Zones, orchards: Orchard[]) {
    this.scatterFireflies(zones, orchards);
  }

  private scatterFireflies(zones: Zones, orchards: Orchard[]) {
    const { ponds, paddy } = zones;
    const flies = this.flies;
    for (let i = 0; i < FIREFLY_COUNT; i++) {
      const fly = flies[i];
      let cx: number;
      let cz: number;
      let reach: number;
      if (i < 25) {
        const pond = ponds[i % ponds.length];
        const a = rand(0, Math.PI * 2);
        const r = Math.sqrt(Math.random()) * (pond.r - 1.5);
        cx = pond.x + Math.cos(a) * r;
        cz = pond.z + Math.sin(a) * r;
        reach = 1.6;
      } else if (i < 40) {
        const orchard = orchards[i % orchards.length];
        const a = rand(0, Math.PI * 2);
        const r = Math.sqrt(Math.random()) * (orchard.r - 1);
        cx = orchard.x + Math.cos(a) * r;
        cz = orchard.z + Math.sin(a) * r;
        reach = 1.4;
      } else {
        // Along the paddy edges, just outside the field.
        const hw = paddy.w / 2 + 1.5;
        const hd = paddy.d / 2 + 1.5;
        const s = rand(0, 4);
        const side = Math.floor(s);
        const frac = s - side;
        if (side === 0) { cx = paddy.x - hw + 2 * hw * frac; cz = paddy.z - hd; }
        else if (side === 1) { cx = paddy.x + hw; cz = paddy.z - hd + 2 * hd * frac; }
        else if (side === 2) { cx = paddy.x + hw - 2 * hw * frac; cz = paddy.z + hd; }
        else { cx = paddy.x - hw; cz = paddy.z + hd - 2 * hd * frac; }
        reach = 0.8;
      }
      fly.cx = cx;
      fly.cz = cz;
      fly.reach = reach;
    }
  }

  private updateFireflies(night: number) {
    const t = this.elapsed;
    const pos = this.flyPos;
    const col = this.flyCol;
    const base = this.flyBase;
    const flies = this.flies;
    for (let i = 0; i < FIREFLY_COUNT; i++) {
      const f = flies[i];
      const s = f.speed;
      const p = f.phase;
      // Two slow sines per axis give a lazy wandering path.
      const x = f.cx + f.reach * (0.6 * Math.sin(t * 0.21 * s + p) + 0.4 * Math.sin(t * 0.37 * s + p * 1.7));
      const z = f.cz + f.reach * (0.6 * Math.cos(t * 0.19 * s + p * 0.6) + 0.4 * Math.sin(t * 0.33 * s + p * 2.3));
      const ground = Math.max(this.terrain.heightAt(x, z), WATER_LEVEL);
      const y = ground + 0.3 + 1.7 * (0.5 + 0.5 * Math.sin(t * 0.4 * s + p * 0.9));
      const j = i * 3;
      pos[j] = x;
      pos[j + 1] = y;
      pos[j + 2] = z;
      // Sharp blink: a short bright flash once per cycle.
      const b = Math.pow(Math.max(0, Math.sin(t * f.blink + f.blinkPhase)), 6) * night;
      col[j] = base[j] * b;
      col[j + 1] = base[j + 1] * b;
      col[j + 2] = base[j + 2] * b;
    }
    const geo = this.fireflies.geometry;
    geo.getAttribute('position').needsUpdate = true;
    geo.getAttribute('color').needsUpdate = true;
  }

  private updatePill(rain: number) {
    const h = this.time;
    const hh = Math.floor(h);
    const mm = Math.floor((h - hh) * 60);
    // Moon 20:00 to 05:00, sunrise 05-07 and sunset 17-20, sun otherwise.
    const icon = h >= 20 || h < 5 ? '🌙' : (h >= 5 && h < 7) || (h >= 17 && h < 20) ? '🌅' : '☀️';
    const text = `${icon} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}${rain > 0.2 ? ' 🌧️' : ''}`;
    if (text !== this.pillText) {
      this.pillText = text;
      this.pill.textContent = text;
    }
  }
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
