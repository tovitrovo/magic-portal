// ══════════════════════════════════════════════════════
// DESEJOS DE CARTAS QUE SAÍRAM DO CATÁLOGO
// ══════════════════════════════════════════════════════
//
// Importar o CSV com "desativar catálogo anterior" (ou a planilha recriar uma
// carta) deixa a carta antiga inativa e cria outra igual. O desejo do cliente
// ficava preso no registro antigo: em nov/2026 eram 471 desejos de 69
// clientes em cartas "fora do catálogo" que, na verdade, continuavam à venda.
//
// - Gêmea (mesmo nome normalizado + mesmo tipo): é a mesma carta. O desejo é
//   movido sozinho (checagem diária em _automation.js).
// - Alternativa (mesmo nome, OUTRO tipo): muda o que o cliente pediu e às
//   vezes o preço, então só é SUGERIDA na lista dele ("Tem em Foil, trocar?").

import { cardMatchKey } from './supplierSheet.js';

const time = (v) => Date.parse(v || '') || 0;

// Entre várias candidatas, a mais "viva": ligada à planilha, com foto, recente.
function rank(a, b) {
  return (Number(!!b.source_url) - Number(!!a.source_url))
    || (Number(!!b.image_url) - Number(!!a.image_url))
    || (time(b.created_at) - time(a.created_at));
}

/** Índice das cartas ATIVAS por nome normalizado. */
export function indexActiveCards(cards) {
  const byKey = new Map();
  for (const c of cards || []) {
    if (!c || c.is_active === false) continue;
    const k = cardMatchKey(c.name);
    if (!k) continue;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(c);
  }
  for (const list of byKey.values()) list.sort(rank);
  return byKey;
}

/** A gêmea ativa (mesmo nome e mesmo tipo) de uma carta, ou null. */
export function findTwin(card, index) {
  const list = index.get(cardMatchKey(card?.name)) || [];
  return list.find((c) => c.id !== card?.id && (c.type || 'Normal') === (card?.type || 'Normal')) || null;
}

/** Versões ativas da mesma carta em OUTRO tipo (para sugerir a troca). */
export function findAlternatives(card, index) {
  const list = index.get(cardMatchKey(card?.name)) || [];
  const seen = new Set();
  return list.filter((c) => {
    const t = c.type || 'Normal';
    if (c.id === card?.id || t === (card?.type || 'Normal') || seen.has(t)) return false;
    seen.add(t);
    return true;
  });
}

/**
 * Plano de movimentação. `rows`: desejos em cartas inativas, com a carta em
 * `cards`. `existing`: Set de "user_id|card_id" que o cliente já deseja.
 * Devolve [{ wishId, userId, targetId, mergeInto? }] — com mergeInto quando o
 * cliente já desejava a gêmea (junta ficando com a MAIOR quantidade).
 */
export function planWishlistMoves(rows, index, existing = new Set()) {
  const taken = new Set(existing);
  const plan = [];
  for (const r of rows || []) {
    const twin = findTwin(r.cards, index);
    if (!twin) continue;
    const key = `${r.user_id}|${twin.id}`;
    plan.push({ wishId: r.id, userId: r.user_id, targetId: twin.id, quantity: r.quantity, acquiredQty: r.acquired_qty, merge: taken.has(key) });
    taken.add(key);
  }
  return plan;
}

/**
 * Termo para buscar candidatas no banco (ilike): a palavra mais longa do nome.
 * Não usa o nome inteiro porque o catálogo mistura apóstrofo reto e curvo
 * ("Urza's" / "Urza’s"), número com e sem zero e sufixos de acabamento; quem
 * decide se é a mesma carta é cardMatchKey, depois.
 */
export function searchStem(name) {
  const words = String(name || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w.length >= 3 && !/^(foil|holo|mtg|proxy|cards?|the|and|of|english|regular|borderless)$/i.test(w) && !/^\d+$/.test(w));
  return words.sort((a, b) => b.length - a.length)[0] || '';
}
