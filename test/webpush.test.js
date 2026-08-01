import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

// As Functions rodam em runtime de Worker, onde `crypto`/`atob`/`btoa` são
// globais. No Node precisamos garantir os mesmos globais antes de importar.
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const { encryptPayload, buildVapidHeader, bytesToB64url, b64urlToBytes } = await import('../functions/api/_webpush.js');

const utf8 = (s) => new TextEncoder().encode(s);

function concat(...chunks) {
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

/** Simula uma subscription de navegador: par ECDH + auth secret. */
async function makeSubscription() {
  const keys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey));
  const authSecret = crypto.getRandomValues(new Uint8Array(16));
  return { keys, publicRaw, authSecret, p256dh: bytesToB64url(publicRaw), auth: bytesToB64url(authSecret) };
}

/** Decifra o corpo aes128gcm do lado do "navegador" (RFC 8291 §3.4). */
async function decryptAsClient(body, sub) {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const serverPublicRaw = body.slice(21, 21 + idlen);
  const ciphertext = body.slice(21 + idlen);

  const serverPublic = await crypto.subtle.importKey('raw', serverPublicRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: serverPublic }, sub.keys.privateKey, 256));

  const prkInfo = concat(utf8('WebPush: info\0'), sub.publicRaw, serverPublicRaw);
  const ikm = await hkdf(sub.authSecret, shared, prkInfo, 32);
  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12);

  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aesKey, ciphertext));
  // Remove o delimitador de registro (0x02) do fim.
  return new TextDecoder().decode(plain.slice(0, plain.length - 1));
}

test('encryptPayload gera um corpo aes128gcm que o navegador consegue decifrar', async () => {
  const sub = await makeSubscription();
  const message = JSON.stringify({ type: 'NEW_ORDER', title: '🛒 Pedido novo', body: 'Fulano · 20 cartas' });

  const body = await encryptPayload(message, sub.p256dh, sub.auth);

  // Cabeçalho: salt(16) + record size(4) + idlen(1) + chave pública(65)
  assert.equal(body[20], 65, 'o keyid deve ter 65 bytes (ponto não comprimido)');
  assert.equal(new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(16, false), 4096);
  assert.ok(body.length > 21 + 65, 'deve haver ciphertext depois do cabeçalho');

  assert.equal(await decryptAsClient(body, sub), message);
});

test('cada envio usa salt e chave efêmera novos', async () => {
  const sub = await makeSubscription();
  const a = await encryptPayload('oi', sub.p256dh, sub.auth);
  const b = await encryptPayload('oi', sub.p256dh, sub.auth);
  assert.notDeepEqual(a.slice(0, 16), b.slice(0, 16), 'salt não pode se repetir');
  assert.notDeepEqual(a.slice(21, 86), b.slice(21, 86), 'a chave efêmera não pode se repetir');
});

test('buildVapidHeader assina um JWT ES256 verificável com a chave pública', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const vapid = { publicKey: bytesToB64url(publicRaw), privateKey: jwk.d, subject: 'mailto:teste@exemplo.com' };

  const header = await buildVapidHeader('https://fcm.googleapis.com/fcm/send/abc123', vapid);
  const match = /^vapid t=([^,]+), k=(.+)$/.exec(header);
  assert.ok(match, 'formato do header Authorization');
  assert.equal(match[2], vapid.publicKey);

  const [h, p, s] = match[1].split('.');
  const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p)));
  assert.equal(payload.aud, 'https://fcm.googleapis.com', 'aud é só a origem do endpoint');
  assert.equal(payload.sub, vapid.subject);
  assert.ok(payload.exp > Math.floor(Date.now() / 1000), 'exp no futuro');
  assert.ok(payload.exp <= Math.floor(Date.now() / 1000) + 24 * 60 * 60, 'exp dentro das 24h do RFC 8292');

  const verifyKey = await crypto.subtle.importKey('raw', publicRaw, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifyKey, b64urlToBytes(s), utf8(`${h}.${p}`));
  assert.ok(valid, 'assinatura ES256 válida');
});

test('base64url faz round-trip sem padding', () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
  const encoded = bytesToB64url(bytes);
  assert.ok(!encoded.includes('=') && !encoded.includes('+') && !encoded.includes('/'));
  assert.deepEqual(b64urlToBytes(encoded), bytes);
});
