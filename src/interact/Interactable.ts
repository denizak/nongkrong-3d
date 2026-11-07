import type * as THREE from 'three/webgpu';
import type { Pickups } from './Pickups';

/** Services an interaction may use. */
export interface InteractContext {
  pickups: Pickups;
}

/** Anything the player can walk up to and press E on. */
export interface Interactable {
  readonly position: THREE.Vector3;
  /** Interaction range in metres. */
  readonly radius: number;
  /** Prompt text without the key, or null when not available right now. */
  prompt(): string | null;
  interact(ctx: InteractContext): void;
  /** Optional per-frame update for animations and timers. */
  update?(dt: number): void;
  /** When true, this is the only interactable that can show or run (e.g. while fishing). */
  isLocked?(): boolean;
}
