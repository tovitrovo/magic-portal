// ──────────────────────────────────────────────────────────────
// STATUS DO PEDIDO — fonte única
//
// O banco guarda dois status por lote: `status` (o dinheiro: DRAFT →
// PENDING_PAYMENT → PAID/CONFIRMED, ou os finais ruins) e
// `fulfillment_status` (a logística: AWAITING_SUPPLIER_ORDER → ... →
// DELIVERED). Ler os dois separados espalhava a mesma regra pela tela do
// cliente e pelo console do admin, com rótulos que discordavam entre si.
//
// Aqui os dois viram UM estágio só, com rótulo, cor e posição na linha do
// tempo. A logística só começa a contar depois que o pagamento entra: um
// lote não pago está sempre em "Aguardando pagamento", não importa o que o
// fulfillment diga.
// ──────────────────────────────────────────────────────────────

/** Estágios em ordem cronológica. `index` é a posição na trilha do cliente. */
export const ORDER_STAGES = [
  { key: 'AWAITING_PAYMENT',      label: 'Aguardando pagamento', short: 'Pagamento',  color: 'var(--gold)', hint: 'Assim que o pagamento cair, a gente encomenda suas cartas.' },
  { key: 'PAID',                  label: 'Pagamento confirmado', short: 'Pago',       color: 'var(--ok)',   hint: 'Recebemos! Seu pedido entra na próxima compra no fornecedor.' },
  { key: 'ORDERED_FROM_SUPPLIER', label: 'Encomendado',          short: 'Encomendado',color: 'var(--indiv)',hint: 'Compramos suas cartas no fornecedor.' },
  { key: 'SHIPPED_TO_BR',         label: 'A caminho do Brasil',  short: 'A caminho',  color: 'var(--indiv)',hint: 'As cartas saíram do fornecedor rumo ao Brasil.' },
  { key: 'ARRIVED_BR',            label: 'Chegou no Brasil',     short: 'No Brasil',  color: 'var(--info)', hint: 'Chegaram por aqui. Falta separar e embalar.' },
  { key: 'PREPARING',             label: 'Em preparação',        short: 'Preparando', color: 'var(--info)', hint: 'Separando e embalando o seu pedido.' },
  { key: 'LABEL_GENERATED',       label: 'Enviado',              short: 'Enviado',    color: 'var(--ok)',   hint: 'Postado! Acompanhe pelo código de rastreio.' },
  { key: 'DELIVERED',             label: 'Entregue',             short: 'Entregue',   color: 'var(--ok)',   hint: 'Pedido entregue. Bom jogo!' },
];

/** Estágios de logística, na ordem em que o admin avança o pedido. */
export const FULFILLMENT_STAGES = ORDER_STAGES.filter(s => s.key !== 'AWAITING_PAYMENT' && s.key !== 'PAID');

/** Saídas terminais — o pedido não segue a trilha, para fora dela. */
export const TERMINAL_STAGES = {
  CANCELLED:   { key: 'CANCELLED',   label: 'Cancelado',  short: 'Cancelado',  color: 'var(--text-faint)', hint: 'Este pedido foi cancelado.' },
  FAILED:      { key: 'FAILED',      label: 'Pagamento recusado', short: 'Recusado', color: 'var(--danger)', hint: 'O pagamento não passou. Você pode fazer um pedido novo.' },
  REFUNDED:    { key: 'REFUNDED',    label: 'Reembolsado', short: 'Reembolsado', color: 'var(--danger)', hint: 'O valor foi devolvido.' },
  CHARGEDBACK: { key: 'CHARGEDBACK', label: 'Estornado',   short: 'Estornado',   color: 'var(--danger)', hint: 'A cobrança foi estornada pelo banco.' },
};

const PAID_BATCH_STATUSES = new Set(['PAID', 'PAID_CONFIRMED', 'CONFIRMED', 'APPROVED']);

const stageIndexByKey = new Map(ORDER_STAGES.map((s, i) => [s.key, i]));

/** O lote já foi pago (status do banco ou retorno aprovado do Mercado Pago). */
export function isPaid(batch) {
  const status = String(batch?.status || '').toUpperCase();
  const payment = String(batch?.payment_status || '').toLowerCase();
  return PAID_BATCH_STATUSES.has(status) || payment === 'approved';
}

/** Posição de um `fulfillment_status` na trilha. Desconhecido cai no primeiro. */
export function fulfillmentIndex(fulfillmentStatus) {
  const idx = stageIndexByKey.get(String(fulfillmentStatus || '').toUpperCase());
  return idx === undefined ? stageIndexByKey.get('ORDERED_FROM_SUPPLIER') - 1 : idx;
}

/**
 * Estágio atual de um lote, unificando dinheiro e logística.
 * Devolve `{ key, label, short, color, hint, index, terminal }`.
 * `index` é -1 nos terminais: eles não ocupam posição na trilha.
 */
export function resolveOrderStage(batch) {
  const status = String(batch?.status || '').toUpperCase();
  if (TERMINAL_STAGES[status]) return { ...TERMINAL_STAGES[status], index: -1, terminal: true };

  if (!isPaid(batch)) return { ...ORDER_STAGES[0], index: 0, terminal: false };

  // Pago: a trilha passa a ser a da logística. Um lote sem
  // `fulfillment_status` (banco antigo) para em "Pagamento confirmado".
  const raw = String(batch?.fulfillment_status || '').toUpperCase();
  if (!raw || raw === 'AWAITING_SUPPLIER_ORDER') return { ...ORDER_STAGES[1], index: 1, terminal: false };
  const idx = stageIndexByKey.get(raw);
  if (idx === undefined) return { ...ORDER_STAGES[1], index: 1, terminal: false };
  return { ...ORDER_STAGES[idx], index: idx, terminal: false };
}

/** Rótulo curto pronto para chip/tag. */
export function orderStageLabel(batch) {
  return resolveOrderStage(batch).label;
}

/**
 * Próximo estágio de logística que o admin pode aplicar, ou null no fim da
 * trilha. Um lote não pago não avança: pagar vem primeiro.
 */
export function nextFulfillmentStage(batch) {
  if (!isPaid(batch)) return null;
  const current = resolveOrderStage(batch);
  if (current.terminal) return null;
  const from = Math.max(current.index, 1);
  return ORDER_STAGES[from + 1] || null;
}

/** Estágio anterior de logística, ou null quando já está no começo da trilha. */
export function prevFulfillmentStage(batch) {
  if (!isPaid(batch)) return null;
  const current = resolveOrderStage(batch);
  if (current.terminal || current.index <= 2) return null;
  return ORDER_STAGES[current.index - 1] || null;
}

/**
 * Estágio do PEDIDO a partir de todos os seus lotes. O pedido anda no ritmo
 * do lote mais atrasado — dizer "enviado" com um lote ainda no fornecedor
 * seria mentira. Lotes terminais (cancelado, estornado) não seguram o pedido.
 */
export function resolveOrderStageFromBatches(batches) {
  const live = (batches || []).map(resolveOrderStage).filter(s => !s.terminal);
  if (live.length === 0) {
    const terminal = (batches || []).map(resolveOrderStage)[0];
    return terminal || { ...ORDER_STAGES[0], index: 0, terminal: false };
  }
  return live.reduce((slowest, s) => (s.index < slowest.index ? s : slowest));
}

/**
 * Agrupa lotes de pagamento em PEDIDOS. A conta do cliente e o console falam
 * em pedido; lote é detalhe de como o dinheiro entrou — quem adicionou cartas
 * a um pedido já pago tem dois lotes e uma remessa só.
 *
 * Cada pedido: `{ orderId, shortId, batches, qty, total, createdAt, stage,
 * tracking, trackingStatus }`, do mais recente para o mais antigo.
 */
export function groupBatchesIntoOrders(batches) {
  const byOrder = new Map();
  for (const batch of batches || []) {
    // Lote sem pedido é dado quebrado: cai num grupo próprio em vez de sumir.
    const key = String(batch?.order_id || batch?.id || '');
    if (!key) continue;
    if (!byOrder.has(key)) byOrder.set(key, []);
    byOrder.get(key).push(batch);
  }

  const time = b => Date.parse(b?.created_at || '') || 0;
  const orders = [];
  byOrder.forEach((rows, orderId) => {
    const sorted = [...rows].sort((a, b) => time(a) - time(b));
    const anchor = sorted[0];
    const tracked = sorted.find(b => b.mandabem_rastreamento || b.mandabem_etiqueta);
    orders.push({
      orderId,
      shortId: String(anchor.id).slice(0, 8).toUpperCase(),
      batches: sorted,
      qty: sorted.reduce((s, b) => s + (Number(b.qty_in_batch) || 0), 0),
      total: sorted.reduce((s, b) => s + (Number(b.total_locked) || 0), 0),
      createdAt: anchor.created_at,
      stage: resolveOrderStageFromBatches(sorted),
      tracking: tracked ? (tracked.mandabem_rastreamento || tracked.mandabem_etiqueta) : null,
      trackingStatus: tracked ? tracked.mandabem_status || null : null,
    });
  });

  return orders.sort((a, b) => (Date.parse(b.createdAt || '') || 0) - (Date.parse(a.createdAt || '') || 0));
}
