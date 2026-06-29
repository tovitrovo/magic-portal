import { test } from "node:test";
import assert from "node:assert/strict";
import { cardPriceBRL, computeCampaignTotal } from "../functions/api/_campaign-helper.js";

const pricing = { normal_price_brl: 16, ouro_price_brl: 20, foil_price_brl: 30 };

test("cardPriceBRL: preço por tipo (case-insensitive) e fallback", () => {
  assert.equal(cardPriceBRL("Foil", pricing), 30);
  assert.equal(cardPriceBRL("foil", pricing), 30);
  assert.equal(cardPriceBRL("Holo", pricing), 20);
  assert.equal(cardPriceBRL("Normal", pricing), 16);
  assert.equal(cardPriceBRL("qualquer-outro", pricing), 16);
  assert.equal(cardPriceBRL(null, pricing), 16);
});

test("computeCampaignTotal: soma só itens pagos, ignora bônus dentro do saldo", () => {
  const items = [
    { card_id: "a", quantity: 2, is_bonus: false }, // 2 x 16 = 32
    { card_id: "b", quantity: 1, is_bonus: false }, // 1 x 30 = 30
    { card_id: "c", quantity: 3, is_bonus: true },  // bônus coberto pelo saldo
  ];
  const typeById = { a: "Normal", b: "Foil", c: "Normal" };
  const r = computeCampaignTotal({ items, typeById, pricing, shipping: 10, grantedBonus: 5 });
  assert.equal(r.paidSubtotal, 62);
  assert.equal(r.bonusQty, 3);
  assert.equal(r.unbackedCharge, 0);
  assert.equal(r.total, 72); // 62 + shipping 10
});

test("computeCampaignTotal: bônus reivindicado acima do saldo é cobrado (maior preço)", () => {
  const items = [
    { card_id: "a", quantity: 1, is_bonus: false }, // 16
    { card_id: "b", quantity: 4, is_bonus: true },  // 4 bônus, saldo 1 → 3 excedentes
  ];
  const typeById = { a: "Normal", b: "Normal" };
  const r = computeCampaignTotal({ items, typeById, pricing, shipping: 0, grantedBonus: 1 });
  assert.equal(r.paidSubtotal, 16);
  assert.equal(r.bonusQty, 4);
  // 3 excedentes x maior preço (foil 30) = 90
  assert.equal(r.unbackedCharge, 90);
  assert.equal(r.total, 106);
});

test("computeCampaignTotal: adulterar total não muda o cálculo (usa itens + pricing)", () => {
  // Cenário do ataque: cliente grava total_locked = 0.01. A função pura
  // ignora isso e recalcula a partir dos itens reais.
  const items = [{ card_id: "x", quantity: 100, is_bonus: false }];
  const typeById = { x: "Normal" };
  const r = computeCampaignTotal({ items, typeById, pricing, shipping: 0, grantedBonus: 0 });
  assert.equal(r.total, 1600); // 100 x 16, independente de qualquer total adulterado
});

test("computeCampaignTotal: quantidades inválidas são ignoradas", () => {
  const items = [
    { card_id: "a", quantity: -5, is_bonus: false },
    { card_id: "a", quantity: 0, is_bonus: false },
    { card_id: "a", quantity: 2.9, is_bonus: false }, // floor → 2
  ];
  const typeById = { a: "Normal" };
  const r = computeCampaignTotal({ items, typeById, pricing, shipping: 0, grantedBonus: 0 });
  assert.equal(r.paidQty, 2);
  assert.equal(r.total, 32);
});
