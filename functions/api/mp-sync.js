export async function onRequest(context) {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (context.request.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { MP_ACCESS_TOKEN, SB_URL, SB_SERVICE_ROLE_KEY } = context.env;
    if (!MP_ACCESS_TOKEN) {
      return new Response(JSON.stringify({ ok:false, error:"MP_ACCESS_TOKEN não configurado" }), {
        status: 500, headers: { ...CORS, "Content-Type":"application/json" }
      });
    }
    if (!SB_URL || !SB_SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ ok:false, error:"SB_URL/SB_SERVICE_ROLE_KEY não configurado" }), {
        status: 500, headers: { ...CORS, "Content-Type":"application/json" }
      });
    }

    const body = await context.request.json().catch(() => ({}));
    const batchId = String(body.batchId || body.id || "").trim();
    if (!batchId) {
      return new Response(JSON.stringify({ ok:false, error:"batchId ausente" }), {
        status: 400, headers: { ...CORS, "Content-Type":"application/json" }
      });
    }

    const searchUrl = `https://api.mercadopago.com/v1/payments/search?external_reference=${encodeURIComponent(batchId)}&sort=date_created&criteria=desc&limit=1`;
    const mpRes = await fetch(searchUrl, { headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` } });
    const mpData = await mpRes.json().catch(()=> ({}));

    if (!mpRes.ok) {
      return new Response(JSON.stringify({ ok:false, error:"Mercado Pago search falhou", details: mpData }), {
        status: 502, headers: { ...CORS, "Content-Type":"application/json" }
      });
    }

    const payment = Array.isArray(mpData?.results) && mpData.results.length ? mpData.results[0] : null;
    if (!payment) {
      return new Response(JSON.stringify({ ok:true, status:"not_found", batchStatus:"PENDING_PAYMENT" }), {
        status: 200, headers: { ...CORS, "Content-Type":"application/json" }
      });
    }

    const status = String(payment.status || "");
    const statusDetail = String(payment.status_detail || "");
    const paymentId = String(payment.id || "");
    const amount = payment.transaction_amount ?? null;

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

    const headers = {
      apikey: SB_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    };

    await fetch(`${SB_URL}/rest/v1/order_batches?id=eq.${encodeURIComponent(batchId)}`, {
      method:"PATCH",
      headers,
      body: JSON.stringify({
        status: batchStatus,
        confirmed_at: batchStatus === "PAID" ? new Date().toISOString() : null,
        mp_payment_id: paymentId || null,
        payment_status: status,
        payment_status_detail: statusDetail,
        payment_amount: amount,
        mp_payload: payment,
      })
    }).catch(()=>{});

    return new Response(JSON.stringify({ ok:true, status, batchStatus, paymentId }), {
      status: 200, headers: { ...CORS, "Content-Type":"application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok:false, error:String(e?.message||e) }), {
      status: 500, headers: { "Content-Type":"application/json" }
    });
  }
}
