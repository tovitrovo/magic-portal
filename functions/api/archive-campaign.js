export async function onRequest(context) {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (context.request.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const { SB_URL, SB_SERVICE_ROLE_KEY } = context.env;
  if (!SB_URL || !SB_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ ok: false, error: "Config ausente" }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" }
    });
  }

  try {
    const { campaignId } = await context.request.json().catch(() => ({}));
    if (!campaignId) return new Response(JSON.stringify({ ok: false, error: "campaignId ausente" }), {
      status: 400, headers: { ...CORS, "Content-Type": "application/json" }
    });

    const h = {
      apikey: SB_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal",
    };

    // 1. Apagar bonus_grants (não fazem sentido na próxima campanha)
    await fetch(`${SB_URL}/rest/v1/bonus_grants?campaign_id=eq.${campaignId}`, { method: "DELETE", headers: h });

    // 2. Arquivar campanha
    await fetch(`${SB_URL}/rest/v1/campaigns?id=eq.${campaignId}`, {
      method: "PATCH", headers: h, body: JSON.stringify({ status: "DONE" })
    });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { ...CORS, "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" }
    });
  }
}
