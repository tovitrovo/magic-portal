import { quoteItems } from "./_individual-helper.js";
import { corsHeaders } from "./_cors.js";

// Identifica o usuário pelo token (sem exigir admin).
async function getUserId(context, SB_URL, SB_KEY) {
  const tok = (context.request.headers.get("Authorization") || "").replace("Bearer ", "").trim();
  if (!tok) return null;
  try {
    const r = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${tok}` } });
    if (!r.ok) return null;
    const me = await r.json();
    return me?.id || null;
  } catch { return null; }
}

// POST /api/individual-checkout
// body: { items:[{card_id,quantity}], shipping:{ service, price, address, already_paid, group_id } }
// Cria um pedido INDIVIDUAL com preços travados no servidor e devolve o batch p/ Mercado Pago.
export async function onRequest(context) {
  const CORS = corsHeaders(context, "POST, OPTIONS");
  const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
  if (context.request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (context.request.method !== "POST") return json({ ok: false, error: "Método não permitido" }, 405);

  const { SB_URL, SB_SERVICE_ROLE_KEY } = context.env;
  if (!SB_URL || !SB_SERVICE_ROLE_KEY) return json({ ok: false, error: "Config do servidor incompleta" }, 500);

  const userId = await getUserId(context, SB_URL, SB_SERVICE_ROLE_KEY);
  if (!userId) return json({ ok: false, error: "Não autenticado" }, 401);

  const body = await context.request.json().catch(() => ({}));
  const items = Array.isArray(body.items) ? body.items : [];
  const shipping = body.shipping || {};
  if (!items.length) return json({ ok: false, error: "Carrinho vazio" }, 400);

  const headers = { apikey: SB_SERVICE_ROLE_KEY, Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" };

  try {
    // 1. Cotação autoritativa (relê tipos do banco) + mínimo de cartas
    const quote = await quoteItems(SB_URL, SB_SERVICE_ROLE_KEY, items);
    const minCards = Number(quote?.pricing?.min_cards) || 15;
    if (quote.totalQty < minCards) {
      return json({ ok: false, error: `Mínimo de ${minCards} cartas por pedido` }, 400);
    }
    const subtotal = quote.subtotal;
    const shippingLocked = shipping.already_paid ? 0 : (Number(shipping.price) || 0);
    const total = Math.round((subtotal + shippingLocked) * 100) / 100;
    const effectiveUnit = quote.totalQty > 0 ? Math.round((subtotal / quote.totalQty) * 10000) / 10000 : 0;

    // 2. Cria o pedido INDIVIDUAL
    const ordRes = await fetch(`${SB_URL}/rest/v1/orders`, {
      method: "POST", headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify({ user_id: userId, campaign_id: null, kind: "INDIVIDUAL", status: "DRAFT", qty_paid: quote.totalQty, qty_bonus: 0, shipping_price_brl_locked: shippingLocked }),
    });
    if (!ordRes.ok) return json({ ok: false, error: `Falha ao criar pedido: ${ordRes.status} ${(await ordRes.text()).slice(0,160)}` }, 502);
    const order = (await ordRes.json())[0];

    // 3. Cria o lote (batch) com totais travados
    const batchRes = await fetch(`${SB_URL}/rest/v1/order_batches`, {
      method: "POST", headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify({
        order_id: order.id, status: "DRAFT", payment_method: "MERCADO_PAGO",
        brl_unit_price_locked: effectiveUnit, qty_in_batch: quote.totalQty,
        subtotal_locked: subtotal, shipping_locked: shippingLocked, total_locked: total,
        shipping_service: shipping.service || null, shipping_address: shipping.address || null,
        shipping_already_paid: !!shipping.already_paid, shipping_group_id: shipping.group_id || null,
      }),
    });
    if (!batchRes.ok) return json({ ok: false, error: `Falha ao criar lote: ${batchRes.status} ${(await batchRes.text()).slice(0,160)}` }, 502);
    const batch = (await batchRes.json())[0];

    // 4. Cria os itens com preço travado por linha
    const rows = quote.lines.filter(l => l.quantity > 0).map(l => ({
      order_id: order.id, batch_id: batch.id, card_id: l.card_id,
      quantity: l.quantity, in_cart: false, is_bonus: false, unit_price_brl: l.unit_price_brl,
    }));
    const itemsRes = await fetch(`${SB_URL}/rest/v1/order_items`, {
      method: "POST", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify(rows),
    });
    if (!itemsRes.ok) return json({ ok: false, error: `Falha ao criar itens: ${itemsRes.status} ${(await itemsRes.text()).slice(0,160)}` }, 502);

    return json({ ok: true, orderId: order.id, batchId: batch.id, shortId: String(batch.id).slice(0, 8).toUpperCase(), subtotal, shipping: shippingLocked, total, totalQty: quote.totalQty });
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
}
