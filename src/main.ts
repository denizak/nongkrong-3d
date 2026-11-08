import * as THREE from 'three/webgpu';
import { Input } from './core/Input';
import { Terrain } from './world/Terrain';
import { Environment } from './world/Environment';
import { DayNight } from './world/DayNight';
import { Weather } from './world/Weather';
import { NATURE_MODELS, loadNatureAssets } from './world/Assets';
import { addProps } from './world/Props';
import { addVegetation } from './world/Vegetation';
import { Torches } from './world/Torches';
import { Archipelago, IslandStates, START_CELL, type Cell, type IslandState } from './world/Archipelago';
import { Bridges } from './world/Bridges';
import { Proxies } from './world/Proxies';
import { IslandPill } from './ui/IslandPill';
import { Player } from './player/Player';
import { CameraRig } from './player/CameraRig';
import { CharacterModel } from './player/CharacterModel';
import { Physics } from './core/Physics';
import { Inventory } from './ui/Inventory';
import { Pickups } from './interact/Pickups';
import { InteractionSystem } from './interact/InteractionSystem';
import { FruitTree } from './interact/FruitTree';
import { FishingSpot } from './interact/FishingSpot';
import { Fishpedia } from './ui/Fishpedia';
import { ChatBubble } from './ui/ChatBubble';
import { PaddyField, inPaddy, MUD_SPEED } from './interact/PaddyField';
import { Birds } from './interact/Birds';
import { Scarecrow } from './interact/Scarecrow';
import { PRONE, SIT } from './player/CharacterModel';
import { sfx } from './audio/AudioManager';
import { Loading } from './ui/Loading';
import { Save } from './core/Save';
import { TouchControls } from './ui/TouchControls';
import { LookControls } from './player/LookControls';

const NO_MOVE = { x: 0, y: 0 };

/** The 3x3 existence mask around a cell, row-major from the north-west corner (dz = -1 first). */
function neighbourhood(arch: Archipelago): boolean[] {
  const out: boolean[] = [];
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) out.push(arch.inGrid(arch.cell.col + dx, arch.cell.row + dz));
  }
  return out;
}

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

  // WebGPURenderer uses WebGPU when available and falls back to WebGL2.
  // Add ?webgl to the URL to force the WebGL path for testing.
  // Pixel ratio is capped at 1.5 for speed. Add ?hq to allow up to 2.
  const params = new URLSearchParams(location.search);
  const forceWebGL = params.has('webgl');
  const maxPixelRatio = params.has('hq') ? 2 : 1.5;
  const loading = new Loading();
  loading.setProgress(0.05, 'Starting renderer');
  const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  await renderer.init();
  container.appendChild(renderer.domElement);
  loading.setProgress(0.1, 'Loading physics and terrain');

  const isWebGPU = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;
  backendLabel.textContent = `Renderer: ${isWebGPU ? 'WebGPU' : 'WebGL 2 (fallback)'}`;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);

  // Rapier loads in its own chunk, in parallel with the models.
  const physicsReady = Physics.create().then((p) => {
    loading.setProgress(0.25, 'Physics ready');
    return p;
  });

  // Everything static on the live island lives under islandRoot, so the proxies can clone it.
  // The island is always at the local origin; the player's position stays local to it.
  const terrain = new Terrain();
  const islandRoot = new THREE.Group();
  islandRoot.name = 'island';
  scene.add(islandRoot);
  islandRoot.add(terrain.mesh);
  const env = new Environment(scene, terrain);
  const daynight = new DayNight(scene, env, terrain, renderer);
  const weather = new Weather(scene, terrain);

  const modelTotal = NATURE_MODELS.length + 1;
  let modelsDone = 0;
  const onModelLoaded = () => {
    modelsDone++;
    loading.setProgress(0.3 + (0.45 * modelsDone) / modelTotal, `Loading models (${modelsDone}/${modelTotal})`);
  };
  const [physics, assets, model] = await Promise.all([
    physicsReady,
    loadNatureAssets(onModelLoaded),
    CharacterModel.load(onModelLoaded),
  ]);
  physics.addTerrain(terrain.mesh);

  loading.setProgress(0.78, 'Building the world');
  const bridges = new Bridges(islandRoot, terrain, physics);
  const corridor = (x: number, z: number) => bridges.inCorridor(x, z);
  const props = addProps(islandRoot, terrain, physics, assets, corridor);
  addVegetation(islandRoot, terrain, assets, corridor);
  const torches = new Torches(islandRoot, terrain, physics, props);

  const player = new Player(terrain, physics, model, (x, z) => bridges.onBridge(x, z));
  scene.add(player.object);

  const rig = new CameraRig(camera, physics);
  const input = new Input(renderer.domElement);
  const chat = new ChatBubble(camera, player, input);

  const inventory = new Inventory();
  const pickups = new Pickups(scene, terrain, inventory);
  loading.setProgress(0.9, 'Almost there');
  const interactions = new InteractionSystem(input, player, { pickups });
  const trees = props.fruitTrees.map((tree) => new FruitTree(tree));
  for (const tree of trees) interactions.add(tree);

  // Hand bone for the rod, found by name so the character model code stays untouched.
  const hand = model?.root.getObjectByName('Palm2R') ?? model?.root.getObjectByName('Palm2.R') ?? null;
  const fishpedia = new Fishpedia();
  const fishing = new FishingSpot({
    scene, camera, terrain, player, inventory, pedia: fishpedia, hand,
    onBridge: (x, z) => bridges.onBridge(x, z),
  });
  interactions.add(fishing);

  // Rice paddy, birds and the scarecrow. Their update() runs with the interaction loop.
  const paddy = new PaddyField({ scene: islandRoot, terrain, assets, player, inventory, avoid: props.scarecrow.position });
  const birds = new Birds(scene);
  const scarecrow = new Scarecrow({ group: props.scarecrow, camera, birds });
  interactions.add(paddy);
  interactions.add(scarecrow);
  // Robot looks: the loading card, K to reroll, and the touch dice button.
  const look = new LookControls({ model, input, inventory, loading });

  // Touch joystick, camera drag and buttons. Does nothing on non-touch devices.
  const touch = new TouchControls({ input, fishpedia, chat });

  // The grid, the proxies and the island switch. Proxies are cloned now, when the island is fully built.
  const archipelago = new Archipelago();
  const islands = new IslandStates();
  const proxies = new Proxies(scene, { island: islandRoot, terrain: terrain.mesh, bridges: bridges.root, torches: torches.group });
  new IslandPill(archipelago);
  sfx.onBridge = (x, z) => bridges.onBridge(x, z);

  archipelago.onChange((cell) => {
    proxies.onCell(archipelago);
    bridges.applyCell(cell, archipelago);
    env.setIslandMask(neighbourhood(archipelago));
  });

  const captureLive = (): IslandState => ({
    trees: trees.map((t) => t.getState()),
    paddy: paddy.getState(),
  });

  // True once the first island is placed; before that there is no live progress to store.
  let booted = false;

  /**
   * Switches the live island. Stores the old island's progress, changes the cell (proxies, bridges and
   * the water mask follow), loads the new island's progress and moves the player. With `shift`, the
   * player keeps their place on the island and only the local frame moves by that offset.
   */
  const enterIsland = (
    cell: Cell,
    x: number,
    z: number,
    heading: number,
    opts: { shift?: { dx: number; dz: number }; capture?: boolean } = {},
  ) => {
    if (opts.capture ?? booted) islands.set(archipelago.id, captureLive());
    archipelago.setCell(cell);
    const saved = islands.get(archipelago.id);
    trees.forEach((t, i) => t.setState(saved?.trees[i]));
    paddy.setState(saved?.paddy);

    if (opts.shift) {
      player.shiftBy(opts.shift.dx, opts.shift.dz);
      rig.shift(opts.shift.dx, opts.shift.dz);
    } else {
      const ok = player.isWalkable(x, z);
      player.place(ok ? x : 0, ok ? z : 0, heading);
    }

    // Anything in local coordinates that belongs to the old island goes away.
    pickups.clear();
    birds.clear();
    fishing.abort();
    weather.clearRipples();
    paddy.clearTransients();
    sfx.resetFootsteps();
  };
  archipelago.switchTo = (cell, x, z) => {
    enterIsland(cell, x, z, 0);
    rig.snapTo(player.position);
  };

  // Restore the saved spot and camera orbit (if valid) before the camera snaps to the player.
  const save = new Save(player, rig, {
    clock: daynight,
    archipelago,
    islands,
    captureLive: () => islands.set(archipelago.id, captureLive()),
    enter: (cell, x, z, heading) => enterIsland(cell, x, z, heading),
    newGame: () => {
      islands.clear();
      enterIsland(START_CELL, 0, 0, 0, { capture: false });
      rig.snapTo(player.position);
    },
  });
  if (!save.restore()) enterIsland(START_CELL, 0, 0, 0);
  booted = true;
  rig.snapTo(player.position);
  save.start();

  // Dev-only handle for poking at the game from the browser console.
  if (import.meta.env.DEV)
    Object.assign(window, {
      game: {
        player, rig, terrain, camera, physics, props, interactions, inventory, trees, pickups, prone: PRONE, sit: SIT,
        fishing, fishpedia, chat, paddy, scarecrow, birds, torches, audio: sfx, save, loading, touch, daynight, weather,
        resetSave: () => save.reset(), archipelago, bridges, proxies, islands, look,
        renderer, debugDrawStats: () => drawStats(scene, renderer),
      },
    });

  // FPS meter: dev builds or ?stats only, and never in touch mode unless ?stats is set.
  const touchMode = document.documentElement.classList.contains('touch');
  const showStats = params.has('stats') || (import.meta.env.DEV && !touchMode);
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
  });

  const timer = new THREE.Timer();
  renderer.setAnimationLoop((now) => {
    timer.update(now);
    const dt = Math.min(timer.getDelta(), 0.1);
    const t = timer.getElapsed();
    stats?.begin();

    if (started) {
      if (input.consumeSit()) player.togglePose('sit');
      if (input.consumeLie()) player.togglePose('lie');
      // Fishing holds the player still until the line is reeled in.
      const move = input.move();
      player.speedMultiplier = inPaddy(player.position.x, player.position.z) ? MUD_SPEED : 1;
      player.update(dt, fishing.locked ? NO_MOVE : move, input.running(), rig.basis());
      physics.step(dt);
      player.sync();
      // Crossing an edge into an existing neighbour: move the local frame by one spacing.
      const shift = archipelago.shiftFor(player.position.x, player.position.z);
      if (shift) enterIsland(shift.cell, 0, 0, 0, { shift: { dx: shift.dx, dz: shift.dz } });
      fishing.tick(dt, move);
      interactions.update(dt);
      birds.update(dt, player.position);
      pickups.update(dt, player.position, t);
      rig.update(player.position, input.consumeLook(), dt);
      sfx.update(dt, player, camera);
      chat.update();
    }
    env.update(player.position, t);
    daynight.update(dt, player.position, weather.rainAmount);
    weather.update(dt, player.position, daynight.hoursThisFrame);
    sfx.setWorld(weather.rainAmount, daynight.nightFactor);
    torches.update(dt, daynight.nightFactor);
    bridges.update(daynight.nightFactor);
    proxies.sync();

    renderer.render(scene, camera);
    stats?.end();
  });
}

boot().catch((err) => {
  console.error(err);
  const message = `Failed to start: ${err?.message ?? err}`;
  document.getElementById('backend')!.textContent = message;
  new Loading().fail(message);
});
