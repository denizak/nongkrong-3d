import * as THREE from 'three/webgpu';
import type { Terrain } from '../world/Terrain';
import type { Inventory } from '../ui/Inventory';

const RADIUS = 0.14;
const GRAVITY = 9.8;
const PICK_RANGE = 1.0;
const COLLECT_TIME = 0.25;

interface Fruit {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  bounces: number;
  state: 'fall' | 'rest' | 'collect';
  phase: number;
  t: number;
  from: THREE.Vector3;
}

/** Fallen mangoes: simple gravity and bounces, then idle bob until the player walks over. */
export class Pickups {
  private fruits: Fruit[] = [];
  private geo = new THREE.SphereGeometry(RADIUS, 8, 6);
  private mat = new THREE.MeshStandardMaterial({ color: '#ff9d2e', roughness: 0.5, flatShading: true });

  constructor(
    private scene: THREE.Scene,
    private terrain: Terrain,
    private inventory: Inventory,
  ) {}

  /** Spawns a mango at a world position with a small random tumble. */
  spawn(pos: THREE.Vector3) {
    const mesh = new THREE.Mesh(this.geo, this.mat);
    mesh.castShadow = true;
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.fruits.push({
      mesh,
      vx: (Math.random() - 0.5) * 1.2,
      vy: 0.5,
      vz: (Math.random() - 0.5) * 1.2,
      bounces: 0,
      state: 'fall',
      phase: Math.random() * Math.PI * 2,
      t: 0,
      from: new THREE.Vector3(),
    });
  }

  update(dt: number, playerPos: THREE.Vector3, time: number) {
    const target = new THREE.Vector3(playerPos.x, playerPos.y + 0.9, playerPos.z);
    for (let i = this.fruits.length - 1; i >= 0; i--) {
      const f = this.fruits[i];
      const p = f.mesh.position;

      if (f.state === 'fall') {
        f.vy -= GRAVITY * dt;
        p.x += f.vx * dt;
        p.z += f.vz * dt;
        p.y += f.vy * dt;
        const ground = this.terrain.heightAt(p.x, p.z) + RADIUS;
        if (p.y <= ground) {
          p.y = ground;
          if (f.bounces < 2 && f.vy < -1) {
            // Bounce once or twice, losing energy each time.
            f.vy = -f.vy * 0.4;
            f.vx *= 0.5;
            f.vz *= 0.5;
            f.bounces++;
          } else {
            f.vy = 0;
            f.state = 'rest';
          }
        }
      } else if (f.state === 'rest') {
        const ground = this.terrain.heightAt(p.x, p.z) + RADIUS;
        p.y = ground + (Math.sin(time * 2.4 + f.phase) + 1) * 0.03;
        f.mesh.rotation.y += dt * 1.2;
        if (Math.hypot(playerPos.x - p.x, playerPos.z - p.z) < PICK_RANGE) {
          f.state = 'collect';
          f.t = 0;
          f.from.copy(p);
        }
      } else {
        // Fly into the player and shrink away.
        f.t += dt;
        const k = Math.min(1, f.t / COLLECT_TIME);
        const e = k * k;
        p.lerpVectors(f.from, target, e);
        f.mesh.scale.setScalar(1 - 0.75 * e);
        if (k >= 1) {
          this.scene.remove(f.mesh);
          this.fruits.splice(i, 1);
          this.inventory.add('mango');
        }
      }
    }
  }
}
