// ──────────────────────────────────────────────────────────────
// ÁLBUM DE COLEÇÃO
//
// Quantas cópias de cada carta do catálogo o cliente tem. Duas fontes que
// não se misturam:
//   • comprado  — soma dos itens de lotes PAGOS dele. É fato, não se edita.
//   • extra     — o que ele marcou na mão (comprou fora do portal, ganhou,
//                 trocou). Mora em `collection_items.extra_qty`.
//
// O total é a soma das duas. Separar importa: a compra não pode sumir quando
// ele mexe no ajuste manual, e o ajuste não pode ser sobrescrito quando
// chega uma compra nova.
// ──────────────────────────────────────────────────────────────

import { isPaid } from './orderStatus.js';

const int = value => Math.max(0, Math.floor(Number(value) || 0));

/**
 * Soma por card_id o que veio de lotes pagos.
 * `items`: linhas de order_items com `{ card_id, quantity, order_batches }`,
 * ou já achatadas com `{ card_id, quantity, batch }`.
 */
export function boughtByCard(items) {
  const totals = new Map();
  for (const item of items || []) {
    const batch = item?.batch || item?.order_batches || null;
    // Sem lote não há pagamento: item solto é carrinho, não coleção.
    if (!batch || !isPaid(batch)) continue;
    // Carta bônus entra igual: o álbum é o que ele tem na mão, não o que pagou.
    const cardId = item?.card_id;
    if (!cardId) continue;
    totals.set(cardId, (totals.get(cardId) || 0) + int(item.quantity));
  }
  return totals;
}

/** Ajustes manuais indexados por card_id. */
export function extrasByCard(rows) {
  const totals = new Map();
  for (const row of rows || []) {
    if (!row?.card_id) continue;
    totals.set(row.card_id, int(row.extra_qty));
  }
  return totals;
}

/**
 * Junta catálogo, compras e ajustes numa lista pronta para a tela.
 * Cada entrada: `{ card, boughtQty, extraQty, ownedQty, owned }`.
 */
export function buildCollection({ cards, bought, extras }) {
  const boughtMap = bought instanceof Map ? bought : boughtByCard(bought);
  const extraMap = extras instanceof Map ? extras : extrasByCard(extras);
  return (cards || []).map(card => {
    const boughtQty = boughtMap.get(card.id) || 0;
    const extraQty = extraMap.get(card.id) || 0;
    const ownedQty = boughtQty + extraQty;
    return { card, boughtQty, extraQty, ownedQty, owned: ownedQty > 0 };
  });
}

/** Progresso do álbum: quantas cartas distintas e quantas cópias. */
export function collectionStats(entries) {
  const list = entries || [];
  const distinct = list.filter(e => e.owned).length;
  return {
    total: list.length,
    distinct,
    copies: list.reduce((sum, e) => sum + e.ownedQty, 0),
    percent: list.length ? Math.round((distinct / list.length) * 100) : 0,
  };
}
