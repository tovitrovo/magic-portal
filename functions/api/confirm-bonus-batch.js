/**
 * Confirm a full-bonus batch (no payment required).
 *
 * When a user places an order using only bonus cards, there is no
 * Mercado Pago payment. This endpoint:
 *  1. Verifies user JWT
 *  2. Validates the batch belongs to the user and is a bonus order
 *  3. Marks the batch as PAID with confirmed_at
 *  4. Increments campaign pool_qty_confirmed
 *  5. Updates parent order status to PAID
 */

import { incrementPoolOnPaid } from './_pool-helper.js';

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

    // Verify the batch belongs to this user
    const orderArr = await sbQuery(SB_URL, svcHeaders,
      `orders?id=eq.${enc(batch.order_id)}&user_id=eq.${enc(userId)}&select=id`);
    if (!orderArr.length) return json({ ok: false, error: "Batch não pertence ao usuário" }, 403, CORS);

    // Verify it's a bonus order
    if (batch.payment_method !== 'BONUS') {
      return json({ ok: false, error: "Batch não é um pedido bônus" }, 400, CORS);
    }

    // Skip if already confirmed
    if (batch.status === 'PAID' || batch.status === 'CONFIRMED') {
      return json({ ok: true, alreadyConfirmed: true }, 200, CORS);
    }

    // ─── Increment pool BEFORE marking as PAID ──────
    await incrementPoolOnPaid(SB_URL, SB_SERVICE_ROLE_KEY, batchId);

    // ─── Mark batch as PAID ─────────────────────────
    await fetch(`${SB_URL}/rest/v1/order_batches?id=eq.${enc(batchId)}`, {
      method: "PATCH",
      headers: { ...svcHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({
        status: "PAID",
        confirmed_at: new Date().toISOString(),
        payment_status: "approved",
      }),
    });

    // ─── Update parent order status ─────────────────
    await fetch(`${SB_URL}/rest/v1/orders?id=eq.${enc(batch.order_id)}`, {
      method: "PATCH",
      headers: { ...svcHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({ status: "PAID" }),
    });

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
