import type { CameraRig } from '../player/CameraRig';
import type { Player } from '../player/Player';
import { type Archipelago, type IslandState, type IslandStates } from '../world/Archipelago';
import { ISLAND_COUNT, MAIN_ID, islandIdForLegacyCell } from '../world/Islands';

const KEY = 'nongkrong.save';
const SAVE_EVERY_MS = 5000;
/** The old save format: a cell on the old 5x10 grid. Still read, then replaced on the next write. */
const LEGACY_VERSION = 1;
const VERSION = 2;
const LEGACY_COLS = 5;
const LEGACY_ROWS = 10;

interface SaveData {
  v: number;
  x: number;
  z: number;
  heading: number;
  yaw: number;
  pitch: number;
  distance: number;
  /** Game clock in hours (0-24). Optional, so older saves still load. */
  clock?: number;
  /** Live island id (version 2). */
  island?: number;
  /** Live island cell (version 1 only). */
  cell?: { col: number; row: number };
  /** Saved state of every island the player has changed. */
  islands?: Record<string, IslandState>;
}

/** The part of DayNight that Save needs. */
export interface SavedClock {
  time: number;
  setTime(hour: number): void;
}

/** What Save needs from the game: the archipelago, island state, and the switch and reset actions. */
export interface SaveLinks {
  clock?: SavedClock;
  archipelago: Archipelago;
  islands: IslandStates;
  /** Stores the live island's progress into `islands`, before a save. */
  captureLive(): void;
  /** Moves to an island and a local spot (places the player and loads that island's state). */
  enter(id: number, x: number, z: number, heading: number): void;
  /** Starts over on the main island with fresh state. */
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
    const legacy = d.v === LEGACY_VERSION;
    islands.load(d.islands, legacy);
    const x = Number.isFinite(d.x) ? d.x : 0;
    const z = Number.isFinite(d.z) ? d.z : 0;
    const heading = Number.isFinite(d.heading) ? d.heading : 0;
    this.links.enter(legacy ? legacyIsland(d.cell) : validIsland(d.island), x, z, heading);
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

  /** Clears the save, all island progress, and moves the player and camera back to the main island's spawn. */
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
      v: VERSION,
      x: p.x,
      z: p.z,
      heading: this.player.headingAngle,
      yaw: this.rig.yaw,
      pitch: this.rig.pitch,
      distance: this.rig.distance,
      clock: this.links.clock?.time,
      island: this.links.archipelago.id,
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
    return raw && (raw.v === LEGACY_VERSION || raw.v === VERSION) ? (raw as SaveData) : null;
  } catch {
    return null;
  }
}

function validIsland(id: number | undefined): number {
  return Number.isInteger(id) && id! >= 0 && id! < ISLAND_COUNT ? id! : MAIN_ID;
}

/** A version 1 save: its cell is a normal island if that cell is one now, otherwise the main island. */
function legacyIsland(c: { col: number; row: number } | undefined): number {
  if (!c || !Number.isInteger(c.col) || !Number.isInteger(c.row)) return MAIN_ID;
  if (c.col < 0 || c.col >= LEGACY_COLS || c.row < 0 || c.row >= LEGACY_ROWS) return MAIN_ID;
  return islandIdForLegacyCell(c.col, c.row);
}

function finite(v: number, fallback: number) {
  return Number.isFinite(v) ? v : fallback;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}
