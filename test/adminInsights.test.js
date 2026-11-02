import test from 'node:test';
import assert from 'node:assert/strict';
import {
  abandonedCarts, cartReminderMessage, customerStats, estimateCardCostBrl, monthKey,
  ordersCsv, profitSummary, wishAvailableMessage, wishlistDemand,
} from '../shared/adminInsights.js';

const tiers = [
  { min_qty: 1, max_qty: 49, usd_per_card: 1.5 },
  { min_qty: 50, max_qty: null, usd_per_card: 1.0 },
];
const paid = (o) => ({ status: 'PAID', payment_status: 'approved', ...o });

test('o custo estimado usa a faixa do volume do pedido e o dólar', () => {
  assert.equal(estimateCardCostBrl(15, tiers, 5), 7.5);
  assert.equal(estimateCardCostBrl(60, tiers, 5), 5);
  assert.equal(estimateCardCostBrl(10, [], 5), 0, 'sem faixas não inventa custo');
});

test('o lucro do mês conta só lotes pagos no mês e separa o frete', () => {
  const orders = [
    { orderId: 'a', batches: [paid({ qty_in_batch: 20, subtotal_locked: 300, shipping_locked: 25, total_locked: 325, confirmed_at: '2026-11-03T12:00:00' })] },
    // Adição: a faixa é a do pedido inteiro (20 + 40 = 60 → US$ 1,00).
    { orderId: 'b', batches: [
      paid({ qty_in_batch: 20, subtotal_locked: 280, shipping_locked: 20, total_locked: 300, confirmed_at: '2026-10-30T12:00:00' }),
      paid({ qty_in_batch: 40, subtotal_locked: 520, shipping_locked: 0, total_locked: 520, confirmed_at: '2026-11-02T12:00:00' }),
    ] },
    { orderId: 'c', batches: [{ status: 'PENDING', qty_in_batch: 15, subtotal_locked: 200, total_locked: 220, created_at: '2026-11-04T12:00:00' }] },
  ];
  const s = profitSummary(orders, { tiers, fxRate: 5, month: '2026-11' });
  assert.equal(s.orders, 2);
  assert.equal(s.qty, 60);
  assert.equal(s.revenueCards, 820);
  assert.equal(s.shipping, 25);
  // 20 × 1,5 × 5 = 150 (pedido a) + 40 × 1,0 × 5 = 200 (adição do pedido b)
  assert.equal(s.cost, 350);
  assert.equal(s.profit, 470);
  assert.equal(s.avgTicket, 422.5);
  assert.ok(Math.abs(s.margin - 470 / 820) < 1e-9);
});

test('recompra e conversão', () => {
  const buyer = n => ({ orders: Array.from({ length: n }, () => ({ paidBatches: [{}] })) });
  const s = customerStats([buyer(1), buyer(2), buyer(3), { orders: [] }]);
  assert.equal(s.registered, 4);
  assert.equal(s.buyers, 3);
  assert.equal(s.repeatBuyers, 2);
  assert.equal(s.conversion, 0.75);
});

test('carrinhos parados: agrupa por rascunho e põe quem está perto do mínimo primeiro', () => {
  const now = Date.parse('2026-11-10T12:00:00Z');
  const row = (order, qty, created, name = 'Bolt') => ({ quantity: qty, created_at: created, cards: { name, type: 'Normal' }, orders: { id: order, user_id: 'u-' + order, profiles: { name: 'Ana Souza', whatsapp: '11999999999' } } });
  const carts = abandonedCarts([
    row('o1', 4, '2026-11-01T12:00:00Z'), row('o1', 3, '2026-11-07T12:00:00Z', 'Elves'),
    row('o2', 13, '2026-11-09T12:00:00Z'),
    row('o3', 0, '2026-11-09T12:00:00Z'),
  ], { minCards: 15, now });
  assert.deepEqual(carts.map(c => c.orderId), ['o2', 'o1'], 'carrinho zerado some; 2 faltando vem antes de 8');
  assert.equal(carts[1].qty, 7);
  assert.equal(carts[1].missing, 8);
  assert.equal(carts[1].idleDays, 3, 'conta a partir da última carta adicionada');
  assert.match(cartReminderMessage(carts[0]), /^Oi, Ana! .*13 cartas.*Faltam só 2 cartas/);
});

test('demanda de desejos conta só o que falta e marca carta nova', () => {
  const now = Date.parse('2026-11-10T12:00:00Z');
  const rows = [
    { user_id: 'u1', card_id: 'c1', quantity: 4, acquired_qty: 1, cards: { name: 'Bolt', created_at: '2026-11-08T00:00:00Z' }, profiles: { name: 'Ana' } },
    { user_id: 'u2', card_id: 'c1', quantity: 1, acquired_qty: 0, cards: { name: 'Bolt', created_at: '2026-11-08T00:00:00Z' }, profiles: { name: 'Bia' } },
    { user_id: 'u3', card_id: 'c2', quantity: 2, acquired_qty: 2, cards: { name: 'Ring' }, profiles: { name: 'Caio' } },
    { user_id: 'u3', card_id: 'c3', quantity: 9, acquired_qty: 0, cards: { name: 'Ritual', created_at: '2025-01-01T00:00:00Z' }, profiles: { name: 'Caio' } },
  ];
  const d = wishlistDemand(rows, { now });
  assert.deepEqual(d.map(c => c.cardId), ['c1', 'c3'], 'desejo já comprado sai; mais gente vem antes de mais unidades');
  assert.equal(d[0].wanted, 4);
  assert.equal(d[0].peopleCount, 2);
  assert.equal(d[0].isNew, true);
  assert.equal(d[1].isNew, false);
  assert.match(wishAvailableMessage(d[0].people[0], d[0]), /^Oi, Ana! A Bolt/);
});

test('CSV abre no Excel em português: BOM, ";" e vírgula decimal', () => {
  const csv = ordersCsv([{ orderId: 'o1', shortId: 'ABCD1234', clientName: 'Ana; "A"', batches: [paid({ id: 'b1aaaaaa-x', qty_in_batch: 15, subtotal_locked: 100.5, shipping_locked: 20, total_locked: 120.5, created_at: '2026-11-01T12:00:00Z' })] }], { stageOf: () => 'Pago' });
  assert.ok(csv.startsWith('﻿Pedido;Lote;'));
  const row = csv.split('\r\n')[1].split(';');
  assert.equal(row[0], 'ABCD1234');
  assert.ok(csv.includes('"Ana; ""A"""'), 'campo com ; e aspas vem escapado');
  assert.ok(csv.includes(';100,50;20,00;120,50;'));
  assert.equal(ordersCsv([{ batches: [{ created_at: '2026-01-01' }] }], { from: '2026-02-01' }).split('\r\n').length, 1, 'filtro de período');
});

test('monthKey', () => {
  assert.equal(monthKey(new Date(2026, 10, 3)), '2026-11');
  assert.equal(monthKey('lixo'), '');
});
