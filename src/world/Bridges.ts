import * as THREE from 'three/webgpu';
import type { Physics } from '../core/Physics';
import type RAPIER from '@dimforge/rapier3d-compat';
import { COAST_H, mulberry32 } from './Terrain';
import { MeshBaker } from './Bake';
import { ISLANDS, centreOf, inProxyWindow, type Vec2 } from './Islands';
import type { Terrains } from './Terrains';
import { distToSegment, gabrielEdges, segmentsCross, spanningTree, type Pair } from './Network';

const DECK_W = 3;
const DECK_HALF = DECK_W / 2;
/** Extra height at mid-span, on top of the straight line between the landing heights. */
const ARCH = 1;
/** The deck starts this far inland of the coast. */
const LANDING_INSET = 4;
/** Keep-clear rectangle on each island: 14 m inland of a landing and 2 m past it, 5 m wide. */
const CORRIDOR_HALF = 2.5;
const CORRIDOR_INLAND = 14;
const CORRIDOR_SEAWARD = 2;
/** Coast to coast, a bridge may be at most this long (m). The spanning tree is kept whatever its length. */
const MAX_BRIDGE = 170;
/** A bridge may not pass this close to a third island's centre (m). */
const NEAR_ISLAND = 70;
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
const SHORE_STEP = 0.25;

/**
 * One bridge, in world coordinates. The deck runs in a straight line from `from` to `to` (any angle), at the
 * heights h0 and h1 at its ends. `islands` are the two islands it joins; a pier joins an island to itself.
 */
export interface Layout {
  id: string;
  islands: [number, number];
  from: Vec2;
  to: Vec2;
  h0: number;
  h1: number;
  /** Mid-span arch (m). Defaults to ARCH; a pier lies flat with 0. */
  arch?: number;
}

/** A bridge's direction: unit vector from `from` to `to`, and its length. */
interface Frame {
  ux: number;
  uz: number;
  len: number;
}

/** A keep-clear rectangle on one island, in its local frame: the landing and the outward direction from it. */
interface Corridor {
  x: number;
  z: number;
  wx: number;
  wz: number;
}

interface DeckPoint {
  top: THREE.Vector3;
  n: THREE.Vector3;
  v: THREE.Vector3;
  q: THREE.Quaternion;
}

/** A bridge candidate on a Gabriel edge, with its landings and coast points in world coordinates. */
interface Candidate {
  a: number;
  b: number;
  from: Vec2;
  to: Vec2;
  h0: number;
  h1: number;
  /** Coast-to-coast length (m). */
  cc: number;
  coastA: Vec2;
  coastB: Vec2;
}

const frameOf = (l: Layout): Frame => {
  const dx = l.to.x - l.from.x;
  const dz = l.to.z - l.from.z;
  const len = Math.hypot(dx, dz);
  return { ux: dx / len, uz: dz / len, len };
};

const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

/**
 * Wooden bridges between islands, built once in world coordinates. The bridges form a planar graph: a Gabriel
 * graph over the island centres, reduced to its Euclidean minimum spanning tree plus the shorter Gabriel edges
 * that cross nothing and pass clear of other islands. Each bridge runs straight between its two islands, at any
 * angle. A bridge touching the live island gets physics colliders in its local frame, and the whole set is drawn
 * offset by minus the live centre.
 */
export class Bridges {
  readonly root = new THREE.Group();
  readonly layouts: Layout[];
  private corridors = new Map<number, Corridor[]>();
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
    for (const l of this.layouts) this.addCorridors(l);

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

  /**
   * The keep-clear test for an island's props and vegetation: true inside one of its bridge corridors. Takes a
   * point in that island's local frame.
   */
  corridorsOf(id: number): (x: number, z: number) => boolean {
    const list = this.corridors.get(id) ?? [];
    return (x, z) =>
      list.some((c) => {
        const rx = x - c.x;
        const rz = z - c.z;
        const along = rx * c.wx + rz * c.wz;
        const across = -rx * c.wz + rz * c.wx;
        return along >= -CORRIDOR_INLAND && along <= CORRIDOR_SEAWARD && Math.abs(across) <= CORRIDOR_HALF;
      });
  }

  /** True when (x, z), in the live island's local frame, is on one of its bridges. */
  onBridge(x: number, z: number): boolean {
    const wx = x + this.centre.x;
    const wz = z + this.centre.z;
    for (const l of this.active) {
      const f = frameOf(l);
      const rx = wx - l.from.x;
      const rz = wz - l.from.z;
      const along = rx * f.ux + rz * f.uz;
      const across = -rx * f.uz + rz * f.ux;
      if (along >= -WALK_MARGIN && along <= f.len + WALK_MARGIN && Math.abs(across) <= WALK_HALF) return true;
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

  /**
   * Every bridge in the world. Candidates are the Gabriel edges, each with its landings found on the terrain.
   * The spanning tree is always kept. Of the other candidates, the ones within MAX_BRIDGE (coast to coast) go in
   * shortest first, unless they pass near a third island or cross a bridge already kept.
   */
  private buildLayouts(): Layout[] {
    const pts = ISLANDS.map((d) => d.centerWorld);
    const candidates = gabrielEdges(pts).map(([a, b]) => this.candidate(a, b));
    const byKey = new Map(candidates.map((c) => [pairKey(c.a, c.b), c]));

    const tree = spanningTree(pts.length, candidates.map((c): Pair => [c.a, c.b]), ([a, b]) => Math.hypot(pts[b].x - pts[a].x, pts[b].z - pts[a].z));
    const inTree = new Set(tree.map(([a, b]) => pairKey(a, b)));
    const kept: Candidate[] = tree.map(([a, b]) => byKey.get(pairKey(a, b))!);

    const nearThirdIsland = (c: Candidate) =>
      pts.some((p, k) => k !== c.a && k !== c.b && distToSegment(p, pts[c.a], pts[c.b]) < NEAR_ISLAND);
    for (const c of kept) {
      if (nearThirdIsland(c)) console.warn(`Bridge ${c.a}-${c.b} (spanning tree) passes near another island`);
    }

    const extras = candidates
      .filter((c) => !inTree.has(pairKey(c.a, c.b)) && c.cc <= MAX_BRIDGE)
      .sort((p, q) => p.cc - q.cc);
    const tooLong = candidates.filter((c) => !inTree.has(pairKey(c.a, c.b)) && c.cc > MAX_BRIDGE).length;
    let near = 0;
    let crossing = 0;
    let added = 0;
    for (const c of extras) {
      if (nearThirdIsland(c)) {
        near++;
        continue;
      }
      if (kept.some((o) => segmentsCross(c.coastA, c.coastB, o.coastA, o.coastB))) {
        crossing++;
        continue;
      }
      kept.push(c);
      added++;
    }
    if (import.meta.env.DEV) {
      console.info(
        `Bridges: ${kept.length} total = ${tree.length} spanning tree + ${added} extra; dropped ${near + crossing + tooLong} `
          + `(${tooLong} too long, ${near} near a third island, ${crossing} crossing)`,
      );
    }
    return kept.map((c) => ({ id: `${c.a}-${c.b}`, islands: [c.a, c.b], from: c.from, to: c.to, h0: c.h0, h1: c.h1 }));
  }

  /** The bridge between islands a and b, from the outermost land on each side along the line between them. */
  private candidate(a: number, b: number): Candidate {
    const A = ISLANDS[a].centerWorld;
    const B = ISLANDS[b].centerWorld;
    const len = Math.hypot(B.x - A.x, B.z - A.z);
    const ux = (B.x - A.x) / len;
    const uz = (B.z - A.z) / len;
    const dA = this.shoreAlong(a, ux, uz, len / 2);
    const dB = this.shoreAlong(b, -ux, -uz, len / 2);
    const inA = dA - LANDING_INSET;
    const inB = dB - LANDING_INSET;
    return {
      a,
      b,
      from: { x: A.x + ux * inA, z: A.z + uz * inA },
      to: { x: B.x - ux * inB, z: B.z - uz * inB },
      h0: this.terrains.of(ISLANDS[a].kind).heightAt(ux * inA, uz * inA),
      h1: this.terrains.of(ISLANDS[b].kind).heightAt(-ux * inB, -uz * inB),
      cc: len - dA - dB,
      coastA: { x: A.x + ux * dA, z: A.z + uz * dA },
      coastB: { x: B.x - ux * dB, z: B.z - uz * dB },
    };
  }

  /**
   * Distance from island `id`'s centre to its outermost land along (ux, uz), searched no further than `maxD`.
   * Looking from the outside in finds the outer shore, so ponds and dips inside the island are not taken for it.
   */
  private shoreAlong(id: number, ux: number, uz: number, maxD: number): number {
    const ground = this.terrains.of(ISLANDS[id].kind);
    for (let d = maxD - SHORE_STEP; d > 0; d -= SHORE_STEP) {
      if (ground.heightAt(ux * d, uz * d) >= COAST_H) return d;
    }
    return 0;
  }

  /** Records the landings of a bridge as keep-clear corridors on both of its islands. Pier layouts have none. */
  private addCorridors(l: Layout) {
    const [a, b] = l.islands;
    if (a === b) return;
    const f = frameOf(l);
    this.addCorridor(a, l.from, f.ux, f.uz);
    this.addCorridor(b, l.to, -f.ux, -f.uz);
  }

  private addCorridor(id: number, end: Vec2, wx: number, wz: number) {
    const c = centreOf(id);
    const list = this.corridors.get(id) ?? [];
    list.push({ x: end.x - c.x, z: end.z - c.z, wx, wz });
    this.corridors.set(id, list);
  }

  /** Centre-line frame at arc length s: top surface point, normal, lateral unit vector and an orientation quaternion. */
  private deckAt(l: Layout, s: number): DeckPoint {
    const f = frameOf(l);
    const L = f.len;
    const t = s / L;
    const arch = l.arch ?? ARCH;
    const h = THREE.MathUtils.lerp(l.h0, l.h1, t) + arch * Math.sin(Math.PI * t);
    const dhds = (l.h1 - l.h0) / L + (arch * Math.PI * Math.cos(Math.PI * t)) / L;
    const top = new THREE.Vector3(l.from.x + f.ux * s, h, l.from.z + f.uz * s);
    const v = new THREE.Vector3(-f.uz, 0, f.ux);
    const n = new THREE.Vector3(-dhds * f.ux, 1, -dhds * f.uz).normalize();
    const z = new THREE.Vector3().crossVectors(v, n);
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(v, n, z));
    return { top, n, v, q };
  }

  private buildDeck(parent: THREE.Group, l: Layout, seedSalt: number) {
    const L = frameOf(l).len;
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
    const L = frameOf(l).len;
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
