import { verifyAdmin } from "./_admin-auth.js";

export async function onRequest(context) {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (context.request.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const { SB_URL, SB_SERVICE_ROLE_KEY } = context.env;
  if (!SB_URL || !SB_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ ok: false, error: "Config ausente" }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" }
    });
  }

  try {
    const auth = await verifyAdmin(context, SB_URL, SB_SERVICE_ROLE_KEY);
    if (!auth.ok) return new Response(JSON.stringify({ ok: false, error: auth.error }), {
      status: auth.status, headers: { ...CORS, "Content-Type": "application/json" }
    });

    const { campaignId } = await context.request.json().catch(() => ({}));
    if (!campaignId) return new Response(JSON.stringify({ ok: false, error: "campaignId ausente" }), {
      status: 400, headers: { ...CORS, "Content-Type": "application/json" }
    });

    const h = {
      apikey: SB_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal",
    };

    // 1. Buscar todos os order_ids dessa campanha
    const ordersRes = await fetch(`${SB_URL}/rest/v1/orders?campaign_id=eq.${campaignId}&select=id`, { headers: h });
    const orders = await ordersRes.json().catch(() => []);
    const orderIds = (orders || []).map(o => o.id);

    if (orderIds.length > 0) {
      const oIn = orderIds.map(id => encodeURIComponent(id)).join(",");

      // 2. Buscar todos os batch_ids desses orders
      const batchesRes = await fetch(`${SB_URL}/rest/v1/order_batches?order_id=in.(${oIn})&select=id`, { headers: h });
      const batches = await batchesRes.json().catch(() => []);
      const batchIds = (batches || []).map(b => b.id);

      if (batchIds.length > 0) {
        const bIn = batchIds.map(id => encodeURIComponent(id)).join(",");
        // 3. Deletar order_items desses batches
        await fetch(`${SB_URL}/rest/v1/order_items?batch_id=in.(${bIn})`, { method: "DELETE", headers: h });
      }

      // 4. Deletar order_items sem batch (wants)
      await fetch(`${SB_URL}/rest/v1/order_items?order_id=in.(${oIn})`, { method: "DELETE", headers: h });

      // 5. Deletar order_batches
      await fetch(`${SB_URL}/rest/v1/order_batches?order_id=in.(${oIn})`, { method: "DELETE", headers: h });

      // 6. Deletar orders
      await fetch(`${SB_URL}/rest/v1/orders?campaign_id=eq.${campaignId}`, { method: "DELETE", headers: h });
    }

    // 7. Deletar bonus_grants dessa campanha
    await fetch(`${SB_URL}/rest/v1/bonus_grants?campaign_id=eq.${campaignId}`, { method: "DELETE", headers: h });

    // 8. Arquivar a campanha (status = DONE)
    await fetch(`${SB_URL}/rest/v1/campaigns?id=eq.${campaignId}`, {
      method: "PATCH", headers: h, body: JSON.stringify({ status: "DONE" })
    });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { ...CORS, "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" }
    });
  }
}
