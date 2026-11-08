import * as THREE from 'three/webgpu';
import type { Physics } from '../core/Physics';
import type RAPIER from '@dimforge/rapier3d-compat';
import { COAST_H, mulberry32 } from './Terrain';
import { MeshBaker } from './Bake';
import { COLS, ISLANDS, ROWS, SPACING, centreOf, inProxyWindow, ownerOfCell, type IslandKind, type Vec2 } from './Islands';
import type { Terrains } from './Terrains';

const DECK_W = 3;
const DECK_HALF = DECK_W / 2;
/** Extra height at mid-span, on top of the straight line between the landing heights. */
const ARCH = 1;
/** The deck starts this far inland of the coast. */
const LANDING_INSET = 4;
/** Keep-clear corridor: 12 m inland from each landing, this far either side of the axis. */
const CORRIDOR_HALF = 2.5;
const CORRIDOR_INLAND = 12;
const PLANK_W = 0.32;
const PLANK_GAP = 0.04;
const PLANK_T = 0.12;
const PLANK_COLOR = '#b98a58';
const POST_COLOR = '#6b4a2e';
const ROPE_COLOR = '#4a3a2a';
const CUP_COLOR = '#4a3322';
const POST_EVERY = 4;
const POST_BOTTOM = -2;
const POST_R = 0.09;
const POST_OFFSET = DECK_HALF + 0.1;
const RAIL_H = 1.1;
const RAIL_SAG = 0.12;
const ROPE_R = 0.025;
const ROPE_SEG = 4;
/** Collider boxes are at most this long (m), so the deck's slope does not lift their ends above the deck. */
const COLLIDER_SEG_LEN = 2.5;
const COLLIDER_SEGS = 12;
const RAIL_COLLIDER_H = 0.6;
/** Walkable half-width around the deck centre line (the rails sit at 1.5 to 1.6). */
const WALK_HALF = 1.6;
const WALK_MARGIN = 0.5;
/** Bridges are drawn while one of their two islands is within the proxy window. */
const COAST_SEARCH = 250;

export type Axis = 'x' | 'z';

/**
 * One bridge, in world coordinates. The deck runs from p0 to p1 along `axis`, on the line at `lateral`
 * across it. `islands` are the two islands it joins.
 */
export interface Layout {
  id: string;
  islands: [number, number];
  axis: Axis;
  lateral: number;
  p0: number;
  p1: number;
  h0: number;
  h1: number;
  /** Mid-span arch (m). Defaults to ARCH; a pier lies flat with 0. */
  arch?: number;
}

interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

interface DeckPoint {
  top: THREE.Vector3;
  n: THREE.Vector3;
  v: THREE.Vector3;
  q: THREE.Quaternion;
}

/**
 * Distance from `(ox, oz)` along (dx, dz) to the shore: the first point below the coast height that stays
 * below it for `sustain` metres. A sustain of 0 takes the first such point (the normal islands' original rule).
 * The main island's noise has bumps that dip under the coast height inside the land, so it uses 6 m.
 */
function coastFrom(ground: (x: number, z: number) => number, ox: number, oz: number, dx: number, dz: number, sustain = 0): number {
  for (let d = 0; d <= COAST_SEARCH; d += 0.25) {
    if (ground(ox + dx * d, oz + dz * d) >= COAST_H) continue;
    let sea = true;
    for (let s = 0.25; s <= sustain && sea; s += 0.25) sea = ground(ox + dx * (d + s), oz + dz * (d + s)) < COAST_H;
    if (sea) return d;
  }
  return COAST_SEARCH;
}

/** Sustain (m) for a kind's shore: see coastFrom. */
const sustainOf = (kind: IslandKind) => (kind === 'main' ? MAIN_SUSTAIN : 0);
const MAIN_SUSTAIN = 6;

/** Keep-clear rectangle for a landing `d` metres from the centre, in direction (dx, dz) at lateral offset `lat`. */
function landingRect(dx: number, dz: number, d: number, lat: number): Rect {
  const h = CORRIDOR_HALF;
  if (dx > 0) return { x0: d - LANDING_INSET - CORRIDOR_INLAND, x1: d + 2, z0: lat - h, z1: lat + h };
  if (dx < 0) return { x0: -(d + 2), x1: -(d - LANDING_INSET - CORRIDOR_INLAND), z0: lat - h, z1: lat + h };
  if (dz > 0) return { x0: lat - h, x1: lat + h, z0: d - LANDING_INSET - CORRIDOR_INLAND, z1: d + 2 };
  return { x0: lat - h, x1: lat + h, z0: -(d + 2), z1: -(d - LANDING_INSET - CORRIDOR_INLAND) };
}

const DIRS: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/**
 * Wooden bridges between edge-adjacent islands, all built once in world coordinates. Normal-normal bridges
 * run along the line through both centres. A main-normal bridge runs along the line through the normal
 * island's centre, so the main island gets up to two per side. Bridges touching the live island get
 * physics colliders in its local frame, and the whole set is drawn offset by minus the live centre.
 */
export class Bridges {
  readonly root = new THREE.Group();
  readonly layouts: Layout[];
  private corridors: Record<IslandKind, Rect[]>;
  private groups: THREE.Group[] = [];
  private active: Layout[] = [];
  private colliders: RAPIER.Collider[] = [];
  private centre: Vec2 = { x: 0, z: 0 };
  /** One group per bridge: its four lantern flames, shared by every bridge. */
  private flames: THREE.Object3D[] = [];
  private flameOuter: THREE.MeshBasicMaterial;
  private flameInner: THREE.MeshBasicMaterial;
  private plankMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, flatShading: true });
  private frameMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, flatShading: true });
  private flameOuterGeo = new THREE.ConeGeometry(0.16, 0.5, 6).translate(0, 0.25, 0);
  private flameInnerGeo = new THREE.ConeGeometry(0.08, 0.3, 5).translate(0, 0.15, 0);

  constructor(
    parent: THREE.Object3D,
    private terrains: Terrains,
    private physics: Physics,
  ) {
    this.root.name = 'bridges';
    parent.add(this.root);

    this.layouts = this.buildLayouts();
    this.corridors = {
      normal: this.landingRects('normal'),
      main: this.landingRects('main'),
    };

    this.flameOuter = new THREE.MeshBasicMaterial({
      color: '#ff8a2a', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0,
    });
    this.flameInner = new THREE.MeshBasicMaterial({ color: '#ffd36b', transparent: true, depthWrite: false, opacity: 0 });

    this.layouts.forEach((l, i) => {
      const g = new THREE.Group();
      g.name = `bridge ${l.id}`;
      this.root.add(g);
      this.groups.push(g);
      this.buildDeck(g, l, i + 1);
    });
  }

  /** Number of bridges in the world. */
  get count(): number {
    return this.layouts.length;
  }

  /** Adds a walkable deck (a pier) after construction. Call before applyIsland. */
  addLayout(l: Layout) {
    this.layouts.push(l);
    const g = new THREE.Group();
    g.name = `bridge ${l.id}`;
    this.root.add(g);
    this.groups.push(g);
    this.buildDeck(g, l, this.layouts.length);
  }

  /** The keep-clear test for props and vegetation on a kind of island, in that island's local frame. */
  corridorFor(kind: IslandKind): (x: number, z: number) => boolean {
    const rects = this.corridors[kind];
    return (x, z) => rects.some((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1);
  }

  /** True when (x, z), in the live island's local frame, is on one of its bridges. */
  onBridge(x: number, z: number): boolean {
    const wx = x + this.centre.x;
    const wz = z + this.centre.z;
    for (const l of this.active) {
      const lo = Math.min(l.p0, l.p1) - WALK_MARGIN;
      const hi = Math.max(l.p0, l.p1) + WALK_MARGIN;
      const a = l.axis === 'x' ? wx : wz;
      const b = l.axis === 'x' ? wz : wx;
      if (a >= lo && a <= hi && Math.abs(b - l.lateral) <= WALK_HALF) return true;
    }
    return false;
  }

  /** The live island changed: move the drawing by its centre, show the nearby bridges, and collide with the ones it touches. */
  applyIsland(id: number) {
    const c = centreOf(id);
    this.centre = c;
    this.root.position.set(-c.x, 0, -c.z);
    this.layouts.forEach((l, i) => {
      this.groups[i].visible = inProxyWindow(id, l.islands[0]) || inProxyWindow(id, l.islands[1]);
    });

    for (const col of this.colliders) this.physics.world.removeCollider(col, true);
    this.colliders = [];
    this.active = this.layouts.filter((l) => l.islands.includes(id));
    for (const l of this.active) this.addColliders(l);
    // A collider created between steps is missed by the character controller until the next step.
    this.physics.world.step();
  }

  /** Night: the bridge lanterns come on. Opacity is on shared materials. */
  update(night: number) {
    const on = night > 0.01;
    for (const f of this.flames) f.visible = on;
    this.flameOuter.opacity = 0.85 * night;
    this.flameInner.opacity = night;
  }

  /** Every bridge, joining each pair of edge-adjacent islands once. */
  private buildLayouts(): Layout[] {
    const out: Layout[] = [];
    const pair = (c1: number, r1: number, c2: number, r2: number, axis: Axis) => {
      const a = ownerOfCell(c1, r1);
      const b = ownerOfCell(c2, r2);
      if (a === null || b === null || a === b) return;
      const A = centreOf(a);
      const B = centreOf(b);
      // Both cells share a row (x bridges) or a column (z bridges); the line runs through the normal island's centre.
      const lateral = axis === 'x' ? r1 * SPACING : c1 * SPACING;
      const oA = axis === 'x' ? { x: A.x, z: lateral } : { x: lateral, z: A.z };
      const oB = axis === 'x' ? { x: B.x, z: lateral } : { x: lateral, z: B.z };
      const [dx, dz] = axis === 'x' ? [1, 0] : [0, 1];
      const dA = coastFrom(this.terrains.heightAtWorld, oA.x, oA.z, dx, dz, sustainOf(ISLANDS[a].kind));
      const dB = coastFrom(this.terrains.heightAtWorld, oB.x, oB.z, -dx, -dz, sustainOf(ISLANDS[b].kind));
      const along = (p: Vec2) => (axis === 'x' ? p.x : p.z);
      const p0 = along(A) + dA - LANDING_INSET;
      const p1 = along(B) - dB + LANDING_INSET;
      const at = (t: number) => (axis === 'x' ? { x: t, z: lateral } : { x: lateral, z: t });
      const q0 = at(p0);
      const q1 = at(p1);
      out.push({
        id: `${a}-${b}`,
        islands: [a, b],
        axis,
        lateral,
        p0,
        p1,
        h0: this.terrains.heightAtWorld(q0.x, q0.z),
        h1: this.terrains.heightAtWorld(q1.x, q1.z),
      });
    };
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        pair(c, r, c + 1, r, 'x');
        pair(c, r, c, r + 1, 'z');
      }
    }
    return out;
  }

  /** Corridors where each kind's bridges can land. The main island has a landing per side at each of two offsets. */
  private landingRects(kind: IslandKind): Rect[] {
    const terrain = this.terrains.of(kind);
    const ground = (x: number, z: number) => terrain.heightAt(x, z);
    const offsets = kind === 'main' ? [-SPACING / 2, SPACING / 2] : [0];
    const out: Rect[] = [];
    for (const [dx, dz] of DIRS) {
      for (const lat of offsets) {
        const ox = dz !== 0 ? lat : 0;
        const oz = dx !== 0 ? lat : 0;
        const d = coastFrom(ground, ox, oz, dx, dz, sustainOf(kind));
        out.push(landingRect(dx, dz, d, lat));
      }
    }
    return out;
  }

  /** Centre-line frame at arc length s: top surface point, normal, lateral unit vector and an orientation quaternion. */
  private deckAt(l: Layout, s: number): DeckPoint {
    const L = Math.abs(l.p1 - l.p0);
    const sgn = Math.sign(l.p1 - l.p0);
    const t = s / L;
    const a = l.p0 + sgn * s;
    const arch = l.arch ?? ARCH;
    const h = THREE.MathUtils.lerp(l.h0, l.h1, t) + arch * Math.sin(Math.PI * t);
    const dhds = (l.h1 - l.h0) / L + (arch * Math.PI * Math.cos(Math.PI * t)) / L;
    const isX = l.axis === 'x';
    const u = isX ? new THREE.Vector3(sgn, 0, 0) : new THREE.Vector3(0, 0, sgn);
    const v = isX ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const top = isX ? new THREE.Vector3(a, h, l.lateral) : new THREE.Vector3(l.lateral, h, a);
    const n = new THREE.Vector3(-dhds * u.x, 1, -dhds * u.z).normalize();
    const z = new THREE.Vector3().crossVectors(v, n);
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(v, n, z));
    return { top, n, v, q };
  }

  private buildDeck(parent: THREE.Group, l: Layout, seedSalt: number) {
    const L = Math.abs(l.p1 - l.p0);
    const rand = mulberry32(1000 + seedSalt * 77);
    const sideOffset = (d: DeckPoint, side: number) => d.top.clone().addScaledVector(d.v, side * POST_OFFSET);
    // Static parts are baked into a few meshes: the planks, and one frame mesh for posts, ropes and lantern cups.
    const planks = new MeshBaker(true);
    const frame = new MeshBaker(true);
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const col = new THREE.Color();
    const identity = new THREE.Quaternion();

    // Planks: each spans the deck width and sits on the top surface.
    const step = PLANK_W + PLANK_GAP;
    const nPlanks = Math.floor(L / step);
    const plankGeo = new THREE.BoxGeometry(1, 1, 1);
    const plankScale = new THREE.Vector3(DECK_W, PLANK_T, PLANK_W);
    for (let i = 0; i < nPlanks; i++) {
      const d = this.deckAt(l, (i + 0.5) * step);
      pos.copy(d.top).addScaledVector(d.n, -PLANK_T / 2);
      m.compose(pos, d.q, plankScale);
      planks.add(plankGeo, m, col.set(PLANK_COLOR).multiplyScalar(0.85 + rand() * 0.25));
    }
    const plankMesh = new THREE.Mesh(planks.build(), this.plankMat);
    plankMesh.name = 'bridge-planks';
    plankMesh.castShadow = plankMesh.receiveShadow = true;
    parent.add(plankMesh);

    // Posts from the water floor up past the handrails, every POST_EVERY metres on both sides.
    const nPosts = Math.max(1, Math.round(L / POST_EVERY));
    const postGeo = new THREE.CylinderGeometry(POST_R, POST_R * 1.1, 1, 6);
    const postColor = new THREE.Color(POST_COLOR);
    for (let i = 0; i <= nPosts; i++) {
      for (const side of [-1, 1]) {
        const d = this.deckAt(l, (i / nPosts) * L);
        const top = sideOffset(d, side);
        top.y += RAIL_H;
        pos.set(top.x, (POST_BOTTOM + top.y) / 2, top.z);
        m.compose(pos, identity, new THREE.Vector3(1, top.y - POST_BOTTOM, 1));
        frame.add(postGeo, m, postColor);
      }
    }

    // Rope handrails: each span is a few short segments that sag between posts.
    const ropeGeo = new THREE.CylinderGeometry(ROPE_R, ROPE_R, 1, 4);
    const ropeColor = new THREE.Color(ROPE_COLOR);
    const up = new THREE.Vector3(0, 1, 0);
    const dir = new THREE.Vector3();
    const q = new THREE.Quaternion();
    for (const side of [-1, 1]) {
      for (let i = 0; i < nPosts; i++) {
        const pts: THREE.Vector3[] = [];
        for (let j = 0; j <= ROPE_SEG; j++) {
          const u = j / ROPE_SEG;
          const d = this.deckAt(l, THREE.MathUtils.lerp(i / nPosts, (i + 1) / nPosts, u) * L);
          const p = sideOffset(d, side);
          p.y += RAIL_H - RAIL_SAG * 4 * u * (1 - u);
          pts.push(p);
        }
        for (let j = 0; j < ROPE_SEG; j++) {
          const a = pts[j];
          const b = pts[j + 1];
          dir.subVectors(b, a);
          const len = dir.length();
          q.setFromUnitVectors(up, dir.normalize());
          pos.addVectors(a, b).multiplyScalar(0.5);
          m.compose(pos, q, new THREE.Vector3(1, len, 1));
          frame.add(ropeGeo, m, ropeColor);
        }
      }
    }

    // Lanterns at both ends, one on each post. The glowing cones share one group per bridge.
    const cupGeo = new THREE.CylinderGeometry(0.13, 0.09, 0.16, 6);
    const cupColor = new THREE.Color(CUP_COLOR);
    const flameOuter = new MeshBaker(false);
    const flameInner = new MeshBaker(false);
    for (const end of [0, L]) {
      for (const side of [-1, 1]) {
        const d = this.deckAt(l, end);
        const top = sideOffset(d, side);
        top.y += RAIL_H;
        frame.add(cupGeo, m.makeTranslation(top.x, top.y + 0.08, top.z), cupColor);
        const at = m.makeTranslation(top.x, top.y + 0.16, top.z);
        flameOuter.add(this.flameOuterGeo, at);
        flameInner.add(this.flameInnerGeo, at);
      }
    }
    const frameMesh = new THREE.Mesh(frame.build(), this.frameMat);
    frameMesh.name = 'bridge-frame';
    frameMesh.castShadow = true;
    parent.add(frameMesh);

    const flames = new THREE.Group();
    flames.name = 'bridge-flames';
    flames.visible = false;
    flames.add(
      new THREE.Mesh(flameOuter.build(), this.flameOuter),
      new THREE.Mesh(flameInner.build(), this.flameInner),
    );
    parent.add(flames);
    this.flames.push(flames);
  }

  /** Deck, side rails as thin colliders, one set per segment that follows the arch. Positions are local to the live centre. */
  private addColliders(l: Layout) {
    const { ColliderDesc } = this.physics.RAPIER;
    const L = Math.abs(l.p1 - l.p0);
    const segs = Math.max(COLLIDER_SEGS, Math.ceil(L / COLLIDER_SEG_LEN));
    const segHalf = L / segs / 2 + 0.15;
    const world = this.physics.world;
    const c = this.centre;
    for (let k = 0; k < segs; k++) {
      const d = this.deckAt(l, ((k + 0.5) * L) / segs);
      const deck = d.top.clone().addScaledVector(d.n, -0.15);
      this.colliders.push(
        world.createCollider(
          ColliderDesc.cuboid(DECK_HALF, 0.15, segHalf).setTranslation(deck.x - c.x, deck.y, deck.z - c.z).setRotation(d.q),
        ),
      );
      for (const side of [-1, 1]) {
        const r = d.top.clone().addScaledVector(d.v, side * (DECK_HALF + 0.05)).addScaledVector(d.n, RAIL_COLLIDER_H / 2);
        this.colliders.push(
          world.createCollider(
            ColliderDesc.cuboid(0.05, RAIL_COLLIDER_H / 2, segHalf).setTranslation(r.x - c.x, r.y, r.z - c.z).setRotation(d.q),
          ),
        );
      }
    }
  }
}

