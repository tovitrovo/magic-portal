export async function onRequest(context) {
  try {
    const { MP_ACCESS_TOKEN, SB_URL, SB_SERVICE_ROLE_KEY } = context.env;
    if (!MP_ACCESS_TOKEN || !SB_URL || !SB_SERVICE_ROLE_KEY) return new Response("ok", { status: 200 });

    const url = new URL(context.request.url);
    const body = await context.request.json().catch(() => ({}));

    const paymentId =
      body?.data?.id ||
      body?.id ||
      url.searchParams.get("data.id") ||
      url.searchParams.get("id");

    if (!paymentId) return new Response("ok", { status: 200 });

    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` }
    });
    const payment = await mpRes.json().catch(() => ({}));
    if (!mpRes.ok) return new Response("ok", { status: 200 });

    const batchId = String(payment?.external_reference || "").trim();
    if (!batchId) return new Response("ok", { status: 200 });

    const mpStatus = String(payment.status || "");
    const mpStatusDetail = String(payment.status_detail || "");
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
    const batchStatus = statusMap[mpStatus] || "PENDING_PAYMENT";

    const headers = {
      apikey: SB_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    };

    await fetch(`${SB_URL}/rest/v1/order_batches?id=eq.${encodeURIComponent(batchId)}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        status: batchStatus,
        confirmed_at: batchStatus === "PAID" ? new Date().toISOString() : null,
        mp_payment_id: String(paymentId),
        payment_status: mpStatus,
        payment_status_detail: mpStatusDetail,
        payment_amount: amount,
        mp_payload: payment,
      }),
    });

    return new Response("ok", { status: 200 });
  } catch {
    return new Response("ok", { status: 200 });
  }
}
