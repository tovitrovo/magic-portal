import { quoteItems } from "./_individual-helper.js";
import { corsHeaders } from "./_cors.js";
import { ADD_CARDS_CLOSED_ERROR, canAddCardsToOrder, isPaidBatch, paidQtyOf, shippingAnchorOf, shippingGroupIdOf } from "../../shared/individualAddCards.js";

const enc = encodeURIComponent;

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

const sumQty = items => items.reduce((s, i) => s + Math.max(0, Math.floor(Number(i.quantity) || 0)), 0);

// Grava as linhas do lote com o preço travado por carta.
async function createItems(SB_URL, headers, orderId, batchId, lines) {
  const rows = lines.filter(l => l.quantity > 0).map(l => ({
    order_id: orderId, batch_id: batchId, card_id: l.card_id,
    quantity: l.quantity, in_cart: false, is_bonus: false, unit_price_brl: l.unit_price_brl,
  }));
  const res = await fetch(`${SB_URL}/rest/v1/order_items`, {
    method: "POST", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify(rows),
  });
  return res.ok ? null : `Falha ao criar itens: ${res.status} ${(await res.text()).slice(0, 160)}`;
}

// ── Adição a um pedido individual já pago ────────────────────────────────
// As cartas novas entram num lote NOVO do mesmo pedido: pagam à parte (o
// dinheiro do primeiro lote já foi cobrado), não pagam frete de novo — vão na
// mesma remessa — e são precificadas pela faixa do volume somado, porque para
// o fornecedor é uma compra só.
async function addCardsToOrder({ SB_URL, SB_KEY, headers, json, userId, orderId, items }) {
  const select = "id,qty_paid,order_batches(id,status,payment_status,qty_in_batch,created_at,fulfillment_status,shipping_service,shipping_address,shipping_group_id,shipping_already_paid,shipping_locked,mandabem_envio_id)";
  const ordRes = await fetch(
    `${SB_URL}/rest/v1/orders?id=eq.${enc(orderId)}&user_id=eq.${enc(userId)}&kind=eq.INDIVIDUAL&select=${enc(select)}&limit=1`,
    { headers }
  );
  if (!ordRes.ok) return json({ ok: false, error: `Falha ao ler o pedido: ${ordRes.status}` }, 502);
  const order = (await ordRes.json().catch(() => []))[0];
  if (!order) return json({ ok: false, error: "Pedido não encontrado" }, 404);

  const batches = order.order_batches || [];
  if (!batches.some(isPaidBatch)) {
    return json({ ok: false, error: "Este pedido ainda não foi pago. Pague-o antes de adicionar cartas." }, 409);
  }
  // code: o cliente usa para sair do modo de adição sem depender do texto.
  if (!canAddCardsToOrder(batches)) return json({ ok: false, code: "ADD_WINDOW_CLOSED", error: ADD_CARDS_CLOSED_ERROR }, 409);

  const newQty = sumQty(items);
  if (newQty < 1) return json({ ok: false, error: "Nenhuma carta para adicionar" }, 400);

  // A faixa de preço olha o volume total da remessa: o que já foi pago + o
  // que está entrando. Adicionar carta nunca deixa a carta mais cara.
  const alreadyPaidQty = paidQtyOf(batches);
  const quote = await quoteItems(SB_URL, SB_KEY, items, null, { tierQty: alreadyPaidQty + newQty });
  const subtotal = quote.subtotal;
  const effectiveUnit = quote.totalQty > 0 ? Math.round((subtotal / quote.totalQty) * 10000) / 10000 : 0;

  const anchor = shippingAnchorOf(batches);
  const batchRes = await fetch(`${SB_URL}/rest/v1/order_batches`, {
    method: "POST", headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify({
      order_id: order.id, status: "DRAFT", payment_method: "MERCADO_PAGO",
      brl_unit_price_locked: effectiveUnit, qty_in_batch: quote.totalQty,
      subtotal_locked: subtotal, shipping_locked: 0, total_locked: subtotal,
      shipping_service: anchor?.shipping_service || null, shipping_address: anchor?.shipping_address || null,
      shipping_already_paid: true, shipping_group_id: shippingGroupIdOf(batches),
    }),
  });
  if (!batchRes.ok) return json({ ok: false, error: `Falha ao criar lote: ${batchRes.status} ${(await batchRes.text()).slice(0, 160)}` }, 502);
  const batch = (await batchRes.json())[0];

  const itemsError = await createItems(SB_URL, headers, order.id, batch.id, quote.lines);
  if (itemsError) return json({ ok: false, error: itemsError }, 502);

  // qty_paid acompanha o pedido inteiro (mesma semântica do checkout: já sobe
  // na criação do lote, antes da confirmação do pagamento).
  await fetch(`${SB_URL}/rest/v1/orders?id=eq.${enc(order.id)}`, {
    method: "PATCH", headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({ qty_paid: (Number(order.qty_paid) || 0) + quote.totalQty }),
  }).catch(() => {});

  return json({
    ok: true, added: true, orderId: order.id, batchId: batch.id,
    shortId: String(batch.id).slice(0, 8).toUpperCase(),
    addedToShortId: anchor ? String(anchor.id).slice(0, 8).toUpperCase() : null,
    subtotal, shipping: 0, total: subtotal, totalQty: quote.totalQty,
    orderTotalQty: alreadyPaidQty + quote.totalQty,
  });
}

// POST /api/individual-checkout
// body: { items:[{card_id,quantity}], shipping:{ service, price, address, already_paid, group_id } }
//    ou { items:[...], addToOrderId }  → adiciona cartas a um pedido individual já pago
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
  const addToOrderId = String(body.addToOrderId || "").trim();
  if (!items.length) return json({ ok: false, error: "Carrinho vazio" }, 400);

  const headers = { apikey: SB_SERVICE_ROLE_KEY, Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" };

  try {
    // Adição a um pedido existente: sem pedido novo, sem frete, sem mínimo —
    // o mínimo já foi cumprido pelo pedido que está recebendo as cartas.
    if (addToOrderId) {
      return await addCardsToOrder({ SB_URL, SB_KEY: SB_SERVICE_ROLE_KEY, headers, json, userId, orderId: addToOrderId, items });
    }

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
    const itemsError = await createItems(SB_URL, headers, order.id, batch.id, quote.lines);
    if (itemsError) return json({ ok: false, error: itemsError }, 502);

    return json({ ok: true, orderId: order.id, batchId: batch.id, shortId: String(batch.id).slice(0, 8).toUpperCase(), subtotal, shipping: shippingLocked, total, totalQty: quote.totalQty });
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
}
