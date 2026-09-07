import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boughtByCard, buildCollection, collectionStats, extrasByCard } from '../shared/collection.js';

const PAID = { status: 'PAID' };
const PENDING = { status: 'PENDING_PAYMENT' };

test('só lote pago vira carta na coleção', () => {
  const bought = boughtByCard([
    { card_id: 'a', quantity: 2, order_batches: PAID },
    { card_id: 'b', quantity: 3, order_batches: PENDING },
    { card_id: 'c', quantity: 1, order_batches: null },
  ]);
  assert.equal(bought.get('a'), 2);
  assert.equal(bought.get('b'), undefined);
  assert.equal(bought.get('c'), undefined);
});

test('cópias da mesma carta em lotes diferentes somam', () => {
  const bought = boughtByCard([
    { card_id: 'a', quantity: 2, order_batches: PAID },
    { card_id: 'a', quantity: 1, order_batches: { status: 'CONFIRMED' } },
    { card_id: 'a', quantity: 4, order_batches: { status: 'DRAFT', payment_status: 'approved' } },
  ]);
  assert.equal(bought.get('a'), 7);
});

test('carta bônus conta — o álbum é o que ele tem, não o que pagou', () => {
  const bought = boughtByCard([{ card_id: 'a', quantity: 1, is_bonus: true, order_batches: PAID }]);
  assert.equal(bought.get('a'), 1);
});

test('quantidade inválida não polui a contagem', () => {
  const bought = boughtByCard([
    { card_id: 'a', quantity: -5, order_batches: PAID },
    { card_id: 'a', quantity: 'duas', order_batches: PAID },
    { card_id: 'a', quantity: 2.9, order_batches: PAID },
  ]);
  assert.equal(bought.get('a'), 2);
});

test('compra e ajuste manual somam sem se apagar', () => {
  const entries = buildCollection({
    cards: [{ id: 'a', name: 'Sol Ring' }, { id: 'b', name: 'Counterspell' }, { id: 'c', name: 'Brainstorm' }],
    bought: [{ card_id: 'a', quantity: 2, order_batches: PAID }],
    extras: [{ card_id: 'a', extra_qty: 1 }, { card_id: 'b', extra_qty: 3 }],
  });
  const byId = Object.fromEntries(entries.map(e => [e.card.id, e]));
  assert.deepEqual(
    [byId.a.boughtQty, byId.a.extraQty, byId.a.ownedQty],
    [2, 1, 3],
  );
  assert.deepEqual([byId.b.boughtQty, byId.b.extraQty, byId.b.ownedQty], [0, 3, 3]);
  assert.equal(byId.c.owned, false);
});

test('ajuste manual negativo não vira desconto na compra', () => {
  const extras = extrasByCard([{ card_id: 'a', extra_qty: -4 }]);
  assert.equal(extras.get('a'), 0);
});

test('o progresso conta cartas distintas, não cópias', () => {
  const stats = collectionStats(buildCollection({
    cards: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
    bought: [{ card_id: 'a', quantity: 4, order_batches: PAID }],
    extras: [{ card_id: 'b', extra_qty: 1 }],
  }));
  assert.deepEqual(stats, { total: 4, distinct: 2, copies: 5, percent: 50 });
});

test('álbum vazio não divide por zero', () => {
  assert.deepEqual(collectionStats([]), { total: 0, distinct: 0, copies: 0, percent: 0 });
});

test('a migration cria collection_items com RLS presa ao dono', () => {
  const sql = readFileSync(new URL('../supabase/migrations/minimal-portal.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.collection_items/);
  assert.match(sql, /UNIQUE \(user_id, card_id\)/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /auth\.uid\(\) = user_id/);
});

test('a migration abre o estágio DELIVERED no fulfillment', () => {
  const sql = readFileSync(new URL('../supabase/migrations/minimal-portal.sql', import.meta.url), 'utf8');
  assert.match(sql, /DELIVERED/);
});
