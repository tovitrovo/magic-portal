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
      const { name, status, close_at, max_cards } = body;
      if (!name || !status) {
        return new Response(JSON.stringify({ error: "Nome e status obrigatórios" }), {
          status: 400, headers: { ...CORS, "Content-Type":"application/json" }
        });
      }
      const insertUrl = `${SB_URL}/rest/v1/campaigns`;
      const payload = { name, status };
      if (close_at) payload.close_at = close_at;
      if (max_cards) payload.max_cards = max_cards;
      const insertBody = JSON.stringify(payload);
      const res = await fetch(insertUrl, { method: "POST", headers: { ...headers, Prefer: "return=representation" }, body: insertBody });
      const data = await res.json();

      // Auto-criar tiers padrão para a nova campanha
      if (res.ok && Array.isArray(data) && data[0]?.id) {
        const campId = data[0].id;
        const defaultTiers = [
          { campaign_id: campId, rank: 1, label: 'Tier 1', min_qty: 1,    max_qty: 500,     usd_per_card: 0.18 },
          { campaign_id: campId, rank: 2, label: 'Tier 2', min_qty: 501,  max_qty: 750,     usd_per_card: 0.16 },
          { campaign_id: campId, rank: 3, label: 'Tier 3', min_qty: 751,  max_qty: 1000,    usd_per_card: 0.14 },
          { campaign_id: campId, rank: 4, label: 'Tier 4', min_qty: 1001, max_qty: 1500,    usd_per_card: 0.12 },
          { campaign_id: campId, rank: 5, label: 'Tier 5', min_qty: 1501, max_qty: 2000,    usd_per_card: 0.10 },
          { campaign_id: campId, rank: 6, label: 'Tier 6', min_qty: 2001, max_qty: 99999999, usd_per_card: 0.08 },
        ];
        try {
          await fetch(`${SB_URL}/rest/v1/tiers`, {
            method: "POST",
            headers: { ...headers, Prefer: "return=minimal" },
            body: JSON.stringify(defaultTiers),
          });
        } catch (e) { console.error('Erro ao criar tiers padrão:', e); }
      }

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
