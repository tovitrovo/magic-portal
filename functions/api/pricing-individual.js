import { loadPricingInputs, quoteItems } from "./_individual-helper.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (b, s = 200, extra = {}) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json", ...extra } });

// GET  /api/pricing-individual            → { tiers, pricing, fx }  (para o preview ao vivo na UI)
// POST /api/pricing-individual { items }   → cotação autoritativa do servidor (relê tipos do banco)
export async function onRequest(context) {
  if (context.request.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const { SB_URL, SB_SERVICE_ROLE_KEY } = context.env;
  if (!SB_URL || !SB_SERVICE_ROLE_KEY) return json({ ok: false, error: "Config do servidor incompleta" }, 500);

  try {
    if (context.request.method === "GET") {
      const { tiers, pricing, fx } = await loadPricingInputs(SB_URL, SB_SERVICE_ROLE_KEY);
      return json({ ok: true, tiers, pricing, fx }, 200, { "Cache-Control": "public, max-age=300" });
    }

    if (context.request.method === "POST") {
      const body = await context.request.json().catch(() => ({}));
      const items = Array.isArray(body.items) ? body.items : [];
      const quote = await quoteItems(SB_URL, SB_SERVICE_ROLE_KEY, items);
      return json({ ok: true, ...quote });
    }

    return json({ ok: false, error: "Método não suportado" }, 405);
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
}
