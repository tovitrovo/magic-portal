import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ORDER_STAGES,
  FULFILLMENT_STAGES,
  isPaid,
  nextFulfillmentStage,
  orderStageLabel,
  prevFulfillmentStage,
  resolveOrderStage,
  resolveOrderStageFromBatches,
  groupBatchesIntoOrders,
} from '../shared/orderStatus.js';

test('a trilha começa no pagamento e termina na entrega', () => {
  assert.equal(ORDER_STAGES[0].key, 'AWAITING_PAYMENT');
  assert.equal(ORDER_STAGES[ORDER_STAGES.length - 1].key, 'DELIVERED');
  const keys = ORDER_STAGES.map(s => s.key);
  assert.equal(new Set(keys).size, keys.length, 'nenhum estágio repetido');
});

test('a lista de fulfillment não expõe os estágios de dinheiro ao admin', () => {
  const keys = FULFILLMENT_STAGES.map(s => s.key);
  assert.ok(!keys.includes('AWAITING_PAYMENT'));
  assert.ok(!keys.includes('PAID'));
  assert.equal(keys[0], 'ORDERED_FROM_SUPPLIER');
});

test('lote sem pagamento fica em "aguardando pagamento" mesmo com fulfillment adiantado', () => {
  const stage = resolveOrderStage({ status: 'PENDING_PAYMENT', fulfillment_status: 'SHIPPED_TO_BR' });
  assert.equal(stage.key, 'AWAITING_PAYMENT');
  assert.equal(stage.index, 0);
});

test('pagamento aprovado no Mercado Pago conta como pago mesmo com status DRAFT', () => {
  assert.ok(isPaid({ status: 'DRAFT', payment_status: 'approved' }));
  assert.equal(resolveOrderStage({ status: 'DRAFT', payment_status: 'approved' }).key, 'PAID');
});

test('lote pago sem fulfillment para em "pagamento confirmado"', () => {
  assert.equal(resolveOrderStage({ status: 'PAID' }).key, 'PAID');
  assert.equal(resolveOrderStage({ status: 'PAID', fulfillment_status: 'AWAITING_SUPPLIER_ORDER' }).key, 'PAID');
});

test('fulfillment desconhecido não quebra a leitura do estágio', () => {
  assert.equal(resolveOrderStage({ status: 'PAID', fulfillment_status: 'XPTO' }).key, 'PAID');
});

test('cada estágio de logística de um lote pago aparece na trilha', () => {
  for (const stage of FULFILLMENT_STAGES) {
    const resolved = resolveOrderStage({ status: 'CONFIRMED', fulfillment_status: stage.key });
    assert.equal(resolved.key, stage.key);
    assert.ok(resolved.index > 1);
  }
});

test('status terminais saem da trilha', () => {
  for (const status of ['CANCELLED', 'FAILED', 'REFUNDED', 'CHARGEDBACK']) {
    const stage = resolveOrderStage({ status });
    assert.equal(stage.terminal, true);
    assert.equal(stage.index, -1);
  }
});

test('cancelado vence o pagamento aprovado — o dinheiro voltou', () => {
  assert.equal(resolveOrderStage({ status: 'CANCELLED', payment_status: 'approved' }).key, 'CANCELLED');
});

test('avançar e voltar respeitam os limites da trilha', () => {
  assert.equal(nextFulfillmentStage({ status: 'PENDING_PAYMENT' }), null, 'não pago não avança');
  assert.equal(nextFulfillmentStage({ status: 'PAID' }).key, 'ORDERED_FROM_SUPPLIER');
  assert.equal(nextFulfillmentStage({ status: 'PAID', fulfillment_status: 'DELIVERED' }), null);
  assert.equal(prevFulfillmentStage({ status: 'PAID' }), null, 'recém-pago não volta');
  assert.equal(prevFulfillmentStage({ status: 'PAID', fulfillment_status: 'ORDERED_FROM_SUPPLIER' }), null);
  assert.equal(prevFulfillmentStage({ status: 'PAID', fulfillment_status: 'ARRIVED_BR' }).key, 'SHIPPED_TO_BR');
  assert.equal(prevFulfillmentStage({ status: 'CANCELLED' }), null);
});

test('o pedido anda no ritmo do lote mais atrasado', () => {
  const stage = resolveOrderStageFromBatches([
    { status: 'PAID', fulfillment_status: 'SHIPPED_TO_BR' },
    { status: 'PAID', fulfillment_status: 'ORDERED_FROM_SUPPLIER' },
  ]);
  assert.equal(stage.key, 'ORDERED_FROM_SUPPLIER');
});

test('lote cancelado não segura o pedido inteiro', () => {
  const stage = resolveOrderStageFromBatches([
    { status: 'CANCELLED' },
    { status: 'PAID', fulfillment_status: 'PREPARING' },
  ]);
  assert.equal(stage.key, 'PREPARING');
});

test('pedido só com lotes cancelados aparece como cancelado', () => {
  assert.equal(resolveOrderStageFromBatches([{ status: 'CANCELLED' }]).key, 'CANCELLED');
});

test('pedido sem nenhum lote começa aguardando pagamento', () => {
  assert.equal(resolveOrderStageFromBatches([]).key, 'AWAITING_PAYMENT');
});

test('o rótulo é o texto que o cliente lê', () => {
  assert.equal(orderStageLabel({ status: 'PAID', fulfillment_status: 'LABEL_GENERATED' }), 'Enviado');
  assert.equal(orderStageLabel({ status: 'PENDING_PAYMENT' }), 'Aguardando pagamento');
});

test('lotes viram pedidos, e o pedido soma cartas e dinheiro dos seus lotes', () => {
  const orders = groupBatchesIntoOrders([
    { id: 'b1', order_id: 'o1', qty_in_batch: 20, total_locked: 300, created_at: '2026-01-01T10:00:00Z', status: 'PAID', fulfillment_status: 'ARRIVED_BR' },
    { id: 'b2', order_id: 'o1', qty_in_batch: 5, total_locked: 70, created_at: '2026-01-02T10:00:00Z', status: 'PAID', fulfillment_status: 'ORDERED_FROM_SUPPLIER' },
    { id: 'b3', order_id: 'o2', qty_in_batch: 15, total_locked: 200, created_at: '2026-02-01T10:00:00Z', status: 'PENDING_PAYMENT' },
  ]);
  assert.equal(orders.length, 2);
  assert.equal(orders[0].orderId, 'o2', 'mais recente primeiro');
  const o1 = orders.find(o => o.orderId === 'o1');
  assert.equal(o1.qty, 25);
  assert.equal(o1.total, 370);
  assert.equal(o1.shortId, 'B1', 'o código é o do lote mais antigo');
  assert.equal(o1.stage.key, 'ORDERED_FROM_SUPPLIER', 'anda no ritmo do lote mais atrasado');
});

test('o rastreio do pedido vem do lote que tem etiqueta', () => {
  const [order] = groupBatchesIntoOrders([
    { id: 'b1', order_id: 'o1', created_at: '2026-01-01T10:00:00Z', status: 'PAID' },
    { id: 'b2', order_id: 'o1', created_at: '2026-01-02T10:00:00Z', status: 'PAID', mandabem_rastreamento: 'BR123', mandabem_status: 'Postado' },
  ]);
  assert.equal(order.tracking, 'BR123');
  assert.equal(order.trackingStatus, 'Postado');
});

test('lote órfão não some — vira um pedido de si mesmo', () => {
  const orders = groupBatchesIntoOrders([{ id: 'b9', qty_in_batch: 3, status: 'PAID' }]);
  assert.equal(orders.length, 1);
  assert.equal(orders[0].orderId, 'b9');
});
