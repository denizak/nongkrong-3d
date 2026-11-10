/**
 * Pure voice maths: how loud a speaker is at a distance, how far left or right they sit, and which peers get my
 * microphone. No DOM and no Web Audio here, so it can be unit-tested directly.
 */

/** Heard, and sent to, within this world distance (m). */
export const VOICE_RANGE = 20;
/** A peer already receiving my voice keeps it until they are farther than this (m). Hysteresis against flapping. */
export const VOICE_STOP = 24;
/** Full volume inside this distance (m). */
export const VOICE_NEAR = 2;
/** Most peers I send my voice to at once: high tiers, then low tier. */
export const VOICE_CAP = 6;
export const VOICE_CAP_LOW = 4;
/** Rank bonus (m) for a peer already receiving, so two peers at almost the same distance do not swap places. */
const STICKY = 1;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Loudness of a speaker at distance d (m): g = clamp(1 - (d - 2) / 18, 0, 1)^2.
 * 1 at 2 m or closer, 0.25 at 11 m, 0 at 20 m and beyond (and for NaN).
 */
export function voiceGain(d: number): number {
  if (!(d < VOICE_RANGE)) return 0;
  const k = clamp01(1 - (d - VOICE_NEAR) / (VOICE_RANGE - VOICE_NEAR));
  return k * k;
}

/**
 * Stereo pan (-1 left .. 1 right) from the speaker's offset in the listener's frame: `side` is the offset along the
 * listener's right, `front` the offset along the listener's forward (both on the ground plane).
 */
export function voicePan(side: number, front: number): number {
  const p = Math.sin(Math.atan2(side, front));
  return p < -1 ? -1 : p > 1 ? 1 : p;
}

/**
 * Which peers should receive my audio. `distances` maps peer id to world distance (m) for every candidate peer.
 * A peer starts receiving at 20 m or closer and stops only beyond 24 m. When more peers qualify than `maxN`, the
 * nearest win, with a 1 m bonus for peers already receiving.
 */
export function selectAudioPeers(distances: Record<string, number>, current: ReadonlySet<string>, maxN: number): Set<string> {
  const ranked: { id: string; rank: number }[] = [];
  for (const id of Object.keys(distances)) {
    const d = distances[id];
    const sending = current.has(id);
    if (!(d <= VOICE_RANGE || (sending && d <= VOICE_STOP))) continue;
    ranked.push({ id, rank: d - (sending ? STICKY : 0) });
  }
  ranked.sort((a, b) => a.rank - b.rank || (a.id < b.id ? -1 : 1));
  return new Set(ranked.slice(0, Math.max(0, Math.floor(maxN))).map((r) => r.id));
}

/**
 * Reads the speaking flag of an incoming 'vc' message ({ s: 0 | 1 }). Returns null for anything malformed.
 */
export function parseVc(data: unknown): boolean | null {
  if (!data || typeof data !== 'object') return null;
  const s = (data as { s?: unknown }).s;
  if (s === 1) return true;
  if (s === 0) return false;
  return null;
}
