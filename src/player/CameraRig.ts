import * as THREE from 'three/webgpu';
import type { Physics } from '../core/Physics';

/** The camera never gets closer than this to the focus point. */
const MIN_DISTANCE = 1.5;

/** Third-person orbit camera that smoothly follows a target and avoids walls. */
export class CameraRig {
  yaw = 0; // 0 = camera south of the player, looking north (-Z)
  pitch = 0.55;
  distance = 11;
  private focus = new THREE.Vector3();
  /** Smoothed actual arm length, shorter than `distance` when something is in the way. */
  private arm = 11;

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    private physics: Physics,
  ) {}

  /** Unit vectors on the ground plane for camera-relative movement. */
  basis() {
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    return { forward, right };
  }

  /** Moves the focus and camera by the same offset, so an island shift does not pop the view. */
  shift(dx: number, dz: number) {
    this.focus.x += dx;
    this.focus.z += dz;
    this.camera.position.x += dx;
    this.camera.position.z += dz;
  }

  snapTo(target: THREE.Vector3) {
    this.focus.copy(target);
    this.arm = this.distance;
    this.update(target, { x: 0, y: 0, zoom: 0 }, 1);
  }

  update(target: THREE.Vector3, look: { x: number; y: number; zoom: number }, dt: number) {
    this.yaw -= look.x;
    this.pitch = THREE.MathUtils.clamp(this.pitch + look.y, 0.15, 1.2);
    this.distance = THREE.MathUtils.clamp(this.distance + look.zoom, 5, 22);

    // Frame-rate independent smoothing toward the target (aim a bit above feet).
    const k = 1 - Math.exp(-dt * 8);
    this.focus.lerp(new THREE.Vector3(target.x, target.y + 1.2, target.z), k);

    // Unit direction from the focus toward the camera.
    const cp = Math.cos(this.pitch);
    const dir = { x: Math.sin(this.yaw) * cp, y: Math.sin(this.pitch), z: Math.cos(this.yaw) * cp };

    // Cast from the focus toward the desired camera spot and stop short of any hit.
    // Only the terrain and registered camera blockers stop the camera; other props and the player are ignored.
    let want = this.distance;
    const origin = { x: this.focus.x, y: this.focus.y, z: this.focus.z };
    const terrainHandle = this.physics.terrainCollider?.handle;
    const blockers = this.physics.cameraBlockers;
    const hit = this.physics.world.castRay(
      new this.physics.RAPIER.Ray(origin, dir),
      this.distance,
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      (c) => c.handle === terrainHandle || blockers.has(c.handle),
    );
    if (hit) want = THREE.MathUtils.clamp(hit.timeOfImpact - 0.3, MIN_DISTANCE, this.distance);

    // Move in quickly when blocked, drift back out slowly so it doesn't jitter.
    const rate = want < this.arm ? 20 : 3;
    this.arm += (want - this.arm) * (1 - Math.exp(-dt * rate));

    this.camera.position.set(
      this.focus.x + dir.x * this.arm,
      this.focus.y + dir.y * this.arm,
      this.focus.z + dir.z * this.arm,
    );
    this.camera.lookAt(this.focus);
  }
}
