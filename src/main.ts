import * as THREE from 'three/webgpu';
import Stats from 'stats.js';
import { Input } from './core/Input';
import { Terrain } from './world/Terrain';
import { Environment } from './world/Environment';
import { loadNatureAssets } from './world/Assets';
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

const NO_MOVE = { x: 0, y: 0 };

async function boot() {
  const container = document.getElementById('app')!;
  const backendLabel = document.getElementById('backend')!;

  // WebGPURenderer uses WebGPU when available and falls back to WebGL2.
  // Add ?webgl to the URL to force the WebGL path for testing.
  const forceWebGL = new URLSearchParams(location.search).has('webgl');
  const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  await renderer.init();
  container.appendChild(renderer.domElement);

  const isWebGPU = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;
  backendLabel.textContent = `Renderer: ${isWebGPU ? 'WebGPU' : 'WebGL 2 (fallback)'}`;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);

  const physics = await Physics.create();

  const terrain = new Terrain();
  scene.add(terrain.mesh);
  physics.addTerrain(terrain.mesh);
  const env = new Environment(scene, terrain);
  const [assets, model] = await Promise.all([loadNatureAssets(), CharacterModel.load()]);
  const props = addProps(scene, terrain, physics, assets);
  addVegetation(scene, terrain, assets);

  const player = new Player(terrain, physics, model);
  scene.add(player.object);

  const rig = new CameraRig(camera, physics);
  rig.snapTo(player.position);

  const input = new Input(renderer.domElement);
  const chat = new ChatBubble(camera, player, input);

  const inventory = new Inventory();
  const pickups = new Pickups(scene, terrain, inventory);
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
      game: { player, rig, terrain, camera, physics, props, interactions, inventory, trees, pickups, prone: PRONE, sit: SIT, fishing, fishpedia, chat, paddy, scarecrow, birds },
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

  const timer = new THREE.Timer();
  renderer.setAnimationLoop((now) => {
    timer.update(now);
    const dt = Math.min(timer.getDelta(), 0.1);
    const t = timer.getElapsed();
    stats.begin();

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
    chat.update();
    env.update(player.position, t);

    renderer.render(scene, camera);
    stats.end();
  });
}

boot().catch((err) => {
  console.error(err);
  document.getElementById('backend')!.textContent = `Failed to start: ${err?.message ?? err}`;
});
