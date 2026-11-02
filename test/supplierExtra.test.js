import test from 'node:test';
import assert from 'node:assert/strict';
import { pricePerCard, quoteCart } from '../shared/individualPricing.js';
import { cardMatchKey, cleanCardName, supplierExtraUsd } from '../shared/supplierSheet.js';
import { sanitizeCardPatch } from '../functions/api/admin-cards.js';

const tiers = [
  { min_qty: 1, max_qty: 10, usd_per_card: 2.5 },
  { min_qty: 11, max_qty: 30, usd_per_card: 2.2 },
  { min_qty: 51, max_qty: 100, usd_per_card: 2.0 },
];
const pricing = { multiplier: 2, normal_floor_brl: 16, holo_floor_brl: 18, foil_floor_brl: 21 };

test('carta de US$ 5: o adicional entra no custo antes do multiplicador e do dólar', () => {
  // (2,20 + 2,50) × 2 × 5,42 = 50,948 → o valor combinado com o cliente (~R$ 50,95)
  assert.equal(pricePerCard({ qty: 15, type: 'Foil', tiers, pricing, fxRate: 5.42, extraUsd: 2.5 }), 50.95);
  // Sem adicional, a mesma Foil segue a fórmula de sempre.
  assert.equal(pricePerCard({ qty: 15, type: 'Foil', tiers, pricing, fxRate: 5.42 }), 23.85);
  // Desconto por volume vale para ela também.
  assert.ok(pricePerCard({ qty: 60, type: 'Foil', tiers, pricing, fxRate: 5.42, extraUsd: 2.5 }) < 50.95);
  // Adicional negativo ou lixo não barateia a carta.
  assert.equal(pricePerCard({ qty: 15, type: 'Foil', tiers, pricing, fxRate: 5.42, extraUsd: -9 }), 23.85);
});

test('o carrinho cotado no servidor usa o adicional de cada linha', () => {
  const q = quoteCart({ items: [{ type: 'Foil', quantity: 1, extra_usd: 2.5 }, { type: 'Normal', quantity: 14 }], tiers, pricing, fxRate: 5.42 });
  assert.equal(q.lines[0].unit_price_brl, 50.95);
  assert.equal(q.lines[1].unit_price_brl, 23.85);
});

test('planilha: "($5 a card)" vira adicional e some do nome', () => {
  assert.equal(supplierExtraUsd('The One Ring LTR #001 (raised golden foil) ($5 a card)'), 2.5);
  assert.equal(supplierExtraUsd('Aclazotz, Deepest Betrayal #88 $5'), 2.5);
  assert.equal(supplierExtraUsd('Sol Ring LTC #408 (raised sliver foil)(111)'), 0);
  assert.equal(cleanCardName('The Soul Stone SPM #242 (raised golden foil) ($5 a card)').includes('$5'), false);
  assert.equal(cleanCardName('Aclazotz, Deepest Betrayal #88 $5'), 'Aclazotz, Deepest Betrayal #88');
  // A carta renomeada no catálogo continua batendo com a linha crua da planilha.
  assert.equal(cardMatchKey('Aclazotz, Deepest Betrayal #88 $5'), cardMatchKey('Aclazotz, Deepest Betrayal #88'));
});

test('admin: adicional do fornecedor editável e validado', () => {
  assert.deepEqual(sanitizeCardPatch({ supplier_extra_usd: '2.5' }), { patch: { supplier_extra_usd: 2.5 } });
  assert.match(sanitizeCardPatch({ supplier_extra_usd: -1 }).error, /inválido/);
});
