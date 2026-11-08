import type { CameraRig } from '../player/CameraRig';
import type { Player } from '../player/Player';
import { START_CELL, COLS, ROWS, type Archipelago, type Cell, type IslandState, type IslandStates } from '../world/Archipelago';

const KEY = 'nongkrong.save';
const SAVE_EVERY_MS = 5000;

interface SaveData {
  v: 1;
  x: number;
  z: number;
  heading: number;
  yaw: number;
  pitch: number;
  distance: number;
  /** Game clock in hours (0-24). Optional, so older saves still load. */
  clock?: number;
  /** Live island cell. Older saves have none and start on the start island. */
  cell?: Cell;
  /** Saved state of every island the player has changed. */
  islands?: Record<string, IslandState>;
}

/** The part of DayNight that Save needs. */
export interface SavedClock {
  time: number;
  setTime(hour: number): void;
}

/** What Save needs from the game: the grid, island state, and the switch and reset actions. */
export interface SaveLinks {
  clock?: SavedClock;
  archipelago: Archipelago;
  islands: IslandStates;
  /** Stores the live island's progress into `islands`, before a save. */
  captureLive(): void;
  /** Moves to a cell and local spot (places the player and loads that island's state). */
  enter(cell: Cell, x: number, z: number, heading: number): void;
  /** Starts over on the start island with fresh state. */
  newGame(): void;
}

/** Saves the player's spot, the island and the camera orbit to localStorage, and restores them on boot. */
export class Save {
  constructor(
    private player: Player,
    private rig: CameraRig,
    private links: SaveLinks,
  ) {}

  /** Puts the player, island and camera back where they were saved. Returns false when there was no save. */
  restore(): boolean {
    const d = read();
    if (!d) return false;
    const { clock, islands } = this.links;
    if (clock && Number.isFinite(d.clock)) clock.setTime(d.clock!);
    islands.load(d.islands);
    const cell = validCell(d.cell) ?? START_CELL;
    const x = Number.isFinite(d.x) ? d.x : 0;
    const z = Number.isFinite(d.z) ? d.z : 0;
    const heading = Number.isFinite(d.heading) ? d.heading : 0;
    this.links.enter({ col: cell.col, row: cell.row }, x, z, heading);
    this.rig.yaw = finite(d.yaw, this.rig.yaw);
    this.rig.pitch = clamp(finite(d.pitch, this.rig.pitch), 0.15, 1.2);
    this.rig.distance = clamp(finite(d.distance, this.rig.distance), 5, 22);
    return true;
  }

  /** Starts the 5 s autosave, plus saves on pagehide and when the tab is hidden. */
  start() {
    window.setInterval(this.write, SAVE_EVERY_MS);
    window.addEventListener('pagehide', this.write);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.write();
    });
  }

  /** Clears the save, all island progress, and moves the player and camera back to the start island's spawn. */
  reset() {
    localStorage.removeItem(KEY);
    this.links.clock?.setTime(9);
    this.links.newGame();
    this.rig.yaw = 0;
    this.rig.pitch = 0.55;
    this.rig.distance = 11;
  }

  write = () => {
    this.links.captureLive();
    const p = this.player.position;
    const data: SaveData = {
      v: 1,
      x: p.x,
      z: p.z,
      heading: this.player.headingAngle,
      yaw: this.rig.yaw,
      pitch: this.rig.pitch,
      distance: this.rig.distance,
      clock: this.links.clock?.time,
      cell: { ...this.links.archipelago.cell },
      islands: this.links.islands.toJSON(),
    };
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      // Storage full or blocked: skip this save.
    }
  };
}

function read(): SaveData | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return raw && raw.v === 1 ? (raw as SaveData) : null;
  } catch {
    return null;
  }
}

function validCell(c: Cell | undefined): Cell | null {
  if (!c || !Number.isInteger(c.col) || !Number.isInteger(c.row)) return null;
  return c.col >= 0 && c.col < COLS && c.row >= 0 && c.row < ROWS ? c : null;
}

function finite(v: number, fallback: number) {
  return Number.isFinite(v) ? v : fallback;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}
