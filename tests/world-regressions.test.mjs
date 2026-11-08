import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
after(() => vite.close());
const { Player } = await vite.ssrLoadModule('/src/player/Player.ts');
const { Environment } = await vite.ssrLoadModule('/src/world/Environment.ts');
const { Proxies } = await vite.ssrLoadModule('/src/world/Proxies.ts');
const { ISLANDS, inProxyWindow } = await vite.ssrLoadModule('/src/world/Islands.ts');
const THREE = await import('three/webgpu');

test('water rule allows escape from deep and flat pond bottoms, but blocks entry', () => {
  const player = Object.create(Player.prototype);
  player.terrain = { heightAt: (x) => x < 0 ? -1 : x };
  player.onBridge = () => false;
  assert.equal(player.canMoveTo(0, 0, -1, 0), false);
  assert.equal(player.canMoveTo(-2, 0, -1, 0), true);
  assert.equal(player.canMoveTo(-1, 0, 0, 0), true);
  player.terrain = { heightAt: (x) => x };
  assert.equal(player.canMoveTo(-1, 0, -2, 0), false);
});

test('water depth rebuild is incremental and cancels a previous window', () => {
  let calls = 0;
  const env = new Environment(new THREE.Scene(), () => { calls++; return -1; });
  env.setWindow(0, 0);
  assert.equal(calls, 0);
  env.update(new THREE.Vector3(), 0);
  assert.equal(calls, 512 * 4);
  const old = env.depthJob;
  env.setWindow(100, 200);
  assert.notEqual(env.depthJob, old);
  for (let i = 0; i < 128; i++) env.update(new THREE.Vector3(), 0);
  assert.equal(env.depthJob, null);
  assert.equal(env.depth.image.data[0], Math.round(255 / 6));
});

test('entering an island hides its previously visible proxy', () => {
  const proxy = Object.create(Proxies.prototype);
  const target = ISLANDS.find((def) => def.id !== 1 && inProxyWindow(1, def.id));
  assert.ok(target);
  const objects = new Map(ISLANDS.map((def) => [def.id, { object: new THREE.Group() }]));
  proxy.items = objects;
  for (const value of objects.values()) value.object.visible = false;
  objects.get(target.id).object.visible = true;
  proxy.update(target.id);
  assert.equal(objects.get(target.id).object.visible, false);
});
