import * as THREE from 'three/webgpu';
import type { Physics } from '../core/Physics';
import type RAPIER from '@dimforge/rapier3d-compat';
import { mulberry32, type Terrain } from './Terrain';
import { MeshBaker } from './Bake';
import { SPACING, type Archipelago, type Cell, type Side } from './Archipelago';

const DECK_W = 3;
const DECK_HALF = DECK_W / 2;
/** Extra height at mid-span, on top of the straight line between the landing heights. */
const ARCH = 1;
/** The deck starts this far inland of the coast. */
const LANDING_INSET = 4;
/** Land counts as coast once it drops below this height (m). */
const COAST_H = 0.5;
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
const COLLIDER_SEGS = 12;
const RAIL_COLLIDER_H = 0.6;
/** Walkable half-width around the deck centre line (the rails sit at 1.5 to 1.6). */
const WALK_HALF = 1.6;
const WALK_MARGIN = 0.5;

type Axis = 'x' | 'z';

/** One bridge in the owner island's local frame. The deck runs from p0 to p1 along `axis`, on the line through the centre. */
export interface Layout {
  side: Side;
  axis: Axis;
  p0: number;
  p1: number;
  h0: number;
  h1: number;
}

interface DeckPoint {
  top: THREE.Vector3;
  n: THREE.Vector3;
  v: THREE.Vector3;
  q: THREE.Quaternion;
}

const SIDES: Side[] = ['E', 'W', 'N', 'S'];

/**
 * Wooden bridges between neighbouring islands. Each island owns its east and north bridge (its
 * visuals live under the island root); the proxies draw the other two. The live island also
 * holds physics colliders for all four of its bridges, and its walkable corridors.
 */
export class Bridges {
  readonly root = new THREE.Group();
  readonly layouts: Record<Side, Layout>;
  /** Distance from the centre to the coast in each direction (m). */
  readonly coast: Record<Side, number>;
  private corridors: Array<{ x0: number; x1: number; z0: number; z1: number }>;
  private active: Layout[] = [];
  private colliders: RAPIER.Collider[] = [];
  private eGroup = new THREE.Group();
  private nGroup = new THREE.Group();
  /** One group per bridge end-to-end: its four lantern flames, as two merged meshes. */
  private flames: THREE.Object3D[] = [];
  private flameOuter: THREE.MeshBasicMaterial;
  private flameInner: THREE.MeshBasicMaterial;
  private flameOuterGeo = new THREE.ConeGeometry(0.16, 0.5, 6).translate(0, 0.25, 0);
  private flameInnerGeo = new THREE.ConeGeometry(0.08, 0.3, 5).translate(0, 0.15, 0);

  constructor(
    parent: THREE.Object3D,
    private terrain: Terrain,
    private physics: Physics,
  ) {
    this.root.name = 'bridges';
    parent.add(this.root);

    const c = {
      E: this.coastDistance(1, 0),
      W: this.coastDistance(-1, 0),
      N: this.coastDistance(0, -1),
      S: this.coastDistance(0, 1),
    };
    this.coast = c;
    const mk = (side: Side, axis: Axis, p0: number, p1: number): Layout => ({
      side, axis, p0, p1, h0: this.landHeight(axis, p0), h1: this.landHeight(axis, p1),
    });
    // E and W are one bridge seen from each island; N and S likewise. Ends are in the owner's frame.
    this.layouts = {
      E: mk('E', 'x', c.E - LANDING_INSET, SPACING - c.W + LANDING_INSET),
      W: mk('W', 'x', c.E - LANDING_INSET - SPACING, -(c.W - LANDING_INSET)),
      N: mk('N', 'z', -(c.N - LANDING_INSET), -(SPACING - c.S + LANDING_INSET)),
      S: mk('S', 'z', SPACING - c.N + LANDING_INSET, c.S - LANDING_INSET),
    };

    const h = CORRIDOR_HALF;
    this.corridors = [
      { x0: c.E - LANDING_INSET - CORRIDOR_INLAND, x1: c.E + 2, z0: -h, z1: h },
      { x0: -(c.W + 2), x1: -(c.W - LANDING_INSET - CORRIDOR_INLAND), z0: -h, z1: h },
      { x0: -h, x1: h, z0: -(c.N + 2), z1: -(c.N - LANDING_INSET - CORRIDOR_INLAND) },
      { x0: -h, x1: h, z0: c.S - LANDING_INSET - CORRIDOR_INLAND, z1: c.S + 2 },
    ];

    this.flameOuter = new THREE.MeshBasicMaterial({
      color: '#ff8a2a', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0,
    });
    this.flameInner = new THREE.MeshBasicMaterial({ color: '#ffd36b', transparent: true, depthWrite: false, opacity: 0 });

    this.eGroup.name = 'bridgeE';
    this.nGroup.name = 'bridgeN';
    this.root.add(this.eGroup, this.nGroup);
    this.buildDeck(this.eGroup, this.layouts.E, 1);
    this.buildDeck(this.nGroup, this.layouts.N, 2);
  }

  /** Keep props and vegetation out of the bridge landings. */
  inCorridor(x: number, z: number): boolean {
    return this.corridors.some((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1);
  }

  /** True when (x, z) in the live island's local frame is on one of its existing bridges. */
  onBridge(x: number, z: number): boolean {
    for (const l of this.active) {
      const lo = Math.min(l.p0, l.p1) - WALK_MARGIN;
      const hi = Math.max(l.p0, l.p1) + WALK_MARGIN;
      const a = l.axis === 'x' ? x : z;
      const b = l.axis === 'x' ? z : x;
      if (a >= lo && a <= hi && Math.abs(b) <= WALK_HALF) return true;
    }
    return false;
  }

  /** Live island changed: rebuild the four bridge colliders for the cell's existing neighbours and show its own E and N visuals. */
  applyCell(cell: Cell, arch: Archipelago) {
    for (const c of this.colliders) this.physics.world.removeCollider(c, true);
    this.colliders = [];
    this.active = [];
    for (const side of SIDES) {
      if (!arch.hasNeighbor(side, cell)) continue;
      this.active.push(this.layouts[side]);
      this.addColliders(this.layouts[side]);
    }
    this.eGroup.visible = arch.hasNeighbor('E', cell);
    this.nGroup.visible = arch.hasNeighbor('N', cell);
    // A collider created between steps is missed by the character controller until the next step.
    this.physics.world.step();
  }

  /** Night: the bridge lanterns come on. Opacity is on shared materials, so proxies follow too. */
  update(night: number) {
    const on = night > 0.01;
    for (const f of this.flames) f.visible = on;
    this.flameOuter.opacity = 0.85 * night;
    this.flameInner.opacity = night;
  }

  /** Landing height of the land at `p` along `axis`, wrapped into the centre island's frame. */
  private landHeight(axis: Axis, p: number): number {
    const w = p - Math.round(p / SPACING) * SPACING;
    return axis === 'x' ? this.terrain.heightAt(w, 0) : this.terrain.heightAt(0, w);
  }

  private coastDistance(dx: number, dz: number): number {
    for (let d = 0; d <= 120; d += 0.25) {
      if (this.terrain.heightAt(dx * d, dz * d) < COAST_H) return d;
    }
    return 120;
  }

  /** Centre-line frame at arc length s: top surface point, normal, lateral unit vector and an orientation quaternion. */
  private deckAt(l: Layout, s: number): DeckPoint {
    const L = Math.abs(l.p1 - l.p0);
    const sgn = Math.sign(l.p1 - l.p0);
    const t = s / L;
    const a = l.p0 + sgn * s;
    const h = THREE.MathUtils.lerp(l.h0, l.h1, t) + ARCH * Math.sin(Math.PI * t);
    const dhds = (l.h1 - l.h0) / L + (ARCH * Math.PI * Math.cos(Math.PI * t)) / L;
    const isX = l.axis === 'x';
    const u = isX ? new THREE.Vector3(sgn, 0, 0) : new THREE.Vector3(0, 0, sgn);
    const v = isX ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const top = isX ? new THREE.Vector3(a, h, 0) : new THREE.Vector3(0, h, a);
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
    const plankMesh = new THREE.Mesh(
      planks.build(),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, flatShading: true }),
    );
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

    // Lanterns at both ends, one on each post. The cups join the frame; the glowing cones share one group
    // per bridge, so the whole bridge's lanterns switch on and off together.
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
    const frameMesh = new THREE.Mesh(
      frame.build(),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, flatShading: true }),
    );
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

  /** Deck, side rails as thin colliders, one set per segment that follows the arch. */
  private addColliders(l: Layout) {
    const { ColliderDesc } = this.physics.RAPIER;
    const L = Math.abs(l.p1 - l.p0);
    const segHalf = L / COLLIDER_SEGS / 2 + 0.15;
    const world = this.physics.world;
    for (let k = 0; k < COLLIDER_SEGS; k++) {
      const d = this.deckAt(l, ((k + 0.5) * L) / COLLIDER_SEGS);
      const c = d.top.clone().addScaledVector(d.n, -0.15);
      this.colliders.push(
        world.createCollider(ColliderDesc.cuboid(DECK_HALF, 0.15, segHalf).setTranslation(c.x, c.y, c.z).setRotation(d.q)),
      );
      for (const side of [-1, 1]) {
        const r = d.top.clone().addScaledVector(d.v, side * (DECK_HALF + 0.05)).addScaledVector(d.n, RAIL_COLLIDER_H / 2);
        this.colliders.push(
          world.createCollider(
            ColliderDesc.cuboid(0.05, RAIL_COLLIDER_H / 2, segHalf).setTranslation(r.x, r.y, r.z).setRotation(d.q),
          ),
        );
      }
    }
  }
}
