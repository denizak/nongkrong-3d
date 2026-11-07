import * as THREE from 'three/webgpu';
import type { Birds } from './Birds';
import type { Interactable } from './Interactable';
import { sfx } from '../audio/AudioManager';

const TAU = Math.PI * 2;
const SPIN_TIME = 1.2;
const BUBBLE_TIME = 3;
const LINES = [
  "Hey! I'm on duty!",
  "The birds don't respect me…",
  "Nice hat. Mine's better.",
  "Shoo! Oh wait, you're not a bird.",
  "I've been standing here since spring.",
  'Do you think the crows like me?',
  'Rice is nice!',
  'Tickles!',
  'Careful, I\'m stuffed with straw, not patience.',
  'Psst… harvest the golden ones.',
];
const _v = new THREE.Vector3();

/** Procedural low-poly scarecrow standing on its post base at the origin, about 2.5 m tall. */
export function buildScarecrow(): THREE.Group {
  const mat = (color: string) => new THREE.MeshStandardMaterial({ color, flatShading: true });
  const wood = mat('#9b7650');
  const straw = mat('#e0c06a');
  const red = mat('#c4433a');
  const blue = mat('#3b5b9a');
  const burlap = mat('#d8c08a');
  const ink = mat('#2f2620');
  const pants = mat('#4d4a3e');

  const g = new THREE.Group();
  const put = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rz = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.rotation.z = rz;
    mesh.castShadow = mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };

  // Post and crossbar.
  put(new THREE.CylinderGeometry(0.07, 0.08, 2, 6), wood, 0, 1, 0);
  put(new THREE.BoxGeometry(1.8, 0.09, 0.09), wood, 0, 1.56, 0);
  // Trousers.
  put(new THREE.BoxGeometry(0.46, 0.5, 0.3), pants, 0, 1.05, 0);
  // Checked shirt: a 3x3 grid of red and blue squares.
  for (let c = 0; c < 3; c++) {
    for (let r = 0; r < 3; r++) {
      put(new THREE.BoxGeometry(0.19, 0.17, 0.2), (c + r) % 2 ? blue : red, -0.19 + c * 0.19, 1.37 + r * 0.17, 0);
    }
  }
  // Sleeves with straw tufts poking out of the cuffs.
  for (const s of [-1, 1]) {
    put(new THREE.BoxGeometry(0.4, 0.18, 0.18), s < 0 ? red : blue, s * 0.5, 1.56, 0);
    for (const dy of [-0.03, 0.04]) {
      put(new THREE.ConeGeometry(0.05, 0.16, 5), straw, s * 0.76, 1.56 + dy, 0, (-s * Math.PI) / 2);
    }
  }
  // Burlap sack head with a stitched face.
  const head = put(new THREE.IcosahedronGeometry(0.25, 1), burlap, 0, 1.9, 0);
  head.scale.set(0.95, 1.1, 0.95);
  put(new THREE.BoxGeometry(0.07, 0.05, 0.03), ink, -0.09, 1.95, 0.25);
  put(new THREE.BoxGeometry(0.07, 0.05, 0.03), ink, 0.09, 1.95, 0.25);
  put(new THREE.BoxGeometry(0.06, 0.03, 0.03), ink, -0.08, 1.8, 0.24, -0.5);
  put(new THREE.BoxGeometry(0.06, 0.03, 0.03), ink, 0, 1.77, 0.25);
  put(new THREE.BoxGeometry(0.06, 0.03, 0.03), ink, 0.08, 1.8, 0.24, 0.5);
  // Wide conical straw hat.
  put(new THREE.CylinderGeometry(0.6, 0.6, 0.04, 14), straw, 0, 2.1, 0);
  put(new THREE.ConeGeometry(0.3, 0.38, 10), straw, 0, 2.3, 0);
  return g;
}

export interface ScarecrowDeps {
  group: THREE.Group;
  camera: THREE.Camera;
  birds: Birds;
}

/** Poke it to spin, get a silly line in a speech bubble, and scare the birds off the paddy. */
export class Scarecrow implements Interactable {
  readonly position: THREE.Vector3;
  readonly radius = 2.2;
  private spinT = -1;
  private yaw0 = 0;
  private bubbleT = -1;
  private lastLine = -1;
  private bubble = document.createElement('div');

  constructor(private deps: ScarecrowDeps) {
    this.position = deps.group.position;
    this.bubble.className = 'speech';
    document.body.append(this.bubble);
  }

  prompt(): string | null {
    return 'Poke scarecrow';
  }

  interact() {
    this.poke();
  }

  /** Spins, talks and scares birds. Callable directly from the console. */
  poke() {
    this.yaw0 = this.deps.group.rotation.y;
    this.spinT = 0;
    this.bubbleT = 0;
    let i = 0;
    do {
      i = Math.floor(Math.random() * LINES.length);
    } while (i === this.lastLine);
    this.lastLine = i;
    this.bubble.textContent = LINES[i];
    this.bubble.classList.add('show');
    sfx.play('knock', { at: this.position, rateJitter: 0.08 });
    this.deps.birds.scareAll();
  }

  update(dt: number) {
    const g = this.deps.group;
    if (this.spinT >= 0) {
      this.spinT += dt;
      const u = Math.min(1, this.spinT / SPIN_TIME);
      const ease = 1 - (1 - u) ** 3;
      g.rotation.y = this.yaw0 + ease * TAU;
      g.rotation.z = Math.sin(this.spinT * 18) * 0.08 * (1 - u);
      if (u >= 1) {
        this.spinT = -1;
        g.rotation.set(0, this.yaw0, 0);
      }
    }
    if (this.bubbleT >= 0) {
      this.bubbleT += dt;
      if (this.bubbleT >= BUBBLE_TIME) {
        this.bubbleT = -1;
        this.bubble.classList.remove('show');
      } else {
        _v.set(this.position.x, this.position.y + 2.8, this.position.z).project(this.deps.camera);
        this.bubble.style.left = `${(_v.x * 0.5 + 0.5) * window.innerWidth}px`;
        this.bubble.style.top = `${(-_v.y * 0.5 + 0.5) * window.innerHeight}px`;
      }
    }
  }
}
