/**
 * Private rooms. A random secret in the invite link (`#r=<secret>`) decides the Trystero room id and the
 * signalling password. Relays only see a hash of the id and ciphertext, never the secret or a readable name.
 * Pure: no DOM, no storage. Node tests can load it directly.
 */

const SECRET_RE = /^[A-Za-z0-9_-]{16,64}$/;

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A new room secret: 16 random bytes, base64url (22 characters). */
export function generateSecret(): string {
  return toBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(16)));
}

/** The secret if `s` is a string of 16 to 64 base64url characters, else null. */
export function parseSecret(s: unknown): string | null {
  return typeof s === 'string' && SECRET_RE.test(s) ? s : null;
}

/**
 * The room id ('p-' plus 24 hex characters of SHA-256 over the secret) and the password (base64url of a
 * second SHA-256 over the secret). The raw secret is never used as-is. Throws for an invalid secret.
 */
export async function deriveRoom(secret: string): Promise<{ roomId: string; password: string }> {
  if (!parseSecret(secret)) throw new Error('invalid room secret');
  const subtle = globalThis.crypto.subtle;
  const enc = new TextEncoder();
  const id = new Uint8Array(await subtle.digest('SHA-256', enc.encode(`nongkrong-room-id:${secret}`)));
  const key = new Uint8Array(await subtle.digest('SHA-256', enc.encode(`nongkrong-room-key:${secret}`)));
  return { roomId: `p-${toHex(id).slice(0, 24)}`, password: toBase64Url(key) };
}

/** The room secret in the URL fragment (`#r=` or `#room=`), or null. Garbage and empty fragments give null. */
export function readHashSecret(loc: { hash: string }): string | null {
  const raw = (loc.hash ?? '').replace(/^#/, '');
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  return parseSecret(params.get('r') ?? params.get('room'));
}

/** The invite link: origin, app base path and the secret in the fragment. No query string. */
export function inviteUrl(secret: string, origin: string, baseUrl: string): string {
  return `${origin}${baseUrl}#r=${secret}`;
}
