/**
 * Web Push (VAPID + aes128gcm) sem dependências, usando só WebCrypto.
 *
 * Implementa:
 *   - RFC 8292 (VAPID): JWT ES256 assinado com a chave privada do servidor.
 *   - RFC 8291 (Message Encryption): ECDH P-256 + HKDF-SHA256 + AES-128-GCM.
 *
 * Chaves esperadas nas variáveis de ambiente (base64url, formato do
 * `web-push` clássico — gere com `node scripts/generate-vapid-keys.mjs`):
 *   VAPID_PUBLIC_KEY   — 65 bytes (ponto público não comprimido, 0x04...)
 *   VAPID_PRIVATE_KEY  — 32 bytes (escalar privado)
 *   VAPID_SUBJECT      — "mailto:voce@exemplo.com" ou a URL do site
 */

// ── base64url ────────────────────────────────────────────────
export function b64urlToBytes(str) {
  const s = String(str || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const bin = atob(s + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64url(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concat(...chunks) {
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

const utf8 = (s) => new TextEncoder().encode(s);

// ── VAPID (RFC 8292) ─────────────────────────────────────────
async function importVapidSigningKey(publicKeyB64, privateKeyB64) {
  const pub = b64urlToBytes(publicKeyB64);
  if (pub.length !== 65 || pub[0] !== 0x04) throw new Error("VAPID_PUBLIC_KEY inválida (esperado 65 bytes não comprimidos)");
  const jwk = {
    kty: "EC",
    crv: "P-256",
    x: bytesToB64url(pub.slice(1, 33)),
    y: bytesToB64url(pub.slice(33, 65)),
    d: bytesToB64url(b64urlToBytes(privateKeyB64)),
    ext: true,
  };
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

/** Monta o header `Authorization: vapid t=<jwt>, k=<publicKey>` para um endpoint. */
export async function buildVapidHeader(endpoint, { publicKey, privateKey, subject }) {
  const audience = new URL(endpoint).origin;
  const header = bytesToB64url(utf8(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = bytesToB64url(utf8(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60, // 12h (limite do RFC: 24h)
    sub: subject,
  })));
  const signingInput = `${header}.${payload}`;
  const key = await importVapidSigningKey(publicKey, privateKey);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, utf8(signingInput));
  return `vapid t=${signingInput}.${bytesToB64url(new Uint8Array(sig))}, k=${publicKey}`;
}

// ── Criptografia do payload (RFC 8291, aes128gcm) ────────────
async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

async function importClientPublicKey(p256dh) {
  const raw = b64urlToBytes(p256dh);
  return crypto.subtle.importKey("raw", raw, { name: "ECDH", namedCurve: "P-256" }, false, []);
}

/**
 * Cifra `plaintext` para a subscription do navegador.
 * Retorna o corpo binário no formato aes128gcm (RFC 8188).
 */
export async function encryptPayload(plaintext, p256dh, authSecret) {
  const clientPublic = await importClientPublicKey(p256dh);
  const serverKeys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const serverPublicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", serverKeys.publicKey));
  const clientPublicRaw = b64urlToBytes(p256dh);

  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: clientPublic }, serverKeys.privateKey, 256)
  );

  // IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info\0" || ua_public || as_public)
  const authBytes = b64urlToBytes(authSecret);
  const prkInfo = concat(utf8("WebPush: info\0"), clientPublicRaw, serverPublicRaw);
  const ikm = await hkdf(authBytes, sharedSecret, prkInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, utf8("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, utf8("Content-Encoding: nonce\0"), 12);

  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  // Registro único: plaintext + delimitador 0x02 (último registro).
  const record = concat(utf8(plaintext), new Uint8Array([0x02]));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, record)
  );

  // Header aes128gcm: salt(16) | record_size(4) | idlen(1) | keyid(65)
  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096, false);
  return concat(salt, recordSize, new Uint8Array([serverPublicRaw.length]), serverPublicRaw, ciphertext);
}

/**
 * Envia uma notificação push para uma subscription.
 *
 * @param {{endpoint:string,p256dh:string,auth:string}} subscription
 * @param {object|string} payload  objeto JSON (ou string) entregue ao service worker
 * @param {{publicKey:string,privateKey:string,subject:string}} vapid
 * @param {{ttl?:number,urgency?:string}} [options]
 * @returns {Promise<{ok:boolean,status:number,gone:boolean,error?:string}>}
 *          `gone: true` quando o endpoint expirou (404/410) e deve ser removido.
 */
export async function sendPush(subscription, payload, vapid, options = {}) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  try {
    const body = await encryptPayload(text, subscription.p256dh, subscription.auth);
    const authorization = await buildVapidHeader(subscription.endpoint, vapid);
    const res = await fetch(subscription.endpoint, {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(options.ttl ?? 86400),
        Urgency: options.urgency || "high",
      },
      body,
    });
    if (res.ok) return { ok: true, status: res.status, gone: false };
    const detail = await res.text().catch(() => "");
    return {
      ok: false,
      status: res.status,
      gone: res.status === 404 || res.status === 410,
      error: `${res.status} ${detail.slice(0, 160)}`,
    };
  } catch (e) {
    return { ok: false, status: 0, gone: false, error: String(e?.message || e) };
  }
}

/** Lê e valida as chaves VAPID do ambiente. Retorna null se não configurado. */
export function readVapidConfig(env) {
  const publicKey = String(env?.VAPID_PUBLIC_KEY || "").trim();
  const privateKey = String(env?.VAPID_PRIVATE_KEY || "").trim();
  if (!publicKey || !privateKey) return null;
  const subject = String(env?.VAPID_SUBJECT || "").trim() || "mailto:admin@cartasparajogar.com";
  return { publicKey, privateKey, subject };
}
