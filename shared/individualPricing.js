// ──────────────────────────────────────────────────────────────
// Precificação do PEDIDO INDIVIDUAL (desconto por volume).
//
//   preço por carta (R$) = máx( custo_da_faixa(USD) × multiplier × dólar , piso[tipo] )
//
// O custo vem da faixa de quantidade (individual_tiers) escolhida pelo
// TOTAL de cartas no carrinho; o preço reajusta conforme a quantidade.
// Compartilhado entre a UI (preview ao vivo) e o servidor (trava no
// fechamento do pagamento — fonte de verdade).
// ──────────────────────────────────────────────────────────────

export const DEFAULTS = {
  multiplier: 2.0,
  normal_floor_brl: 16,
  holo_floor_brl: 18,
  foil_floor_brl: 21,
  fx_fallback_rate: 5.5,
  min_cards: 15,
};

// Seleciona a faixa cujo intervalo [min_qty, max_qty] contém a quantidade.
// max_qty null = sem limite superior. Aceita tiers fora de ordem.
export function pickTier(qty, tiers) {
  const q = Math.max(0, Math.floor(Number(qty) || 0));
  const sorted = [...(tiers || [])].sort((a, b) => Number(a.min_qty) - Number(b.min_qty));
  let chosen = null;
  for (const t of sorted) {
    const min = Number(t.min_qty);
    const max = t.max_qty == null ? Infinity : Number(t.max_qty);
    if (q >= min && q <= max) { chosen = t; break; }
  }
  // Abaixo da primeira faixa, usa a primeira (mais cara); acima, a última.
  if (!chosen && sorted.length) chosen = q < Number(sorted[0].min_qty) ? sorted[0] : sorted[sorted.length - 1];
  return chosen || null;
}

// Piso em R$ conforme o tipo da carta.
export function floorForType(type, pricing = {}) {
  const t = String(type || '').toLowerCase();
  if (t === 'foil') return Number(pricing.foil_floor_brl ?? DEFAULTS.foil_floor_brl);
  if (t === 'holo' || t === 'ouro') return Number(pricing.holo_floor_brl ?? DEFAULTS.holo_floor_brl);
  return Number(pricing.normal_floor_brl ?? DEFAULTS.normal_floor_brl);
}

function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }

// Preço de UMA carta (R$), dada a quantidade total do carrinho e o tipo.
// priceOverride (ex.: price_brl de um lote) tem prioridade e ignora faixa/piso.
export function pricePerCard({ qty, type, tiers, pricing = {}, fxRate, priceOverride = null }) {
  const ov = Number(priceOverride);
  if (Number.isFinite(ov) && ov > 0) return round2(ov);
  const tier = pickTier(qty, tiers);
  if (!tier) return floorForType(type, pricing);
  const multiplier = Number(pricing.multiplier ?? DEFAULTS.multiplier);
  const rate = Number(fxRate) > 0 ? Number(fxRate) : Number(pricing.fx_fallback_rate ?? DEFAULTS.fx_fallback_rate);
  const computed = Number(tier.usd_per_card) * multiplier * rate;
  return round2(Math.max(computed, floorForType(type, pricing)));
}

// Total do carrinho. items: [{ type, quantity }]. A quantidade total
// (soma das quantidades) define a faixa aplicada a todas as cartas.
export function quoteCart({ items, tiers, pricing = {}, fxRate }) {
  const list = Array.isArray(items) ? items : [];
  const totalQty = list.reduce((s, i) => s + Math.max(0, Math.floor(Number(i.quantity) || 0)), 0);
  const lines = list.map((i) => {
    const unit = pricePerCard({ qty: totalQty, type: i.type, tiers, pricing, fxRate, priceOverride: i.price_brl });
    const quantity = Math.max(0, Math.floor(Number(i.quantity) || 0));
    return { ...i, quantity, unit_price_brl: unit, line_total_brl: round2(unit * quantity) };
  });
  const subtotal = round2(lines.reduce((s, l) => s + l.line_total_brl, 0));
  const tier = pickTier(totalQty, tiers);
  return { totalQty, subtotal, lines, tier };
}
