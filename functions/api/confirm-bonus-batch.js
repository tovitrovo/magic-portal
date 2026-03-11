/**
 * Confirm a full-bonus batch (no payment required).
 *
 *  1. Verifies user JWT
 *  2. Validates the batch belongs to the user and is a bonus order
 *  3. Consumes AVAILABLE bonus_grants (marks as USED) for the qty used
 *  4. Marks the batch as PAID with confirmed_at
 *  5. Increments campaign pool_qty_confirmed
 *  6. Updates parent order status to PAID
 *  7. Recalculates tier-change bonus for all users in the campaign
 */

import { incrementPoolOnPaid } from './_pool-helper.js';
import { grantTierBonusToAll } from './_tier-bonus-helper.js';

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
    const { batchId } = body;
    if (!batchId) return json({ ok: false, error: "batchId obrigatório" }, 400, CORS);

    const svcHeaders = {
      apikey: SB_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    };

    // ─── Fetch batch and verify ownership ───────────
    const batchArr = await sbQuery(SB_URL, svcHeaders,
      `order_batches?id=eq.${enc(batchId)}&select=id,order_id,status,payment_method,total_locked,qty_in_batch`);
    const batch = batchArr[0];
    if (!batch) return json({ ok: false, error: "Batch não encontrado" }, 404, CORS);

    const orderArr = await sbQuery(SB_URL, svcHeaders,
      `orders?id=eq.${enc(batch.order_id)}&user_id=eq.${enc(userId)}&select=id,campaign_id`);
    if (!orderArr.length) return json({ ok: false, error: "Batch não pertence ao usuário" }, 403, CORS);
    const campaignId = orderArr[0].campaign_id;

    if (batch.payment_method !== 'BONUS') {
      return json({ ok: false, error: "Batch não é um pedido bônus" }, 400, CORS);
    }

    // Skip if already confirmed
    if (batch.status === 'PAID' || batch.status === 'PAID_CONFIRMED') {
      return json({ ok: true, alreadyConfirmed: true }, 200, CORS);
    }

    const qtyToConsume = Number(batch.qty_in_batch || 0);

    // ─── Consume bonus_grants ────────────────────────
    // Fetch AVAILABLE grants sorted oldest first
    const grantsArr = await sbQuery(SB_URL, svcHeaders,
      `bonus_grants?user_id=eq.${enc(userId)}&campaign_id=eq.${enc(campaignId)}&status=eq.AVAILABLE&order=created_at.asc`);

    let remaining = qtyToConsume;
    for (const grant of grantsArr) {
      if (remaining <= 0) break;
      const grantQty = Number(grant.bonus_qty || 0);

      if (remaining >= grantQty) {
        // Consume entire grant
        await fetch(`${SB_URL}/rest/v1/bonus_grants?id=eq.${enc(grant.id)}`, {
          method: "PATCH",
          headers: { ...svcHeaders, Prefer: "return=minimal" },
          body: JSON.stringify({ status: "USED" }),
        });
        remaining -= grantQty;
      } else {
        // Partially consume grant
        await fetch(`${SB_URL}/rest/v1/bonus_grants?id=eq.${enc(grant.id)}`, {
          method: "PATCH",
          headers: { ...svcHeaders, Prefer: "return=minimal" },
          body: JSON.stringify({ bonus_qty: grantQty - remaining }),
        });
        remaining = 0;
      }
    }

    // ─── Increment pool BEFORE marking as PAID ──────
    await incrementPoolOnPaid(SB_URL, SB_SERVICE_ROLE_KEY, batchId);

    // ─── Mark batch as PAID ─────────────────────────
    const patchRes = await fetch(`${SB_URL}/rest/v1/order_batches?id=eq.${enc(batchId)}`, {
      method: "PATCH",
      headers: { ...svcHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({
        status: "PAID",
        confirmed_at: new Date().toISOString(),
        payment_status: "approved",
      }),
    });
    if (!patchRes.ok) {
      const errTxt = await patchRes.text().catch(() => "");
      console.error("confirm-bonus-batch: failed to mark batch PAID:", patchRes.status, errTxt);
      return json({ ok: false, error: "Falha ao confirmar batch" }, 502, CORS);
    }

    // ─── Update parent order status ─────────────────
    await fetch(`${SB_URL}/rest/v1/orders?id=eq.${enc(batch.order_id)}`, {
      method: "PATCH",
      headers: { ...svcHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({ status: "PAID_CONFIRMED" }),
    }).catch(e => console.error("confirm-bonus-batch: failed to update order status:", e));

    // ─── Recalculate tier-change bonus for all users ─
    if (campaignId) {
      await grantTierBonusToAll(SB_URL, SB_SERVICE_ROLE_KEY, campaignId)
        .catch(e => console.error("confirm-bonus-batch: tier bonus error:", e));
    }

    return json({ ok: true }, 200, CORS);
  } catch (e) {
    console.error("confirm-bonus-batch error:", e);
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
