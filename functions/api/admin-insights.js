import { verifyAdmin } from "./_admin-auth.js";
import { corsHeaders } from "./_cors.js";

// POST /api/admin-insights { action }
//
// Dados crus para os indicadores do console (as contas ficam em
// shared/adminInsights.js, testadas sem rede):
//
//   action: 'carts'    → itens ainda no carrinho (in_cart, sem lote) de
//                         pedidos-rascunho, com cliente e carta.
//   action: 'wishlist' → linhas da lista de desejos com carta e cliente.
//
// Só leitura, só admin.
const PAGE = 1000;

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
  const headers = { apikey: SB_SERVICE_ROLE_KEY, Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}` };

  async function fetchAll(pathAndQuery) {
    const rows = [];
    for (let offset = 0; ; offset += PAGE) {
      const sep = pathAndQuery.includes("?") ? "&" : "?";
      const res = await fetch(`${SB_URL}/rest/v1/${pathAndQuery}${sep}limit=${PAGE}&offset=${offset}`, { headers });
      if (!res.ok) throw new Error(`Erro do banco: ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
      const page = await res.json().catch(() => []);
      if (!Array.isArray(page) || !page.length) break;
      rows.push(...page);
      if (page.length < PAGE) break;
    }
    return rows;
  }

  try {
    if (body.action === "carts") {
      // `orders!inner` + filtro no embed: só itens de pedidos-rascunho.
      const select = "id,order_id,quantity,created_at,card_id,cards(name,type),orders!inner(id,user_id,status,profiles(name,whatsapp,email))";
      const items = await fetchAll(`order_items?in_cart=is.true&batch_id=is.null&orders.status=eq.DRAFT&select=${encodeURIComponent(select)}&order=created_at.desc`);
      return json({ ok: true, items });
    }
    if (body.action === "wishlist") {
      const select = "user_id,card_id,quantity,acquired_qty,created_at,cards(name,type,image_url,is_active,created_at),profiles(name,whatsapp)";
      const items = await fetchAll(`wishlist_items?select=${encodeURIComponent(select)}&order=created_at.desc`);
      return json({ ok: true, items });
    }
    return json({ ok: false, error: "Ação desconhecida" }, 400);
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
}
