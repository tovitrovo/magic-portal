// ══════════════════════════════════════════════════════
// INDICADORES DO CONSOLE ADMIN
// ══════════════════════════════════════════════════════
//
// Funções puras (sem rede) que transformam o que o console já carrega em
// respostas de gestão: quanto sobrou, quem largou o carrinho, que carta o
// pessoal quer. Compartilhadas entre a UI e os testes.

import { pickTier } from './individualPricing.js';
import { isPaid } from './orderStatus.js';

const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** 'AAAA-MM' de uma data (no fuso de quem está olhando). */
export function monthKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(key) {
  const [y, m] = String(key).split('-').map(Number);
  if (!y || !m) return '';
  const name = new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long' });
  return `${name} de ${y}`;
}

/**
 * Custo estimado de UMA carta em R$: o custo da faixa do fornecedor (USD)
 * pelo volume do pedido, convertido pelo dólar informado. É a mesma faixa que
 * forma o preço (preço = custo × multiplicador × dólar), sem o multiplicador.
 */
export function estimateCardCostBrl(orderQty, tiers, fxRate) {
  const tier = pickTier(orderQty, tiers);
  if (!tier) return 0;
  return num(tier.usd_per_card) * num(fxRate);
}

const paidAtOf = b => b.confirmed_at || b.created_at || null;

/**
 * Resumo financeiro de um mês, a partir dos pedidos agrupados
 * (groupBatchesIntoOrders). Conta só lotes PAGOS cujo pagamento caiu no mês.
 *
 * - receita das cartas: subtotal travado no pagamento (sem frete);
 * - frete: o que o cliente pagou de frete (repasse para o MandaBem);
 * - custo: estimado pela faixa do fornecedor e pelo dólar informado;
 * - lucro: receita das cartas − custo. Não desconta a taxa do Mercado Pago.
 */
export function profitSummary(orders, { tiers = [], fxRate = 0, month = monthKey(new Date()) } = {}) {
  let revenueCards = 0, shipping = 0, qty = 0, cost = 0;
  const orderIds = new Set();
  (orders || []).forEach(order => {
    const paid = (order.batches || []).filter(isPaid);
    if (!paid.length) return;
    // A faixa do fornecedor é a do pedido inteiro (adições viajam juntas).
    const orderQty = paid.reduce((s, b) => s + num(b.qty_in_batch), 0);
    const unitCost = estimateCardCostBrl(orderQty, tiers, fxRate);
    paid.forEach(b => {
      if (monthKey(paidAtOf(b)) !== month) return;
      const ship = num(b.shipping_locked);
      const sub = b.subtotal_locked != null ? num(b.subtotal_locked) : Math.max(0, num(b.total_locked) - ship);
      const q = num(b.qty_in_batch);
      revenueCards += sub; shipping += ship; qty += q; cost += q * unitCost;
      orderIds.add(String(order.orderId ?? order.id));
    });
  });
  const profit = revenueCards - cost;
  const count = orderIds.size;
  return {
    month,
    orders: count,
    qty,
    revenueCards: round2(revenueCards),
    shipping: round2(shipping),
    total: round2(revenueCards + shipping),
    cost: round2(cost),
    profit: round2(profit),
    margin: revenueCards > 0 ? profit / revenueCards : 0,
    avgTicket: count ? round2((revenueCards + shipping) / count) : 0,
  };
}

/** Recompra e conversão, a partir da lista de clientes do console. */
export function customerStats(clients) {
  const list = clients || [];
  const registered = list.length;
  const buyers = list.filter(c => (c.orders || []).some(o => (o.paidBatches || []).length > 0));
  const repeat = buyers.filter(c => (c.orders || []).filter(o => (o.paidBatches || []).length > 0).length >= 2);
  return {
    registered,
    buyers: buyers.length,
    repeatBuyers: repeat.length,
    repeatRate: buyers.length ? repeat.length / buyers.length : 0,
    conversion: registered ? buyers.length / registered : 0,
  };
}

/**
 * Carrinhos parados: itens ainda no carrinho (in_cart, sem lote) agrupados
 * por pedido-rascunho. `rows` vem de /api/admin-insights { action:'carts' }.
 */
export function abandonedCarts(rows, { minCards = 15, now = Date.now() } = {}) {
  const byOrder = new Map();
  (rows || []).forEach(r => {
    const order = r.orders || {};
    const key = String(order.id || r.order_id || '');
    if (!key) return;
    if (!byOrder.has(key)) {
      const p = order.profiles || {};
      byOrder.set(key, { orderId: key, userId: order.user_id || null, name: p.name || '—', whatsapp: p.whatsapp || '', email: p.email || '', qty: 0, lines: [], lastAddedAt: null });
    }
    const cart = byOrder.get(key);
    const q = Math.max(0, Math.floor(num(r.quantity)));
    cart.qty += q;
    cart.lines.push({ name: r.cards?.name || 'Carta', type: r.cards?.type || 'Normal', qty: q });
    if (r.created_at && (!cart.lastAddedAt || r.created_at > cart.lastAddedAt)) cart.lastAddedAt = r.created_at;
  });
  return [...byOrder.values()]
    .filter(c => c.qty > 0)
    .map(c => ({
      ...c,
      missing: Math.max(0, minCards - c.qty),
      idleDays: c.lastAddedAt ? Math.max(0, Math.floor((now - Date.parse(c.lastAddedAt)) / 86400000)) : null,
    }))
    // Quem está mais perto de fechar vem primeiro: é a venda mais fácil.
    .sort((a, b) => a.missing - b.missing || b.qty - a.qty);
}

/** Mensagem pronta para cobrar o carrinho parado pelo WhatsApp. */
export function cartReminderMessage(cart) {
  const first = String(cart?.name || '').trim().split(/\s+/)[0] || 'tudo bem';
  const qty = cart?.qty || 0;
  const tail = cart?.missing > 0
    ? `Faltam só ${cart.missing} carta${cart.missing !== 1 ? 's' : ''} para fechar o pedido.`
    : 'Ele já pode ser fechado — é só entrar e pagar.';
  return `Oi, ${first}! Vi que você deixou ${qty} carta${qty !== 1 ? 's' : ''} no carrinho do Cartas para Jogar. ${tail} Posso ajudar em alguma coisa?`;
}

/**
 * Demanda da lista de desejos por carta. `rows` vem de
 * /api/admin-insights { action:'wishlist' }. Conta só o que ainda falta
 * (quantidade desejada − já comprada pelo portal).
 */
export function wishlistDemand(rows, { now = Date.now(), newDays = 7 } = {}) {
  const byCard = new Map();
  (rows || []).forEach(r => {
    const missing = Math.max(0, Math.floor(num(r.quantity) - num(r.acquired_qty)));
    if (!missing || !r.card_id) return;
    if (!byCard.has(r.card_id)) {
      const c = r.cards || {};
      byCard.set(r.card_id, { cardId: r.card_id, name: c.name || 'Carta', type: c.type || 'Normal', imageUrl: c.image_url || null, isActive: c.is_active !== false, createdAt: c.created_at || null, wanted: 0, people: [] });
    }
    const card = byCard.get(r.card_id);
    card.wanted += missing;
    card.people.push({ userId: r.user_id, name: r.profiles?.name || '—', whatsapp: r.profiles?.whatsapp || '', missing });
  });
  const cutoff = now - newDays * 86400000;
  return [...byCard.values()]
    .map(c => ({ ...c, peopleCount: c.people.length, isNew: !!c.createdAt && Date.parse(c.createdAt) >= cutoff }))
    .sort((a, b) => b.peopleCount - a.peopleCount || b.wanted - a.wanted || a.name.localeCompare(b.name));
}

/** Mensagem para avisar quem desejava uma carta que está disponível. */
export function wishAvailableMessage(person, card) {
  const first = String(person?.name || '').trim().split(/\s+/)[0] || 'tudo bem';
  return `Oi, ${first}! A ${card?.name || 'carta'} que está na sua lista de desejos está disponível no Cartas para Jogar. Quer garantir a sua?`;
}

// ── Exportação ──────────────────────────────────────────────────────────

// Planilha brasileira: separador ";" e vírgula decimal, que é o que o Excel
// em português abre sem pedir importação.
const csvCell = v => {
  const s = v == null ? '' : String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const brNum = n => num(n).toFixed(2).replace('.', ',');

export const ORDER_CSV_COLUMNS = ['Pedido', 'Lote', 'Data', 'Pago em', 'Cliente', 'Email', 'WhatsApp', 'Status', 'Cartas', 'Cartas (R$)', 'Frete (R$)', 'Total (R$)', 'Envio', 'Rastreio'];

/**
 * Uma linha por LOTE (é como o dinheiro entrou), com o pedido ao lado para
 * agrupar. `orders` são os pedidos do console; `stageOf(batch)` dá o rótulo.
 * `from`/`to` (Date ou string ISO) filtram pela data do lote, inclusive.
 */
export function ordersCsv(orders, { stageOf = () => '', from = null, to = null } = {}) {
  const fromT = from ? Date.parse(from) : -Infinity;
  const toT = to ? Date.parse(to) : Infinity;
  const date = v => (v ? new Date(v).toLocaleDateString('pt-BR') : '');
  const lines = [ORDER_CSV_COLUMNS.join(';')];
  (orders || []).forEach(o => {
    (o.batches || []).forEach(b => {
      const t = Date.parse(b.created_at || o.createdAt || 0);
      if (!(t >= fromT && t <= toT)) return;
      const ship = num(b.shipping_locked);
      const sub = b.subtotal_locked != null ? num(b.subtotal_locked) : Math.max(0, num(b.total_locked) - ship);
      lines.push([
        o.shortId || String(o.orderId || '').slice(0, 8).toUpperCase(),
        String(b.id || '').slice(0, 8).toUpperCase(),
        date(b.created_at),
        isPaid(b) ? date(b.confirmed_at || b.created_at) : '',
        o.clientName || '',
        o.clientEmail || '',
        o.clientWhatsapp || '',
        stageOf(b),
        num(b.qty_in_batch),
        brNum(sub),
        brNum(ship),
        brNum(b.total_locked),
        b.shipping_service || '',
        b.mandabem_rastreamento || '',
      ].map(csvCell).join(';'));
    });
  });
  // BOM: sem ele o Excel lê acento como lixo.
  return '﻿' + lines.join('\r\n');
}
