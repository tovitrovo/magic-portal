import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TIERS, quotePledge, campaignProgress, financeSummary, normalizeTiers, scryfallQuery, rankVotes, NO_STAMP_FILTER, capacityOf } from '../shared/crowdfund.js';

test('faixas: ordena, descarta inválidas e calcula o início de cada uma', () => {
  const t = normalizeTiers([{ upto: 70, per_card_brl: 13 }, { upto: 40, per_card_brl: 10 }, { upto: 0, per_card_brl: 5 }]);
  assert.deepEqual(t.map((x) => [x.from, x.upto]), [[1, 40], [41, 70]]);
  assert.equal(capacityOf(DEFAULT_TIERS), 100);
});

test('primeiro pacote sai na faixa de fundador', () => {
  const q = quotePledge({ tiers: DEFAULT_TIERS, taken: 0, packs: 1 });
  assert.equal(q.ok, true);
  assert.equal(q.firstPack, 1);
  assert.equal(q.total, 560); // 56 × R$ 10
});

test('caixa que atravessa faixas paga cada pacote na sua posição', () => {
  const q = quotePledge({ tiers: DEFAULT_TIERS, taken: 38, packs: 4 });
  assert.deepEqual(q.breakdown.map((b) => [b.label, b.packs]), [['Fundadores', 2], ['Apoiadores', 2]]);
  assert.equal(q.total, 2 * 560 + 2 * 728);
});

test('não vende além da capacidade', () => {
  assert.equal(quotePledge({ tiers: DEFAULT_TIERS, taken: 98, packs: 4 }).ok, false);
  assert.equal(quotePledge({ tiers: DEFAULT_TIERS, taken: 100, packs: 1 }).error, 'Esgotado');
});

test('progresso: faixa atual, quanto falta e meta pelos pagos', () => {
  const p = campaignProgress({ tiers: DEFAULT_TIERS, goalPacks: 40, taken: 45, paid: 40 });
  assert.equal(p.current.label, 'Apoiadores');
  assert.equal(p.current.left, 25);
  assert.equal(p.goalReached, true);
  assert.deepEqual(p.tiers.map((t) => t.state), ['done', 'current', 'next']);
});

test('com as faixas padrão, a meta de fundadores paga o lote', () => {
  const f = financeSummary({ tiers: DEFAULT_TIERS, goalPacks: 40, supplierLotUsd: 3500, fxRate: 5.42, fxMarkupPct: 5.6, extraCostsBrl: 1030 });
  assert.equal(f.goalRevenue, 22400);
  assert.ok(f.goalCoversLot, `meta líquida ${f.goalNet} < custo ${f.lotCost}`);
  assert.ok(f.fullProfit > 40000);
});

test('busca do Scryfall sempre exclui cartas com selo', () => {
  const { q } = scryfallQuery('Sol "Ring', 'commander');
  assert.ok(q.startsWith(NO_STAMP_FILTER));
  assert.ok(q.includes('name:"Sol Ring"'));
});

test('ranking soma votos e marca os meus', () => {
  const r = rankVotes([
    { oracle_id: 'a', card_name: 'A', user_id: 'u1', created_at: '2026-01-02' },
    { oracle_id: 'b', card_name: 'B', user_id: 'u1', created_at: '2026-01-01' },
    { oracle_id: 'b', card_name: 'B', user_id: 'u2', created_at: '2026-01-03' },
  ], 'u2');
  assert.deepEqual(r.map((x) => [x.oracle_id, x.votes, x.mine]), [['b', 2, true], ['a', 1, false]]);
});
