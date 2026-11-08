import * as THREE from 'three/webgpu';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { clamp, float, floor, max, mix, positionWorld, sin, smoothstep, step, texture, time, uniform, vec2, vec3 } from 'three/tsl';
import type { UniformNode } from 'three/webgpu';
import { Terrain, WATER_LEVEL } from './Terrain';
import { SPACING } from './Archipelago';

const SKY_TOP = new THREE.Color('#4fb3ea');
const SKY_HORIZON = new THREE.Color('#c9eefc');
const FOG = new THREE.Color('#bfe7f7');

/** Water depth (m) at which the depth map saturates. */
const MAX_DEPTH = 6;
const DEPTH_RES = 256;

/** Sky dome, sun + fill light, toon water and fog. DayNight drives the colours and the sun direction. */
export class Environment {
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly sky: THREE.Mesh;
  /** 0 by day, 1 at night. Darkens and blue-shifts the toon water. */
  readonly waterNight: UniformNode<'float', number> = uniform(0);
  /** 3x3 grid of cell existence around the live island, row-major from the north-west corner. */
  private mask: THREE.DataTexture;
  private water: THREE.Mesh;

  constructor(scene: THREE.Scene, terrain: Terrain) {
    scene.fog = new THREE.Fog(FOG, 70, 260);
    scene.background = FOG;

    // Gradient sky dome via vertex colors (works on WebGPU and WebGL).
    const skyGeo = new THREE.SphereGeometry(400, 32, 16);
    const pos = skyGeo.getAttribute('position');
    const cols = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = Math.max(0, pos.getY(i) / 400);
      c.copy(SKY_HORIZON).lerp(SKY_TOP, Math.pow(t, 0.6));
      cols.set([c.r, c.g, c.b], i * 3);
    }
    skyGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    this.sky = new THREE.Mesh(
      skyGeo,
      new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }),
    );
    this.sky.renderOrder = -1;
    scene.add(this.sky);

    this.hemi = new THREE.HemisphereLight('#d6f1ff', '#6fae4a', 1.4);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight('#fff0d4', 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = this.sun.shadow.camera;
    s.left = s.bottom = -28;
    s.right = s.top = 28;
    s.near = 1;
    s.far = 150;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.03;
    scene.add(this.sun, this.sun.target);

    // One big water plane: ocean around the island and the pond basin.
    this.mask = new THREE.DataTexture(new Uint8Array(9).fill(255), 3, 3, THREE.RedFormat, THREE.UnsignedByteType);
    this.mask.minFilter = THREE.NearestFilter;
    this.mask.magFilter = THREE.NearestFilter;
    this.mask.wrapS = this.mask.wrapT = THREE.ClampToEdgeWrapping;
    this.mask.needsUpdate = true;

    const waterGeo = new THREE.PlaneGeometry(900, 900, 1, 1).rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(waterGeo, toonWater(terrain, this.waterNight, this.mask));
    this.water.position.y = WATER_LEVEL;
    scene.add(this.water);
  }

  /**
   * Which of the 3x3 cells around the live island hold an island. `exists[(dz + 1) * 3 + (dx + 1)]`,
   * with dz = +1 toward the south (+z). Cells outside the grid count as deep water.
   */
  setIslandMask(exists: readonly boolean[]) {
    const data = this.mask.image.data as Uint8Array;
    for (let i = 0; i < 9; i++) data[i] = exists[i] ? 255 : 0;
    this.mask.needsUpdate = true;
  }

  /** Keep the shadow frustum and sky centred on the player. */
  update(focus: THREE.Vector3, time: number) {
    this.sun.target.position.copy(focus);
    this.sky.position.set(focus.x, 0, focus.z);
    this.water.position.y = WATER_LEVEL + Math.sin(time * 0.8) * 0.04;
  }
}

/** Water depth per texel over the terrain square, 0 (dry) to MAX_DEPTH. */
function buildDepthTexture(terrain: Terrain) {
  const data = new Uint8Array(DEPTH_RES * DEPTH_RES);
  const cell = terrain.size / DEPTH_RES;
  const half = terrain.size / 2;
  for (let j = 0; j < DEPTH_RES; j++) {
    for (let i = 0; i < DEPTH_RES; i++) {
      const h = terrain.heightAt(-half + (i + 0.5) * cell, -half + (j + 0.5) * cell);
      const depth = Math.min(1, Math.max(0, (WATER_LEVEL - h) / MAX_DEPTH));
      data[j * DEPTH_RES + i] = Math.round(depth * 255);
    }
  }
  const tex = new THREE.DataTexture(data, DEPTH_RES, DEPTH_RES, THREE.RedFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

const rgb = (hex: string) => {
  const c = new THREE.Color(hex);
  return vec3(c.r, c.g, c.b);
};

/**
 * Toon water: depth-banded colour, a wobbling white foam line at the shore and light streaks.
 * The depth map covers one island. The world XZ is wrapped into the cell it falls in, so the
 * neighbour proxies get the same shore, and that cell must exist (from the 3x3 mask) to count as land.
 */
function toonWater(terrain: Terrain, night: UniformNode<'float', number>, mask: THREE.DataTexture) {
  const depthTex = texture(buildDepthTexture(terrain));
  const maskTex = texture(mask);
  const p = positionWorld;
  const t = time;

  // Which cell (-1..1 on each axis) the point is in, and whether it is inside the 3x3 window at all.
  const rx = floor(p.x.div(SPACING).add(0.5));
  const rz = floor(p.z.div(SPACING).add(0.5));
  const inWindow = step(float(-1.5), rx).mul(step(rx, float(1.5))).mul(step(float(-1.5), rz)).mul(step(rz, float(1.5)));
  const cx = clamp(rx, float(-1), float(1));
  const cz = clamp(rz, float(-1), float(1));
  const local = vec2(p.x.sub(cx.mul(SPACING)), p.z.sub(cz.mul(SPACING)));

  // World XZ to map UV inside that cell. Outside the depth map the water counts as deep.
  const uv = local.add(terrain.size / 2).div(terrain.size);
  const inside = step(float(0), uv.x)
    .mul(step(uv.x, float(1)))
    .mul(step(float(0), uv.y))
    .mul(step(uv.y, float(1)));
  const cellUv = vec2(cx.add(1.5).div(3), cz.add(1.5).div(3));
  const exists = maskTex.sample(cellUv).r;
  const land = inside.mul(exists).mul(inWindow);
  const sampled = depthTex.sample(uv).r.mul(MAX_DEPTH);
  const baseDepth = mix(float(MAX_DEPTH), sampled, land);
  const wobble = sin(t.mul(1.3).add(p.x.mul(0.7))).mul(0.05).add(sin(t.mul(0.9).sub(p.z.mul(0.9))).mul(0.04));
  const depth = baseDepth.add(wobble);

  // Shallow turquoise, then teal, then deep blue offshore.
  const shallow = rgb('#5fe8d2');
  const mid = rgb('#2bc3c9');
  const deep = rgb('#1c86b8');
  const band = mix(shallow, mid, smoothstep(float(0.1), float(1.0), depth));
  const deepBody = mix(band, deep, smoothstep(float(1.0), float(3.5), depth));
  // At night the body turns deep navy (shallow a little lighter). With night = 0 this is exactly the day colour.
  const nightShallow = rgb('#163b5c');
  const nightDeep = rgb('#0f2a4a');
  const nightBody = mix(nightShallow, nightDeep, smoothstep(float(0.1), float(2.5), depth));
  const body = mix(deepBody, nightBody, night);

  // Foam where the water is under about 0.25 m deep.
  const foam = float(1).sub(smoothstep(float(0.1), float(0.28), depth));
  const speckle = float(0.8).add(sin(p.x.mul(5).add(t.mul(2))).mul(sin(p.z.mul(4.6).sub(t.mul(1.3)))).mul(0.2));
  // At night the foam is dimmed to about 40%.
  const foamMask = foam.mul(speckle).mul(float(1).sub(night.mul(0.6)));

  // Thin light streaks that drift across the water.
  const ripple = sin(p.x.mul(0.9).add(p.z.mul(0.45)).add(sin(p.z.mul(0.6).add(t.mul(0.5))).mul(1.6)).add(t.mul(0.9)));
  const streak = smoothstep(float(0.9), float(0.96), ripple);
  // Break the streaks into scattered glints with a slow second wave.
  const patch = smoothstep(float(0.55), float(0.85), sin(p.x.mul(0.31).add(p.z.mul(0.13)).add(t.mul(0.2))).mul(0.5).add(0.5));
  // Night removes the streaks completely.
  const light = streak.mul(patch).mul(0.12).mul(float(1).sub(night));

  const white = vec3(1, 1, 1);
  const lit = mix(body, white, light);
  const color = mix(lit, white, foamMask.mul(0.9));
  const alpha = max(mix(float(0.7), float(0.9), smoothstep(float(0.2), float(1.5), depth)), foamMask);

  const mat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  mat.colorNode = color;
  mat.opacityNode = alpha;
  return mat;
}
