export type WaterKind = 'pond' | 'sea';

export interface Species {
  id: string;
  name: string;
  emoji: string;
  water: WaterKind;
  /** Relative chance within its water's table. */
  weight: number;
  minCm: number;
  maxCm: number;
}

export const SPECIES: Species[] = [
  { id: 'tilapia', name: 'Tilapia', emoji: '🐟', water: 'pond', weight: 35, minCm: 15, maxCm: 35 },
  { id: 'catfish', name: 'Catfish', emoji: '🐟', water: 'pond', weight: 20, minCm: 25, maxCm: 70 },
  { id: 'carp', name: 'Carp', emoji: '🐟', water: 'pond', weight: 20, minCm: 30, maxCm: 80 },
  { id: 'gourami', name: 'Gourami', emoji: '🐠', water: 'pond', weight: 15, minCm: 10, maxCm: 25 },
  { id: 'koi', name: 'Koi', emoji: '🎏', water: 'pond', weight: 8, minCm: 30, maxCm: 75 },
  { id: 'golden-koi', name: 'Golden Koi', emoji: '🎏', water: 'pond', weight: 2, minCm: 40, maxCm: 90 },
  { id: 'sardine', name: 'Sardine', emoji: '🐟', water: 'sea', weight: 30, minCm: 10, maxCm: 20 },
  { id: 'red-snapper', name: 'Red Snapper', emoji: '🐠', water: 'sea', weight: 20, minCm: 30, maxCm: 70 },
  { id: 'clownfish', name: 'Clownfish', emoji: '🐠', water: 'sea', weight: 15, minCm: 6, maxCm: 11 },
  { id: 'pufferfish', name: 'Pufferfish', emoji: '🐡', water: 'sea', weight: 15, minCm: 15, maxCm: 40 },
  { id: 'tuna', name: 'Tuna', emoji: '🐟', water: 'sea', weight: 8, minCm: 60, maxCm: 150 },
  { id: 'mahi-mahi', name: 'Mahi-mahi', emoji: '🐠', water: 'sea', weight: 2, minCm: 60, maxCm: 120 },
];

/** Inventory and Fishpedia id for a species. */
export const fishItemId = (s: Species) => `fish_${s.id}`;

/** Weighted random pick from one water's table. */
export function pickSpecies(water: WaterKind): Species {
  const table = SPECIES.filter((s) => s.water === water);
  const total = table.reduce((sum, s) => sum + s.weight, 0);
  let r = Math.random() * total;
  for (const s of table) {
    r -= s.weight;
    if (r < 0) return s;
  }
  return table[table.length - 1];
}

/** Seconds the player has to press E after the bite. Rarer fish give a shorter window. */
export function biteWindow(s: Species): number {
  return s.weight <= 2 ? 0.4 : s.weight <= 8 ? 0.5 : 0.7;
}
