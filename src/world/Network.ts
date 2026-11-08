import type { Vec2 } from './Islands';

/** Two indices into a list of points. */
export type Pair = [number, number];

const orient = (a: Vec2, b: Vec2, c: Vec2) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);

/**
 * Gabriel graph: A and B are joined when no other point lies strictly inside the circle with AB as its diameter.
 * It is a subgraph of the Delaunay triangulation, so its edges never cross.
 */
export function gabrielEdges(pts: readonly Vec2[]): Pair[] {
  const out: Pair[] = [];
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const a = pts[i];
      const b = pts[j];
      const mx = (a.x + b.x) / 2;
      const mz = (a.z + b.z) / 2;
      const r2 = ((b.x - a.x) ** 2 + (b.z - a.z) ** 2) / 4;
      let empty = true;
      for (let k = 0; k < pts.length && empty; k++) {
        if (k === i || k === j) continue;
        if ((pts[k].x - mx) ** 2 + (pts[k].z - mz) ** 2 < r2) empty = false;
      }
      if (empty) out.push([i, j]);
    }
  }
  return out;
}

/**
 * Minimum spanning tree (Kruskal) of the given edges by weight. Over the Gabriel graph this is the Euclidean
 * minimum spanning tree, which is planar and connects every point.
 */
export function spanningTree(n: number, edges: readonly Pair[], weight: (p: Pair) => number): Pair[] {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const out: Pair[] = [];
  for (const e of [...edges].sort((p, q) => weight(p) - weight(q))) {
    const ra = find(e[0]);
    const rb = find(e[1]);
    if (ra === rb) continue;
    parent[ra] = rb;
    out.push(e);
  }
  return out;
}

/** True when segment AB and segment CD cross at a point strictly inside both. Shared endpoints do not count. */
export function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

/** Distance from point p to segment AB. */
export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2));
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
}
