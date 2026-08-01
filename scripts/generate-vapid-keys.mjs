#!/usr/bin/env node
/**
 * Gera o par de chaves VAPID usado pelo Web Push.
 *
 *   node scripts/generate-vapid-keys.mjs
 *
 * Copie a saída para as variáveis de ambiente do projeto no Cloudflare Pages:
 *   VAPID_PUBLIC_KEY   (também vai para o navegador, via /api/push-config)
 *   VAPID_PRIVATE_KEY  (segredo — nunca commitar)
 *   VAPID_SUBJECT      (mailto: do responsável, ex: mailto:voce@exemplo.com)
 *
 * Trocar as chaves invalida as inscrições existentes: cada aparelho precisa
 * ativar as notificações de novo no painel.
 */
import { webcrypto } from 'node:crypto';

const b64url = (bytes) =>
  Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);

const publicRaw = new Uint8Array(await webcrypto.subtle.exportKey('raw', pair.publicKey));
const jwk = await webcrypto.subtle.exportKey('jwk', pair.privateKey);

console.log('VAPID_PUBLIC_KEY =', b64url(publicRaw));
console.log('VAPID_PRIVATE_KEY=', jwk.d);
console.log('VAPID_SUBJECT    = mailto:seu@email.com');
