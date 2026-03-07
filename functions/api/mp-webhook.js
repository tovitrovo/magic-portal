export async function onRequest(context) {
  // Webhook server-to-server: responder 200 rápido sempre.
  try {
    const { MP_ACCESS_TOKEN, SB_URL, SB_SERVICE_ROLE_KEY } = context.env;
    if (!MP_ACCESS_TOKEN) return new Response("ok", { status: 200 });

    const url = new URL(context.request.url);
    const body = await context.request.json().catch(() => ({}));

    const paymentId =
      body?.data?.id ||
      body?.id ||
      url.searchParams.get("data.id") ||
      url.searchParams.get("id");

    if (!paymentId) return new Response("ok", { status: 200 });

    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { "Authorization": `Bearer ${MP_ACCESS_TOKEN}` }
    });

    const payment = await mpRes.json().catch(() => ({}));
    if (!mpRes.ok) return new Response("ok", { status: 200 });

    const orderId = String(payment?.external_reference || ""); // batch.id
    const status = String(payment?.status || "");
    const statusDetail = String(payment?.status_detail || "");
    const amount = payment?.transaction_amount ?? null;

    // Map de status do MP -> status interno
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

    if (SB_URL && SB_SERVICE_ROLE_KEY && orderId) {
      const headers = {
        apikey: SB_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      };

      // Atualiza o batch (principal)
      await fetch(`${SB_URL}/rest/v1/order_batches?id=eq.${encodeURIComponent(orderId)}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          status: batchStatus,
          mp_payment_id: String(paymentId),
          payment_status: status,
          payment_status_detail: statusDetail,
          payment_amount: amount,
          mp_payload: payment,
        }),
      }).catch(() => {});

      // (Opcional) também atualiza orders via order_id se existir no payload do batch no seu schema
      // Aqui a gente tenta sem saber a coluna exata: não quebra se falhar.
    }

    return new Response("ok", { status: 200 });
  } catch {
    return new Response("ok", { status: 200 });
  }
}
