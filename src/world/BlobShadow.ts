import * as THREE from 'three/webgpu';
import { quality } from '../core/Quality';

/**
 * A soft dark disc on the ground under a character. The low tier has no real shadows, so these stand in for them.
 * Discs are added to a parent that sits at the feet. Each one is shown only while quality.knobs.blobShadows is on.
 */

const discs = new Set<THREE.Mesh>();
let geo: THREE.CircleGeometry | null = null;
let mat: THREE.MeshBasicMaterial | null = null;

function shared() {
  if (geo && mat) return { geo, mat };
  geo = new THREE.CircleGeometry(0.5, 20).rotateX(-Math.PI / 2);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const map = new THREE.CanvasTexture(canvas);
  mat = new THREE.MeshBasicMaterial({
    map, color: '#000000', transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, fog: false,
  });
  return { geo, mat };
}

/** Adds a blob shadow under `parent` (a character whose origin is at its feet). */
export function addBlobShadow(parent: THREE.Object3D, radius = 0.45): THREE.Mesh {
  const s = shared();
  const disc = new THREE.Mesh(s.geo, s.mat);
  disc.name = 'blob-shadow';
  disc.position.y = 0.03;
  disc.scale.setScalar(radius * 2);
  disc.visible = quality.knobs.blobShadows;
  disc.raycast = () => {};
  parent.add(disc);
  discs.add(disc);
  return disc;
}

/** Shows or hides every blob shadow. Discs whose character was removed are forgotten here. */
export function applyBlobShadows() {
  const on = quality.knobs.blobShadows;
  for (const d of discs) {
    if (!d.parent) {
      discs.delete(d);
      continue;
    }
    d.visible = on;
  }
}
