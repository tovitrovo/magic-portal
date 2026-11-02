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

test('PTAX: pega a cotação de venda mais recente da janela', async () => {
  const { parsePtaxRate, ptaxUrl } = await import('../shared/fx.js');
  const json = { value: [
    { cotacaoCompra: 5.4998, cotacaoVenda: 5.5007, dataHoraCotacao: '2026-10-26 13:09:51.106' },
    { cotacaoCompra: 5.4206, cotacaoVenda: 5.4212, dataHoraCotacao: '2026-10-30 13:04:18.706' },
    { cotacaoCompra: 5.3340, cotacaoVenda: 5.3346, dataHoraCotacao: '2026-10-27 13:05:26.521' },
  ] };
  assert.deepEqual(parsePtaxRate(json), { rate: 5.4212, quotedAt: '2026-10-30 13:04:18.706' });
  assert.equal(parsePtaxRate({ value: [] }), null);
  assert.equal(parsePtaxRate(null), null);
  assert.equal(parsePtaxRate({ value: [{ cotacaoVenda: 0, dataHoraCotacao: 'x' }] }), null);
  const url = ptaxUrl(new Date(2026, 10, 2), 10);
  assert.match(url, /dataInicial='10-23-2026'&@dataFinalCotacao='11-02-2026'/);
});

test('busca ao vivo: Banco Central primeiro, AwesomeAPI só se ele falhar', async () => {
  const { fetchLiveRate } = await import('../functions/api/_fx-helper.js');
  const res = (ok, body) => ({ ok, json: async () => body });
  const calls = [];
  const bcbOk = async (url) => { calls.push(url); return url.includes('bcb.gov.br') ? res(true, { value: [{ cotacaoVenda: 5.42, dataHoraCotacao: '2026-10-30' }] }) : res(true, {}); };
  assert.deepEqual(await fetchLiveRate(bcbOk), { rate: 5.42, provider: 'bcb-ptax', quotedAt: '2026-10-30' });
  assert.equal(calls.length, 1, 'não consulta a reserva se o BC respondeu');

  const bcbDown = async (url) => url.includes('bcb.gov.br') ? res(false, {}) : res(true, { USDBRL: { ask: '5.40' } });
  assert.deepEqual(await fetchLiveRate(bcbDown), { rate: 5.4, provider: 'awesomeapi' });

  // O caso de nov/2026: AwesomeAPI devolvendo 429 e BC fora — sem cotação ao vivo.
  const allDown = async () => res(false, { status: 429, code: 'QuotaExceeded' });
  assert.equal(await fetchLiveRate(allDown), null);
});

test('custo usa o dólar do Inter (oficial + IOF e spread)', async () => {
  const { costFx } = await import('../shared/fx.js');
  assert.equal(Math.round(costFx(5.18) * 100) / 100, 5.42);
});
