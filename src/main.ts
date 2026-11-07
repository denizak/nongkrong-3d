import * as THREE from 'three/webgpu';
import Stats from 'stats.js';
import { Input } from './core/Input';
import { Terrain } from './world/Terrain';
import { Environment } from './world/Environment';
import { NATURE_MODELS, loadNatureAssets } from './world/Assets';
import { addProps } from './world/Props';
import { addVegetation } from './world/Vegetation';
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

const NO_MOVE = { x: 0, y: 0 };

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

  const terrain = new Terrain();
  scene.add(terrain.mesh);
  const env = new Environment(scene, terrain);

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
  const props = addProps(scene, terrain, physics, assets);
  addVegetation(scene, terrain, assets);

  const player = new Player(terrain, physics, model);
  scene.add(player.object);

  const rig = new CameraRig(camera, physics);
  // Restore the saved spot and camera orbit (if valid) before the camera snaps to the player.
  const save = new Save(player, rig, terrain);
  save.restore();
  rig.snapTo(player.position);
  save.start();

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
  const fishing = new FishingSpot({ scene, camera, terrain, player, inventory, pedia: fishpedia, hand });
  interactions.add(fishing);

  // Rice paddy, birds and the scarecrow. Their update() runs with the interaction loop.
  const paddy = new PaddyField({ scene, terrain, assets, player, inventory, avoid: props.scarecrow.position });
  const birds = new Birds(scene);
  const scarecrow = new Scarecrow({ group: props.scarecrow, camera, birds });
  interactions.add(paddy);
  interactions.add(scarecrow);

  // Dev-only handle for poking at the game from the browser console.
  if (import.meta.env.DEV)
    Object.assign(window, {
      game: {
        player, rig, terrain, camera, physics, props, interactions, inventory, trees, pickups, prone: PRONE, sit: SIT,
        fishing, fishpedia, chat, paddy, scarecrow, birds, audio: sfx, save, loading, resetSave: () => save.reset(),
      },
    });

  const stats = new Stats();
  stats.dom.style.left = 'auto';
  stats.dom.style.right = '0';
  document.body.appendChild(stats.dom);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // The world renders behind the loading overlay, but nothing reacts to input until the player starts.
  let started = false;
  void loading.ready().then(() => {
    started = true;
  });

  const timer = new THREE.Timer();
  renderer.setAnimationLoop((now) => {
    timer.update(now);
    const dt = Math.min(timer.getDelta(), 0.1);
    const t = timer.getElapsed();
    stats.begin();

    if (started) {
      if (input.consumeSit()) player.togglePose('sit');
      if (input.consumeLie()) player.togglePose('lie');
      // Fishing holds the player still until the line is reeled in.
      const move = input.move();
      player.speedMultiplier = inPaddy(player.position.x, player.position.z) ? MUD_SPEED : 1;
      player.update(dt, fishing.locked ? NO_MOVE : move, input.running(), rig.basis());
      physics.step(dt);
      player.sync();
      fishing.tick(dt, move);
      interactions.update(dt);
      birds.update(dt, player.position);
      pickups.update(dt, player.position, t);
      rig.update(player.position, input.consumeLook(), dt);
      sfx.update(dt, player, camera);
      chat.update();
    }
    env.update(player.position, t);

    renderer.render(scene, camera);
    stats.end();
  });
}

boot().catch((err) => {
  console.error(err);
  const message = `Failed to start: ${err?.message ?? err}`;
  document.getElementById('backend')!.textContent = message;
  new Loading().fail(message);
});
