/**
 * Sistema de bônus por queda de preço (TIER_CHANGE) desativado.
 * Apenas bônus manuais são utilizados — ver /api/admin-bonus.
 */

export async function onRequest(context) {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (context.request.method === "OPTIONS") return new Response("ok", { headers: CORS });

  return new Response(JSON.stringify({ ok: true, tierBonus: 0, disabled: true }), {
    status: 200,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
