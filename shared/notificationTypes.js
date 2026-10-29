// ──────────────────────────────────────────────────────────────
// TIPOS DE NOTIFICAÇÃO DO ADMIN — fonte única
//
// Cada evento gravado em `app_notifications` pertence a uma categoria, e cada
// categoria é uma preferência por aparelho em `push_subscriptions` (uma
// coluna booleana). O servidor usa isso para filtrar quem recebe o push; o
// console usa para montar os interruptores e os ícones do feed.
// ──────────────────────────────────────────────────────────────

export const NOTIFICATION_CATEGORIES = [
  {
    key: 'newOrders',
    column: 'notify_new_orders',
    label: 'Pedidos e pagamentos',
    hint: 'Pedido novo, pagamento confirmado, pedido bônus',
    types: ['NEW_ORDER', 'ORDER_PAID', 'BONUS_ORDER'],
  },
  {
    key: 'shipping',
    column: 'notify_shipping',
    label: 'Envios e rastreio',
    hint: 'Etiqueta gerada, postado, entregue, troca de endereço',
    types: ['SHIPMENT_LABEL', 'SHIPMENT_POSTED', 'SHIPMENT_DELIVERED', 'ADDRESS_CHANGED'],
  },
  {
    key: 'alerts',
    column: 'notify_alerts',
    label: 'Cancelamentos e falhas',
    hint: 'Cancelado, pagamento recusado/estornado, problema na entrega, erros',
    types: ['ORDER_CANCELLED', 'PAYMENT_FAILED', 'SHIPMENT_PROBLEM', 'SYSTEM_ERROR'],
  },
  {
    key: 'digest',
    column: 'notify_digest',
    label: 'Resumo diário',
    hint: 'Um push de manhã com vendas e pendências',
    types: ['DAILY_DIGEST'],
  },
  {
    key: 'logins',
    column: 'notify_logins',
    label: 'Logins e novas contas',
    hint: 'Cliente entrou ou criou conta',
    types: ['LOGIN', 'SIGNUP'],
  },
];

export const NOTIFICATION_TYPES = NOTIFICATION_CATEGORIES.flatMap(c => c.types);

const categoryByType = new Map(NOTIFICATION_CATEGORIES.flatMap(c => c.types.map(t => [t, c])));

/** Categoria de um tipo de evento (ou null para tipos fora do catálogo, ex. TEST). */
export function categoryOfType(type) {
  return categoryByType.get(String(type || '').toUpperCase()) || null;
}

/** Preferências padrão de um aparelho novo: tudo ligado. */
export function defaultPushPrefs() {
  return Object.fromEntries(NOTIFICATION_CATEGORIES.map(c => [c.key, true]));
}

/** Linha de `push_subscriptions` → `{ newOrders, shipping, ... }`. Coluna ausente conta como ligada. */
export function prefsFromRow(row) {
  return Object.fromEntries(NOTIFICATION_CATEGORIES.map(c => [c.key, row?.[c.column] !== false]));
}

/** `{ newOrders, ... }` → colunas de `push_subscriptions`. Só inclui chaves booleanas presentes. */
export function rowFromPrefs(prefs = {}) {
  const row = {};
  for (const c of NOTIFICATION_CATEGORIES) {
    if (typeof prefs[c.key] === 'boolean') row[c.column] = prefs[c.key];
  }
  return row;
}
