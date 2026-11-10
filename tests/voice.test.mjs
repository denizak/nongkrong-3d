import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
after(() => vite.close());
const { voiceGain, voicePan, selectAudioPeers, parseVc, VOICE_RANGE } = await vite.ssrLoadModule('/src/net/voiceMath.ts');

test('falloff: 1 at 1 m, 0.25 at 11 m, 0 at 20 m and beyond', () => {
  assert.equal(voiceGain(1), 1);
  assert.equal(voiceGain(2), 1);
  assert.ok(Math.abs(voiceGain(11) - 0.25) < 1e-12);
  assert.equal(voiceGain(20), 0);
  assert.equal(voiceGain(35), 0);
  assert.equal(voiceGain(NaN), 0);
  assert.equal(VOICE_RANGE, 20);
});

test('falloff is monotonic from 2 m to 20 m', () => {
  let prev = 1;
  for (let d = 2; d <= 20; d += 0.25) {
    const g = voiceGain(d);
    assert.ok(g <= prev + 1e-12, `gain rose at ${d} m`);
    prev = g;
  }
});

test('pan: right of the camera is positive, left is negative, straight ahead is 0', () => {
  // Camera looks down -Z, so its right is +X. A speaker at +X (side > 0, front 0) pans right.
  assert.ok(voicePan(5, 0) > 0.99);
  assert.ok(voicePan(-5, 0) < -0.99);
  assert.equal(voicePan(0, 5), 0);
  assert.equal(voicePan(0, 0), 0);
});

test('send set: starts at 20 m or closer, nearest first, capped', () => {
  const picked = selectAudioPeers({ a: 5, b: 12, c: 19.9, d: 20.5 }, new Set(), 6);
  assert.deepEqual([...picked].sort(), ['a', 'b', 'c']);
  const capped = selectAudioPeers({ a: 1, b: 2, c: 3, d: 4, e: 5 }, new Set(), 4);
  assert.deepEqual([...capped].sort(), ['a', 'b', 'c', 'd']);
});

test('send set: hysteresis keeps a peer between 20 m and 24 m, drops it beyond 24 m', () => {
  const sending = new Set(['a']);
  assert.ok(selectAudioPeers({ a: 22 }, sending, 6).has('a'), 'kept at 22 m while sending');
  assert.ok(!selectAudioPeers({ a: 22 }, new Set(), 6).has('a'), 'not started at 22 m');
  assert.ok(!selectAudioPeers({ a: 25 }, sending, 6).has('a'), 'dropped at 25 m');
  assert.ok(selectAudioPeers({ a: 19 }, new Set(), 6).has('a'), 'started at 19 m');
});

test('send set: a peer already sending keeps its place over a near-equal newcomer', () => {
  const picked = selectAudioPeers({ old: 10.4, new: 10.0 }, new Set(['old']), 1);
  assert.deepEqual([...picked], ['old']);
});

test('send set: zero cap and NaN distances send to nobody', () => {
  assert.equal(selectAudioPeers({ a: 1 }, new Set(), 0).size, 0);
  assert.equal(selectAudioPeers({ a: NaN }, new Set(), 6).size, 0);
});

test('parseVc accepts 0 and 1 only', () => {
  assert.equal(parseVc({ s: 1 }), true);
  assert.equal(parseVc({ s: 0 }), false);
  assert.equal(parseVc({ s: 2 }), null);
  assert.equal(parseVc({ s: '1' }), null);
  assert.equal(parseVc(null), null);
  assert.equal(parseVc(1), null);
});
