import test from 'node:test';
import assert from 'node:assert/strict';
import { shipmentPhase, trackingEventFor } from '../shared/mandabemStatus.js';
import { categoryOfType, prefsFromRow, rowFromPrefs, NOTIFICATION_TYPES } from '../shared/notificationTypes.js';
import { formatDigest, groupByShipment, summarizeQueue, brDate } from '../functions/api/_automation.js';
import { normalizeSiteUrl } from '../functions/api/admin-automation.js';

test('classifica os textos de status do MandaBem em fases', () => {
  assert.equal(shipmentPhase('Envio gerado'), 'PENDING');
  assert.equal(shipmentPhase('Aguardando postagem'), 'PENDING');
  assert.equal(shipmentPhase('Objeto postado'), 'POSTED');
  assert.equal(shipmentPhase('Objeto em trânsito - por favor aguarde'), 'POSTED');
  assert.equal(shipmentPhase('Objeto saiu para entrega ao destinatário'), 'POSTED');
  assert.equal(shipmentPhase('Objeto entregue ao destinatário'), 'DELIVERED');
  assert.equal(shipmentPhase('Objeto não entregue - endereço incorreto'), 'PROBLEM');
  assert.equal(shipmentPhase('Objeto aguardando retirada no endereço indicado'), 'PROBLEM');
  assert.equal(shipmentPhase('Objeto devolvido ao remetente'), 'PROBLEM');
  assert.equal(shipmentPhase(''), 'UNKNOWN');
});

test('só troca de fase vira push; problema novo sempre avisa', () => {
  assert.equal(trackingEventFor('Envio gerado', 'Objeto postado'), 'SHIPMENT_POSTED');
  assert.equal(trackingEventFor('Objeto postado', 'Objeto em trânsito'), null);
  assert.equal(trackingEventFor('Objeto em trânsito', 'Objeto entregue ao destinatário'), 'SHIPMENT_DELIVERED');
  assert.equal(trackingEventFor('Objeto em trânsito', 'Objeto aguardando retirada'), 'SHIPMENT_PROBLEM');
  assert.equal(trackingEventFor('Objeto aguardando retirada', 'Objeto aguardando retirada'), null);
  assert.equal(trackingEventFor('Objeto entregue', 'Objeto Entregue'), null);
});

test('cada tipo de evento tem uma categoria e uma coluna de preferência', () => {
  for (const type of NOTIFICATION_TYPES) assert.ok(categoryOfType(type)?.column, type);
  assert.equal(categoryOfType('SHIPMENT_DELIVERED').column, 'notify_shipping');
  assert.equal(categoryOfType('PAYMENT_FAILED').column, 'notify_alerts');
  assert.equal(categoryOfType('TEST'), null);
});

test('preferências: coluna ausente conta como ligada e só booleanos viram coluna', () => {
  assert.deepEqual(prefsFromRow({ notify_new_orders: true, notify_logins: false }), { newOrders: true, shipping: true, alerts: true, digest: true, logins: false });
  assert.deepEqual(rowFromPrefs({ digest: false, logins: 'x' }), { notify_digest: false });
});

test('agrupa lotes pelo envio do MandaBem, os menos consultados primeiro', () => {
  const groups = groupByShipment([
    { id: 'a', mandabem_envio_id: '1', mandabem_updated_at: '2026-10-20T10:00:00Z' },
    { id: 'b', mandabem_envio_id: '1', mandabem_updated_at: '2026-10-20T10:00:00Z' },
    { id: 'c', mandabem_envio_id: '2', mandabem_updated_at: null },
    { id: 'd', mandabem_envio_id: null },
  ]);
  assert.deepEqual(groups.map(g => [g.envioId, g.batches.length]), [['2', 1], ['1', 2]]);
});

test('resumo diário conta a fila e as etiquetas paradas', () => {
  const now = Date.parse('2026-10-29T12:00:00Z');
  const q = summarizeQueue([
    { fulfillment_status: 'AWAITING_SUPPLIER_ORDER', qty_in_batch: 20 },
    { fulfillment_status: 'SHIPPED_TO_BR', qty_in_batch: 20 },
    { fulfillment_status: 'PREPARING', qty_in_batch: 20 },
    { fulfillment_status: 'LABEL_GENERATED', qty_in_batch: 20, mandabem_status: 'Envio gerado', mandabem_generated_at: '2026-10-20T12:00:00Z' },
    { fulfillment_status: 'LABEL_GENERATED', qty_in_batch: 20, mandabem_status: 'Objeto devolvido' },
    // ajuste de frete não é trabalho
    { fulfillment_status: 'AWAITING_SUPPLIER_ORDER', qty_in_batch: 0, shipping_already_paid: true, shipping_locked: 5 },
  ], now);
  assert.deepEqual(q, { toBuy: 1, inbound: 1, toShip: 1, shipped: 2, problems: 1, stalled: 1 });
  const text = formatDigest({ paidCount: 2, paidTotal: 300, awaiting: 1 }, q);
  assert.match(text, /Ontem: 2 pago\(s\)/);
  assert.match(text, /1 p\/ comprar/);
  assert.match(text, /⚠️ 1 com problema/);
  assert.match(formatDigest({ paidCount: 0, paidTotal: 0, awaiting: 0 }, summarizeQueue([])), /Fila vazia/);
});

test('data do resumo segue o dia de Brasília', () => {
  assert.equal(brDate(new Date('2026-10-30T02:00:00Z')), '2026-10-29');
  assert.equal(brDate(new Date('2026-10-30T04:00:00Z')), '2026-10-30');
});

test('o cron só aceita domínio https público', () => {
  assert.equal(normalizeSiteUrl('https://cartas.pages.dev/admin?x=1'), 'https://cartas.pages.dev');
  assert.equal(normalizeSiteUrl('http://cartas.pages.dev'), null);
  assert.equal(normalizeSiteUrl('https://localhost:5173'), null);
  assert.equal(normalizeSiteUrl('lixo'), null);
});
