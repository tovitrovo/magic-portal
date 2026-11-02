import test from 'node:test';
import assert from 'node:assert/strict';
import { findAlternatives, findTwin, indexActiveCards, planWishlistMoves, searchStem } from '../shared/wishlistReconcile.js';

const cards = [
  { id: 'a1', name: 'Mox Opal English MTG Proxy', type: 'Normal', is_active: true, created_at: '2026-10-01' },
  { id: 'a2', name: 'Thoughtseize SLD 1117', type: 'Foil', is_active: true, created_at: '2026-09-01' },
  { id: 'a3', name: 'Thoughtseize SLD 1117 foil', type: 'Foil', is_active: true, created_at: '2026-10-01', source_url: 'x', image_url: 'y' },
  { id: 'a4', name: 'Lotus Petal Foil', type: 'Foil', is_active: true },
  { id: 'old', name: 'Lotus Petal', type: 'Normal', is_active: false },
];
const index = indexActiveCards(cards);

test('gêmea: mesmo nome normalizado e mesmo tipo; entre várias, a ligada à planilha', () => {
  assert.equal(findTwin({ id: 'x', name: 'Mox Opal English', type: 'Normal' }, index)?.id, 'a1');
  assert.equal(findTwin({ id: 'x', name: 'Thoughtseize SLD 1117 ', type: 'Foil' }, index)?.id, 'a3');
  assert.equal(findTwin({ id: 'old', name: 'Lotus Petal', type: 'Normal' }, index), null, 'outro tipo não é gêmea');
});

test('alternativa: mesma carta em outro tipo, uma por tipo', () => {
  assert.deepEqual(findAlternatives({ id: 'old', name: 'Lotus Petal', type: 'Normal' }, index).map(c => c.id), ['a4']);
  assert.deepEqual(findAlternatives({ id: 'x', name: 'Mox Opal English', type: 'Normal' }, index), []);
});

test('plano: move, e junta quando o cliente já desejava a gêmea (ou duas cópias viram a mesma)', () => {
  const rows = [
    { id: 'w1', user_id: 'u1', quantity: 2, acquired_qty: 0, cards: { name: 'Mox Opal English', type: 'Normal' } },
    { id: 'w2', user_id: 'u2', quantity: 1, acquired_qty: 0, cards: { name: 'Thoughtseize SLD 1117', type: 'Foil' } },
    { id: 'w3', user_id: 'u2', quantity: 4, acquired_qty: 0, cards: { name: 'Thoughtseize SLD 1117 foil ', type: 'Foil' } },
    { id: 'w4', user_id: 'u3', quantity: 1, acquired_qty: 0, cards: { name: 'Lotus Petal', type: 'Normal' } },
  ];
  const plan = planWishlistMoves(rows, index, new Set(['u1|a1']));
  assert.deepEqual(plan.map(p => [p.wishId, p.targetId, p.merge]), [['w1', 'a1', true], ['w2', 'a3', false], ['w3', 'a3', true]]);
});

test('termo de busca: a palavra mais longa, sem acabamento e sem número', () => {
  assert.equal(searchStem("Urza’s Saga SCH #0029 Foil"), 'Urza');
  assert.equal(searchStem('Thoughtseize SLD 1117 foil'), 'Thoughtseize');
  // Empate de tamanho fica com a primeira; acento some ("dûm" não entra na busca).
  assert.equal(searchStem('Bridge of Khazad-dûm 380 Surge'), 'Bridge');
});
