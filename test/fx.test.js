import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAwesomeApiRate, isStale } from '../shared/fx.js';

test('parseAwesomeApiRate lê o campo ask por padrão', () => {
  const json = { USDBRL: { code: 'USD', codein: 'BRL', bid: '5.45', ask: '5.46', high: '5.50' } };
  assert.equal(parseAwesomeApiRate(json), 5.46);
});

test('parseAwesomeApiRate cai para bid quando ask ausente', () => {
  assert.equal(parseAwesomeApiRate({ USDBRL: { bid: '5.40' } }), 5.40);
});

test('parseAwesomeApiRate retorna null em resposta inválida', () => {
  assert.equal(parseAwesomeApiRate({}), null);
  assert.equal(parseAwesomeApiRate(null), null);
  assert.equal(parseAwesomeApiRate({ USDBRL: { ask: '0' } }), null);
  assert.equal(parseAwesomeApiRate({ USDBRL: { ask: 'abc' } }), null);
});

test('isStale: cotação recente não é velha', () => {
  assert.equal(isStale(new Date().toISOString(), 12), false);
});

test('isStale: cotação antiga é velha', () => {
  const old = new Date(Date.now() - 13 * 3600 * 1000).toISOString();
  assert.equal(isStale(old, 12), true);
});

test('isStale: data inválida conta como velha', () => {
  assert.equal(isStale(null, 12), true);
  assert.equal(isStale('not-a-date', 12), true);
});
