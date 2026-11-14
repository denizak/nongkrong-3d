import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { createMediaManager } from '../node_modules/@trystero-p2p/core/dist/media.mjs';

// Minimal browser surface: tests drive real class methods and control async completions.
class Element extends EventTarget {
  style = {};
  children = [];
  textContent = '';
  hidden = false;
  classList = {
    values: new Set(),
    add(...xs) { xs.forEach(x => this.values.add(x)); },
    remove(...xs) { xs.forEach(x => this.values.delete(x)); },
    contains(x) { return this.values.has(x); },
    toggle(x, on = !this.values.has(x)) { on ? this.values.add(x) : this.values.delete(x); return on; },
  };
  append(...xs) { this.children.push(...xs); }
  replaceChildren(...xs) { this.children = xs; }
  setAttribute() {}
  removeAttribute() {}
  querySelector() { return null; }
  remove() {}
  focus() {}
  blur() {}
  setPointerCapture() {}
  releasePointerCapture() {}
}
const elements = new Map();
const windowTarget = new EventTarget();
let timerId = 0;
globalThis.window = Object.assign(windowTarget, {
  setInterval: () => ++timerId, clearInterval() {},
  setTimeout: () => ++timerId, clearTimeout() {},
  innerWidth: 1000, innerHeight: 700,
});
globalThis.document = Object.assign(new EventTarget(), {
  body: new Element(), documentElement: new Element(), activeElement: null,
  querySelector: () => null, querySelectorAll: () => [],
  createElement: () => new Element(),
  getElementById: (id) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); },
});
globalThis.HTMLElement = Element;
globalThis.HTMLInputElement = class extends Element {};
globalThis.HTMLTextAreaElement = class extends Element {};
globalThis.HTMLButtonElement = class extends Element {};
globalThis.location = { hash: '', search: '', origin: 'https://example.test' };
let storageFails = false;
const storage = new Map();
globalThis.localStorage = {
  getItem: k => storage.get(k) ?? null,
  setItem: (k, v) => { if (storageFails) throw new Error('quota'); storage.set(k, v); },
  removeItem: k => { if (storageFails) throw new Error('blocked'); storage.delete(k); },
};
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => [] } });
globalThis.requestAnimationFrame = cb => { cb(); return 1; };
globalThis.WebSocket = { OPEN: 1 };
let rooms = [];
globalThis.__testTrystero = {
  joinRoom() { const room = makeRoom(); rooms.push(room); return room; },
  getRelaySockets: () => ({}),
};
const vite = await createServer({
  ssr: { noExternal: ['trystero'] },
  server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom',
  plugins: [{ name: 'controlled-network', enforce: 'pre',
    resolveId(id) { if (id === 'trystero') return '\0test-trystero'; },
    load(id) { if (id === '\0test-trystero') return `export const selfId = 'local'; export const joinRoom = (...args) => globalThis.__testTrystero.joinRoom(...args); export const getRelaySockets = () => globalThis.__testTrystero.getRelaySockets();`; },
  }],
});
after(() => vite.close());
const load = path => vite.ssrLoadModule(`/src/${path}.ts`);
const { Net } = await load('net/Net');
const { Voice } = await load('net/Voice');
const { Fishing } = await load('interact/Fishing');
const { FruitTree } = await load('interact/FruitTree');
const { Birds } = await load('interact/Birds');
const { PaddyField } = await load('interact/PaddyField');
const { Weather } = await load('world/Weather');
const { IslandStates } = await load('world/Archipelago');
const { Inventory } = await load('ui/Inventory');
const { Fishpedia } = await load('ui/Fishpedia');
const { Save } = await load('core/Save');
const { FullMap } = await load('ui/FullMap');
const { Input } = await load('core/Input');
const { TouchControls } = await load('ui/TouchControls');
const { FrameMonitor } = await load('core/Quality');
const { RemotePlayers } = await load('net/RemotePlayers');
const { Scarecrow } = await load('interact/Scarecrow');
const { sfx } = await load('audio/AudioManager');
sfx.play = () => {};
const THREE = await import('three/webgpu');
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function makeRoom() {
  return {
    actions: new Map(), leave: async () => {}, addStream: () => [Promise.resolve()], removeStream() {},
    makeAction(name) { const action = { send: async () => {} }; this.actions.set(name, action); return action; },
  };
}
function micStream() {
  const track = Object.assign(new EventTarget(), { enabled: false, stopped: false, stop() { this.stopped = true; } });
  return { track, getTracks: () => [track], getAudioTracks: () => [track] };
}
function makeVoice() {
  const voice = Object.create(Voice.prototype);
  Object.assign(voice, {
    enabled: true, mic: { kind: 'released' }, wantTalk: false,
    audio: { unlockNow() {} }, clock: 0, lastTalkEnd: 0,
    room: null, vc: null, sending: new Set(), sendAttempts: new Map(),
    links: new Map(), pending: new Map(), vcOn: new Map(), speakUntil: new Map(), mutedPeers: new Set(),
    micBtns: new Set(), say() {}, net: { remotes: new Map(), failedPeers: new Set() },
    me: { island: 0, pos: { x: 0, y: 0, z: 0 } },
  });
  voice.refresh = () => {};
  return voice;
}

test('ISSUE-01: corrupt island progress is rejected atomically; valid saves are copied', () => {
  const states = new IslandStates();
  const valid = { trees: [{ h: [1, 0], r: 5 }], paddy: { s: [0, 1, 2], t: [4, 0, 5], f: [1, 1, .2] } };
  for (const bad of [
    { trees: [], paddy: { s: [0] } },
    { trees: [null], paddy: valid.paddy },
    { trees: valid.trees, paddy: { s: [9], t: [0], f: [1] } },
    { trees: valid.trees, paddy: { s: [0], t: [NaN], f: [1] } },
    { trees: valid.trees, paddy: { s: [0], t: [], f: [1] } },
  ]) {
    states.load({ 1: bad });
    assert.equal(states.get(1), undefined);
  }
  states.load({ 1: valid });
  assert.deepEqual(states.get(1), valid);
  valid.paddy.s[0] = 99;
  assert.equal(states.get(1).paddy.s[0], 0);
});

test('ISSUE-01: incompatible crop density restores fresh state instead of leaking another island', () => {
  const paddy = Object.create(PaddyField.prototype);
  Object.assign(paddy, { n: 2, fresh: { s: [1, 1], t: [0, 0], f: [1, 1] },
    state: new Uint8Array([2, 2]), timer: new Float32Array(2), hf: new Float32Array(2),
    tilt: new Float32Array(2), vel: new Float32Array(2), dirX: new Float32Array(2), dirZ: new Float32Array(2),
    bending: new Set([0]), growing: new Set([0]), write() {}, paint() {}, flush() {},
  });
  paddy.setState({ s: [2], t: [2], f: [.2] });
  assert.deepEqual([...paddy.state], [1, 1]);
  assert.equal(paddy.growing.size, 0);
  assert.equal(paddy.bending.size, 0);
});

test('ISSUE-02: storage failure does not interrupt a catch or award it twice', () => {
  const pedia = new Fishpedia();
  const inventory = new Inventory();
  const fishing = new Fishing({ scene: new THREE.Scene(), player: { object: new THREE.Group(),
    position: new THREE.Vector3(), getFacing: out => out.set(0, 0, 1) }, hand: null,
    camera: new THREE.PerspectiveCamera(), pedia, inventory });
  fishing.cast(new THREE.Vector3(0, 0, 3), 'sea');
  fishing.debugForceBite();
  storageFails = true;
  try {
    fishing.press();
    assert.equal(fishing.state, 'caught');
    const counts = { ...inventory.counts };
    fishing.press();
    assert.deepEqual(inventory.counts, counts);
    fishing.tick(2);
    assert.equal(fishing.state, 'idle');
  } finally { storageFails = false; }
});

test('ISSUE-02: resetting the live game succeeds with blocked storage', () => {
  let resets = 0;
  const save = new Save({}, {}, { newGame() { resets++; } });
  storageFails = true;
  try { assert.doesNotThrow(() => save.reset()); } finally { storageFails = false; }
  assert.equal(resets, 1);
});

test('ISSUE-03: relay loss times out and recovers without discarding connected peers', () => {
  const net = new Net(() => ({ type: 0, body: '#ffffff', trim: '#000000' }));
  net.status = 'online';
  net.remotes.set('existing', {});
  net.relayStates = () => [{ open: false }];
  net.checkRelays();
  assert.equal(net.status, 'connecting');
  net.relayLostAt -= 12001;
  net.checkRelays();
  assert.equal(net.status, 'offline');
  assert.equal(net.remotes.size, 1);
  net.relayStates = () => [{ open: true }];
  net.checkRelays();
  assert.equal(net.status, 'online');
});

test('ISSUE-03: retries coalesce, can repeat, and ignore callbacks from departed rooms', async () => {
  rooms = [];
  const net = new Net(() => ({ type: 0, body: '#ffffff', trim: '#000000' }));
  const attached = [];
  net.onRoom = room => attached.push(room);
  await net.start();
  const first = rooms[0];
  first.onPeerJoin('old');
  const leaving = deferred();
  first.leave = () => leaving.promise;
  net.status = 'offline';
  const retry = net.onNetworkBack();
  await net.onNetworkBack();
  assert.equal(rooms.length, 1);
  first.onPeerJoin('late');
  assert.equal(net.remotes.size, 0);
  assert.equal(attached.at(-1), null);
  leaving.resolve();
  await retry;
  assert.equal(rooms.length, 2);
  rooms[1].onPeerJoin('same-id');
  first.onPeerLeave('same-id');
  assert.ok(net.remotes.has('same-id'));
  net.status = 'offline';
  await net.onNetworkBack();
  assert.equal(rooms.length, 3);
});

test('ISSUE-04: release during permission keeps mic silent; ended track is reacquirable', async () => {
  const v = makeVoice();
  const request = deferred();
  let calls = 0;
  navigator.mediaDevices = { getUserMedia: () => { calls++; return request.promise; } };
  v.press(); v.press();
  assert.equal(calls, 1);
  v.release();
  const stream = micStream();
  request.resolve(stream);
  await flush();
  assert.equal(v.mic.kind, 'ready');
  assert.equal(stream.track.enabled, false);
  v.press();
  assert.equal(v.talkingNow, true);
  stream.track.dispatchEvent(new Event('ended'));
  assert.equal(v.mic.kind, 'released');
  assert.equal(v.talkingNow, false);
  assert.ok(stream.track.stopped);
  v.press();
  assert.equal(calls, 2);
  await flush();
});

test('ISSUE-04: disable absorbs pending permission success and failure', async () => {
  for (const outcome of ['resolve', 'reject']) {
    const v = makeVoice();
    const request = deferred();
    navigator.mediaDevices = { getUserMedia: () => request.promise };
    v.press();
    v.disable();
    const stream = micStream();
    request[outcome](outcome === 'resolve' ? stream : new Error('denied'));
    await flush();
    assert.equal(v.mic.kind, 'disabled');
    assert.equal(v.talkingNow, false);
    if (outcome === 'resolve') assert.ok(stream.track.stopped);
  }
});

test('ISSUE-04: rejected stream negotiation retries; old rejection cannot undo a new attempt', async () => {
  const v = makeVoice();
  const stream = micStream();
  v.mic = { kind: 'ready', stream };
  const room = makeRoom();
  const attempts = [];
  room.addStream = () => { const d = deferred(); attempts.push(d); return [d.promise]; };
  v.room = room;
  v.net.remotes.set('peer', { id: 'peer', snaps: [{ island: 0, x: 0, z: 1 }], lastState: performance.now() });
  v.syncSend();
  attempts[0].reject(new Error('negotiation failed'));
  await flush();
  assert.ok(!v.sending.has('peer'));
  v.syncSend();
  assert.equal(attempts.length, 2);
  v.attach(room); // resets ownership of the second attempt
  v.syncSend();
  attempts[1].reject(new Error('old attempt'));
  await flush();
  assert.ok(v.sending.has('peer'));
  attempts[2].resolve();
});

test('ISSUE-04: stale room callbacks cannot populate pending audio after detach/rejoin', () => {
  const v = makeVoice();
  const old = makeRoom();
  v.attach(old);
  v.attach(null);
  old.onPeerStream(micStream(), 'peer');
  assert.equal(v.pending.size, 0);
  const next = makeRoom();
  v.attach(next);
  old.onPeerStream(micStream(), 'peer');
  assert.equal(v.pending.size, 0);
  next.onPeerStream(micStream(), 'peer');
  assert.equal(v.pending.size, 1);
});

test('ISSUE-05: repeated short hops cannot renew a bird visit indefinitely', () => {
  const birds = new Birds(new THREE.Scene());
  birds.spawnFlock();
  const b = birds.birds[0];
  // Initial arrival establishes one visit deadline.
  b.t = b.dur;
  birds.moveBird(b, .01);
  b.stayLeft = 2;
  for (let i = 0; i < 3; i++) {
    birds.start(b, b.root.position.clone(), .5, .4);
    b.t = b.dur;
    birds.moveBird(b, .01);
    assert.equal(b.stayLeft, 2);
  }
  birds.update(2.1, new THREE.Vector3(1000, 0, 1000));
  assert.equal(b.state, 'flee');
});

test('ISSUE-06: blur clears queued keys, joystick, and drag; cancelled drag cannot resume', () => {
  const canvas = new Element();
  const input = new Input(canvas);
  input.pressInteract(); input.setTouchMove(1, 1, true);
  input.dragging = true; input.addLook(10, 10);
  window.dispatchEvent(new Event('blur'));
  assert.equal(input.consumeInteract(), false);
  assert.deepEqual(input.move(), { x: 0, y: 0 });
  assert.equal(input.dragging, false);
  assert.deepEqual(input.consumeLook(), { x: 0, y: 0, zoom: 0 });
  input.dragging = true;
  canvas.dispatchEvent(new Event('pointercancel'));
  assert.equal(input.dragging, false);
});

test('ISSUE-07: finishing asynchronous map baking invalidates an already open map', () => {
  const map = Object.create(FullMap.prototype);
  let rebuilds = 0;
  Object.assign(map, { opened: true, staticKey: 1, shapesReady: false,
    world: { arch: { visited: new Set([0]) } }, shapes: { ready: false },
    rebuildStatic() { rebuilds++; this.shapesReady = this.shapes.ready; }, drawFrame() {},
  });
  map.update(); assert.equal(rebuilds, 0);
  map.shapes.ready = true;
  map.update(); assert.equal(rebuilds, 1);
  map.update(); assert.equal(rebuilds, 1);
});

test('ISSUE-07: island departure clears a scarecrow bubble and interrupted spin', () => {
  const scarecrow = Object.create(Scarecrow.prototype);
  const group = new THREE.Group();
  const bubble = new Element(); bubble.classList.add('show');
  Object.assign(scarecrow, { deps: { group }, bubble, spinT: .2, bubbleT: .2, yaw0: .4 });
  scarecrow.clearTransients();
  assert.equal(scarecrow.spinT, -1);
  assert.equal(scarecrow.bubbleT, -1);
  assert.equal(group.rotation.y, .4);
  assert.equal(bubble.classList.contains('show'), false);
});

test('ISSUE-08: excluded work breaks the consecutive slow-window streak', () => {
  const monitor = new FrameMonitor();
  monitor.bad = 2;
  monitor.pause(1);
  assert.equal(monitor.bad, 0);
  for (let i = 0; i < 200; i++) assert.equal(monitor.tick(.04, false), false);
});

test('optimization: idle fishing skips transforms and uploads but drains splash effects', () => {
  const fishing = Object.create(Fishing.prototype);
  let splashes = 0;
  Object.assign(fishing, { state: 'idle', time: 0, updateSplashes() { splashes++; }, updateBang() {},
    updateRod() { assert.fail('idle transform'); }, updateLine() { assert.fail('idle upload'); } });
  fishing.tick(.016);
  assert.equal(splashes, 1);
});

test('optimization: first cast resolves current hand position and drops/reels only once', () => {
  const player = { object: new THREE.Group(), position: new THREE.Vector3(20, 0, 20), getFacing: out => out.set(0, 0, 1) };
  player.object.position.copy(player.position);
  const fishing = new Fishing({ scene: new THREE.Scene(), player, hand: null,
    camera: new THREE.PerspectiveCamera(), inventory: {}, pedia: {} });
  fishing.cast(new THREE.Vector3(20, 0, 23), 'sea');
  assert.ok(fishing.castFrom.x > 19);
  const from = fishing.castFrom.clone();
  fishing.cast(new THREE.Vector3(0, 0, 0), 'sea');
  assert.ok(fishing.castFrom.equals(from));
  fishing.cancel(); fishing.tick(1);
  assert.equal(fishing.state, 'idle');
});

test('optimization: tree shake crosses drop once and cached count survives restore/regrowth', () => {
  const object = new THREE.Group();
  const fruit = new THREE.InstancedMesh(new THREE.SphereGeometry(), new THREE.MeshBasicMaterial(), 3);
  for (let i = 0; i < 3; i++) fruit.setMatrixAt(i, new THREE.Matrix4());
  const tree = new FruitTree({ object, fruit, position: object.position });
  let drops = 0;
  tree.interact({ pickups: { spawn() { drops++; } } });
  tree.update(.5);
  const afterDrop = tree.hangingCount();
  assert.equal(afterDrop, 3 - drops);
  tree.update(.4);
  assert.equal(3 - tree.hangingCount(), drops);
  assert.equal(tree.shake.kind, 'resting');
  tree.setState({ h: [0, 0, 1], r: 44 });
  tree.update(1);
  assert.equal(tree.hangingCount(), 2);
  tree.setState();
  assert.equal(tree.hangingCount(), 3);
});

test('weather: forced rain does not expire and automatic storm returns to dry', () => {
  const weather = Object.create(Weather.prototype);
  weather.setRain(true); weather.updateSchedule(100);
  assert.equal(weather.schedule.kind, 'forced');
  weather.setRain(false);
  assert.equal(weather.raining, false);
  weather.schedule = { kind: 'storm', hoursLeft: 1 };
  weather.updateSchedule(1);
  assert.equal(weather.schedule.kind, 'dry');
});

test('optimization: nearest avatar selection remains capped, stable, and reuses samples', () => {
  const net = { remotes: new Map() };
  const renderer = new RemotePlayers(new THREE.Scene(), net);
  const now = performance.now();
  for (let i = 40; i > 0; i--) net.remotes.set(String(i), {
    id: String(i), lastState: now, snaps: [{ t: now, island: 0, x: i, z: 0, y: 0, heading: 0, speed: 0, pose: 'stand', fishing: false }],
  });
  const chosen = [];
  renderer.ensure = p => ({ peer: p });
  renderer.place = av => chosen.push(av.peer.id);
  const camera = new THREE.PerspectiveCamera();
  const me = { island: 0, pos: new THREE.Vector3() };
  renderer.update(.016, camera, me, now);
  assert.deepEqual(chosen, Array.from({ length: 24 }, (_, i) => String(i + 1)));
  const sample = renderer.pool[0].s;
  chosen.length = 0;
  renderer.update(.016, camera, me, now);
  assert.equal(renderer.pool[0].s, sample);
  assert.equal(chosen.length, 24);
});

test('optimization: paddy spatial updates match a full-scan oracle through harvest, growth, and spring settling', () => {
  const player = { position: new THREE.Vector3(0, 0, 0), getFacing: out => out.set(0, 0, 1) };
  const geometry = new THREE.BoxGeometry(.1, 1, .1);
  const paddy = new PaddyField({ scene: new THREE.Group(), terrain: { heightAt: () => 0 },
    zones: { paddy: { x: 0, z: 0, w: 16, d: 16, h: 0 } },
    assets: { crops_wheatStageB: { parts: [{ geometry }] } }, player, inventory: { add() {} }, avoid: [], spacing: 1.2 });
  paddy.puff = () => {};
  // A second field's near() returns every stalk: same exact narrow-phase rules,
  // but no spatial culling or sleeping springs. This catches omitted active stalks.
  const oracle = new PaddyField({ scene: new THREE.Group(), terrain: { heightAt: () => 0 },
    zones: { paddy: { x: 0, z: 0, w: 16, d: 16, h: 0 } },
    assets: { crops_wheatStageB: { parts: [{ geometry }] } }, player, inventory: { add() {} }, avoid: [], spacing: 1.2 });
  oracle.near = () => Array.from({ length: oracle.n }, (_, i) => i);
  oracle.puff = () => {};
  for (let frame = 0; frame < 1500; frame++) {
    if (frame < 100) player.position.set(Math.sin(frame * .04) * 4, 0, Math.cos(frame * .04) * 4);
    else player.position.set(100, 0, 100);
    paddy.update(.1); oracle.update(.1);
    assert.equal(paddy.target, oracle.target);
    if (frame === 50) {
      const random = Math.random;
      try { Math.random = () => .5; paddy.interact(); oracle.interact(); }
      finally { Math.random = random; }
    }
    assert.deepEqual(paddy.state, oracle.state);
    assert.deepEqual(paddy.timer, oracle.timer);
    assert.deepEqual(paddy.hf, oracle.hf);
    assert.deepEqual(paddy.tilt, oracle.tilt);
    assert.deepEqual(paddy.vel, oracle.vel);
  }
  assert.equal(paddy.bending.size, 0);
  assert.equal(paddy.growing.size, 0);
  assert.equal(paddy.activeSprings.size, 0);
});

test('ISSUE-06: focus recovery does not synthesize a held gamepad edge, and touch ownership is cancelled', () => {
  const input = new Input(new Element());
  const buttons = Array.from({ length: 4 }, () => ({ pressed: false }));
  navigator.getGamepads = () => [{ buttons, axes: [1, 0] }];
  buttons[2].pressed = true;
  assert.equal(input.consumeInteract(), true);
  window.dispatchEvent(new Event('blur'));
  assert.deepEqual(input.move(), { x: 0, y: 0 });
  window.dispatchEvent(new Event('focus'));
  assert.equal(input.consumeInteract(), false);
  buttons[2].pressed = false; input.consumeInteract();
  buttons[2].pressed = true; assert.equal(input.consumeInteract(), true);
  navigator.getGamepads = () => [];
  const touch = Object.create(TouchControls.prototype);
  const base = new Element(); base.classList.add('show');
  Object.assign(touch, { tracked: new Map([[1, { kind: 'stick' }], [2, { kind: 'look' }]]),
    stickId: 1, pinchDist: 10, stickBase: base, input });
  input.setTouchMove(1, 0, true);
  touch.cancelTouches();
  assert.equal(touch.tracked.size, 0);
  assert.equal(touch.stickId, -1);
  assert.equal(touch.pinchDist, 0);
  assert.equal(base.classList.contains('show'), false);
  assert.deepEqual(input.move(), { x: 0, y: 0 });
});

test('ISSUE-07: Fishpedia shortcut ignores editable fields and works after editing ends', () => {
  const pedia = new Fishpedia();
  const key = () => Object.assign(new Event('keydown'), { code: 'KeyF', repeat: false });
  document.activeElement = new HTMLInputElement();
  window.dispatchEvent(key());
  assert.equal(pedia.isOpen, false);
  document.activeElement = null;
  window.dispatchEvent(key());
  assert.equal(pedia.isOpen, true);
});

test('ISSUE-04: late addStream success after mute is compensated before any later retry', async () => {
  const v = makeVoice();
  const stream = micStream();
  v.mic = { kind: 'ready', stream };
  const room = makeRoom();
  const metadata = deferred();
  const attached = new Set();
  let adds = 0;
  // Exercise the installed dependency's actual await-metadata → add-track order.
  const peer = { addStream() { attached.add('peer'); }, removeStream() { attached.delete('peer'); } };
  const media = createMediaManager({ iterate: (_targets, f) => [Promise.resolve(f('peer', peer))],
    isActive: () => true, getSharedMediaPeer: () => null, onPeerError() {} });
  room.addStream = (s, options) => { adds++; return media.addStream(s, options, () => metadata.promise); };
  room.removeStream = (s, options) => media.removeStream(s, options.target);
  v.room = room;
  v.net.remotes.set('peer', { id: 'peer', snaps: [{ island: 0, x: 0, z: 1 }], lastState: performance.now() });
  v.syncSend();
  v.togglePeerMute('peer'); // remove runs while metadata is still pending
  assert.equal(attached.size, 0);
  v.togglePeerMute('peer'); // do not issue a duplicate add while the cancelled attempt is pending
  assert.equal(adds, 1);
  metadata.resolve();
  await flush(); await flush();
  assert.equal(attached.size, 0);
  assert.equal(v.sendAttempts.size, 0);
  assert.equal(v.sending.size, 0);
});

test('ISSUE-04: late addStream success after microphone release removes obsolete tracks', async () => {
  const v = makeVoice();
  const stream = micStream();
  v.mic = { kind: 'ready', stream };
  const room = makeRoom();
  const metadata = deferred();
  let attached = false;
  room.addStream = () => [metadata.promise.then(() => { attached = true; })];
  room.removeStream = () => { attached = false; };
  v.room = room;
  v.net.remotes.set('peer', { id: 'peer', snaps: [{ island: 0, x: 0, z: 1 }], lastState: performance.now() });
  v.syncSend(); v.stopMic();
  metadata.resolve(); await flush(); await flush();
  assert.equal(attached, false);
  assert.ok(stream.track.stopped);
  assert.equal(v.stream, null);
});
