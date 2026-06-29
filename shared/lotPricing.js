// ──────────────────────────────────────────────────────────────
// Precificação de LOTES (sets / uncut sheets / "PCS/Set"...).
//
//   price_brl = teto( cost_original_usd × dólar × cost_factor × (1 + margin%) )
//
//   cost_factor → custo real do PayPal pago no cartão de crédito BR:
//                 spread PayPal (~4,5%) × IOF (3,5%) ≈ 1,082
//   margin%     → lucro + taxa de recebimento do Mercado Pago
//
// Função pura (sem rede) para ser compartilhada entre servidor (recálculo)
// e testes. O resultado é arredondado pra cima (teto) ao centavo.
// ──────────────────────────────────────────────────────────────

export const LOT_DEFAULTS = {
  cost_factor: 1.082,   // spread PayPal 4,5% × IOF 3,5%
  margin_percent: 15,   // lucro + taxa Mercado Pago
};

// Preço de venda (R$) de um lote. Retorna null quando faltam dados essenciais
// (sem custo de lista ou sem dólar não dá pra precificar com segurança).
export function computeLotPrice({ costOriginalUsd, fxRate, costFactor, marginPercent } = {}) {
  const usd = Number(costOriginalUsd);
  const rate = Number(fxRate);
  if (!Number.isFinite(usd) || usd <= 0) return null;
  if (!Number.isFinite(rate) || rate <= 0) return null;

  const factor = Number.isFinite(Number(costFactor)) && Number(costFactor) > 0
    ? Number(costFactor) : LOT_DEFAULTS.cost_factor;
  const margin = Number.isFinite(Number(marginPercent)) && Number(marginPercent) >= 0
    ? Number(marginPercent) : LOT_DEFAULTS.margin_percent;

  const brl = usd * rate * factor * (1 + margin / 100);
  // Teto ao centavo (evita preços tipo 379,9999).
  return Math.ceil(brl * 100) / 100;
}
