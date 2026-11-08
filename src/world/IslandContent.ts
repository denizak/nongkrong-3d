import * as THREE from 'three/webgpu';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Physics } from '../core/Physics';
import type { Player } from '../player/Player';
import type { Inventory } from '../ui/Inventory';
import { FruitTree } from '../interact/FruitTree';
import { PaddyField } from '../interact/PaddyField';
import { Scarecrow } from '../interact/Scarecrow';
import type { Birds } from '../interact/Birds';
import type { Interactable } from '../interact/Interactable';
import { addProps, type Props } from './Props';
import { addVegetation } from './Vegetation';
import { Torches } from './Torches';
import type { NatureAssets } from './Assets';
import type { Bridges } from './Bridges';
import type { IslandKind } from './Islands';
import type { Terrains } from './Terrains';
import { buildPlaza, type Campfire } from './Plaza';
import { addBeach } from './Beach';
import type { MainTerrain } from './MainTerrain';
import type { ShapeSpec, Terrain, Zones } from './Terrain';

/**
 * Everything an island kind owns in the live world: its terrain, props, vegetation, torches, rice paddy,
 * scarecrow and fruit trees. Each kind is built once, under its own root. Only the live island's root is
 * shown, and only its colliders are enabled. The per-island state (fruit, rice) is loaded into these
 * instances whenever the player arrives on an island of this kind.
 */
export interface IslandContent {
  kind: IslandKind;
  spec: ShapeSpec;
  root: THREE.Group;
  terrain: Terrain;
  terrainCollider: RAPIER.Collider;
  zones: Zones;
  /** Distance from the centre to the shore (m), used by the ambience and the sand footsteps. */
  coastR: number;
  props: Props;
  fruitTrees: FruitTree[];
  paddy: PaddyField;
  scarecrow: Scarecrow;
  torches: Torches;
  /** The interactables this island owns. The interaction system runs only these on the live island. */
  interactables: Interactable[];
  /** The village campfire, main island only. */
  campfire: Campfire | null;
}

export interface ContentDeps {
  terrains: Terrains;
  physics: Physics;
  assets: NatureAssets;
  scene: THREE.Scene;
  player: Player;
  inventory: Inventory;
  camera: THREE.Camera;
  birds: Birds;
  bridges: Bridges;
}

/**
 * Builds one island kind. Call it with the physics tags set so that only this kind's colliders are enabled
 * while it builds (physics.setActiveTags). The root is added to the scene but left hidden.
 */
export function buildIslandContent(kind: IslandKind, deps: ContentDeps, physics: Physics): IslandContent {
  const { terrains, assets, player, inventory, camera, birds, bridges } = deps;
  const terrain = terrains.of(kind);
  const spec = terrain.spec;

  const root = new THREE.Group();
  root.name = `island-${kind}`;
  root.visible = false;
  deps.scene.add(root);

  physics.tag = kind;
  root.add(terrain.mesh);
  const terrainCollider = physics.addTerrain(terrain.mesh);
  physics.terrainCollider = terrainCollider;

  const corridor = bridges.corridorFor(kind);
  const props = addProps(root, terrain, physics, assets, corridor, spec);
  addVegetation(root, terrain, assets, corridor, spec);
  // The main island's village: plaza with huts, fire and benches, and the beach with the pier's landing.
  let campfire: Campfire | null = null;
  if (kind === 'main') {
    campfire = buildPlaza(root, terrain as MainTerrain, physics, assets);
    addBeach(root, terrain as MainTerrain, physics, assets);
  }
  const torches = new Torches(root, terrain, physics, props, spec);
  const paddy = new PaddyField({
    scene: root, terrain, zones: spec.zones, assets, player, inventory, spacing: spec.riceSpacing,
    avoid: [props.scarecrow.position, ...props.decoys],
  });
  const scarecrow = new Scarecrow({ group: props.scarecrow, camera, birds });
  const fruitTrees = props.fruitTrees.map((tree) => new FruitTree(tree));
  physics.tag = 'static';

  return {
    kind,
    spec,
    root,
    terrain,
    terrainCollider,
    zones: spec.zones,
    coastR: terrain.coastR,
    props,
    fruitTrees,
    paddy,
    scarecrow,
    torches,
    interactables: [...fruitTrees, paddy, scarecrow],
    campfire,
  };
}
