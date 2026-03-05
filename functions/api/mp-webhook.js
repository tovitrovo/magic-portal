export async function onRequest(context) {
  // Webhook server-to-server: sempre responder 200 rápido.
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

    // Busca detalhes do pagamento
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { "Authorization": `Bearer ${MP_ACCESS_TOKEN}` }
    });
    const payment = await mpRes.json().catch(() => ({}));
    if (!mpRes.ok) return new Response("ok", { status: 200 });

    const orderId = String(payment?.external_reference || "");
    const status = String(payment?.status || "");
    const statusDetail = String(payment?.status_detail || "");
    const amount = payment?.transaction_amount ?? null;

    // Tenta atualizar Supabase se tiver envs
    if (SB_URL && SB_SERVICE_ROLE_KEY && orderId) {
      const headers = {
        apikey: SB_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      };

      // Tentativa 1: tabela orders, id = orderId
      await fetch(`${SB_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          payment_status: status,
          payment_status_detail: statusDetail,
          payment_id: String(paymentId),
          payment_amount: amount,
          mp_payload: payment,
        }),
      }).catch(() => {});

      // Tentativa 2: tabela orders, order_id = orderId (caso seu schema use order_id)
      await fetch(`${SB_URL}/rest/v1/orders?order_id=eq.${encodeURIComponent(orderId)}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          payment_status: status,
          payment_status_detail: statusDetail,
          payment_id: String(paymentId),
          payment_amount: amount,
          mp_payload: payment,
        }),
      }).catch(() => {});
    }

    return new Response("ok", { status: 200 });
  } catch {
    return new Response("ok", { status: 200 });
  }
}
