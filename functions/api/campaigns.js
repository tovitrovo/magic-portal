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
      if (res.ok) {
        const campId = Array.isArray(data) ? data[0]?.id : data?.id;
        console.log('[campaigns] Created campaign, response:', JSON.stringify(data), 'campId:', campId);
        if (campId) {
          const defaultTiers = [
            { campaign_id: campId, rank:  1, label: 'Aprendiz',    min_qty:    1, max_qty:      100, usd_per_card: 2.00 },
            { campaign_id: campId, rank:  2, label: 'Iniciado',    min_qty:  101, max_qty:      200, usd_per_card: 1.90 },
            { campaign_id: campId, rank:  3, label: 'Escudeiro',   min_qty:  201, max_qty:      300, usd_per_card: 1.80 },
            { campaign_id: campId, rank:  4, label: 'Guerreiro',   min_qty:  301, max_qty:      400, usd_per_card: 1.70 },
            { campaign_id: campId, rank:  5, label: 'Veterano',    min_qty:  401, max_qty:      500, usd_per_card: 1.66 },
            { campaign_id: campId, rank:  6, label: 'Campeão',     min_qty:  501, max_qty:      600, usd_per_card: 1.63 },
            { campaign_id: campId, rank:  7, label: 'Herói',       min_qty:  601, max_qty:      700, usd_per_card: 1.52 },
            { campaign_id: campId, rank:  8, label: 'Mestre',      min_qty:  701, max_qty:      800, usd_per_card: 1.41 },
            { campaign_id: campId, rank:  9, label: 'Grão-Mestre', min_qty:  801, max_qty:      900, usd_per_card: 1.30 },
            { campaign_id: campId, rank: 10, label: 'Lenda',       min_qty:  901, max_qty:     1000, usd_per_card: 1.19 },
            { campaign_id: campId, rank: 11, label: 'Mítico',      min_qty: 1001, max_qty: 99999999, usd_per_card: 1.08 },
          ];
          let tierRes = await fetch(`${SB_URL}/rest/v1/tiers?on_conflict=campaign_id,min_qty,max_qty`, {
            method: "POST",
            headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
            body: JSON.stringify(defaultTiers),
          });
          if (!tierRes.ok) {
            // Correct constraint may not exist — fallback to plain INSERT
            tierRes = await fetch(`${SB_URL}/rest/v1/tiers`, {
              method: "POST",
              headers: { ...headers, Prefer: "return=minimal" },
              body: JSON.stringify(defaultTiers),
            });
          }
          console.log('[campaigns] Tiers insert status:', tierRes.status, tierRes.ok ? 'OK' : await tierRes.text().catch(() => ''));
        }
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
