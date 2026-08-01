/**
 * Notificações push do painel admin (Web Push + PWA).
 *
 * Fluxo: registra o service worker → pede permissão → cria a subscription com
 * a chave VAPID do servidor → guarda no banco via /api/push-subscribe.
 *
 * Regras de plataforma que valem a pena lembrar:
 *   - iOS/iPadOS só entrega push quando o site foi adicionado à tela de início
 *     (Safari 16.4+). No navegador comum a API nem aparece.
 *   - A permissão só pode ser pedida a partir de um gesto do usuário.
 */

const SW_PATH = '/sw.js';

export const PUSH_UNSUPPORTED = 'unsupported';
export const PUSH_NEEDS_INSTALL = 'needs-install';

/** O app está rodando como PWA instalado? */
export function isStandalone() {
  if (typeof window === 'undefined') return false;
  return Boolean(
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
    window.navigator.standalone
  );
}

export function isIos() {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** Suporte real a push neste aparelho/contexto. */
export function pushSupport() {
  if (typeof window === 'undefined') return { ok: false, reason: PUSH_UNSUPPORTED };
  const hasApi = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (!hasApi) {
    // No iPhone a API só existe dentro do PWA instalado — vale orientar.
    if (isIos() && !isStandalone()) return { ok: false, reason: PUSH_NEEDS_INSTALL };
    return { ok: false, reason: PUSH_UNSUPPORTED };
  }
  if (isIos() && !isStandalone()) return { ok: false, reason: PUSH_NEEDS_INSTALL };
  return { ok: true, reason: null };
}

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register(SW_PATH, { scope: '/' });
  } catch (e) {
    console.warn('[push] falha ao registrar service worker:', e);
    return null;
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

function bufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return window.btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function serializeSubscription(sub) {
  return {
    endpoint: sub.endpoint,
    keys: {
      p256dh: bufferToBase64Url(sub.getKey('p256dh')),
      auth: bufferToBase64Url(sub.getKey('auth')),
    },
  };
}

async function api(path, token, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

/** Chave pública VAPID do servidor (null se o push não estiver configurado). */
export async function fetchPublicKey() {
  const res = await fetch('/api/push-config');
  const json = await res.json().catch(() => ({}));
  return json?.enabled ? json.publicKey : null;
}

/** Estado atual deste aparelho, sem pedir permissão nem criar subscription. */
export async function getPushState(token) {
  const support = pushSupport();
  const base = {
    supported: support.ok,
    reason: support.reason,
    permission: typeof Notification !== 'undefined' ? Notification.permission : 'default',
    subscribed: false,
    endpoint: null,
    prefs: { newOrders: true, logins: true },
    serverConfigured: true,
  };
  if (!support.ok) return base;

  const publicKey = await fetchPublicKey().catch(() => null);
  base.serverConfigured = Boolean(publicKey);

  const reg = await navigator.serviceWorker.getRegistration(SW_PATH).catch(() => null);
  const sub = reg ? await reg.pushManager.getSubscription().catch(() => null) : null;
  if (!sub) return base;

  base.endpoint = sub.endpoint;
  if (!token) return base;

  try {
    const { subscription } = await api('/api/push-subscribe', token, { action: 'status', endpoint: sub.endpoint });
    if (subscription) {
      base.subscribed = true;
      base.prefs = {
        newOrders: subscription.notify_new_orders !== false,
        logins: subscription.notify_logins !== false,
      };
    }
  } catch (e) {
    console.warn('[push] falha ao consultar status:', e);
  }
  return base;
}

/**
 * Ativa as notificações neste aparelho. Precisa ser chamada a partir de um
 * clique — os navegadores rejeitam `requestPermission` fora de gesto.
 */
export async function enablePush(token, prefs = {}) {
  const support = pushSupport();
  if (!support.ok) {
    throw new Error(
      support.reason === PUSH_NEEDS_INSTALL
        ? 'No iPhone, adicione o site à tela de início e abra por lá para ativar as notificações.'
        : 'Este navegador não suporta notificações push.'
    );
  }

  const publicKey = await fetchPublicKey();
  if (!publicKey) throw new Error('Push não configurado no servidor (chaves VAPID ausentes).');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Permissão de notificação negada no aparelho.');

  const reg = (await registerServiceWorker()) || (await navigator.serviceWorker.ready);
  await navigator.serviceWorker.ready;

  let sub = await reg.pushManager.getSubscription();
  if (sub) {
    // Chave VAPID trocada no servidor: a subscription antiga não serve mais.
    const current = sub.options?.applicationServerKey
      ? bufferToBase64Url(sub.options.applicationServerKey)
      : null;
    if (current && current !== publicKey) {
      await sub.unsubscribe().catch(() => {});
      sub = null;
    }
  }
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  const { subscription } = await api('/api/push-subscribe', token, {
    action: 'subscribe',
    subscription: serializeSubscription(sub),
    prefs: { newOrders: prefs.newOrders !== false, logins: prefs.logins !== false },
    deviceLabel: isStandalone() ? 'App instalado' : 'Navegador',
  });

  return {
    endpoint: sub.endpoint,
    prefs: {
      newOrders: subscription?.notify_new_orders !== false,
      logins: subscription?.notify_logins !== false,
    },
  };
}

/** Desliga as notificações neste aparelho (remove do banco e do navegador). */
export async function disablePush(token) {
  const reg = await navigator.serviceWorker.getRegistration(SW_PATH).catch(() => null);
  const sub = reg ? await reg.pushManager.getSubscription().catch(() => null) : null;
  if (sub) {
    if (token) await api('/api/push-subscribe', token, { action: 'unsubscribe', endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
}

/** Atualiza quais eventos este aparelho recebe. */
export async function updatePushPrefs(token, endpoint, prefs) {
  if (!endpoint) return null;
  const { subscription } = await api('/api/push-subscribe', token, { action: 'update', endpoint, prefs });
  return subscription;
}

/** Dispara um push de teste para este aparelho. */
export async function sendTestPush(token, endpoint) {
  return api('/api/push-subscribe', token, { action: 'test', endpoint });
}

/** Avisa o servidor que um cliente entrou (gera notificação para o admin). */
export function reportAccess(token, type = 'LOGIN') {
  if (!token) return Promise.resolve(null);
  return fetch('/api/notify-event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ type }),
  })
    .then((r) => r.json().catch(() => ({})))
    .catch((e) => {
      console.warn('[push] falha ao registrar acesso:', e);
      return null;
    });
}
