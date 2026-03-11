import { incrementPoolOnPaid } from './_pool-helper.js';
import { grantTierBonusToAll } from './_tier-bonus-helper.js';

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

      // Incrementa pool ANTES de marcar como PAID (para detectar a transição)
      if (batchStatus === "PAID") {
        await incrementPoolOnPaid(SB_URL, SB_SERVICE_ROLE_KEY, orderId);
      }

      // Atualiza o batch (principal)
      const patchBody = {
        status: batchStatus,
        mp_payment_id: String(paymentId),
        payment_status: status,
        payment_status_detail: statusDetail,
        payment_amount: amount,
        mp_payload: payment,
      };
      if (batchStatus === "PAID") {
        patchBody.confirmed_at = new Date().toISOString();
      }

      await fetch(`${SB_URL}/rest/v1/order_batches?id=eq.${encodeURIComponent(orderId)}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify(patchBody),
      }).catch(() => {});

      // Atualiza o status do pedido pai (orders) quando batch é pago
      if (batchStatus === "PAID") {
        try {
          const batchRes = await fetch(`${SB_URL}/rest/v1/order_batches?id=eq.${encodeURIComponent(orderId)}&select=order_id`, {
            headers: { apikey: SB_SERVICE_ROLE_KEY, Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}` },
          });
          const batchArr = await batchRes.json().catch(() => []);
          const parentOrderId = Array.isArray(batchArr) && batchArr.length ? batchArr[0].order_id : null;
          if (parentOrderId) {
            await fetch(`${SB_URL}/rest/v1/orders?id=eq.${encodeURIComponent(parentOrderId)}`, {
              method: "PATCH",
              headers,
              body: JSON.stringify({ status: "PAID_CONFIRMED" }),
            });
          }
        } catch (e) { console.error('Webhook: erro ao atualizar order pai:', e); } // não bloqueia o retorno do webhook

        
        // Recalcula bônus de tier-change para todos os usuários da campanha
        try {
          const orderRes2 = await fetch(`${SB_URL}/rest/v1/orders?id=eq.${encodeURIComponent(parentOrderId)}&select=campaign_id`, {
            headers: { apikey: SB_SERVICE_ROLE_KEY, Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}` },
          });
          const orderArr2 = await orderRes2.json().catch(() => []);
          const campaignId = Array.isArray(orderArr2) && orderArr2.length ? orderArr2[0].campaign_id : null;
          if (campaignId) await grantTierBonusToAll(SB_URL, SB_SERVICE_ROLE_KEY, campaignId);
        } catch (e) { console.error('Webhook: tier bonus error:', e); }
      }
    }

    return new Response("ok", { status: 200 });
  } catch {
    return new Response("ok", { status: 200 });
  }
}
