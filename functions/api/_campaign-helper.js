/**
 * Recálculo AUTORITATIVO do valor de um batch no servidor.
 *
 * Não confia nos campos gravados pelo cliente via REST do Supabase
 * (unit_price_brl / subtotal_locked / total_locked), que estão sob RLS e
 * podem ser adulterados. Para pedidos de CAMPANHA, o preço por carta é
 * relido de pricing_config (preço fixo por tipo) e o tipo da carta é relido
 * da tabela cards. Para pedidos INDIVIDUAIS, o total_locked já é calculado
 * de forma autoritativa no checkout (individual-checkout.js), então é mantido.
 */

const enc = encodeURIComponent;

// Preço BRL por carta de campanha, conforme o tipo (mesma regra do cliente).
// Foil → foil_price_brl | Holo → ouro_price_brl | demais → normal_price_brl
export function cardPriceBRL(cardType, pricing) {
  const t = String(cardType || "Normal").toLowerCase();
  if (t === "foil") return Number(pricing?.foil_price_brl) || 18;
  if (t === "holo") return Number(pricing?.ouro_price_brl) || 16;
  return Number(pricing?.normal_price_brl) || 16;
}

/**
 * Função PURA (sem rede) que calcula o total autoritativo de um batch de
 * campanha. Separada para ser testável.
 *
 * @param items       [{ card_id, quantity, is_bonus }]
 * @param typeById    Map<card_id, type>  (tipos relidos do banco)
 * @param pricing     { normal_price_brl, ouro_price_brl, foil_price_brl }
 * @param shipping    número (shipping_locked do batch)
 * @param grantedBonus saldo de bônus AVAILABLE do usuário na campanha
 */
export function computeCampaignTotal({ items, typeById, pricing, shipping = 0, grantedBonus = 0, priceById = null }) {
  const map = typeById instanceof Map ? typeById : new Map(Object.entries(typeById || {}));
  const overrides = priceById instanceof Map ? priceById : new Map(Object.entries(priceById || {}));
  // Preço unitário: lote com price_brl travado tem prioridade; senão, preço por tipo.
  const unitFor = (cardId) => {
    const ov = Number(overrides.get(cardId));
    return Number.isFinite(ov) && ov > 0 ? ov : cardPriceBRL(map.get(cardId), pricing);
  };
  let paidSubtotal = 0, paidQty = 0, bonusQty = 0;
  for (const it of (Array.isArray(items) ? items : [])) {
    const qty = Math.max(0, Math.floor(Number(it?.quantity) || 0));
    if (qty <= 0) continue;
    if (it.is_bonus) { bonusQty += qty; continue; }
    paidSubtotal += unitFor(it.card_id) * qty;
    paidQty += qty;
  }
  // Bônus reivindicado acima do saldo concedido é cobrado (nunca de graça).
  let unbackedCharge = 0;
  if (bonusQty > grantedBonus) {
    const excess = bonusQty - grantedBonus;
    const maxPrice = Math.max(
      Number(pricing?.normal_price_brl) || 16,
      Number(pricing?.ouro_price_brl) || 16,
      Number(pricing?.foil_price_brl) || 18
    );
    unbackedCharge = excess * maxPrice;
  }
  const ship = Number(shipping || 0);
  const total = Math.round((paidSubtotal + unbackedCharge + ship) * 100) / 100;
  return { total, paidSubtotal: Math.round(paidSubtotal * 100) / 100, shipping: ship, paidQty, bonusQty, grantedBonus, unbackedCharge };
}

/**
 * Recalcula o total de um batch de CAMPANHA a partir dos itens e do
 * pricing_config. Retorna null se faltar dado essencial (o chamador deve
 * então recorrer ao total_locked como fallback defensivo).
 */
async function quoteCampaignBatch(SB_URL, SB_KEY, batch, order) {
  const headers = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

  // Itens do batch
  const iRes = await fetch(
    `${SB_URL}/rest/v1/order_items?batch_id=eq.${enc(batch_id_of(batch))}&select=card_id,quantity,is_bonus`,
    { headers }
  );
  const items = await iRes.json().catch(() => []);
  const list = Array.isArray(items) ? items : [];

  // Tipos reais das cartas (ignora o que o cliente possa ter gravado)
  const ids = [...new Set(list.map((i) => i.card_id).filter(Boolean))];
  let typeById = new Map();
  let priceById = new Map();
  if (ids.length) {
    const inList = ids.map((id) => `"${id}"`).join(",");
    const cRes = await fetch(`${SB_URL}/rest/v1/cards?id=in.(${inList})&select=id,type,price_brl`, { headers });
    const cards = await cRes.json().catch(() => []);
    const arr = Array.isArray(cards) ? cards : [];
    typeById = new Map(arr.map((c) => [c.id, c.type]));
    priceById = new Map(arr.filter((c) => Number(c.price_brl) > 0).map((c) => [c.id, Number(c.price_brl)]));
  }

  // Config de preços ativa
  const pRes = await fetch(
    `${SB_URL}/rest/v1/pricing_config?is_active=eq.true&select=normal_price_brl,ouro_price_brl,foil_price_brl&limit=1`,
    { headers }
  );
  const pArr = await pRes.json().catch(() => []);
  const pricing = Array.isArray(pArr) && pArr.length ? pArr[0] : null;
  if (!pricing) return null; // sem config não recalculamos com segurança

  // Saldo de bônus AVAILABLE do usuário na campanha
  let grantedBonus = 0;
  if (order?.campaign_id && order?.user_id) {
    const gRes = await fetch(
      `${SB_URL}/rest/v1/bonus_grants?user_id=eq.${enc(order.user_id)}&campaign_id=eq.${enc(order.campaign_id)}&status=eq.AVAILABLE&select=bonus_qty`,
      { headers }
    );
    const grants = await gRes.json().catch(() => []);
    grantedBonus = (Array.isArray(grants) ? grants : []).reduce((s, g) => s + Number(g.bonus_qty || 0), 0);
  }

  return computeCampaignTotal({
    items: list,
    typeById,
    priceById,
    pricing,
    shipping: Number(batch.shipping_locked || 0),
    grantedBonus,
  });
}

// batch pode chegar com id em propriedades diferentes; normaliza.
function batch_id_of(batch) {
  return batch?.id || batch?.batch_id || "";
}

/**
 * Valor autoritativo a cobrar por um batch, no servidor.
 * Lê batch + order; INDIVIDUAL usa total_locked (já autoritativo),
 * CAMPANHA recalcula. Retorna { ok, total, status, kind } ou { ok:false }.
 */
export async function authoritativeBatchTotal(SB_URL, SB_KEY, batchId) {
  const headers = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

  const bRes = await fetch(
    `${SB_URL}/rest/v1/order_batches?id=eq.${enc(batchId)}&select=id,order_id,shipping_locked,total_locked,status&limit=1`,
    { headers }
  );
  const bArr = await bRes.json().catch(() => []);
  const batch = Array.isArray(bArr) && bArr.length ? bArr[0] : null;
  if (!batch) return { ok: false };

  const oRes = await fetch(
    `${SB_URL}/rest/v1/orders?id=eq.${enc(batch.order_id)}&select=user_id,campaign_id,kind&limit=1`,
    { headers }
  );
  const oArr = await oRes.json().catch(() => []);
  const order = Array.isArray(oArr) && oArr.length ? oArr[0] : null;

  const lockedTotal = Number(batch.total_locked || 0);

  // INDIVIDUAL: total já é autoritativo (calculado em individual-checkout).
  if (order?.kind === "INDIVIDUAL") {
    return { ok: true, total: lockedTotal, status: batch.status, kind: "INDIVIDUAL" };
  }

  // CAMPANHA: recalcula; em falha, cai no total_locked como defesa.
  const quote = await quoteCampaignBatch(SB_URL, SB_KEY, batch, order).catch(() => null);
  const total = quote && Number.isFinite(quote.total) && quote.total > 0 ? quote.total : lockedTotal;
  return { ok: true, total, status: batch.status, kind: order?.kind || "CAMPAIGN", quote };
}
