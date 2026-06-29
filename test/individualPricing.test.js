import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickTier, floorForType, pricePerCard, quoteCart } from '../shared/individualPricing.js';

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
