import { getUsdBrlRate } from "./_fx-helper.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

// GET /api/fx-rate → { rate, source, fetched_at }
// Cotação USD→BRL do dia (cacheada). Pública: é só um número de câmbio.
export async function onRequest(context) {
  if (context.request.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const { SB_URL, SB_SERVICE_ROLE_KEY } = context.env;
  if (!SB_URL || !SB_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ ok: false, error: "Config do servidor incompleta" }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  // Fallback configurável (individual_pricing.fx_fallback_rate)
  let fallback = 5.5;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/individual_pricing?is_active=eq.true&select=fx_fallback_rate&limit=1`, {
      headers: { apikey: SB_SERVICE_ROLE_KEY, Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}` },
    });
    const a = await r.json().catch(() => []);
    if (Array.isArray(a) && a[0] && Number(a[0].fx_fallback_rate) > 0) fallback = Number(a[0].fx_fallback_rate);
  } catch { /* usa 5.5 */ }

  const result = await getUsdBrlRate(SB_URL, SB_SERVICE_ROLE_KEY, { fallback });
  return new Response(JSON.stringify({ ok: true, ...result }), {
    status: 200,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" },
  });
}
