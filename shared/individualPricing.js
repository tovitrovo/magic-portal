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
export function pricePerCard({ qty, type, tiers, pricing = {}, fxRate }) {
  const tier = pickTier(qty, tiers);
  if (!tier) return floorForType(type, pricing);
  const multiplier = Number(pricing.multiplier ?? DEFAULTS.multiplier);
  const rate = Number(fxRate) > 0 ? Number(fxRate) : Number(pricing.fx_fallback_rate ?? DEFAULTS.fx_fallback_rate);
  const computed = Number(tier.usd_per_card) * multiplier * rate;
  return round2(Math.max(computed, floorForType(type, pricing)));
}

// Total do carrinho. items: [{ type, quantity }]. A quantidade total
// (soma das quantidades) define a faixa aplicada a todas as cartas.
//
// tierQty permite puxar a faixa por um volume MAIOR que o do carrinho: é o
// caso da adição de cartas a um pedido individual já pago, em que as cartas
// novas viajam junto com as antigas e por isso são precificadas pelo volume
// somado. Nunca reduz a quantidade — só sobe.
export function quoteCart({ items, tiers, pricing = {}, fxRate, tierQty = null }) {
  const list = Array.isArray(items) ? items : [];
  const totalQty = list.reduce((s, i) => s + Math.max(0, Math.floor(Number(i.quantity) || 0)), 0);
  const qtyForTier = Math.max(totalQty, Math.max(0, Math.floor(Number(tierQty) || 0)));
  const lines = list.map((i) => {
    const unit = pricePerCard({ qty: qtyForTier, type: i.type, tiers, pricing, fxRate });
    const quantity = Math.max(0, Math.floor(Number(i.quantity) || 0));
    return { ...i, quantity, unit_price_brl: unit, line_total_brl: round2(unit * quantity) };
  });
  const subtotal = round2(lines.reduce((s, l) => s + l.line_total_brl, 0));
  const tier = pickTier(qtyForTier, tiers);
  return { totalQty, tierQty: qtyForTier, subtotal, lines, tier };
}

// ──────────────────────────────────────────────────────────────
// O PISO ACHATA O FIM DA ESCADA
//
// O preço é `máx(custo × multiplicador × dólar, piso[tipo])`. Passado o ponto
// em que o custo da faixa cai abaixo do piso, todas as faixas seguintes valem
// o mesmo — o desconto por volume acaba, ainda que a tabela siga crescendo.
// Com a configuração de produção isso começa cedo: Foil trava no piso a partir
// de ~50 cartas, Holo a partir de ~300.
//
// As duas funções abaixo existem para a interface não mentir por causa disso.
// ──────────────────────────────────────────────────────────────

// Próxima faixa que REALMENTE baixa o preço. Sem esse filtro, a home promete
// "faltam 81 cartas para pagar R$ 16,00" para quem já paga R$ 16,00 — um
// convite a gastar mais por nada. Devolve também o preço da faixa e quanto o
// cliente economiza no pedido inteiro ao alcançá-la.
export function nextCheaperTier(qty, { tiers, pricing = {}, fxRate, type = 'Normal' } = {}) {
  const q = Math.max(0, Math.floor(Number(qty) || 0));
  const current = pricePerCard({ qty: q, type, tiers, pricing, fxRate });
  const sorted = [...(tiers || [])].sort((a, b) => Number(a.min_qty) - Number(b.min_qty));
  for (const tier of sorted) {
    const min = Number(tier.min_qty) || 0;
    if (min <= q) continue;
    const unit = pricePerCard({ qty: min, type, tiers, pricing, fxRate });
    // O desconto vale para o pedido todo, não só para as cartas que faltam.
    if (unit < current) return { tier, missing: min - q, unit, saving: round2((current - unit) * min) };
  }
  return { tier: null, missing: 0, unit: current, saving: 0 };
}

// A escada como o cliente deve vê-la: sem as faixas que o mínimo do pedido
// torna inalcançáveis e sem repetir o mesmo preço em linhas seguidas — com a
// configuração de produção, as quatro últimas faixas da carta Normal caem
// todas em R$ 16,00 e virariam quatro linhas idênticas na tela.
export function discountLadder({ tiers, pricing = {}, fxRate, type = 'Normal', minCards = 0 } = {}) {
  const floor = Math.max(0, Math.floor(Number(minCards) || 0));
  const sorted = [...(tiers || [])].sort((a, b) => Number(a.min_qty) - Number(b.min_qty));
  const rows = [];
  for (const tier of sorted) {
    const max = tier.max_qty == null ? null : Number(tier.max_qty);
    if (max != null && max < floor) continue; // faixa inteira abaixo do mínimo
    const min = Math.max(Number(tier.min_qty) || 0, floor);
    const unit = pricePerCard({ qty: min, type, tiers, pricing, fxRate });
    const last = rows[rows.length - 1];
    if (last && last.unit === unit) { last.max = max; continue; }
    rows.push({ min, max, unit });
  }
  return rows;
}
