import { verifyAdmin } from "./_admin-auth.js";
import { corsHeaders } from "./_cors.js";

// POST /api/admin-individual-orders
// Lista todos os pedidos do modo INDIVIDUAL (pagos), independente de campanha —
// esses pedidos têm campaign_id null e por isso nunca aparecem em /api/admin-orders.
export async function onRequest(context) {
  const CORS = corsHeaders(context, "POST, OPTIONS");
  const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
  if (context.request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (context.request.method !== "POST") return json({ ok: false, error: "Método não permitido" }, 405);

  const { SB_URL, SB_SERVICE_ROLE_KEY } = context.env;
  if (!SB_URL || !SB_SERVICE_ROLE_KEY) return json({ ok: false, error: "Config do servidor incompleta" }, 500);

  const auth = await verifyAdmin(context, SB_URL, SB_SERVICE_ROLE_KEY);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const headers = { apikey: SB_SERVICE_ROLE_KEY, Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}` };
  const select = "id,created_at,user_id,qty_paid,status,profiles(name,whatsapp,email),order_batches(id,status,qty_in_batch,payment_status,confirmed_at,created_at,fulfillment_status,fulfillment_status_updated_at,total_locked,subtotal_locked,shipping_locked,shipping_service,shipping_address,shipping_already_paid,shipping_group_id,mandabem_envio_id,mandabem_etiqueta,mandabem_rastreamento,mandabem_status,payment_method,mp_payment_id,mp_preference_id)";

  const pageSize = 1000;
  const rows = [];
  try {
    for (let offset = 0; ; offset += pageSize) {
      const url = `${SB_URL}/rest/v1/orders?select=${encodeURIComponent(select)}&kind=eq.INDIVIDUAL&order=created_at.desc&limit=${pageSize}&offset=${offset}`;
      const res = await fetch(url, { headers });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return json({ ok: false, error: `Erro do banco: ${res.status} ${text.slice(0, 200)}` }, 502);
      }
      const page = await res.json().catch(() => []);
      if (!Array.isArray(page) || page.length === 0) break;
      rows.push(...page);
      if (page.length < pageSize) break;
    }
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }

  // Só interessam lotes efetivamente pagos (esconde DRAFT/AWAITING_PAYMENT/CANCELLED/FAILED).
  const paidStatuses = new Set(["PAID", "PAID_CONFIRMED", "CONFIRMED"]);
  const data = rows
    .map(order => ({ ...order, order_batches: (order.order_batches || []).filter(b => paidStatuses.has(String(b.status).toUpperCase())) }))
    .filter(order => order.order_batches.length > 0);

  return json({ ok: true, orders: data, total: data.length });
}
