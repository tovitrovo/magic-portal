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
    if (!campaignId) {
      return new Response(JSON.stringify({ error: "campaignId ausente" }), {
        status: 400, headers: { ...CORS, "Content-Type":"application/json" }
      });
    }

    const select = "id,user_id,status,qty_paid,qty_bonus,created_at,profiles(name,whatsapp,email),order_batches(id,status,total_locked,payment_method,confirmed_at,qty_in_batch,mp_link,mp_preference_id,mp_payment_id,payment_status)";
    const url = `${SB_URL}/rest/v1/orders?select=${encodeURIComponent(select)}&campaign_id=eq.${encodeURIComponent(campaignId)}&order=created_at.desc`;

    const r = await fetch(url, {
      headers: {
        apikey: SB_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}`,
      }
    });

    const data = await r.json().catch(()=> ([]));
    if (!r.ok) {
      return new Response(JSON.stringify({ error: "Falha ao buscar pedidos", details: data }), {
        status: 502, headers: { ...CORS, "Content-Type":"application/json" }
      });
    }

    return new Response(JSON.stringify(data), {
      status: 200, headers: { ...CORS, "Content-Type":"application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message||e) }), {
      status: 500, headers: { "Content-Type":"application/json" }
    });
  }
}
