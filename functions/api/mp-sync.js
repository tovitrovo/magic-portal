export async function onRequest(context) {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (context.request.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    const { MP_ACCESS_TOKEN, SB_URL, SB_SERVICE_ROLE_KEY } = context.env;

    if (!MP_ACCESS_TOKEN) {
      return new Response(JSON.stringify({ ok: false, error: "MP_ACCESS_TOKEN não configurado" }), {
        status: 500,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    if (!SB_URL || !SB_SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ ok: false, error: "SB_URL/SB_SERVICE_ROLE_KEY não configurado" }), {
        status: 500,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const body = await context.request.json().catch(() => ({}));
    const batchId = String(body.batchId || body.id || "").trim();

    if (!batchId) {
      return new Response(JSON.stringify({ ok: false, error: "batchId ausente" }), {
        status: 400,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const sbHeaders = {
      apikey: SB_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    };

    const bRes = await fetch(
      `${SB_URL}/rest/v1/order_batches?select=id,mp_preference_id,mp_payment_id,status,payment_status&limit=1&id=eq.${encodeURIComponent(batchId)}`,
      { headers: sbHeaders }
    );

    const bArr = await bRes.json().catch(() => []);
    const batch = Array.isArray(bArr) && bArr.length ? bArr[0] : null;

    async function fetchPayment() {
      const pid = batch?.mp_payment_id;
      if (pid) {
        const r = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(pid)}`, {
          headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
        });
        const j = await r.json().catch(() => ({}));
        if (r.ok) return j;
      }

      const pref = batch?.mp_preference_id;
      if (pref) {
        const url = `https://api.mercadopago.com/v1/payments/search?preference_id=${encodeURIComponent(pref)}&sort=date_created&criteria=desc&limit=1`;
        const r = await fetch(url, { headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` } });
        const j = await r.json().catch(() => ({}));
        if (r.ok) {
          const p = Array.isArray(j?.results) && j.results.length ? j.results[0] : null;
          if (p) return p;
        }
      }

      const url = `https://api.mercadopago.com/v1/payments/search?external_reference=${encodeURIComponent(batchId)}&sort=date_created&criteria=desc&limit=1`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error("Mercado Pago search falhou");
      const p = Array.isArray(j?.results) && j.results.length ? j.results[0] : null;
      return p;
    }

    const payment = await fetchPayment().catch(() => null);

    if (!payment) {
      return new Response(JSON.stringify({ ok: true, status: "not_found", batchStatus: "PENDING_PAYMENT", updated: null }), {
        status: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const status = String(payment.status || "");
    const statusDetail = String(payment.status_detail || "");
    const paymentId = String(payment.id || "");

    const statusMap = {
      approved: "PAID",
      in_process: "PENDING_PAYMENT",
      pending: "PENDING_PAYMENT",
      authorized: "PENDING_PAYMENT",
      rejected: "FAILED",
      cancelled: "CANCELLED",
      refunded: "REFUNDED",
      charged_back: "CHARGEDBACK",
    };

    const batchStatus = statusMap[status] || "PENDING_PAYMENT";

    const patchHeaders = {
      apikey: SB_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    };

    const pRes = await fetch(`${SB_URL}/rest/v1/order_batches?id=eq.${encodeURIComponent(batchId)}`, {
      method: "PATCH",
      headers: patchHeaders,
      body: JSON.stringify({
        status: batchStatus,
        confirmed_at: batchStatus === "PAID" ? new Date().toISOString() : null,
        mp_payment_id: paymentId || null,
        payment_status: status,
        payment_status_detail: statusDetail,
      }),
    });

    if (!pRes.ok) {
      const errTxt = await pRes.text().catch(() => "");
      return new Response(JSON.stringify({ ok: false, error: `Supabase PATCH falhou: ${pRes.status} ${errTxt.slice(0, 200)}` }), {
        status: 502,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    let updated = null;
    try {
      const uRes = await fetch(
        `${SB_URL}/rest/v1/order_batches?select=id,status,payment_status,payment_status_detail,mp_payment_id,mp_preference_id,confirmed_at&limit=1&id=eq.${encodeURIComponent(batchId)}`,
        { headers: { apikey: SB_SERVICE_ROLE_KEY, Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}` } }
      );
      const arr = await uRes.json().catch(() => []);
      updated = Array.isArray(arr) && arr.length ? arr[0] : null;
    } catch {}

    return new Response(JSON.stringify({ ok: true, status, batchStatus, paymentId, updated }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
