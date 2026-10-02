import test from 'node:test';
import assert from 'node:assert/strict';
import {
  batchesCarryingShipment, canChangeShipmentAddress, isShippingAdjustment, missingAddressFields,
  paidShippingOf, pendingAdjustmentOf, shipmentOf, shippingDifference,
} from '../shared/shippingAddressChange.js';
import { resolveOrderStageFromBatches } from '../shared/orderStatus.js';

function batch(id, overrides = {}) {
  return {
    id, order_id: 'o1', userId: 'u1', status: 'PAID', created_at: `2026-01-0${id}T10:00:00Z`,
    shipping_locked: 0, shipping_already_paid: true, qty_in_batch: 10, fulfillment_status: 'AWAITING_SUPPLIER_ORDER',
    ...overrides,
  };
}
const root = batch('1', { shipping_locked: 20, shipping_already_paid: false, shipping_service: 'PAC' });
const added = batch('2', { shipping_group_id: '1' });
const joint = batch('3', { order_id: 'o2', shipping_group_id: '1' });

test('ajuste de frete: sem cartas, só frete, pendurado no grupo', () => {
  assert.equal(isShippingAdjustment(batch('4', { qty_in_batch: 0, shipping_locked: 8, shipping_group_id: '1' })), true);
  assert.equal(isShippingAdjustment(root), false);
  assert.equal(isShippingAdjustment(added), false);
});

test('remessa inclui pedido, adição e envio conjunto — a partir de qualquer lote', () => {
  const all = [root, added, joint];
  for (const id of ['1', '2', '3']) {
    const s = shipmentOf(all, id);
    assert.equal(s.rootId, '1');
    assert.deepEqual(s.batches.map(b => b.id).sort(), ['1', '2', '3']);
  }
});

test('lotes que carregam o endereço incluem os ainda não pagos do grupo', () => {
  const unpaid = batch('5', { status: 'DRAFT', shipping_group_id: '1' });
  const all = [root, added, unpaid];
  assert.deepEqual(batchesCarryingShipment(all, shipmentOf(all, '1')).sort(), ['1', '2', '5']);
});

test('troca bloqueada depois da etiqueta', () => {
  assert.equal(canChangeShipmentAddress(shipmentOf([root, added], '1')), true);
  assert.equal(canChangeShipmentAddress(shipmentOf([root, { ...added, mandabem_envio_id: '99' }], '1')), false);
  assert.equal(canChangeShipmentAddress(shipmentOf([{ ...root, fulfillment_status: 'LABEL_GENERATED' }], '1')), false);
});

test('ajuste pendente é detectado; pago entra no frete pago', () => {
  const adj = batch('6', { status: 'PENDING_PAYMENT', qty_in_batch: 0, shipping_locked: 7.5, shipping_group_id: '1' });
  let all = [root, added, adj];
  assert.equal(pendingAdjustmentOf(all, shipmentOf(all, '1'))?.id, '6');
  all = [root, added, { ...adj, status: 'PAID' }];
  assert.equal(pendingAdjustmentOf(all, shipmentOf(all, '1')), null);
  assert.equal(paidShippingOf(shipmentOf(all, '1')), 27.5);
});

test('diferença: compara com a cotação do endereço atual; sem ela, com o frete pago', () => {
  assert.equal(shippingDifference({ newPrice: 30, currentPrice: 22, paidShipping: 20 }), 8);
  assert.equal(shippingDifference({ newPrice: 18, currentPrice: 22, paidShipping: 20 }), 0);
  assert.equal(shippingDifference({ newPrice: 30, currentPrice: null, paidShipping: 20 }), 10);
  assert.equal(shippingDifference({ newPrice: 0, currentPrice: 22, paidShipping: 20 }), null);
});

test('endereço incompleto é recusado', () => {
  assert.deepEqual(missingAddressFields({ cep: '01310-100', rua: 'Av. Paulista', numero: '1000', bairro: 'Bela Vista', cidade: 'São Paulo', uf: 'sp' }), []);
  assert.deepEqual(missingAddressFields({ cep: '0131', rua: 'X' }), ['CEP', 'número', 'bairro', 'cidade', 'UF']);
});

test('ajuste de frete não atrasa a trilha do pedido', () => {
  const advanced = { ...root, fulfillment_status: 'PREPARING' };
  const adj = batch('7', { status: 'PENDING_PAYMENT', qty_in_batch: 0, shipping_locked: 5, shipping_group_id: '1' });
  assert.equal(resolveOrderStageFromBatches([advanced, adj]).key, 'PREPARING');
});
