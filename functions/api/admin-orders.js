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
      console.error('❌ Missing env vars');
      return new Response(JSON.stringify({ error: "Configuração do servidor incompleta" }), {
        status: 500, headers: { ...CORS, "Content-Type":"application/json" }
      });
    }

    const body = await context.request.json().catch(() => ({}));
    let campaignId = String(body.campaignId || "").trim();

    console.log('🔍 Request:', { campaignId });

    const headers = {
      apikey: SB_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    };

    // Buscar campanha ativa se não fornecida
    if (!campaignId) {
      console.log('🔍 Fetching active campaign...');
      const campUrl = `${SB_URL}/rest/v1/campaigns?select=id&status=eq.ACTIVE&limit=1`;
      const campRes = await fetch(campUrl, { headers });
      if (!campRes.ok) {
        console.error('❌ Failed to fetch active campaign:', campRes.status);
        return new Response(JSON.stringify({ error: "Erro ao buscar campanha ativa" }), {
          status: 500, headers: { ...CORS, "Content-Type":"application/json" }
        });
      }
      const campData = await campRes.json().catch(() => []);
      if (campData.length === 0) {
        console.log('❌ No active campaign found');
        return new Response(JSON.stringify({ error: "Nenhuma campanha ativa encontrada" }), {
          status: 404, headers: { ...CORS, "Content-Type":"application/json" }
        });
      }
      campaignId = String(campData[0].id);
      console.log('✅ Active campaign:', campaignId);
    }

    // Query completa com todos os campos necessários
    const select = "id,created_at,user_id,qty_paid,qty_bonus,status,campaign_id,shipping_price_brl_locked,profiles(name,email),order_batches(id,status,qty_in_batch,payment_status,confirmed_at,total_locked,payment_method,mp_link,mp_preference_id,payment_amount,mp_payload)";
    const url = `${SB_URL}/rest/v1/orders?select=${encodeURIComponent(select)}&campaign_id=eq.${encodeURIComponent(campaignId)}&order=created_at.desc&limit=100`;

    console.log('🔍 Query URL:', url);

    const res = await fetch(url, { headers });
    console.log('🔍 Response status:', res.status);

    if (!res.ok) {
      const errorText = await res.text();
      console.error('❌ Supabase error:', res.status, errorText);
      return new Response(JSON.stringify({ error: `Erro do banco: ${res.status}`, details: errorText }), {
        status: 502, headers: { ...CORS, "Content-Type":"application/json" }
      });
    }

    const data = await res.json().catch(() => []);
    console.log('✅ Data fetched:', data.length, 'orders');

    // Filtrar apenas pedidos com batches pagos no lado servidor para eficiência
    const paidOrders = data.filter(order => 
      order.order_batches && order.order_batches.some(batch => batch.status === 'PAID' || batch.status === 'CONFIRMED')
    );

    console.log('✅ Paid orders:', paidOrders.length);

    return new Response(JSON.stringify({
      orders: paidOrders,
      total: paidOrders.length,
      campaignId
    }), {
      status: 200, headers: { ...CORS, "Content-Type":"application/json" }
    });
  } catch (e) {
    console.error('❌ General error:', e);
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500, headers: { ...CORS, "Content-Type":"application/json" }
    });
  }
}