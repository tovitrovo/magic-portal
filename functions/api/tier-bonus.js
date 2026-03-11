/**
 * Auto-grant tier-change bonus cards.
 *
 * When the pool grows and the campaign moves to a cheaper tier,
 * users who already paid at the higher price deserve bonus cards
 * for the price difference.
 *
 * Flow:
 *  1. Verify user JWT
 *  2. Fetch campaign pool, tiers, pricing → compute current BRL price
 *  3. Fetch user's paid batches (non-bonus)
 *  4. Global calculation:
 *     totalSubtotal  = sum of subtotal_locked across all paid batches
 *     totalPaidQty   = sum of round(subtotal / lockedPrice) per batch
 *     totalExpected   = floor(totalSubtotal / currentPrice) − totalPaidQty
 *  5. Query existing TIER_CHANGE grants (AVAILABLE + USED) for user+campaign
 *  6. If expected > existing → INSERT new grant for the delta
 *  7. Return { ok, tierBonus }
 */

export async function onRequest(context) {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (context.request.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { SB_URL, SB_SERVICE_ROLE_KEY } = context.env;
    if (!SB_URL || !SB_SERVICE_ROLE_KEY) {
      return json({ ok: false, error: "SB_URL/SB_SERVICE_ROLE_KEY não configurado" }, 500, CORS);
    }

    // ─── Authenticate user via JWT ───────────────────
    const authHeader = context.request.headers.get("Authorization") || "";
    const userToken = authHeader.replace("Bearer ", "").trim();
    if (!userToken) return json({ ok: false, error: "Token ausente" }, 401, CORS);

    const meRes = await fetch(`${SB_URL}/auth/v1/user`, {
      headers: { apikey: SB_SERVICE_ROLE_KEY, Authorization: `Bearer ${userToken}` },
    });
    if (!meRes.ok) return json({ ok: false, error: "Token inválido" }, 401, CORS);
    const me = await meRes.json();
    const userId = me.id;
    if (!userId) return json({ ok: false, error: "Token inválido" }, 401, CORS);

    // ─── Parse body ─────────────────────────────────
    const body = await context.request.json().catch(() => ({}));
    const { campaignId } = body;
    if (!campaignId) return json({ ok: false, error: "campaignId obrigatório" }, 400, CORS);

    const svcHeaders = {
      apikey: SB_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    };

    // ─── Fetch campaign ─────────────────────────────
    const campArr = await sbQuery(SB_URL, svcHeaders,
      `campaigns?id=eq.${enc(campaignId)}&select=id,pool_qty_confirmed`);
    const camp = campArr[0];
    if (!camp) return json({ ok: true, tierBonus: 0 }, 200, CORS);

    const pool = Number(camp.pool_qty_confirmed ?? 0);

    // ─── Fetch tiers ────────────────────────────────
    const tiersArr = await sbQuery(SB_URL, svcHeaders,
      `tiers?campaign_id=eq.${enc(campaignId)}&order=rank&select=min_qty,max_qty,usd_per_card`);
    if (!tiersArr.length) return json({ ok: true, tierBonus: 0 }, 200, CORS);

    // ─── Fetch pricing ──────────────────────────────
    const pricingArr = await sbQuery(SB_URL, svcHeaders,
      `pricing_config?is_active=eq.true&limit=1`);
    const pricing = pricingArr[0];
    if (!pricing) return json({ ok: true, tierBonus: 0 }, 200, CORS);

    // ─── Compute current price ──────────────────────
    const tiers = tiersArr.map(t => ({
      min: Number(t.min_qty),
      max: Number(t.max_qty) || 9999999,
      usd: Number(t.usd_per_card),
    }));
    const tier = tiers.find(t => pool >= t.min && pool <= t.max) || tiers[0];
    const currentPrice = calcBrlPrice(tier.usd, pricing);
    if (currentPrice <= 0) return json({ ok: true, tierBonus: 0 }, 200, CORS);

    // ─── Fetch user's order for this campaign ───────
    const orderArr = await sbQuery(SB_URL, svcHeaders,
      `orders?campaign_id=eq.${enc(campaignId)}&user_id=eq.${enc(userId)}&select=id`);
    const order = orderArr[0];
    if (!order) return json({ ok: true, tierBonus: 0 }, 200, CORS);

    // ─── Fetch user's paid batches ──────────────────
    const paidStatuses = "status=in.(PAID,PAID_CONFIRMED)";
    const batchArr = await sbQuery(SB_URL, svcHeaders,
      `order_batches?order_id=eq.${enc(order.id)}&${paidStatuses}&payment_method=neq.BONUS&select=id,brl_unit_price_locked,subtotal_locked,qty_in_batch`);

    // ─── Global bonus calculation ──────────────────
    // Sum ALL paid subtotals and paid qtys across batches,
    // then compute bonus from the global totals.
    // This avoids losing fractional bonuses that add up across batches.
    // We include all batches regardless of lockedPrice vs currentPrice;
    // batches at the same price contribute zero bonus (equivalent = paid),
    // and Math.max(0, ...) guards against edge cases.
    let totalSubtotal = 0;
    let totalPaidQty = 0;
    for (const b of batchArr) {
      const lockedPrice = Number(b.brl_unit_price_locked || 0);
      const subtotal = Number(b.subtotal_locked || 0);
      if (lockedPrice <= 0 || subtotal <= 0) continue;
      totalSubtotal += subtotal;
      // round: paidQty was an exact integer at order time (subtotal = paidQty * lockedPrice),
      // so Math.round handles floating-point imprecision.
      totalPaidQty += Math.round(subtotal / lockedPrice);
    }

    if (totalSubtotal <= 0) return json({ ok: true, tierBonus: 0 }, 200, CORS);

    // floor: you can only grant whole bonus cards, round down to be conservative.
    const totalExpected = Math.max(0, Math.floor(totalSubtotal / currentPrice) - totalPaidQty);

    if (totalExpected <= 0) return json({ ok: true, tierBonus: 0 }, 200, CORS);

    // ─── Fetch existing TIER_CHANGE grants ──────────
    const existingArr = await sbQuery(SB_URL, svcHeaders,
      `bonus_grants?user_id=eq.${enc(userId)}&campaign_id=eq.${enc(campaignId)}&grant_type=eq.TIER_CHANGE&select=bonus_qty,status`);
    const existingTotal = existingArr.reduce((s, g) => s + Number(g.bonus_qty || 0), 0);

    const delta = totalExpected - existingTotal;
    if (delta <= 0) return json({ ok: true, tierBonus: totalExpected }, 200, CORS);

    // ─── Create new tier-change grant ───────────────
    await fetch(`${SB_URL}/rest/v1/bonus_grants`, {
      method: "POST",
      headers: { ...svcHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({
        user_id: userId,
        campaign_id: campaignId,
        bonus_qty: delta,
        status: "AVAILABLE",
        grant_type: "TIER_CHANGE",
        batch_id: null,
      }),
    });

    return json({ ok: true, tierBonus: totalExpected, granted: delta }, 201, CORS);
  } catch (e) {
    console.error("tier-bonus error:", e);
    return json({ ok: false, error: String(e?.message || e) }, 500, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "content-type, authorization",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    });
  }
}

// ─── Helpers ──────────────────────────────────────────

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status, headers: { ...cors, "Content-Type": "application/json" },
  });
}

function enc(v) { return encodeURIComponent(v); }

async function sbQuery(sbUrl, headers, path) {
  const r = await fetch(`${sbUrl}/rest/v1/${path}`, { headers });
  if (!r.ok) return [];
  const data = await r.json().catch(() => []);
  return Array.isArray(data) ? data : [];
}

/**
 * Same calculation as the client-side calcBrlPrice in MagicPortal.jsx.
 * The fallback rate 5.68 matches the client; only used when pricing_config has no usd_brl_rate.
 */
function calcBrlPrice(usdPerCard, pricing) {
  if (!pricing) return 0;
  const base = usdPerCard * (1 + (Number(pricing.card_fee_percent) || 0) / 100);
  const taxed = base * (1 + (Number(pricing.tax_percent) || 0) / 100);
  const brl = taxed * (Number(pricing.usd_brl_rate) || 5.68);
  const marked = brl * (1 + (Number(pricing.markup_percent) || 0) / 100);
  return Math.ceil(marked + (Number(pricing.profit_fixed_brl) || 0));
}
