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
      return new Response(JSON.stringify({ error: "Configuração do servidor incompleta" }), {
        status: 500, headers: { ...CORS, "Content-Type":"application/json" }
      });
    }

    const body = await context.request.json().catch(() => ({}));
    let campaignId = String(body.campaignId || "").trim();

    const headers = {
      apikey: SB_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    };

    // Buscar campanha ativa se não fornecida
    if (!campaignId) {
      const campUrl = `${SB_URL}/rest/v1/campaigns?select=id&status=eq.ACTIVE&limit=1`;
      const campRes = await fetch(campUrl, { headers });
      if (!campRes.ok) {
        return new Response(JSON.stringify({ error: "Erro ao buscar campanha ativa" }), {
          status: 500, headers: { ...CORS, "Content-Type":"application/json" }
        });
      }
      const campData = await campRes.json().catch(() => []);
      if (campData.length === 0) {
        return new Response(JSON.stringify({ error: "Nenhuma campanha ativa encontrada" }), {
          status: 404, headers: { ...CORS, "Content-Type":"application/json" }
        });
      }
      campaignId = String(campData[0].id);
    }

    // Query corrigida: Supabase exige o filtro campaign_id no formato correto
    // NOTA: profiles não tem coluna email — o email fica em auth.users
    const select = "id,created_at,user_id,qty_paid,qty_bonus,status,profiles(name,whatsapp),order_batches(id,status,qty_in_batch,payment_status,confirmed_at)";
    const url = `${SB_URL}/rest/v1/orders?select=${encodeURIComponent(select)}&campaign_id=eq.${encodeURIComponent(campaignId)}&order=created_at.desc&limit=100`;

    // Supabase pode exigir o filtro como um parâmetro separado, não concatenado
    // Alternativa: usar URLSearchParams para garantir formato correto
    // const params = new URLSearchParams({
    //   select,
    //   order: 'created_at.desc',
    //   limit: '100',
    //   'campaign_id': `eq.${campaignId}`
    // });
    // const url = `${SB_URL}/rest/v1/orders?${params.toString()}`;

    const res = await fetch(url, { headers });
    if (!res.ok) {
      const errorText = await res.text();
      return new Response(JSON.stringify({ error: `Erro do banco: ${res.status}`, details: errorText }), {
        status: 502, headers: { ...CORS, "Content-Type":"application/json" }
      });
    }

    const data = await res.json().catch(() => []);

    // Filtrar apenas pedidos com batches pagos
    const paidOrders = data.filter(order => 
      order.order_batches && order.order_batches.some(batch => batch.status === 'PAID' || batch.status === 'PAID_CONFIRMED')
    );

    return new Response(JSON.stringify({
      orders: paidOrders,
      total: paidOrders.length,
      campaignId
    }), {
      status: 200, headers: { ...CORS, "Content-Type":"application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500, headers: { ...CORS, "Content-Type":"application/json" }
    });
  }
}
