import './map.css';
import { t } from '../i18n';
import { COLS, ISLANDS, ROWS, SPACING, MAIN_ID, displayName, type IslandKind } from '../world/Islands';
import type { IslandShapes } from '../world/IslandShapes';
import type { Input } from '../core/Input';
import { SEA, drawArrow, drawBridges, drawDot, drawLabel, drawShapes, localWorld, remoteMarks } from './mapCommon';
import type { MapWorld } from './Minimap';

/** The whole grid in metres: cell centres sit on multiples of SPACING, so the grid runs half a cell past each edge. */
const GRID = { x0: -SPACING / 2, z0: -SPACING / 2, w: COLS * SPACING, h: ROWS * SPACING };
/** Panel chrome around the canvas, in CSS px: side padding and border, header and legend. */
const CHROME_W = 28 + 12;
const CHROME_H = 110;
/** Name labels sit this far (m) below each island's centre: about the land's reach, or the main island's. */
const LABEL_M: Record<IslandKind, number> = { normal: 72, main: 200 };
const HIT_PX = 14;

interface Hit {
  x: number;
  y: number;
  text: string;
}

/**
 * The full archipelago map (P, or the map button in touch mode). A centred panel that keeps the grid's aspect ratio.
 * The islands, bridges and names are drawn once when the map opens (and again if the visited set changes). Each
 * frame only the players' dots and the arrow are drawn on top. Hovering or tapping a dot shows a tooltip.
 */
export class FullMap {
  private overlay = document.createElement('div');
  private stage = document.createElement('div');
  private canvas = document.createElement('canvas');
  private tip = document.createElement('div');
  private ctx = this.canvas.getContext('2d')!;
  private stat = document.createElement('canvas');
  private dpr = Math.min(window.devicePixelRatio || 1, 2);
  private k = 1;
  private cssW = 0;
  private cssH = 0;
  private staticKey = -1;
  private hits: Hit[] = [];
  /** Islands whose names were left off the map for crowding: hovering their centre shows the name. */
  private hiddenNames: Hit[] = [];
  private opened = false;

  constructor(
    private world: MapWorld,
    private shapes: IslandShapes,
    private input: Input,
  ) {
    this.overlay.id = 'map-overlay';
    this.overlay.setAttribute('role', 'dialog');
    this.overlay.setAttribute('aria-modal', 'true');

    const panel = document.createElement('div');
    panel.className = 'map-panel';
    const head = document.createElement('div');
    head.className = 'map-head';
    const title = document.createElement('span');
    title.className = 'map-title';
    title.textContent = t('map.title');
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'map-close';
    close.textContent = '✕';
    close.setAttribute('aria-label', t('map.close'));
    close.addEventListener('click', () => this.close());
    head.append(title, close);

    this.stage.className = 'map-stage';
    this.tip.className = 'map-tip';
    this.tip.hidden = true;
    this.stage.append(this.canvas, this.tip);

    const legend = document.createElement('div');
    legend.className = 'map-legend';
    legend.textContent = t('map.legend');

    panel.append(head, this.stage, legend);
    this.overlay.append(panel);
    document.body.append(this.overlay);

    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') this.hover(e);
    });
    this.canvas.addEventListener('pointerdown', (e) => this.hover(e));
    this.canvas.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') this.tip.hidden = true;
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        this.close();
        return;
      }
      if (e.code !== 'KeyP' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || this.input.typing) return;
      this.toggle();
    });
    window.addEventListener('resize', () => {
      if (this.isOpen) this.layout();
    });
  }

  get isOpen() {
    return this.opened;
  }

  open() {
    if (this.opened) return;
    this.opened = true;
    this.layout();
    this.rebuildStatic();
    this.overlay.classList.add('show');
  }

  close() {
    if (!this.opened) return;
    this.opened = false;
    this.tip.hidden = true;
    this.overlay.classList.remove('show');
  }

  toggle() {
    if (this.opened) this.close();
    else this.open();
  }

  /** Call once per frame. Does nothing while the map is closed. */
  update() {
    if (!this.opened) return;
    if (this.staticKey !== this.world.arch.visited.size) this.rebuildStatic();
    this.drawFrame();
  }

  /** Fits the canvas to the viewport at the grid's aspect ratio (80% of the viewport at most). */
  private layout() {
    const maxW = window.innerWidth * 0.8 - CHROME_W;
    const maxH = window.innerHeight * 0.8 - CHROME_H;
    this.k = Math.max(0.05, Math.min(maxW / GRID.w, maxH / GRID.h));
    this.cssW = Math.round(GRID.w * this.k);
    this.cssH = Math.round(GRID.h * this.k);
    this.canvas.style.width = `${this.cssW}px`;
    this.canvas.style.height = `${this.cssH}px`;
    this.stage.style.width = `${this.cssW}px`;
    this.stage.style.height = `${this.cssH}px`;
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
    this.stat.width = this.canvas.width;
    this.stat.height = this.canvas.height;
    this.staticKey = -1;
  }

  private toPx(x: number, z: number) {
    return { x: (x - GRID.x0) * this.k, y: (z - GRID.z0) * this.k };
  }

  /** Sea, island shapes, unvisited outlines, bridges and names. Cached on the offscreen canvas. */
  private rebuildStatic() {
    const g = this.stat.getContext('2d')!;
    const visited = this.world.arch.visited;
    this.staticKey = visited.size;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.cssW, this.cssH);
    g.fillStyle = SEA;
    g.fillRect(0, 0, this.cssW, this.cssH);

    const toPx = (x: number, z: number) => this.toPx(x, z);
    drawShapes(g, this.shapes, toPx, this.k, (id) => (visited.has(id) ? 1 : 0.35));

    // Unvisited islands get a dashed outline of their region.
    g.save();
    g.strokeStyle = 'rgba(47, 59, 42, 0.45)';
    g.lineWidth = 1;
    g.setLineDash([4, 3]);
    for (const def of ISLANDS) {
      if (visited.has(def.id)) continue;
      const p = toPx(def.centerWorld.x, def.centerWorld.z);
      const w = 2 * def.half * this.k;
      g.strokeRect(p.x - w / 2, p.y - w / 2, w, w);
    }
    g.restore();

    drawBridges(g, this.world.bridges.layouts, toPx, 2);
    this.drawNames(g, visited, toPx);
  }

  /**
   * Island names. The main island is drawn first, so it always keeps its label. A normal island's name drops
   * its "Pulau " prefix when it is wider than the gap between island centres, and a name that still overlaps an
   * earlier label is left off the map (its centre shows the name on hover instead).
   */
  private drawNames(g: CanvasRenderingContext2D, visited: ReadonlySet<number>, toPx: (x: number, z: number) => { x: number; y: number }) {
    const gap = SPACING * this.k;
    const placed: Array<{ x0: number; x1: number; y0: number; y1: number }> = [];
    this.hiddenNames = [];
    const order = [...ISLANDS].sort((a, b) => (a.id === MAIN_ID ? -1 : b.id === MAIN_ID ? 1 : a.id - b.id));
    for (const def of order) {
      const p = toPx(def.centerWorld.x, def.centerWorld.z);
      const main = def.id === MAIN_ID;
      const font = main ? '800 14px system-ui, sans-serif' : '600 10px system-ui, sans-serif';
      let name = displayName(def.id);
      g.font = font;
      if (!main && g.measureText(name).width > gap - 6 && name.startsWith('Pulau ')) name = name.slice(6);
      const w = g.measureText(name).width;
      // Keep the name inside the canvas: shift it in from an edge rather than let it be cut off.
      const half = w / 2 + 2;
      const x = Math.min(Math.max(p.x, half), this.cssW - half);
      const y = p.y + LABEL_M[def.kind] * this.k;
      const box = { x0: x - half, x1: x + half, y0: y, y1: y + (main ? 18 : 13) };
      const clash = placed.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0);
      if (!main && clash) {
        this.hiddenNames.push({ x: p.x, y: p.y, text: displayName(def.id) });
        continue;
      }
      placed.push(box);
      g.globalAlpha = visited.has(def.id) ? 1 : 0.7;
      drawLabel(g, name, x, y, font);
    }
    g.globalAlpha = 1;
  }

  /** Remote dots and the local arrow, on top of the cached layer. Also records where they are for hover. */
  private drawFrame() {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.stat, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this.hits = [...this.hiddenNames];
    const { arch, player } = this.world;
    for (const m of remoteMarks(this.world.net, performance.now())) {
      const p = this.toPx(m.x, m.z);
      drawDot(ctx, p.x, p.y, 6, m.color);
      drawLabel(ctx, m.name, p.x + 9, p.y - 7, '600 11px system-ui, sans-serif', 'left');
      this.hits.push({ x: p.x, y: p.y, text: `${m.name} · ${displayName(m.island)}` });
    }

    const me = localWorld(arch, player);
    const p = this.toPx(me.x, me.z);
    drawArrow(ctx, p.x, p.y, player.headingAngle, 11);
    drawLabel(ctx, t('map.you'), p.x, p.y + 13, '700 11px system-ui, sans-serif');
    this.hits.push({ x: p.x, y: p.y, text: `${t('map.you')} · ${displayName(arch.id)}` });
  }

  private hover(e: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    let best: Hit | null = null;
    let bestD = HIT_PX;
    for (const h of this.hits) {
      const d = Math.hypot(h.x - x, h.y - y);
      if (d <= bestD) {
        best = h;
        bestD = d;
      }
    }
    if (!best) {
      this.tip.hidden = true;
      return;
    }
    this.tip.textContent = best.text;
    this.tip.hidden = false;
    const flip = best.x > this.cssW - 180;
    const left = flip ? best.x - 12 : best.x + 12;
    this.tip.style.transform = `translate(${left}px, ${best.y - 10}px) translate(${flip ? '-100%' : '0'}, -100%)`;
  }
}
