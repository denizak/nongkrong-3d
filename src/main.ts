import { t } from './i18n';
import * as THREE from 'three/webgpu';
import { Input } from './core/Input';
import { Terrains, LiveGround } from './world/Terrains';
import { Environment } from './world/Environment';
import { DayNight } from './world/DayNight';
import { Weather } from './world/Weather';
import { NATURE_MODELS, loadNatureAssets } from './world/Assets';
import { buildIslandContent, type IslandContent } from './world/IslandContent';
import { Archipelago, IslandStates, type IslandState } from './world/Archipelago';
import { Bridges } from './world/Bridges';
import { pierLayout } from './world/Beach';
import { IslandShapes } from './world/IslandShapes';
import { Proxies } from './world/Proxies';
import { MAIN_ID, ISLAND_COUNT, islandById, type IslandKind } from './world/Islands';
import { IslandPill } from './ui/IslandPill';
import { Player } from './player/Player';
import { CameraRig } from './player/CameraRig';
import { CharacterModel } from './player/CharacterModel';
import { Physics } from './core/Physics';
import { Inventory } from './ui/Inventory';
import { Pickups } from './interact/Pickups';
import { InteractionSystem } from './interact/InteractionSystem';
import { FishingSpot } from './interact/FishingSpot';
import { Fishpedia } from './ui/Fishpedia';
import { ChatBubble } from './ui/ChatBubble';
import { inPaddyZone, MUD_SPEED } from './interact/PaddyField';
import { Birds } from './interact/Birds';
import { PRONE, SIT } from './player/CharacterModel';
import { sfx, type Surface } from './audio/AudioManager';
import { Loading } from './ui/Loading';
import { Save } from './core/Save';
import { TouchControls } from './ui/TouchControls';
import { LookControls } from './player/LookControls';
import { Net } from './net/Net';
import { RemotePlayers } from './net/RemotePlayers';
import { NetPill } from './net/NetPill';
import { NetDebug } from './net/NetDebug';
import { Minimap } from './ui/Minimap';
import { FullMap } from './ui/FullMap';
import { IslandTitle } from './ui/IslandTitle';
import { quality, initQuality, isTouchDevice, lowerTier, FrameMonitor, type Knobs, type Source, type Tier } from './core/Quality';
import { QualityMenu } from './ui/QualityMenu';
import { PerfPanel } from './ui/PerfPanel';
import { addBlobShadow, applyBlobShadows } from './world/BlobShadow';

const NO_MOVE = { x: 0, y: 0 };
/** Beach is the sand band: beyond this share of the coast radius (and low ground). */
const BEACH_FROM = 0.71;

/**
 * Dev helper: counts the visible draw-call sources (Mesh, InstancedMesh, Sprite, Points, Line) in the
 * scene, grouped by node name, next to the renderer's counts from the last rendered frame.
 */
function drawStats(scene: THREE.Scene, renderer: THREE.WebGPURenderer) {
  const byName: Record<string, number> = {};
  let drawables = 0;
  let instanced = 0;
  scene.traverseVisible((o) => {
    const isDrawable = (o as THREE.Mesh).isMesh || (o as THREE.Sprite).isSprite || (o as THREE.Points).isPoints || (o as THREE.Line).isLine;
    if (!isDrawable) return;
    drawables++;
    if ((o as THREE.InstancedMesh).isInstancedMesh) instanced++;
    const key = o.name || `(unnamed ${o.type})`;
    byName[key] = (byName[key] ?? 0) + 1;
  });
  const top = Object.entries(byName).sort((a, b) => b[1] - a[1]).slice(0, 25);
  return {
    renderCalls: renderer.info.render.calls,
    renderTriangles: renderer.info.render.triangles,
    visibleDrawables: drawables,
    visibleInstancedMeshes: instanced,
    byName: Object.fromEntries(top),
  };
}

async function boot() {
  const container = document.getElementById('app')!;
  const backendLabel = document.getElementById('backend')!;

  // Quality tier first: it decides antialiasing, pixel ratio and shadows at renderer creation.
  // ?q=high|medium|low overrides the saved and automatic choice. See src/core/Quality.ts.
  const params = new URLSearchParams(location.search);
  initQuality(params);
  const touchDevice = isTouchDevice();
  // WebGPURenderer uses WebGPU when available and falls back to WebGL2. ?webgl forces WebGL2 (testing and drivers).
  // Low on a touch device also starts on WebGL2, since phone WebGPU drivers are uneven; ?webgpu keeps WebGPU.
  const forceWebGL = params.has('webgl') || (quality.tier === 'low' && touchDevice && !params.has('webgpu'));
  const loading = new Loading();
  loading.setProgress(0.05, t('loading.renderer'));
  const renderer = new THREE.WebGPURenderer({ antialias: quality.knobs.antialias, forceWebGL });
  renderer.setPixelRatio(quality.pixelRatio(window.devicePixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = quality.knobs.shadowSize > 0;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  await renderer.init();
  container.appendChild(renderer.domElement);
  loading.setProgress(0.1, t('loading.physics'));

  const isWebGPU = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;
  backendLabel.textContent = t('backend.renderer', { name: isWebGPU ? 'WebGPU' : t('backend.fallback') });

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
  /** Frame-rate watch for auto-downgrade. Only measures once the game has started. */
  const frames = new FrameMonitor();

  // Rapier loads in its own chunk, in parallel with the models.
  const physicsReady = Physics.create().then((p) => {
    loading.setProgress(0.25, t('loading.physicsReady'));
    return p;
  });

  // Terrains for both kinds, built once. The live ground follows the live island's terrain.
  // The game starts on the main island.
  const terrains = new Terrains();
  // The main island's start: the plaza's south edge, facing north.
  const start = terrains.main.spec.start;
  // Island shapes for the minimap and the full map, baked in chunks in the background.
  const shapes = new IslandShapes(terrains);
  const ground = new LiveGround(terrains.main);
  const env = new Environment(scene, terrains.heightAtWorld);
  const daynight = new DayNight(scene, env, ground, renderer);
  const weather = new Weather(scene, ground);

  const modelTotal = NATURE_MODELS.length + 1;
  let modelsDone = 0;
  const onModelLoaded = () => {
    modelsDone++;
    loading.setProgress(0.3 + (0.45 * modelsDone) / modelTotal, t('loading.models', { done: modelsDone, total: modelTotal }));
  };
  const [physics, assets, model] = await Promise.all([
    physicsReady,
    loadNatureAssets(onModelLoaded),
    CharacterModel.load(onModelLoaded),
  ]);

  loading.setProgress(0.78, t('loading.world'));
  const bridges = new Bridges(scene, terrains, physics);
  // The main island's pier: a bridge-style deck from the south beach out to sea.
  bridges.addLayout(pierLayout(terrains.main));
  const player = new Player(ground, physics, model, (x, z) => bridges.onBridge(x, z));
  scene.add(player.object);
  // Soft disc under the player: the stand-in for a shadow on the low tier.
  addBlobShadow(player.object);

  const rig = new CameraRig(camera, physics);
  const input = new Input(renderer.domElement);
  const chat = new ChatBubble(camera, player, input);

  const inventory = new Inventory();
  const pickups = new Pickups(scene, ground, inventory);
  const birds = new Birds(scene);

  // Build each island kind once. Each build sees only its own colliders.
  const contents = {} as Record<IslandKind, IslandContent>;
  for (const kind of ['normal', 'main'] as const) {
    physics.setActiveTags(new Set([kind]));
    contents[kind] = buildIslandContent(kind, {
      terrains, physics, assets, scene, player, inventory, camera, birds,
    }, physics);
  }
  // Flowers are placed in full; the tier draws its share.
  for (const kind of ['normal', 'main'] as const) contents[kind].vegetation.setShare(quality.knobs.flowerShare);
  loading.setProgress(0.9, t('loading.almost'));

  const interactions = new InteractionSystem(input, player, { pickups });

  // Hand bone for the rod, found by name so the character model code stays untouched.
  const hand = model?.root.getObjectByName('Palm2R') ?? model?.root.getObjectByName('Palm2.R') ?? null;
  const fishpedia = new Fishpedia();
  const fishing = new FishingSpot({
    scene, camera, terrain: ground, player, inventory, pedia: fishpedia, hand,
    onBridge: (x, z) => bridges.onBridge(x, z),
  });
  interactions.add(fishing);
  // Robot looks: the loading card, K to reroll, and the touch dice button.
  const look = new LookControls({ model, input, inventory, loading });

  // Multiplayer: presence and chat over WebRTC. Trystero loads when the game starts. ?solo turns it off.
  const net = new Net(() => look.current, { solo: params.has('solo') });
  const remotes = new RemotePlayers(scene, net);
  loading.addNameField(net.name, (raw) => net.setName(raw) ?? net.name);
  chat.onSend = (text) => net.sendChat(text);
  chat.onName = (arg) => {
    const name = net.setName(arg);
    inventory.toast(name ? t('name.set', { name }) : t('name.usage'));
  };

  // The island switch. Proxies are built from the baked kinds, now that every island is fully built.
  const archipelago = new Archipelago();
  const islands = new IslandStates();
  const proxies = new Proxies(scene, {
    normal: { root: contents.normal.root, terrain: contents.normal.terrain.mesh, torches: contents.normal.torches.group },
    main: { root: contents.main.root, terrain: contents.main.terrain.mesh, torches: contents.main.torches.group },
  });
  proxies.setDecimate(quality.knobs.decimateProxies);
  new IslandPill(archipelago);
  const netPill = new NetPill(net, archipelago);
  new NetDebug(net);
  const mapWorld = { arch: archipelago, net, bridges, player };
  const minimap = new Minimap(mapWorld, shapes);
  const fullMap = new FullMap(mapWorld, shapes, input);
  const islandTitle = new IslandTitle();
  // Touch joystick, camera drag and buttons, with the map button. Does nothing on non-touch devices.
  const touch = new TouchControls({ input, fishpedia, chat, map: fullMap });

  /** Build-time knobs as the scene was built. A change to any of these needs a reload to show in full. */
  const buildKey = (k: Knobs) => `${k.antialias}|${k.riceMul}|${k.waterLite}`;
  const builtKey = buildKey(quality.knobs);
  /**
   * Applies a quality tier to the live scene and saves it. Returns true when a build-time knob differs from
   * what was built, so the page needs a reload for the full effect.
   */
  const applyTier = (tier: Tier, source: Source): boolean => {
    quality.set(tier, source, true);
    const K = quality.knobs;
    frames.pause(2);
    renderer.setPixelRatio(quality.pixelRatio(window.devicePixelRatio));
    renderer.shadowMap.enabled = K.shadowSize > 0;
    env.applyShadows();
    contents.normal.vegetation.setShare(K.flowerShare);
    contents.main.vegetation.setShare(K.flowerShare);
    proxies.setDecimate(K.decimateProxies);
    proxies.update(archipelago.id);
    applyBlobShadows();
    return buildKey(K) !== builtKey;
  };
  const menu = new QualityMenu((tier) => applyTier(tier, 'manual'), (msg) => inventory.toast(msg));
  const announceLowered = (tier: Tier) => inventory.toast(t('quality.lowered', { tier: t(`quality.${tier}`) }));
  // ?perf only: count the draws of nested render() calls. The shadow maps render the scene through renderer.render()
  // from inside the top-level call, so the nested draws are the shadow pass. Draws are read from info.render.drawCalls.
  const passes = { shadowDraws: 0 };
  if (params.has('perf')) {
    const baseRender = renderer.render.bind(renderer);
    let depth = 0;
    renderer.render = ((scene: THREE.Object3D, camera: THREE.Camera) => {
      if (depth === 0) {
        depth++;
        try { baseRender(scene, camera); } finally { depth--; }
        return;
      }
      const before = renderer.info.render.drawCalls;
      depth++;
      try { baseRender(scene, camera); } finally {
        depth--;
        passes.shadowDraws += renderer.info.render.drawCalls - before;
      }
    }) as typeof renderer.render;
  }
  const perf = params.has('perf')
    ? new PerfPanel({
      renderer,
      scene,
      backend: isWebGPU ? 'WebGPU' : 'WebGL2',
      visibleProxies: () => proxies.visibleCount,
      shadowText: () => (env.sun.castShadow ? `${env.sun.shadow.mapSize.x}px` : 'off'),
      shadowDraws: () => passes.shadowDraws,
    })
    : null;

  /** The live island's content. Set by enterIsland; the main island until the first switch. */
  let live: IslandContent = contents.main;
  // True once the first island is placed; before that there is no live progress to store.
  let booted = false;

  const captureLive = (): IslandState => ({
    trees: live.fruitTrees.map((tree) => tree.getState()),
    paddy: live.paddy.getState(),
  });

  sfx.surfaceAt = (x, z): Surface => {
    if (bridges.onBridge(x, z)) return 'bridge';
    if (inPaddyZone(live.zones.paddy, x, z)) return 'paddy';
    if (Math.hypot(x, z) > BEACH_FROM * live.coastR && ground.heightAt(x, z) < 0.9) return 'beach';
    return 'grass';
  };

  /**
   * Switches the live island. Stores the old island's progress, makes the new kind's content live (roots,
   * colliders, ground, interaction, birds, fishing), loads the new island's progress and moves the player.
   * With `shift`, the player keeps their place on the island and only the local frame moves by that offset.
   */
  const enterIsland = (
    id: number,
    opts: { shift?: { dx: number; dz: number }; x?: number; z?: number; heading?: number; capture?: boolean } = {},
  ) => {
    // Island changes cost frames (new colliders and props): keep them out of the auto-downgrade window.
    frames.pause(0.5);
    const def = islandById(id)!;
    if (opts.capture ?? booted) islands.set(archipelago.id, captureLive());

    const next = contents[def.kind];
    // The old island's props on bridge landings come back before its colliders are switched off below.
    live.scatter.setHidden(null);
    live = next;
    archipelago.setCurrent(id);
    contents.normal.root.visible = def.kind === 'normal';
    contents.main.root.visible = def.kind === 'main';
    ground.active = next.terrain;
    physics.setActiveTags(new Set([def.kind]));
    physics.terrainCollider = next.terrainCollider;
    interactions.setActive(next.interactables);
    birds.setIsland(next.zones);
    fishing.setZones(next.zones);
    daynight.setIsland(next.zones, next.spec.orchards);
    sfx.coastR = next.coastR;

    const saved = islands.get(id);
    next.fruitTrees.forEach((tree, i) => tree.setState(saved?.trees[i]));
    next.paddy.setState(saved?.paddy);

    // Bridges first: the placement check below asks whether the spot is on a bridge.
    bridges.applyIsland(id);
    // Props and plants on this island's bridge landings are hidden, with their colliders.
    next.scatter.setHidden(bridges.corridorsOf(id));
    if (opts.shift) {
      player.shiftBy(opts.shift.dx, opts.shift.dz);
      rig.shift(opts.shift.dx, opts.shift.dz);
    } else {
      const x = opts.x ?? 0;
      const z = opts.z ?? 0;
      const ok = player.isWalkable(x, z);
      player.place(ok ? x : 0, ok ? z : 0, opts.heading ?? 0);
    }

    // Anything in local coordinates that belongs to the old island goes away.
    pickups.clear();
    fishing.abort();
    weather.clearRipples();
    next.paddy.clearTransients();
    sfx.resetFootsteps();
    proxies.update(id);
    env.setWindow(def.centerWorld.x, def.centerWorld.z);
  };
  archipelago.switchTo = (id, x, z) => {
    enterIsland(id, { x, z, heading: 0 });
    rig.snapTo(player.position);
  };

  // Restore the saved spot and camera orbit (if valid) before the camera snaps to the player.
  const save = new Save(player, rig, {
    clock: daynight,
    archipelago,
    islands,
    captureLive: () => islands.set(archipelago.id, captureLive()),
    enter: (id, x, z, heading) => enterIsland(id, { x, z, heading }),
    newGame: () => {
      islands.clear();
      enterIsland(MAIN_ID, { ...start, capture: false });
      rig.snapTo(player.position);
    },
  });
  if (!save.restore()) enterIsland(MAIN_ID, start);
  booted = true;
  rig.snapTo(player.position);
  save.start();

  // Dev-only handle for poking at the game from the browser console.
  if (import.meta.env.DEV)
    Object.assign(window, {
      game: {
        player, rig, camera, physics, interactions, inventory, pickups, prone: PRONE, sit: SIT,
        fishing, fishpedia, chat, birds, audio: sfx, save, loading, touch, daynight, weather,
        resetSave: () => save.reset(), archipelago, bridges, proxies, islands, look, net, remotes, map: fullMap, minimap, shapes,
        renderer, debugDrawStats: () => drawStats(scene, renderer), islandCount: ISLAND_COUNT,
        contents, terrains, ground, env,
        /** The live island's content: trees, paddy, props, torches, terrain, scarecrow. */
        get live() { return live; },
        get trees() { return live.fruitTrees; },
        get paddy() { return live.paddy; },
        get props() { return live.props; },
        get torches() { return live.torches; },
        get terrain() { return live.terrain; },
      },
    });

  // FPS meter: dev builds or ?stats only, and never in touch mode unless ?stats is set.
  const touchMode = document.documentElement.classList.contains('touch');
  const showStats = params.has('stats') || (import.meta.env.DEV && !touchMode && quality.tier !== 'low');
  const stats = showStats ? new (await import('stats.js')).default() : null;
  if (stats) {
    stats.dom.style.left = 'auto';
    stats.dom.style.right = '0';
    document.body.appendChild(stats.dom);
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // The world renders behind the loading overlay, but nothing reacts to input until the player starts.
  let started = false;
  void loading.ready().then(() => {
    started = true;
    touch.showHint();
    void net.start();
  });

  const timer = new THREE.Timer();
  renderer.setAnimationLoop((now) => {
    timer.update(now);
    const raw = timer.getDelta();
    const dt = Math.min(raw, 0.1);
    const t = timer.getElapsed();
    // A hidden tab draws nothing and measures nothing.
    if (document.hidden) {
      frames.pause(1);
      return;
    }
    stats?.begin();

    if (started) {
      // Auto-downgrade: three slow 3 s windows in a row step the tier down one notch. Never up.
      if (frames.tick(raw, false) && quality.tier !== 'low') {
        const next = lowerTier(quality.tier);
        menu.setNeedsReload(applyTier(next, 'auto'));
        announceLowered(next);
      }

      if (input.consumeSit()) player.togglePose('sit');
      if (input.consumeLie()) player.togglePose('lie');
      // Fishing holds the player still until the line is reeled in.
      const move = input.move();
      player.speedMultiplier = inPaddyZone(live.zones.paddy, player.position.x, player.position.z) ? MUD_SPEED : 1;
      player.update(dt, fishing.locked ? NO_MOVE : move, input.running(), rig.basis());
      physics.step(dt);
      player.sync();
      // Floating origin: crossing into another island's region moves the local frame onto that island.
      const shift = archipelago.shiftFor(player.position.x, player.position.z);
      if (shift) {
        const first = !archipelago.visited.has(shift.id);
        enterIsland(shift.id, { shift: { dx: shift.dx, dz: shift.dz } });
        islandTitle.show(shift.id, first);
      }
      fishing.tick(dt, move);
      interactions.update(dt);
      birds.update(dt, player.position);
      pickups.update(dt, player.position, t);
      rig.update(player.position, input.consumeLook(), dt);
      sfx.update(dt, player, camera);
      chat.update();
      // Presence: send my state, then draw the others around my island.
      net.tick(dt, {
        island: archipelago.id,
        x: player.position.x,
        y: player.position.y,
        z: player.position.z,
        heading: player.headingAngle,
        speed: player.currentSpeed,
        pose: player.pose,
        fishing: fishing.locked,
      });
      remotes.update(dt, camera, { island: archipelago.id, pos: player.position });
    }
    netPill.update(dt);
    minimap.update(dt);
    fullMap.update();
    env.update(player.position, t);
    daynight.update(dt, player.position, weather.rainAmount);
    weather.update(dt, player.position, daynight.hoursThisFrame);
    sfx.setWorld(weather.rainAmount, daynight.nightFactor);
    // Both kinds keep their torches ticking, so the proxies of the other kind stay in step.
    contents.normal.torches.update(dt, daynight.nightFactor, player.position);
    contents.main.torches.update(dt, daynight.nightFactor, player.position);
    contents.main.campfire?.update(dt, daynight.nightFactor);
    bridges.update(daynight.nightFactor);
    proxies.sync();

    passes.shadowDraws = 0;
    renderer.render(scene, camera);
    perf?.frame(raw);
    stats?.end();
  });
}

boot().catch((err) => {
  console.error(err);
  const message = t('backend.failed', { msg: String(err?.message ?? err) });
  document.getElementById('backend')!.textContent = message;
  new Loading().fail(message);
});
