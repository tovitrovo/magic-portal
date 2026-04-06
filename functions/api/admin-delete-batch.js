/**
 * admin-delete-batch.js
 * Exclui definitivamente um batch CANCELADO do banco de dados.
 * Só permite exclusão de batches com status CANCELLED.
 * Os order_items vinculados têm batch_id setado para NULL automaticamente
 * via ON DELETE SET NULL definido no schema.
 *
 * Body: { batchId: string }         → exclui um batch específico
 * Body: { orderId: string }         → exclui todos os cancelados de um pedido
 * Body: { campaignId: string }      → exclui todos os cancelados de uma campanha
 * Body: { all: true, campaignId }   → mesmo que campaignId
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
      return new Response(JSON.stringify({ ok: false, error: "SB_URL/SB_SERVICE_ROLE_KEY não configurado" }), {
        status: 500, headers: { ...CORS, "Content-Type": "application/json" }
      });
    }

    const body = await context.request.json().catch(() => ({}));
    const { batchId, orderId, campaignId } = body;

    if (!batchId && !orderId && !campaignId) {
      return new Response(JSON.stringify({ ok: false, error: "batchId, orderId ou campaignId obrigatório" }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" }
      });
    }

    const headers = {
      apikey: SB_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    };

    let deleted = 0;

    if (batchId) {
      // Exclusão de um batch específico — verifica se é CANCELLED
      const checkRes = await fetch(
        `${SB_URL}/rest/v1/order_batches?id=eq.${encodeURIComponent(batchId)}&select=id,status`,
        { headers }
      );
      const checkData = await checkRes.json().catch(() => []);
      if (!checkData.length) {
        return new Response(JSON.stringify({ ok: false, error: "Batch não encontrado" }), {
          status: 404, headers: { ...CORS, "Content-Type": "application/json" }
        });
      }
      if (checkData[0].status !== "CANCELLED") {
        return new Response(JSON.stringify({ ok: false, error: "Só é possível excluir batches com status CANCELLED" }), {
          status: 400, headers: { ...CORS, "Content-Type": "application/json" }
        });
      }
      const delRes = await fetch(
        `${SB_URL}/rest/v1/order_batches?id=eq.${encodeURIComponent(batchId)}`,
        { method: "DELETE", headers }
      );
      if (!delRes.ok) {
        const t = await delRes.text().catch(() => "");
        return new Response(JSON.stringify({ ok: false, error: `Falha ao excluir: ${delRes.status} ${t.slice(0, 200)}` }), {
          status: 502, headers: { ...CORS, "Content-Type": "application/json" }
        });
      }
      deleted = 1;

    } else if (orderId) {
      // Exclui todos os cancelados de um pedido específico
      const delRes = await fetch(
        `${SB_URL}/rest/v1/order_batches?order_id=eq.${encodeURIComponent(orderId)}&status=eq.CANCELLED`,
        { method: "DELETE", headers }
      );
      if (!delRes.ok) {
        const t = await delRes.text().catch(() => "");
        return new Response(JSON.stringify({ ok: false, error: `Falha ao excluir: ${delRes.status} ${t.slice(0, 200)}` }), {
          status: 502, headers: { ...CORS, "Content-Type": "application/json" }
        });
      }
      deleted = -1; // count unknown

    } else if (campaignId) {
      // Busca todos os orders da campanha
      const ordersRes = await fetch(
        `${SB_URL}/rest/v1/orders?campaign_id=eq.${encodeURIComponent(campaignId)}&select=id`,
        { headers }
      );
      const orders = await ordersRes.json().catch(() => []);
      if (!orders.length) {
        return new Response(JSON.stringify({ ok: true, deleted: 0 }), {
          status: 200, headers: { ...CORS, "Content-Type": "application/json" }
        });
      }
      const orderIds = orders.map(o => o.id).map(id => encodeURIComponent(id)).join(",");
      const delRes = await fetch(
        `${SB_URL}/rest/v1/order_batches?order_id=in.(${orderIds})&status=eq.CANCELLED`,
        { method: "DELETE", headers }
      );
      if (!delRes.ok) {
        const t = await delRes.text().catch(() => "");
        return new Response(JSON.stringify({ ok: false, error: `Falha ao excluir cancelados: ${delRes.status} ${t.slice(0, 200)}` }), {
          status: 502, headers: { ...CORS, "Content-Type": "application/json" }
        });
      }
      deleted = -1; // count unknown
    }

    return new Response(JSON.stringify({ ok: true, deleted }), {
      status: 200, headers: { ...CORS, "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" }
    });
  }
}
