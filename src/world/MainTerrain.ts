import { NORMAL_SPEC, Terrain, ZONES, scaleZones, type ShapeSpec } from './Terrain';

/**
 * The main (start) island. Same shape logic as a normal island, scaled 2.2x in each direction
 * (about 4.8x the area): a 380 m square at 2 m cells, with the coast, zones and orchard scaled to match.
 * Noise detail keeps the normal island's wavelengths, so the coast does not look coarser.
 */
export const MAIN_SCALE = 2.2;

export const MAIN_SPEC: ShapeSpec = {
  kind: 'main',
  scale: MAIN_SCALE,
  size: 380,
  segments: 190,
  zones: scaleZones(ZONES, MAIN_SCALE),
  orchard: {
    x: NORMAL_SPEC.orchard.x * MAIN_SCALE,
    z: NORMAL_SPEC.orchard.z * MAIN_SCALE,
    r: NORMAL_SPEC.orchard.r * MAIN_SCALE,
  },
  coastR: NORMAL_SPEC.coastR * MAIN_SCALE,
};

/** Terrain for the main island. Its local origin is the island centre, the spawn. */
export class MainTerrain extends Terrain {
  constructor() {
    super(MAIN_SPEC);
  }
}
