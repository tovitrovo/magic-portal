import { verifyAdmin } from "./_admin-auth.js";

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

    // Verify admin
    const auth = await verifyAdmin(context, SB_URL, SB_SERVICE_ROLE_KEY);
    if (!auth.ok) {
      return new Response(JSON.stringify({ ok: false, error: auth.error }), {
        status: auth.status, headers: { ...CORS, "Content-Type": "application/json" }
      });
    }

    const body = await context.request.json().catch(() => ({}));
    const batchIds = body.batchIds;
    if (!Array.isArray(batchIds) || batchIds.length === 0) {
      return new Response(JSON.stringify({ ok: false, error: "batchIds ausente ou vazio" }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" }
      });
    }

    const headers = {
      apikey: SB_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    };

    const idsParam = batchIds.map(id => encodeURIComponent(id)).join(",");
    const select = "id,quantity,batch_id,order_id,cards(name,type)";
    const url = `${SB_URL}/rest/v1/order_items?batch_id=in.(${idsParam})&select=${encodeURIComponent(select)}`;

    const r = await fetch(url, { headers });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      return new Response(JSON.stringify({ ok: false, error: `Supabase GET falhou: ${r.status} ${t.slice(0, 200)}` }), {
        status: 502, headers: { ...CORS, "Content-Type": "application/json" }
      });
    }

    const items = await r.json().catch(() => []);
    return new Response(JSON.stringify({ ok: true, items }), {
      status: 200, headers: { ...CORS, "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" }
    });
  }
}
