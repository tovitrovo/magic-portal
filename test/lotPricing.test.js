import { test } from "node:test";
import assert from "node:assert/strict";
import { computeLotPrice, LOT_DEFAULTS } from "../shared/lotPricing.js";
import { computeCampaignTotal } from "../functions/api/_campaign-helper.js";
import { quoteCart } from "../shared/individualPricing.js";

test("computeLotPrice: cost_original × dólar × fator × (1+margem), teto ao centavo", () => {
  // 89.99 × 5.40 × 1.082 × 1.15 = 604.49... → teto 604.49? calcula exato:
  const p = computeLotPrice({ costOriginalUsd: 89.99, fxRate: 5.4, costFactor: 1.082, marginPercent: 15 });
  const exato = 89.99 * 5.4 * 1.082 * 1.15;
  assert.equal(p, Math.ceil(exato * 100) / 100);
  assert.ok(p > 0);
});

test("computeLotPrice: usa defaults quando fator/margem ausentes", () => {
  const p = computeLotPrice({ costOriginalUsd: 100, fxRate: 5 });
  const exato = 100 * 5 * LOT_DEFAULTS.cost_factor * (1 + LOT_DEFAULTS.margin_percent / 100);
  assert.equal(p, Math.ceil(exato * 100) / 100);
});

test("computeLotPrice: retorna null sem custo ou sem dólar", () => {
  assert.equal(computeLotPrice({ costOriginalUsd: 0, fxRate: 5 }), null);
  assert.equal(computeLotPrice({ costOriginalUsd: 50, fxRate: 0 }), null);
  assert.equal(computeLotPrice({ costOriginalUsd: null, fxRate: 5 }), null);
});

test("campanha: price_brl do lote tem prioridade sobre o preço por tipo", () => {
  const items = [
    { card_id: "lote", quantity: 1, is_bonus: false },   // override 600
    { card_id: "normal", quantity: 2, is_bonus: false },  // 2 × 16 = 32
  ];
  const typeById = { lote: "Normal", normal: "Normal" };
  const priceById = { lote: 600 };
  const pricing = { normal_price_brl: 16, ouro_price_brl: 20, foil_price_brl: 30 };
  const r = computeCampaignTotal({ items, typeById, priceById, pricing, shipping: 0, grantedBonus: 0 });
  assert.equal(r.paidSubtotal, 632);
  assert.equal(r.total, 632);
});

test("individual: price_brl do lote ignora faixa/piso", () => {
  const tiers = [{ min_qty: 1, max_qty: null, usd_per_card: 1.5 }];
  const pricing = { multiplier: 2, normal_floor_brl: 16 };
  const items = [
    { type: "Normal", quantity: 1, price_brl: 600 }, // lote travado
    { type: "Normal", quantity: 1 },                  // 1.5 × 2 × 5 = 15 → piso 16
  ];
  const q = quoteCart({ items, tiers, pricing, fxRate: 5 });
  const lote = q.lines.find((l) => l.price_brl === 600);
  const comum = q.lines.find((l) => l.price_brl == null);
  assert.equal(lote.unit_price_brl, 600);
  assert.equal(comum.unit_price_brl, 16);
  assert.equal(q.subtotal, 616);
});
