/* Service worker do Cartas para Jogar (PWA).
 *
 * Escopo enxuto de propósito: recebe Web Push e abre o painel no clique.
 * Não faz cache offline — o app depende de dados ao vivo do Supabase, e um
 * cache mal calibrado deixaria pedidos/preços desatualizados na tela.
 */

const NOTIFICATION_ICON = '/icons/icon-192.png';
const NOTIFICATION_BADGE = '/icons/badge-72.png';

self.addEventListener('install', () => {
  // Ativa a versão nova sem esperar as abas antigas fecharem.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'Cartas para Jogar', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'Cartas para Jogar';
  const options = {
    body: payload.body || '',
    icon: NOTIFICATION_ICON,
    badge: NOTIFICATION_BADGE,
    // Agrupa por tipo: pedidos novos não somem atrás de um login.
    tag: payload.type ? `cpj-${payload.type}` : 'cpj',
    renotify: true,
    timestamp: payload.createdAt ? Date.parse(payload.createdAt) || Date.now() : Date.now(),
    data: { url: payload.url || '/?admin=notifications', ...(payload.data || {}) },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/?admin=notifications';

  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      if ('focus' in client) {
        // Já existe uma janela do app: foca e manda navegar internamente.
        client.postMessage({ type: 'NOTIFICATION_CLICK', url: target });
        return client.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  })());
});
