import test from 'node:test';
import assert from 'node:assert/strict';
import { buildShippingGroups, identifyShippingService, SHIPPING_SERVICE_UNKNOWN } from '../shared/shipping-groups.js';

function batch(id, overrides = {}) {
  return {
    id,
    userId: 'user-1',
    status: 'PAID',
    created_at: `2026-01-0${id}T10:00:00Z`,
    shipping_locked: 0,
    shipping_already_paid: true,
    qty_in_batch: 10,
    total_locked: 50,
    ...overrides,
  };
}

test('agrupa lotes legados sem frete ao último lote que pagou frete', () => {
  const groups = buildShippingGroups([
    batch('1', { shipping_locked: 13, shipping_already_paid: false, shipping_service: 'SEDEX' }),
    batch('2'),
    batch('3'),
  ]);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].rootId, '1');
  assert.deepEqual(groups[0].batches.map(item => item.id), ['1', '2', '3']);
  assert.equal(groups[0].shippingService, 'SEDEX');
  assert.equal(groups[0].totalQuantity, 30);
});

test('mantém dois grupos quando o mesmo cliente paga dois fretes', () => {
  const groups = buildShippingGroups([
    batch('1', { shipping_locked: 13, shipping_already_paid: false }),
    batch('2'),
    batch('3', { shipping_locked: 22, shipping_already_paid: false }),
    batch('4'),
  ]);

  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map(group => group.batches.map(item => item.id)), [['1', '2'], ['3', '4']]);
});

test('respeita shipping_group_id explícito mesmo com ordem de criação diferente', () => {
  const groups = buildShippingGroups([
    batch('1', { shipping_locked: 13, shipping_already_paid: false }),
    batch('2', { shipping_group_id: '1' }),
    batch('3', { shipping_locked: 20, shipping_already_paid: false }),
    batch('4', { shipping_group_id: '1' }),
  ]);

  assert.deepEqual(groups.find(group => group.rootId === '1').batches.map(item => item.id), ['1', '2', '4']);
  assert.deepEqual(groups.find(group => group.rootId === '3').batches.map(item => item.id), ['3']);
});

test('identifica o único serviço dentro da tolerância de cinquenta centavos', () => {
  assert.equal(identifyShippingService(13, [
    { service: 'PACMINI', price: 9.8 },
    { service: 'SEDEX', price: 13.49 },
  ]), 'SEDEX');
});

test('retorna UNKNOWN quando não há correspondência ou há empate', () => {
  assert.equal(identifyShippingService(13, [{ service: 'SEDEX', price: 13.51 }]), SHIPPING_SERVICE_UNKNOWN);
  assert.equal(identifyShippingService(13, [
    { service: 'PACMINI', price: 12.8 },
    { service: 'SEDEX', price: 13.2 },
  ]), SHIPPING_SERVICE_UNKNOWN);
});
