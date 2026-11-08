import { t } from '../i18n';
import * as THREE from 'three/webgpu';
import { ZONES, WATER_LEVEL, type Ground, type Zones } from '../world/Terrain';
import type { Player } from '../player/Player';
import type { Inventory } from '../ui/Inventory';
import type { Fishpedia } from '../ui/Fishpedia';
import type { WaterKind } from './FishSpecies';
import { Fishing, type FishState } from './Fishing';
import type { Interactable } from './Interactable';

/** Distance in front of the player where the line lands. */
const RANGE = 3;
const RADIUS = 3.6;
/** Water at least this deep (m) can be fished. */
const MIN_DEPTH = 0.4;

export interface FishingSpotDeps {
  scene: THREE.Scene;
  camera: THREE.Camera;
  terrain: Ground;
  player: Player;
  inventory: Inventory;
  pedia: Fishpedia;
  hand: THREE.Object3D | null;
  /** True when (x, z) is on a bridge, which counts as dry ground for casting. */
  onBridge?: (x: number, z: number) => boolean;
}

/** "The water in front of the player": offers Fish when the spot is deep enough, and runs the fishing session. */
export class FishingSpot implements Interactable {
  readonly position = new THREE.Vector3();
  readonly radius = RADIUS;
  private fishing: Fishing;
  private target = new THREE.Vector3();
  private water: WaterKind = 'sea';
  private available = false;
  /** The live island's zones: its ponds decide pond or sea. */
  private zones: Zones = ZONES;

  constructor(private deps: FishingSpotDeps) {
    this.fishing = new Fishing(deps);
  }

  /** Current fishing state, for tests and debugging. */
  get state(): FishState {
    return this.fishing.state;
  }

  /** True while fishing: the player is held in place and other interactables are paused. */
  get locked() {
    return this.fishing.active;
  }

  /** The live island changed: its pond is the one that counts. */
  setZones(zones: Zones) {
    this.zones = zones;
  }

  /** Cancels any cast without the reel animation. Used when the island changes. */
  abort() {
    this.fishing.abort();
  }

  prompt(): string | null {
    if (this.fishing.active) return this.fishing.prompt();
    return this.available && this.deps.player.pose === 'stand' ? t('fish.fish') : null;
  }

  isLocked() {
    return this.fishing.active;
  }

  interact() {
    if (this.fishing.active) this.fishing.press();
    else if (this.available) this.fishing.cast(this.target, this.water);
  }

  /** Called once per frame from main, after the player has moved. */
  tick(dt: number, move: { x: number; y: number }) {
    if (this.fishing.active) {
      // Moving or changing pose reels the line in.
      const moving = Math.hypot(move.x, move.y) > 0.01;
      if (moving || this.deps.player.pose !== 'stand') this.fishing.cancel();
    } else {
      this.updateTarget();
    }
    this.fishing.tick(dt);
  }

  /** Dev only: jumps straight to the bite state. */
  debugForceBite() {
    if (!this.fishing.active) this.fishing.cast(this.target, this.water);
    this.fishing.debugForceBite();
  }

  private updateTarget() {
    const { player, terrain } = this.deps;
    const p = player.position;
    const f = player.getFacing();
    const x = p.x + f.x * RANGE;
    const z = p.z + f.z * RANGE;
    this.target.set(x, WATER_LEVEL, z);
    this.position.copy(this.target);
    const deep = terrain.heightAt(x, z) < WATER_LEVEL - MIN_DEPTH;
    const onShore = terrain.heightAt(p.x, p.z) > WATER_LEVEL - MIN_DEPTH || (this.deps.onBridge?.(p.x, p.z) ?? false);
    this.available = deep && onShore;
    const inPond = this.zones.ponds.some((pond) => Math.hypot(x - pond.x, z - pond.z) <= pond.r + 2);
    this.water = inPond ? 'pond' : 'sea';
  }
}
