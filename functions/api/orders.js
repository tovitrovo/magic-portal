export async function onRequest(context) {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  };
  if (context.request.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const { SB_URL, SB_SERVICE_ROLE_KEY } = context.env;
  if (!SB_URL || !SB_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Configuração do servidor incompleta" }), {
      status: 500, headers: { ...CORS, "Content-Type":"application/json" }
    });
  }

  const headers = {
    apikey: SB_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };

  try {
    if (context.request.method === "POST") {
      // Cadastro de pedido vinculado a campanha
      const body = await context.request.json();
      const { user_id, campaign_id, qty_paid, qty_bonus, status } = body;
      if (!user_id || !campaign_id) {
        return new Response(JSON.stringify({ error: "Usuário e campanha obrigatórios" }), {
          status: 400, headers: { ...CORS, "Content-Type":"application/json" }
        });
      }
      const insertUrl = `${SB_URL}/rest/v1/orders`;
      const insertBody = JSON.stringify({ user_id, campaign_id, qty_paid, qty_bonus, status });
      const res = await fetch(insertUrl, { method: "POST", headers, body: insertBody });
      const data = await res.json();
      return new Response(JSON.stringify(data), {
        status: res.ok ? 201 : 400, headers: { ...CORS, "Content-Type":"application/json" }
      });
    }
    if (context.request.method === "GET") {
      // Listar pedidos por campanha
      const url = `${SB_URL}/rest/v1/orders?select=*&order=created_at.desc&limit=100`;
      const res = await fetch(url, { headers });
      const data = await res.json();
      return new Response(JSON.stringify(data), {
        status: 200, headers: { ...CORS, "Content-Type":"application/json" }
      });
    }
    return new Response(JSON.stringify({ error: "Método não suportado" }), {
      status: 405, headers: { ...CORS, "Content-Type":"application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500, headers: { ...CORS, "Content-Type":"application/json" }
    });
  }
}
