import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateOrderCards, formatSupplierCardList, totalCardQty } from '../shared/supplierCardList.js';

const item = (name, quantity, type = '', batch_id = 'b1') => ({ batch_id, quantity, cards: { name, type } });

test('junta os itens de todos os lotes do pedido numa lista só', () => {
  const cards = aggregateOrderCards([
    item('Sol Ring', 2, 'normal', 'lote-1'),
    item('Lightning Bolt', 1, 'foil', 'lote-1'),
    item('Sol Ring', 3, 'normal', 'lote-2'),
  ]);
  assert.deepEqual(cards, [
    { name: 'Lightning Bolt', type: 'foil', qty: 1 },
    { name: 'Sol Ring', type: 'normal', qty: 5 },
  ]);
});

test('carta igual com tipo diferente não se mistura', () => {
  const cards = aggregateOrderCards([item('Sol Ring', 1, 'normal'), item('Sol Ring', 1, 'foil')]);
  assert.equal(cards.length, 2);
  assert.deepEqual(cards.map(c => c.type).sort(), ['foil', 'normal']);
});

test('nome com caixa e espaço diferentes conta como a mesma carta', () => {
  const cards = aggregateOrderCards([item(' Sol Ring ', 1), item('sol ring', 2)]);
  assert.deepEqual(cards, [{ name: 'Sol Ring', type: '', qty: 3 }]);
});

test('aceita o formato já mastigado pela UI', () => {
  const cards = aggregateOrderCards([{ name: 'Counterspell', type: 'normal', qty: 4 }]);
  assert.deepEqual(cards, [{ name: 'Counterspell', type: 'normal', qty: 4 }]);
});

test('quantidade ausente vale 1; zero e lixo não viram linha', () => {
  assert.deepEqual(aggregateOrderCards([{ cards: { name: 'Brainstorm' } }]), [{ name: 'Brainstorm', type: '', qty: 1 }]);
  assert.deepEqual(aggregateOrderCards([item('Brainstorm', 0), item('Ponder', 'abc')]), []);
});

test('item sem nome não some da lista de compra', () => {
  assert.deepEqual(aggregateOrderCards([{ quantity: 2, cards: {} }]), [{ name: 'Carta', type: '', qty: 2 }]);
});

test('lista vazia ou inválida não quebra', () => {
  assert.deepEqual(aggregateOrderCards(), []);
  assert.deepEqual(aggregateOrderCards(null), []);
  assert.equal(formatSupplierCardList(null), '');
  assert.equal(totalCardQty(null), 0);
});

test('texto sai no formato que o fornecedor já recebe', () => {
  const texto = formatSupplierCardList(aggregateOrderCards([
    item('Sol Ring', 2, 'normal', 'lote-1'),
    item('Sol Ring', 3, 'normal', 'lote-2'),
    item('Lightning Bolt', 1, 'foil', 'lote-2'),
    item('Opt', 1, '', 'lote-2'),
  ]));
  assert.equal(texto, '1x Lightning Bolt (foil)\n1x Opt\n5x Sol Ring (normal)');
});

test('total soma as quantidades já juntadas', () => {
  assert.equal(totalCardQty(aggregateOrderCards([item('Sol Ring', 2), item('Sol Ring', 3), item('Opt', 1)])), 6);
});
