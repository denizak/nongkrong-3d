import { ISLANDS, centreOf, type IslandKind } from '../world/Islands';
import type { IslandShapes } from '../world/IslandShapes';
import type { Layout } from '../world/Bridges';
import { STALE_MS, type Net } from '../net/Net';

/** Shared by the minimap and the full map. */
export const SEA = '#86d3c9';
export const BRIDGE = '#8a5a34';
export const INK = '#2f3b2a';
export const CREAM = '#fffbea';

/** The local player's place in the world: the island centre plus the local position. */
export interface PlayerLike {
  readonly position: { readonly x: number; readonly z: number };
  readonly headingAngle: number;
}

/** Something to draw on a map at a world point. */
export interface Mark {
  x: number;
  z: number;
  name: string;
  island: number;
  color: string;
}

/** Remote peers with a recent state, as world positions. */
export function remoteMarks(net: Net, now: number): Mark[] {
  const out: Mark[] = [];
  for (const p of net.remotes.values()) {
    const s = p.snaps[p.snaps.length - 1];
    if (!s || now - p.lastState > STALE_MS) continue;
    const c = centreOf(s.island);
    out.push({ x: c.x + s.x, z: c.z + s.z, name: p.name, island: s.island, color: p.look.body });
  }
  return out;
}

/** Draws every island's shape at its world position. `toPx` maps world x/z to canvas pixels, `scale` is px per metre. */
export function drawShapes(
  ctx: CanvasRenderingContext2D,
  shapes: IslandShapes,
  toPx: (x: number, z: number) => { x: number; y: number },
  scale: number,
  alpha: (id: number) => number,
) {
  for (const def of ISLANDS) {
    const img = shapes.get(def.kind as IslandKind);
    if (!img) continue;
    const p = toPx(def.centerWorld.x, def.centerWorld.z);
    const w = 2 * def.half * scale;
    ctx.globalAlpha = alpha(def.id);
    ctx.drawImage(img, p.x - w / 2, p.y - w / 2, w, w);
  }
  ctx.globalAlpha = 1;
}

/** Bridge decks as lines between their landings. */
export function drawBridges(
  ctx: CanvasRenderingContext2D,
  layouts: readonly Layout[],
  toPx: (x: number, z: number) => { x: number; y: number },
  width: number,
) {
  ctx.strokeStyle = BRIDGE;
  ctx.lineWidth = width;
  ctx.beginPath();
  for (const l of layouts) {
    const a = toPx(l.from.x, l.from.z);
    const b = toPx(l.to.x, l.to.z);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();
}

/** A filled dot with a white outline. */
export function drawDot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
}

/**
 * The player arrow, pointing along the heading. Heading 0 faces +z (down the screen, since −z is up), so the
 * screen angle is atan2(cos h, sin h).
 */
export function drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number, heading: number, size: number) {
  const angle = Math.atan2(Math.cos(heading), Math.sin(heading));
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(size, 0);
  ctx.lineTo(-size * 0.7, -size * 0.62);
  ctx.lineTo(-size * 0.35, 0);
  ctx.lineTo(-size * 0.7, size * 0.62);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.restore();
}

/** Text with a cream halo so it reads on sea and land. Sizes are in CSS pixels (the context is scaled). */
export function drawLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, font: string, align: CanvasTextAlign = 'center') {
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = CREAM;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = INK;
  ctx.fillText(text, x, y);
}

/** The local player's world position (island centre plus local position). */
export function localWorld(arch: { id: number }, player: PlayerLike): { x: number; z: number } {
  const c = centreOf(arch.id);
  return { x: c.x + player.position.x, z: c.z + player.position.z };
}
