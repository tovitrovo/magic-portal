import { getUsdBrlRate } from "./_fx-helper.js";
import { quoteCart, DEFAULTS } from "../../shared/individualPricing.js";

// Carrega os insumos de preço do pedido individual: faixas, config e dólar do dia.
export async function loadPricingInputs(SB_URL, SB_KEY) {
  const headers = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

  const [tiersRes, cfgRes] = await Promise.all([
    fetch(`${SB_URL}/rest/v1/individual_tiers?select=min_qty,max_qty,usd_per_card&order=min_qty`, { headers }),
    fetch(`${SB_URL}/rest/v1/individual_pricing?is_active=eq.true&select=*&limit=1`, { headers }),
  ]);
  const tiers = await tiersRes.json().catch(() => []);
  const cfgArr = await cfgRes.json().catch(() => []);
  const pricing = (Array.isArray(cfgArr) && cfgArr[0]) ? cfgArr[0] : { ...DEFAULTS };

  const fx = await getUsdBrlRate(SB_URL, SB_KEY, { fallback: Number(pricing.fx_fallback_rate) || DEFAULTS.fx_fallback_rate });

  return { tiers: Array.isArray(tiers) ? tiers : [], pricing, fx };
}

// Cotação autoritativa do servidor. Relê o TIPO de cada carta no banco
// (ignora o tipo enviado pelo cliente) e precifica via shared/individualPricing.
// items: [{ card_id, quantity }]  →  { totalQty, subtotal, lines, tier, fx }
export async function quoteItems(SB_URL, SB_KEY, items, inputs = null) {
  const headers = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };
  const list = Array.isArray(items) ? items.filter(i => i && i.card_id) : [];
  const { tiers, pricing, fx } = inputs || await loadPricingInputs(SB_URL, SB_KEY);

  if (!list.length) return { totalQty: 0, subtotal: 0, lines: [], tier: null, fx, pricing };

  // Relê os tipos reais das cartas
  const ids = [...new Set(list.map(i => i.card_id))];
  const inList = ids.map(id => `"${id}"`).join(",");
  const r = await fetch(`${SB_URL}/rest/v1/cards?id=in.(${inList})&select=id,type,name`, { headers });
  const cards = await r.json().catch(() => []);
  const typeById = new Map((Array.isArray(cards) ? cards : []).map(c => [c.id, c.type]));
  const nameById = new Map((Array.isArray(cards) ? cards : []).map(c => [c.id, c.name]));

  const cartItems = list.map(i => ({
    card_id: i.card_id,
    name: nameById.get(i.card_id) || null,
    type: typeById.get(i.card_id) || "Normal",
    quantity: Math.max(0, Math.floor(Number(i.quantity) || 0)),
  }));

  const quote = quoteCart({ items: cartItems, tiers, pricing, fxRate: fx.rate });
  return { ...quote, fx, pricing };
}
