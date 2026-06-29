import { getUsdBrlRate } from "./_fx-helper.js";
import { computeLotPrice, LOT_DEFAULTS } from "../../shared/lotPricing.js";

/**
 * Recalcula o price_brl de todos os lotes (cards.is_lot = true) a partir do
 * cost_original_usd, do dólar do dia (cacheado ~diário) e da config de lote
 * (lot_cost_factor / lot_margin_percent em pricing_config).
 *
 * Idempotente. Roda na importação de catálogo, sob demanda (admin) e quando o
 * dólar do dia é renovado (fx-rate). Retorna { ok, updated, rate, skipped }.
 */
export async function recalcLotPrices(SB_URL, SB_KEY) {
  const headers = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

  // Config de lote (fator + margem) do pricing_config ativo.
  let costFactor = LOT_DEFAULTS.cost_factor;
  let marginPercent = LOT_DEFAULTS.margin_percent;
  try {
    const r = await fetch(
      `${SB_URL}/rest/v1/pricing_config?is_active=eq.true&select=lot_cost_factor,lot_margin_percent&limit=1`,
      { headers }
    );
    const a = await r.json().catch(() => []);
    if (Array.isArray(a) && a[0]) {
      if (Number(a[0].lot_cost_factor) > 0) costFactor = Number(a[0].lot_cost_factor);
      if (Number(a[0].lot_margin_percent) >= 0) marginPercent = Number(a[0].lot_margin_percent);
    }
  } catch { /* usa defaults */ }

  // Dólar do dia (mesma fonte/cache do resto do app).
  const fx = await getUsdBrlRate(SB_URL, SB_KEY);
  const rate = Number(fx.rate);
  if (!Number.isFinite(rate) || rate <= 0) return { ok: false, error: "dólar indisponível", updated: 0 };

  // Lotes a precificar.
  const lRes = await fetch(`${SB_URL}/rest/v1/cards?is_lot=eq.true&select=id,cost_original_usd`, { headers });
  const lots = await lRes.json().catch(() => []);
  const list = Array.isArray(lots) ? lots : [];

  let updated = 0, skipped = 0;
  for (const lot of list) {
    const price = computeLotPrice({
      costOriginalUsd: lot.cost_original_usd,
      fxRate: rate,
      costFactor,
      marginPercent,
    });
    if (price == null) { skipped++; continue; } // sem cost_original_usd: deixa como está
    const u = await fetch(`${SB_URL}/rest/v1/cards?id=eq.${encodeURIComponent(lot.id)}`, {
      method: "PATCH",
      headers: { ...headers, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ price_brl: price }),
    });
    if (u.ok) updated++; else skipped++;
  }

  return { ok: true, updated, skipped, rate, source: fx.source, costFactor, marginPercent };
}
