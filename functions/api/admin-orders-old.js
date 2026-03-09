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
    let campaignId = String(body.campaignId || "").trim();

    console.log('🔍 Admin orders request:', { campaignId });

    // Se campaignId estiver vazio, buscar a campanha ativa
    if (!campaignId) {
      console.log('🔍 Buscando campanha ativa...');
      const campUrl = `${SB_URL}/rest/v1/campaigns?select=id&status=eq.ACTIVE&limit=1`;
      const campResponse = await fetch(campUrl, { headers });
      const campData = await campResponse.json().catch(() => []);
      if (campResponse.ok && campData.length > 0) {
        campaignId = String(campData[0].id);
        console.log('🔍 Campanha ativa encontrada:', campaignId);
      } else {
        console.log('❌ Nenhuma campanha ativa encontrada');
      }
    }

    const headers = {
      apikey: SB_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}`,
    };

    // NOTA: profiles não tem coluna email — o email fica em auth.users
    const select = "id,created_at,user_id,qty_paid,qty_bonus,status,campaign_id,profiles(name,whatsapp),order_batches(id,status,total_locked,qty_in_batch,mp_link,mp_preference_id,mp_payment_id,payment_status,payment_status_detail,confirmed_at,campaign_id)";
    let url = `${SB_URL}/rest/v1/orders?select=${encodeURIComponent(select)}&order=created_at.desc&limit=500`;
    if (campaignId) url += `&campaign_id=eq.${encodeURIComponent(campaignId)}`;

    console.log('🔍 Final Supabase URL:', url);

    let r, data;
    try {
      r = await fetch(url, { headers });
      console.log('🔍 Fetch response status:', r.status);
      data = await r.json().catch(() => []);
      console.log('🔍 Data length:', data.length);
    } catch (fetchError) {
      console.error('❌ Fetch error:', fetchError);
      return new Response(JSON.stringify({ error: "Erro na requisição ao banco de dados", details: String(fetchError) }), {
        status: 500, headers: { ...CORS, "Content-Type":"application/json" }
      });
    }

    if (!r.ok) {
      console.error('❌ Supabase error:', r.status, data);
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
  } catch (e) {    console.error('❌ Admin orders error:', e);    return new Response(JSON.stringify({ error: String(e?.message||e) }), {
      status: 500, headers: { "Content-Type":"application/json" }
    });
  }
}
