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

    const headers = {
      apikey: SB_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    };

    const select = "id,name,whatsapp,email,is_admin";
    const url = `${SB_URL}/rest/v1/profiles?select=${encodeURIComponent(select)}&order=name.asc`;
    const r = await fetch(url, { headers });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      return new Response(JSON.stringify({ ok: false, error: `Falha ao listar perfis: ${r.status} ${t.slice(0, 200)}` }), {
        status: 502, headers: { ...CORS, "Content-Type": "application/json" }
      });
    }
    const profiles = await r.json();
    return new Response(JSON.stringify({ ok: true, profiles }), {
      status: 200, headers: { ...CORS, "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: "Erro interno: " + String(e?.message || e) }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" }
    });
  }
}
