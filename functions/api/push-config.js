import { corsHeaders } from "./_cors.js";
import { readVapidConfig } from "./_webpush.js";

// GET /api/push-config
// Devolve a chave pública VAPID para o navegador criar a subscription.
// Público por natureza (a chave pública é enviada a todos os clientes).
export async function onRequest(context) {
  const CORS = corsHeaders(context, "GET, OPTIONS");
  const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
  if (context.request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (context.request.method !== "GET") return json({ ok: false, error: "Método não permitido" }, 405);

  const vapid = readVapidConfig(context.env);
  if (!vapid) return json({ ok: true, enabled: false, publicKey: null });
  return json({ ok: true, enabled: true, publicKey: vapid.publicKey });
}
