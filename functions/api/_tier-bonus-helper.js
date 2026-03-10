/**
 * Concede bônus de tier-change para TODOS os usuários com pedidos pagos
 * em uma campanha, após um pagamento ser confirmado.
 *
 * Deve ser chamado nos 3 gatilhos de pagamento:
 *   - mp-webhook.js
 *   - admin-mark-paid.js
 *   - mp-sync.js
 *
 * Idempotente: calcula o delta entre o que já foi concedido e o que é devido,
 * e só insere a diferença.
 */

export async function grantTierBonusToAll(sbUrl, sbKey, campaignId) {
  try {
    const svc = {
      apikey: sbKey,
      Authorization: `Bearer ${sbKey}`,
      'Content-Type': 'application/json',
    };

    // ─── 1. Campanha: pool atual ─────────────────────────────
    const campArr = await sbGet(sbUrl, svc,
      `campaigns?id=eq.${enc(campaignId)}&select=pool_qty_confirmed,pool_qty`);
    const camp = campArr[0];
    if (!camp) return;

    const pool = Number(camp.pool_qty_confirmed ?? camp.pool_qty ?? 0);

    // ─── 2. Tiers da campanha ────────────────────────────────
    const tiersArr = await sbGet(sbUrl, svc,
      `tiers?campaign_id=eq.${enc(campaignId)}&order=rank&select=min_qty,max_qty,usd_per_card`);
    if (!tiersArr.length) return;

    // ─── 3. Pricing ativo ────────────────────────────────────
    const pricingArr = await sbGet(sbUrl, svc, `pricing_config?is_active=eq.true&limit=1`);
    const pricing = pricingArr[0];
    if (!pricing) return;

    // ─── 4. Preço atual ──────────────────────────────────────
    const tiers = tiersArr.map(t => ({
      min: Number(t.min_qty),
      max: Number(t.max_qty) || 9999999,
      usd: Number(t.usd_per_card),
    }));
    const tier = tiers.find(t => pool >= t.min && pool <= t.max) || tiers[0];
    const currentPrice = calcBrlPrice(tier.usd, pricing);
    if (currentPrice <= 0) return;

    // ─── 5. Todos os pedidos pagos da campanha ───────────────
    const ordersArr = await sbGet(sbUrl, svc,
      `orders?campaign_id=eq.${enc(campaignId)}&select=id,user_id`);
    if (!ordersArr.length) return;

    // ─── 6. Para cada usuário, calcular e conceder delta ─────
    for (const order of ordersArr) {
      await grantForUser(sbUrl, svc, order.user_id, order.id, campaignId, currentPrice);
    }
  } catch (e) {
    console.error('grantTierBonusToAll error:', e);
  }
}

async function grantForUser(sbUrl, svc, userId, orderId, campaignId, currentPrice) {
  // orderId is required by the production schema (NOT NULL)
  try {
    // Batches pagos (não-bônus): base financeira para o cálculo
    const paidBatchArr = await sbGet(sbUrl, svc,
      `order_batches?order_id=eq.${enc(orderId)}&status=in.(PAID,CONFIRMED,APPROVED)&payment_method=neq.BONUS&select=brl_unit_price_locked,subtotal_locked`);

    if (!paidBatchArr.length) return;

    // Soma global de subtotais e qtds pagas
    let totalSubtotal = 0;
    let totalPaidQty = 0;
    for (const b of paidBatchArr) {
      const lockedPrice = Number(b.brl_unit_price_locked || 0);
      const subtotal = Number(b.subtotal_locked || 0);
      if (lockedPrice <= 0 || subtotal <= 0) continue;
      totalSubtotal += subtotal;
      totalPaidQty += Math.round(subtotal / lockedPrice);
    }

    if (totalSubtotal <= 0) return;

    // Batches de bônus já utilizados: contam como "cartas pagas" para não
    // gerar novo bônus de tier sobre cartas que o usuário já recebeu de graça.
    const bonusBatchArr = await sbGet(sbUrl, svc,
      `order_batches?order_id=eq.${enc(orderId)}&status=in.(PAID,CONFIRMED,APPROVED)&payment_method=eq.BONUS&select=qty_in_batch`);
    for (const b of bonusBatchArr) {
      totalPaidQty += Number(b.qty_in_batch || 0);
    }

    const totalExpected = Math.max(0, Math.floor(totalSubtotal / currentPrice) - totalPaidQty);
    if (totalExpected <= 0) return;

    // Grants TIER_CHANGE já existentes (AVAILABLE + USED) para não duplicar
    const existingArr = await sbGet(sbUrl, svc,
      `bonus_grants?user_id=eq.${enc(userId)}&campaign_id=eq.${enc(campaignId)}&grant_type=eq.TIER_CHANGE&select=bonus_qty`);
    const existingTotal = existingArr.reduce((s, g) => s + Number(g.bonus_qty || 0), 0);

    const delta = totalExpected - existingTotal;
    if (delta <= 0) return;

    // Inserir grant do delta
    await fetch(`${sbUrl}/rest/v1/bonus_grants`, {
      method: 'POST',
      headers: { ...svc, Prefer: 'return=minimal' },
      body: JSON.stringify({
        user_id: userId,
        campaign_id: campaignId,
        order_id: orderId,
        bonus_qty: delta,
        status: 'AVAILABLE',
        grant_type: 'TIER_CHANGE',
        batch_id: null,
      }),
    });
  } catch (e) {
    console.error(`grantForUser error (user=${userId}):`, e);
  }
}

// ─── Helpers ────────────────────────────────────────────────

function enc(v) { return encodeURIComponent(v); }

async function sbGet(sbUrl, headers, path) {
  const r = await fetch(`${sbUrl}/rest/v1/${path}`, { headers });
  if (!r.ok) return [];
  const data = await r.json().catch(() => []);
  return Array.isArray(data) ? data : [];
}

function calcBrlPrice(usdPerCard, pricing) {
  if (!pricing) return 0;
  const base = usdPerCard * (1 + (Number(pricing.card_fee_percent) || 0) / 100);
  const taxed = base * (1 + (Number(pricing.tax_percent) || 0) / 100);
  const brl = taxed * (Number(pricing.usd_brl_rate) || 5.68);
  const marked = brl * (1 + (Number(pricing.markup_percent) || 0) / 100);
  return Math.ceil(marked + (Number(pricing.profit_fixed_brl) || 0));
}
