// ──────────────────────────────────────────────────────────────
// STATUS DO ENVIO NO MANDABEM → fase do rastreio
//
// O MandaBem devolve o status como texto livre ("Postado", "Objeto em
// trânsito", "Entregue", "Aguardando retirada"...). O rastreio automático só
// precisa saber em que fase a remessa está para decidir duas coisas: se o
// pedido vira "Entregue" sozinho e se vale um push para o admin.
// ──────────────────────────────────────────────────────────────

export const SHIPMENT_PHASES = {
  PENDING: 'PENDING',       // etiqueta gerada, ainda não postado
  POSTED: 'POSTED',         // postado / em trânsito / saiu para entrega
  DELIVERED: 'DELIVERED',
  PROBLEM: 'PROBLEM',       // devolvido, extraviado, aguardando retirada...
  UNKNOWN: 'UNKNOWN',
};

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Ordem importa: "não entregue" e "tentativa de entrega" são problema, não entrega.
const PROBLEM_RE = /(nao entregue|tentativa|devolv|extravi|roubad|furtad|avaria|danificad|retirada|recusad|incorret|insuficiente|ausente|sinistro|problema|bloquead|fiscaliza|atrasad|nao localizad|cancelad)/;
const DELIVERED_RE = /entregue/;
const POSTED_RE = /(postad|transito|encaminhad|saiu para entrega|em rota|recebido na unidade|coletad|despachad|em transferencia|chegou)/;
const PENDING_RE = /(aguardando|gerad|pendente|emitid|criad|pago|processando)/;

/** Fase de um texto de status do MandaBem. */
export function shipmentPhase(status) {
  const s = norm(status);
  if (!s) return SHIPMENT_PHASES.UNKNOWN;
  if (PROBLEM_RE.test(s)) return SHIPMENT_PHASES.PROBLEM;
  if (DELIVERED_RE.test(s)) return SHIPMENT_PHASES.DELIVERED;
  if (POSTED_RE.test(s)) return SHIPMENT_PHASES.POSTED;
  if (PENDING_RE.test(s)) return SHIPMENT_PHASES.PENDING;
  return SHIPMENT_PHASES.UNKNOWN;
}

const EVENT_BY_PHASE = {
  POSTED: 'SHIPMENT_POSTED',
  DELIVERED: 'SHIPMENT_DELIVERED',
  PROBLEM: 'SHIPMENT_PROBLEM',
};

/**
 * Evento de notificação para uma mudança de status, ou null.
 * Só a troca de FASE notifica: "Em trânsito" → "Saiu para entrega" é a mesma
 * fase e não vira push. Um problema notifica a cada texto novo (podem ser
 * problemas diferentes).
 */
export function trackingEventFor(previousStatus, nextStatus) {
  if (norm(previousStatus) === norm(nextStatus)) return null;
  const prev = shipmentPhase(previousStatus);
  const next = shipmentPhase(nextStatus);
  if (next === SHIPMENT_PHASES.PROBLEM) return EVENT_BY_PHASE.PROBLEM;
  if (prev === next) return null;
  return EVENT_BY_PHASE[next] || null;
}
