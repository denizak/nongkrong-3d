import './map.css';
import type { Archipelago } from '../world/Archipelago';
import type { Bridges } from '../world/Bridges';
import type { IslandShapes } from '../world/IslandShapes';
import type { Net } from '../net/Net';
import { drawArrow, drawBridges, drawDot, drawShapes, localWorld, remoteMarks, SEA, CREAM, type PlayerLike } from './mapCommon';

/** Metres across the minimap (diameter). */
const RANGE = 420;
const SIZE = 150;
const SIZE_TOUCH = 110;
const PERIOD = 0.1;

export interface MapWorld {
  arch: Archipelago;
  net: Net;
  bridges: Bridges;
  player: PlayerLike;
}

/**
 * Round north-up minimap at the top right, centred on the player. Drawn on a 2D canvas at 10 Hz.
 */
export class Minimap {
  private el = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private size: number;
  private acc = 0;
  private dpr = Math.min(window.devicePixelRatio || 1, 2);

  constructor(
    private world: MapWorld,
    private shapes: IslandShapes,
  ) {
    const touch = document.documentElement.classList.contains('touch');
    this.size = touch ? SIZE_TOUCH : SIZE;
    this.el.id = 'minimap';
    this.el.style.width = `${this.size}px`;
    this.el.style.height = `${this.size}px`;
    this.el.width = Math.round(this.size * this.dpr);
    this.el.height = Math.round(this.size * this.dpr);
    this.el.setAttribute('aria-hidden', 'true');
    document.body.append(this.el);
    this.ctx = this.el.getContext('2d')!;
    this.draw();
  }

  /** Call once per frame. Redraws every PERIOD seconds. */
  update(dt: number) {
    this.acc += dt;
    if (this.acc < PERIOD) return;
    this.acc = Math.min(this.acc - PERIOD, PERIOD);
    this.draw();
  }

  private draw() {
    const ctx = this.ctx;
    const s = this.size;
    const r = s / 2;
    const k = s / RANGE;
    const me = localWorld(this.world.arch, this.world.player);
    const toPx = (x: number, z: number) => ({ x: r + (x - me.x) * k, y: r + (z - me.z) * k });

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, s, s);
    ctx.save();
    ctx.beginPath();
    ctx.arc(r, r, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = SEA;
    ctx.fillRect(0, 0, s, s);
    drawShapes(ctx, this.shapes, toPx, k, () => 1);
    drawBridges(ctx, this.world.bridges.layouts, toPx, 1.5);
    for (const m of remoteMarks(this.world.net, performance.now())) {
      const p = toPx(m.x, m.z);
      if (Math.hypot(p.x - r, p.y - r) > r) continue;
      drawDot(ctx, p.x, p.y, 4, m.color);
    }
    drawArrow(ctx, r, r, this.world.player.headingAngle, 7);
    ctx.restore();

    ctx.beginPath();
    ctx.arc(r, r, r - 1.5, 0, Math.PI * 2);
    ctx.strokeStyle = CREAM;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
}
