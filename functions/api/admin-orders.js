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

    console.log('🔍 Request body:', JSON.stringify(body));
    console.log('🔍 Campaign ID:', campaignId);

    if (!campaignId || campaignId.length !== 36) { // UUID length
      return new Response(JSON.stringify({ error: "ID da campanha inválido" }), {
        status: 400, headers: { ...CORS, "Content-Type":"application/json" }
      });
    }

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

    // Query completa com todos os campos necessários para o admin
    // NOTA: profiles não tem coluna email — o email fica em auth.users
    const fullSelect = "id,created_at,user_id,qty_paid,qty_bonus,status,campaign_id,shipping_price_brl_locked,profiles(name,whatsapp),order_batches(id,status,qty_in_batch,payment_status,confirmed_at,total_locked,subtotal_locked,shipping_locked,shipping_already_paid,payment_method,mp_link,mp_payment_id,mp_preference_id,payment_amount,mp_payload,created_at)";
    // Query mínima de fallback (colunas essenciais que sempre existem)
    const safeSelect = "id,created_at,user_id,qty_paid,qty_bonus,status,profiles(name,whatsapp),order_batches(id,status,qty_in_batch,payment_status,confirmed_at,total_locked,shipping_locked,payment_method)";

    const pageSize = 1000;
    const baseParams = `&campaign_id=eq.${encodeURIComponent(campaignId)}&order=created_at.desc`;

    async function fetchOrdersPaged(selectClause) {
      const rows = [];
      for (let offset = 0; ; offset += pageSize) {
        const url = `${SB_URL}/rest/v1/orders?select=${encodeURIComponent(selectClause)}${baseParams}&limit=${pageSize}&offset=${offset}`;
        console.log('🔍 Query URL:', url);
        const res = await fetch(url, { headers });
        console.log('🔍 Response status:', res.status);
        if (!res.ok) return { res, rows: null };
        const page = await res.json().catch(() => []);
        if (!Array.isArray(page) || page.length === 0) return { res, rows };
        rows.push(...page);
        if (page.length < pageSize) return { res, rows };
      }
    }

    let result = await fetchOrdersPaged(fullSelect);

    // Se a query completa falhar com 400/406 (coluna ou relação inexistente), tentar query mínima
    if (result.res.status === 400 || result.res.status === 406) {
      const errorText = await result.res.text().catch(() => '');
      console.warn(`⚠️ Full query failed (${result.res.status}), retrying with safe select. Error:`, errorText);
      result = await fetchOrdersPaged(safeSelect);
      console.log('🔍 Fallback response status:', result.res.status);
    }

    if (!result.res.ok) {
      const errorText = await result.res.text().catch(() => '');
      console.error('❌ Supabase error:', result.res.status, errorText);
      return new Response(JSON.stringify({ error: `Erro do banco: ${result.res.status}`, details: errorText }), {
        status: 502, headers: { ...CORS, "Content-Type":"application/json" }
      });
    }

    const data = result.rows || [];
    console.log('✅ Data fetched:', data.length, 'orders');

    return new Response(JSON.stringify({
      orders: data,
      total: data.length,
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