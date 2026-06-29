import { verifyAdmin } from "./_admin-auth.js";
import { recalcLotPrices } from "./_lot-helper.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// POST /api/admin-recalc-lots → recalcula price_brl de todos os lotes (admin).
export async function onRequest(context) {
  if (context.request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (context.request.method !== "POST") return json({ ok: false, error: "Método não permitido" }, 405);

  const { SB_URL, SB_SERVICE_ROLE_KEY } = context.env;
  if (!SB_URL || !SB_SERVICE_ROLE_KEY) return json({ ok: false, error: "Config do servidor incompleta" }, 500);

  const auth = await verifyAdmin(context, SB_URL, SB_SERVICE_ROLE_KEY);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  try {
    const result = await recalcLotPrices(SB_URL, SB_SERVICE_ROLE_KEY);
    return json(result, result.ok ? 200 : 502);
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
}
