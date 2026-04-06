export async function onRequest(context) {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, GET, PUT, DELETE, OPTIONS",
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
      // Cadastro de campanha
      const body = await context.request.json();
      const { name, status, close_at, max_cards, min_cards } = body;
      if (!name || !status) {
        return new Response(JSON.stringify({ error: "Nome e status obrigatórios" }), {
          status: 400, headers: { ...CORS, "Content-Type":"application/json" }
        });
      }
      const insertUrl = `${SB_URL}/rest/v1/campaigns`;
      const payload = { name, status };
      if (close_at) payload.close_at = close_at;
      if (max_cards) payload.max_cards = max_cards;
      // meta mínima de cartas pagas para a encomenda ser confirmada (default 150)
      payload.min_cards = Number(min_cards) > 0 ? Number(min_cards) : 150;

      const insertBody = JSON.stringify(payload);
      const res = await fetch(insertUrl, { method: "POST", headers: { ...headers, Prefer: "return=representation" }, body: insertBody });
      const data = await res.json();

      return new Response(JSON.stringify(data), {
        status: res.ok ? 201 : 400, headers: { ...CORS, "Content-Type":"application/json" }
      });
    }
    if (context.request.method === "GET") {
      // Listar campanhas
      const url = `${SB_URL}/rest/v1/campaigns?select=*`;
      const res = await fetch(url, { headers });
      const data = await res.json();
      return new Response(JSON.stringify(data), {
        status: 200, headers: { ...CORS, "Content-Type":"application/json" }
      });
    }
    if (context.request.method === "PUT") {
      // Editar campanha
      const body = await context.request.json();
      const { id, ...fields } = body;
      if (!id) {
        return new Response(JSON.stringify({ error: "ID obrigatório" }), {
          status: 400, headers: { ...CORS, "Content-Type":"application/json" }
        });
      }
      const updateUrl = `${SB_URL}/rest/v1/campaigns?id=eq.${id}`;
      const res = await fetch(updateUrl, { method: "PATCH", headers: { ...headers, "Prefer": "return=minimal" }, body: JSON.stringify(fields) });
      if (!res.ok) { const err = await res.text(); return new Response(JSON.stringify({ error: err }), { status: 400, headers: { ...CORS, "Content-Type":"application/json" } }); }
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...CORS, "Content-Type":"application/json" } });
    }
    if (context.request.method === "DELETE") {
      // Deletar campanha
      const body = await context.request.json();
      const { id } = body;
      if (!id) {
        return new Response(JSON.stringify({ error: "ID obrigatório" }), {
          status: 400, headers: { ...CORS, "Content-Type":"application/json" }
        });
      }
      const deleteUrl = `${SB_URL}/rest/v1/campaigns?id=eq.${id}`;
      const res = await fetch(deleteUrl, { method: "DELETE", headers });
      return new Response(JSON.stringify({ success: res.ok }), {
        status: res.ok ? 200 : 400, headers: { ...CORS, "Content-Type":"application/json" }
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
