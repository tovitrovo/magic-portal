export async function onRequest(context) {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (context.request.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { SB_URL, SB_SERVICE_ROLE_KEY } = context.env;
    if (!SB_URL || !SB_SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ error: "SB_URL/SB_SERVICE_ROLE_KEY não configurado" }), {
        status: 500, headers: { ...CORS, "Content-Type":"application/json" }
      });
    }

    const body = await context.request.json().catch(() => ({}));
    const campaignId = String(body.campaignId || "").trim();

    const headers = {
      apikey: SB_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}`,
    };

    const select = "id,created_at,user_id,qty_paid,qty_bonus,status,campaign_id,profiles(name,email,whatsapp),order_batches(id,status,total_locked,qty_in_batch,mp_link,mp_preference_id,mp_payment_id,payment_status,payment_status_detail,confirmed_at,campaign_id)";
    let url = `${SB_URL}/rest/v1/orders?select=${encodeURIComponent(select)}&order=created_at.desc&limit=500`;
    // Temporariamente removendo filtro de campanha para debug
    // if (campaignId) url += `&campaign_id=eq.${encodeURIComponent(campaignId)}`;

    const r = await fetch(url, { headers });
    const data = await r.json().catch(() => []);
    if (!r.ok) {
      return new Response(JSON.stringify({ error: "Falha ao buscar pedidos", details: data }), {
        status: 502, headers: { ...CORS, "Content-Type":"application/json" }
      });
    }

    // Debug: adicionar informações sobre os pedidos encontrados
    const debugInfo = {
      campaignId: campaignId,
      totalOrders: data.length,
      ordersWithBatches: data.filter(o => o.order_batches?.length > 0).length,
      paidOrders: data.filter(o => o.order_batches?.some(b => b.status === 'PAID' || b.status === 'CONFIRMED')).length,
      batchStatuses: [...new Set(data.flatMap(o => o.order_batches?.map(b => b.status) || []))],
      campaigns: [...new Set(data.map(o => o.campaign_id))],
      ordersByCampaign: data.reduce((acc, o) => {
        const campId = o.campaign_id || 'null';
        acc[campId] = (acc[campId] || 0) + 1;
        return acc;
      }, {})
    };

    return new Response(JSON.stringify({
      ...debugInfo,
      orders: data
    }), {
      status: 200, headers: { ...CORS, "Content-Type":"application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message||e) }), {
      status: 500, headers: { "Content-Type":"application/json" }
    });
  }
}
