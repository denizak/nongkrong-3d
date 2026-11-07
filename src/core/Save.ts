import type { CameraRig } from '../player/CameraRig';
import { WORLD_LIMIT, type Player } from '../player/Player';
import type { Terrain } from '../world/Terrain';

const KEY = 'nongkrong.save';
const SAVE_EVERY_MS = 5000;
/** Below this height the spot counts as water, so a restore falls back to the spawn. */
const MIN_LAND = -0.3;

interface SaveData {
  v: 1;
  x: number;
  z: number;
  heading: number;
  yaw: number;
  pitch: number;
  distance: number;
}

/** Saves the player's spot and the camera orbit to localStorage, and restores them on boot. */
export class Save {
  constructor(
    private player: Player,
    private rig: CameraRig,
    private terrain: Terrain,
  ) {}

  /** Puts the player and camera back where they were saved. Returns false (keeps the spawn) if the save is missing or invalid. */
  restore(): boolean {
    const d = read();
    if (!d) return false;
    if (!Number.isFinite(d.x) || !Number.isFinite(d.z) || !Number.isFinite(d.heading)) return false;
    if (Math.hypot(d.x, d.z) >= WORLD_LIMIT) return false;
    if (this.terrain.heightAt(d.x, d.z) <= MIN_LAND) return false;

    this.player.place(d.x, d.z, d.heading);
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

  /** Clears the save and moves the player and camera back to the spawn. */
  reset() {
    localStorage.removeItem(KEY);
    this.player.place(0, 0, 0);
    this.rig.yaw = 0;
    this.rig.pitch = 0.55;
    this.rig.distance = 11;
  }

  write = () => {
    const p = this.player.position;
    const data: SaveData = {
      v: 1,
      x: p.x,
      z: p.z,
      heading: this.player.headingAngle,
      yaw: this.rig.yaw,
      pitch: this.rig.pitch,
      distance: this.rig.distance,
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

function finite(v: number, fallback: number) {
  return Number.isFinite(v) ? v : fallback;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}
