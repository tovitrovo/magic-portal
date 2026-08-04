import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickTier, floorForType, discountLadder, nextCheaperTier, pricePerCard, quoteCart } from '../shared/individualPricing.js';

const TIERS = [
  { min_qty: 1, max_qty: 10, usd_per_card: 2.50 },
  { min_qty: 11, max_qty: 30, usd_per_card: 2.20 },
  { min_qty: 31, max_qty: 50, usd_per_card: 2.15 },
  { min_qty: 51, max_qty: 100, usd_per_card: 2.00 },
  { min_qty: 101, max_qty: 200, usd_per_card: 1.90 },
  { min_qty: 201, max_qty: 300, usd_per_card: 1.80 },
  { min_qty: 1001, max_qty: null, usd_per_card: 1.08 },
];
const PRICING = { multiplier: 2.0, normal_floor_brl: 16, holo_floor_brl: 18, foil_floor_brl: 21, fx_fallback_rate: 5.5 };

test('pickTier seleciona a faixa correta', () => {
  assert.equal(pickTier(15, TIERS).usd_per_card, 2.20);
  assert.equal(pickTier(50, TIERS).usd_per_card, 2.15);
  assert.equal(pickTier(150, TIERS).usd_per_card, 1.90);
  assert.equal(pickTier(5000, TIERS).usd_per_card, 1.08); // faixa 1001+
});

test('floorForType respeita o tipo', () => {
  assert.equal(floorForType('Normal', PRICING), 16);
  assert.equal(floorForType('Holo', PRICING), 18);
  assert.equal(floorForType('Foil', PRICING), 21);
  assert.equal(floorForType('qualquer', PRICING), 16);
});

test('pricePerCard aplica fórmula custo×mult×dólar', () => {
  // 30 cartas, faixa 11-30 = 2.20 ; 2.20*2*5.5 = 24.20
  assert.equal(pricePerCard({ qty: 30, type: 'Normal', tiers: TIERS, pricing: PRICING, fxRate: 5.5 }), 24.20);
  // 250 cartas, faixa 201-300 = 1.80 ; 1.80*2*5.5 = 19.80
  assert.equal(pricePerCard({ qty: 250, type: 'Normal', tiers: TIERS, pricing: PRICING, fxRate: 5.5 }), 19.80);
});

test('pricePerCard aplica o piso por tipo', () => {
  // 5000 cartas: 1.08*2*5.5 = 11.88 -> abaixo de todos os pisos
  assert.equal(pricePerCard({ qty: 5000, type: 'Normal', tiers: TIERS, pricing: PRICING, fxRate: 5.5 }), 16);
  assert.equal(pricePerCard({ qty: 5000, type: 'Holo', tiers: TIERS, pricing: PRICING, fxRate: 5.5 }), 18);
  assert.equal(pricePerCard({ qty: 5000, type: 'Foil', tiers: TIERS, pricing: PRICING, fxRate: 5.5 }), 21);
  // 250 cartas: computed 19.80 > piso Normal(16)/Holo(18), mas < Foil(21)
  assert.equal(pricePerCard({ qty: 250, type: 'Foil', tiers: TIERS, pricing: PRICING, fxRate: 5.5 }), 21);
  assert.equal(pricePerCard({ qty: 250, type: 'Holo', tiers: TIERS, pricing: PRICING, fxRate: 5.5 }), 19.80);
});

test('pricePerCard usa fallback quando fxRate ausente', () => {
  assert.equal(pricePerCard({ qty: 30, type: 'Normal', tiers: TIERS, pricing: PRICING }), 24.20);
});

test('quoteCart soma a quantidade total e precifica tudo na mesma faixa', () => {
  const items = [
    { type: 'Normal', quantity: 200 },
    { type: 'Foil', quantity: 50 },
  ]; // total 250 -> faixa 201-300 (1.80) -> Normal 19.80, Foil max(19.80,21)=21
  const q = quoteCart({ items, tiers: TIERS, pricing: PRICING, fxRate: 5.5 });
  assert.equal(q.totalQty, 250);
  assert.equal(q.lines[0].unit_price_brl, 19.80);
  assert.equal(q.lines[1].unit_price_brl, 21);
  assert.equal(q.subtotal, round(19.80 * 200 + 21 * 50));
});

function round(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }


// ── O piso achata o fim da escada ─────────────────────
// Faixas de produção (individual_tiers) com a config ativa: multiplicador 2,
// pisos 16/18/21. Passado o ponto em que custo × 2 × dólar cai abaixo do piso,
// as faixas seguintes valem todas o mesmo.
const PROD_TIERS = [
  { min_qty: 1, max_qty: 10, usd_per_card: 2.50 },
  { min_qty: 11, max_qty: 30, usd_per_card: 2.20 },
  { min_qty: 31, max_qty: 50, usd_per_card: 2.15 },
  { min_qty: 51, max_qty: 100, usd_per_card: 2.00 },
  { min_qty: 101, max_qty: 200, usd_per_card: 1.90 },
  { min_qty: 201, max_qty: 300, usd_per_card: 1.80 },
  { min_qty: 301, max_qty: 400, usd_per_card: 1.70 },
  { min_qty: 401, max_qty: 500, usd_per_card: 1.66 },
  { min_qty: 501, max_qty: 600, usd_per_card: 1.63 },
  { min_qty: 601, max_qty: 700, usd_per_card: 1.52 },
  { min_qty: 701, max_qty: 800, usd_per_card: 1.41 },
  { min_qty: 801, max_qty: 900, usd_per_card: 1.30 },
  { min_qty: 901, max_qty: 1000, usd_per_card: 1.19 },
  { min_qty: 1001, max_qty: null, usd_per_card: 1.08 },
];
const FX = 5.0751; // dólar em cache na produção

test('nextCheaperTier: pula as faixas que não baixam o preço', () => {
  const opts = { tiers: PROD_TIERS, pricing: PRICING, fxRate: FX };
  // Carta Normal a 620 cartas já paga o piso de R$ 16 — as faixas 701, 801,
  // 901 e 1001 valem o mesmo, então não há nada a alcançar.
  assert.equal(pricePerCard({ qty: 620, type: 'Normal', ...opts }), 16);
  assert.deepEqual(nextCheaperTier(620, opts), { tier: null, missing: 0, unit: 16, saving: 0 });
  // Foil trava no piso de R$ 21 já em 51 cartas.
  const foil = nextCheaperTier(60, { ...opts, type: 'Foil' });
  assert.equal(foil.tier, null);
  assert.equal(foil.unit, 21);
  // Abaixo do piso a escada funciona: de 22 cartas, a próxima faixa útil é a de 31.
  const normal = nextCheaperTier(22, opts);
  assert.equal(normal.tier.min_qty, 31);
  assert.equal(normal.missing, 9);
  assert.equal(normal.unit, 21.82);
  // Economia = (preço atual − preço novo) × volume da faixa nova.
  assert.equal(normal.saving, round((22.33 - 21.82) * 31));
});

test('discountLadder: sem faixas inalcançáveis e sem preço repetido', () => {
  const rows = discountLadder({ tiers: PROD_TIERS, pricing: PRICING, fxRate: FX, minCards: 15 });
  // A faixa 1–10 não sobrevive ao mínimo de 15, e a 11–30 começa em 15.
  assert.equal(rows[0].min, 15);
  assert.equal(rows[0].max, 30);
  // As cinco últimas faixas caem todas em R$ 16,00 e viram uma linha só, aberta.
  const last = rows[rows.length - 1];
  assert.equal(last.unit, 16);
  assert.equal(last.min, 601);
  assert.equal(last.max, null);
  // Nenhum preço repetido em linhas seguidas.
  const units = rows.map(r => r.unit);
  assert.equal(new Set(units).size, units.length);
  // A escada só desce.
  assert.deepEqual(units, [...units].sort((a, b) => b - a));
  // Foil achata bem antes: menos degraus que a Normal.
  const foilRows = discountLadder({ tiers: PROD_TIERS, pricing: PRICING, fxRate: FX, minCards: 15, type: 'Foil' });
  assert.ok(foilRows.length < rows.length);
  assert.equal(foilRows[foilRows.length - 1].unit, 21);
});
