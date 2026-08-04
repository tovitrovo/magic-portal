import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ADD_CARDS_STAGE,
  batchAcceptsMoreCards,
  canAddCardsToOrder,
  isPaidBatch,
  paidQtyOf,
  shippingAnchorOf,
  shippingGroupIdOf,
} from '../shared/individualAddCards.js';
import { quoteCart } from '../shared/individualPricing.js';

const TIERS = [
  { min_qty: 1, max_qty: 10, usd_per_card: 2.50 },
  { min_qty: 11, max_qty: 30, usd_per_card: 2.20 },
  { min_qty: 31, max_qty: 50, usd_per_card: 2.15 },
  { min_qty: 51, max_qty: 100, usd_per_card: 2.00 },
];
const PRICING = { multiplier: 2.0, normal_floor_brl: 16, holo_floor_brl: 18, foil_floor_brl: 21 };

const pago = (over = {}) => ({ id: 'a', status: 'PAID', qty_in_batch: 20, created_at: '2026-01-01T10:00:00Z', shipping_locked: 32, ...over });

// ── A janela ────────────────────────────────────────────────────────────

test('pedido pago e ainda não comprado no fornecedor aceita cartas', () => {
  assert.equal(canAddCardsToOrder([pago()]), true);
});

test('a janela fecha quando a compra no fornecedor é feita', () => {
  for (const stage of ['ORDERED_FROM_SUPPLIER', 'SHIPPED_TO_BR', 'ARRIVED_BR', 'PREPARING', 'LABEL_GENERATED']) {
    assert.equal(canAddCardsToOrder([pago({ fulfillment_status: stage })]), false, stage);
  }
});

test('fulfillment_status ausente conta como o primeiro estágio', () => {
  // Banco sem a migração de fulfillment: não é motivo para negar a adição.
  assert.equal(batchAcceptsMoreCards({ status: 'PAID' }), true);
  assert.equal(ADD_CARDS_STAGE, 'AWAITING_SUPPLIER_ORDER');
});

test('etiqueta gerada fecha a janela mesmo com status atrasado', () => {
  assert.equal(canAddCardsToOrder([pago({ fulfillment_status: ADD_CARDS_STAGE, mandabem_envio_id: '999' })]), false);
});

test('pedido sem lote pago não aceita adição', () => {
  assert.equal(canAddCardsToOrder([{ id: 'a', status: 'DRAFT', qty_in_batch: 20 }]), false);
  assert.equal(canAddCardsToOrder([]), false);
});

test('lote pendente de pagamento não fecha a janela', () => {
  // A adição anterior ainda não paga não pode travar uma nova.
  const batches = [pago(), { id: 'b', status: 'PENDING_PAYMENT', qty_in_batch: 5 }];
  assert.equal(canAddCardsToOrder(batches), true);
});

test('um lote já comprado no fornecedor fecha a janela do pedido inteiro', () => {
  const batches = [pago(), pago({ id: 'b', fulfillment_status: 'ORDERED_FROM_SUPPLIER' })];
  assert.equal(canAddCardsToOrder(batches), false);
});

test('payment_status approved conta como pago', () => {
  assert.equal(isPaidBatch({ status: 'PENDING_PAYMENT', payment_status: 'approved' }), true);
  assert.equal(isPaidBatch({ status: 'CANCELLED' }), false);
});

// ── Volume e frete herdados ─────────────────────────────────────────────

test('paidQtyOf soma só o que foi pago', () => {
  const batches = [pago({ qty_in_batch: 20 }), pago({ id: 'b', qty_in_batch: 15 }), { id: 'c', status: 'DRAFT', qty_in_batch: 99 }];
  assert.equal(paidQtyOf(batches), 35);
});

test('a âncora de frete é o lote que pagou o envio', () => {
  const original = pago({ id: 'raiz', shipping_locked: 32, shipping_group_id: null });
  const adicao = pago({ id: 'adicao', created_at: '2026-01-05T10:00:00Z', shipping_locked: 0, shipping_already_paid: true });
  assert.equal(shippingAnchorOf([adicao, original]).id, 'raiz');
  // A próxima adição herda o mesmo grupo de envio: uma etiqueta, uma caixa.
  assert.equal(shippingGroupIdOf([adicao, original]), 'raiz');
  assert.equal(shippingGroupIdOf([pago({ id: 'x', shipping_group_id: 'grupo-1' })]), 'grupo-1');
});

// ── Preço da adição ─────────────────────────────────────────────────────

test('a adição é precificada pelo volume somado, não pelo do carrinho', () => {
  const items = [{ type: 'Normal', quantity: 5 }];
  // 5 cartas sozinhas caem na faixa 1-10 (2.50); somadas às 40 já pagas, na 31-50 (2.15).
  const sozinho = quoteCart({ items, tiers: TIERS, pricing: PRICING, fxRate: 5.5 });
  const somado = quoteCart({ items, tiers: TIERS, pricing: PRICING, fxRate: 5.5, tierQty: 45 });
  assert.equal(sozinho.lines[0].unit_price_brl, 27.50);
  assert.equal(somado.lines[0].unit_price_brl, 23.65);
  // A quantidade cobrada continua sendo a do carrinho.
  assert.equal(somado.totalQty, 5);
  assert.equal(somado.tierQty, 45);
  assert.equal(somado.subtotal, 118.25);
});

test('tierQty nunca reduz o volume do próprio carrinho', () => {
  const items = [{ type: 'Normal', quantity: 60 }];
  const q = quoteCart({ items, tiers: TIERS, pricing: PRICING, fxRate: 5.5, tierQty: 3 });
  assert.equal(q.tierQty, 60);
  assert.equal(q.lines[0].unit_price_brl, 22); // faixa 51-100
});

// ── Contrato do endpoint e do cliente ───────────────────────────────────

const endpoint = readFileSync(new URL('../functions/api/individual-checkout.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/MagicPortal.jsx', import.meta.url), 'utf8');

test('o endpoint valida a janela pela regra compartilhada', () => {
  assert.match(endpoint, /canAddCardsToOrder\(batches\)/);
  assert.match(endpoint, /ADD_CARDS_CLOSED_ERROR/);
});

test('a adição não cobra frete de novo e herda a remessa', () => {
  const bloco = endpoint.slice(endpoint.indexOf('async function addCardsToOrder'), endpoint.indexOf('// POST /api/individual-checkout'));
  assert.match(bloco, /shipping_locked: 0/);
  assert.match(bloco, /total_locked: subtotal/);
  assert.match(bloco, /shipping_already_paid: true/);
  assert.match(bloco, /shippingGroupIdOf\(batches\)/);
  // Mínimo de cartas é do pedido, não da adição: ele já foi cumprido.
  assert.doesNotMatch(bloco, /min_cards/);
});

test('a adição usa a faixa do volume somado no servidor', () => {
  assert.match(endpoint, /tierQty: alreadyPaidQty \+ newQty/);
});

test('o checkout do cliente manda addToOrderId quando está adicionando', () => {
  assert.match(app, /const payload=isAdding\?\{items,addToOrderId:addTo\.orderId\}:\{items,shipping\}/);
  // Adicionar não passa pelo endereço/frete nem pelo mínimo.
  assert.match(app, /const shippingSkipped = isAdding \|\| alreadyPaidShipping \|\| useJointShipping/);
  assert.match(app, /const minCards=isAdding\?1:/);
});

test('a etiqueta do individual sai por remessa, não por lote', () => {
  // Com adições, o pedido tem vários lotes numa caixa só: uma etiqueta cobre todos.
  assert.match(app, /apiPost\('\/api\/admin-mandabem-label',\{batchIds,rootBatchId:group\.rootId,action,formaEnvio\}\)/);
  assert.match(app, /buildShippingGroups\(individualBatches\)/);
});
