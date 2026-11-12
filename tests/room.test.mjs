import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
after(() => vite.close());
const { generateSecret, parseSecret, deriveRoom, readHashSecret, inviteUrl } = await vite.ssrLoadModule('/src/net/room.ts');

const B64URL = /^[A-Za-z0-9_-]+$/;

test('generateSecret: 22 base64url characters, different on every call', () => {
  const a = generateSecret();
  const b = generateSecret();
  assert.equal(a.length, 22);
  assert.match(a, B64URL);
  assert.notEqual(a, b);
  assert.equal(parseSecret(a), a);
});

test('parseSecret accepts valid secrets and rejects short, long, bad characters and non-strings', () => {
  assert.equal(parseSecret('abcdefghijklmnop'), 'abcdefghijklmnop');
  assert.equal(parseSecret('a'.repeat(64)), 'a'.repeat(64));
  assert.equal(parseSecret('A-b_c-D-e_F-g_H-i'), 'A-b_c-D-e_F-g_H-i');
  assert.equal(parseSecret('a'.repeat(15)), null);
  assert.equal(parseSecret('a'.repeat(65)), null);
  assert.equal(parseSecret('abcdefghijklmno+'), null);
  assert.equal(parseSecret('abcdefghijklmno='), null);
  assert.equal(parseSecret('abcdefghijklmn o'), null);
  assert.equal(parseSecret('../../../etc/passwd!!'), null);
  assert.equal(parseSecret(undefined), null);
  assert.equal(parseSecret(null), null);
  assert.equal(parseSecret(12345678901234567890), null);
  assert.equal(parseSecret(['abcdefghijklmnop']), null);
  assert.equal(parseSecret({ toString: () => 'abcdefghijklmnop' }), null);
});

test('deriveRoom is deterministic, and different secrets give different room ids and passwords', async () => {
  const s1 = generateSecret();
  const s2 = generateSecret();
  const a = await deriveRoom(s1);
  const b = await deriveRoom(s1);
  const c = await deriveRoom(s2);
  assert.deepEqual(a, b);
  assert.notEqual(a.roomId, c.roomId);
  assert.notEqual(a.password, c.password);
});

test('deriveRoom: roomId is p- plus 24 hex characters, and neither value contains the secret', async () => {
  const secret = generateSecret();
  const { roomId, password } = await deriveRoom(secret);
  assert.match(roomId, /^p-[0-9a-f]{24}$/);
  assert.match(password, B64URL);
  assert.equal(password.length, 43);
  assert.ok(!roomId.includes(secret));
  assert.ok(!password.includes(secret));
  assert.notEqual(roomId, 'world');
});

test('deriveRoom refuses an invalid secret', async () => {
  await assert.rejects(() => deriveRoom('short'));
  await assert.rejects(() => deriveRoom(42));
});

test('readHashSecret reads #r= and #room=, and ignores garbage and empty fragments', () => {
  const secret = 'abcdefghijklmnop';
  assert.equal(readHashSecret({ hash: `#r=${secret}` }), secret);
  assert.equal(readHashSecret({ hash: `#room=${secret}` }), secret);
  assert.equal(readHashSecret({ hash: `r=${secret}` }), secret);
  assert.equal(readHashSecret({ hash: '#r=short' }), null);
  assert.equal(readHashSecret({ hash: '#r=' }), null);
  assert.equal(readHashSecret({ hash: '#garbage' }), null);
  assert.equal(readHashSecret({ hash: '#%%%&&&===' }), null);
  assert.equal(readHashSecret({ hash: '#' }), null);
  assert.equal(readHashSecret({ hash: '' }), null);
});

test('inviteUrl puts the secret in the fragment only, with the base path and no query string', () => {
  const secret = generateSecret();
  const url = inviteUrl(secret, 'https://example.test', '/nongkrong-3d/');
  assert.equal(url, `https://example.test/nongkrong-3d/#r=${secret}`);
  assert.ok(!url.includes('?'));
});
