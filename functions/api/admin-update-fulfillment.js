import { verifyAdmin } from "./_admin-auth.js";
import { corsHeaders } from "./_cors.js";

const VALID_STATUSES = new Set([
  "AWAITING_SUPPLIER_ORDER",
  "ORDERED_FROM_SUPPLIER",
  "SHIPPED_TO_BR",
  "ARRIVED_BR",
  "PREPARING",
  "LABEL_GENERATED",
]);

// POST /api/admin-update-fulfillment
// body: { batchIds:[...], fulfillmentStatus }
// Avança o status simplificado de importação de um ou mais lotes de pedidos
// INDIVIDUAL de uma vez (ex: "marcar todos os pedidos pagos hoje como comprados").
export async function onRequest(context) {
  const CORS = corsHeaders(context, "POST, OPTIONS");
  const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
  if (context.request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (context.request.method !== "POST") return json({ ok: false, error: "Método não permitido" }, 405);

  const { SB_URL, SB_SERVICE_ROLE_KEY } = context.env;
  if (!SB_URL || !SB_SERVICE_ROLE_KEY) return json({ ok: false, error: "Config do servidor incompleta" }, 500);

  const auth = await verifyAdmin(context, SB_URL, SB_SERVICE_ROLE_KEY);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const body = await context.request.json().catch(() => ({}));
  const batchIds = [...new Set((Array.isArray(body.batchIds) ? body.batchIds : [body.batchId]).map(id => String(id || "").trim()).filter(Boolean))];
  const fulfillmentStatus = String(body.fulfillmentStatus || "").trim();
  if (!batchIds.length) return json({ ok: false, error: "batchIds ausente" }, 400);
  if (!VALID_STATUSES.has(fulfillmentStatus)) return json({ ok: false, error: "fulfillmentStatus inválido" }, 400);

  const headers = { apikey: SB_SERVICE_ROLE_KEY, Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" };

  try {
    // Confirma que os lotes pertencem a pedidos INDIVIDUAL (esse pipeline não vale pra Encomenda Coletiva).
    const idsParam = batchIds.map(encodeURIComponent).join(",");
    const checkRes = await fetch(`${SB_URL}/rest/v1/order_batches?id=in.(${idsParam})&select=id,orders(kind)`, { headers });
    if (!checkRes.ok) return json({ ok: false, error: `Falha ao validar lotes: ${checkRes.status}` }, 502);
    const checked = await checkRes.json().catch(() => []);
    if (checked.length !== batchIds.length) return json({ ok: false, error: "Um ou mais lotes não foram encontrados" }, 404);
    if (checked.some(b => b.orders?.kind !== "INDIVIDUAL")) return json({ ok: false, error: "Esse status só se aplica a pedidos Individuais" }, 400);

    const filter = batchIds.length === 1 ? `id=eq.${idsParam}` : `id=in.(${idsParam})`;
    const patchRes = await fetch(`${SB_URL}/rest/v1/order_batches?${filter}`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify({ fulfillment_status: fulfillmentStatus, fulfillment_status_updated_at: new Date().toISOString() }),
    });
    if (!patchRes.ok) {
      const text = await patchRes.text().catch(() => "");
      return json({ ok: false, error: `Supabase PATCH falhou: ${patchRes.status} ${text.slice(0, 200)}` }, 502);
    }
    const updated = await patchRes.json().catch(() => []);
    return json({ ok: true, batches: updated });
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
}
