import { authoritativeBatchTotal } from "./_campaign-helper.js";
import { corsHeaders } from "./_cors.js";

export async function onRequest(context) {
  const CORS = corsHeaders(context, "POST, OPTIONS");
  if (context.request.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { MP_ACCESS_TOKEN, SB_URL, SB_SERVICE_ROLE_KEY } = context.env;
    if (!MP_ACCESS_TOKEN) {
      return new Response(JSON.stringify({ error: "MP_ACCESS_TOKEN não configurado" }), {
        status: 500, headers: { ...CORS, "Content-Type": "application/json" }
      });
    }

    const body = await context.request.json().catch(() => ({}));
    const orderId = String(body.orderId || "").trim(); // aqui é o batch.id
    const descricao = String(body.descricao || "Pedido");

    if (!orderId) {
      return new Response(JSON.stringify({ error: "Parâmetros inválidos" }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" }
      });
    }

    // SEGURANÇA: o valor cobrado NÃO vem do cliente. É recalculado de forma
    // autoritativa no servidor (preços de pricing_config + itens do banco),
    // evitando adulteração de preço mesmo via REST direto do Supabase.
    if (!SB_URL || !SB_SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ error: "Config do servidor incompleta" }), {
        status: 500, headers: { ...CORS, "Content-Type": "application/json" }
      });
    }
    const authTotal = await authoritativeBatchTotal(SB_URL, SB_SERVICE_ROLE_KEY, orderId);
    if (!authTotal.ok) {
      return new Response(JSON.stringify({ error: "Pedido não encontrado" }), {
        status: 404, headers: { ...CORS, "Content-Type": "application/json" }
      });
    }
    if (authTotal.status === "PAID" || authTotal.status === "PAID_CONFIRMED") {
      return new Response(JSON.stringify({ error: "Pedido já está pago" }), {
        status: 409, headers: { ...CORS, "Content-Type": "application/json" }
      });
    }
    const total = Number(authTotal.total || 0);
    if (!Number.isFinite(total) || total <= 0) {
      return new Response(JSON.stringify({ error: "Valor do pedido inválido" }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" }
      });
    }

    const origin = new URL(context.request.url).origin;

    const preference = {
      external_reference: orderId,
      items: [
        { title: descricao, quantity: 1, unit_price: Number(total.toFixed(2)), currency_id: "BRL" }
      ],
      notification_url: `${origin}/api/mp-webhook`
    };

    const res = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${MP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(preference),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return new Response(JSON.stringify({ error: "Mercado Pago erro", details: data }), {
        status: 502, headers: { ...CORS, "Content-Type": "application/json" }
      });
    }

    const mpLink = data?.init_point || data?.sandbox_init_point || null;

    // Tenta salvar o link no Supabase (pra página Perfil -> "Pagar agora" funcionar)
    let saved = false;
    if (SB_URL && SB_SERVICE_ROLE_KEY && mpLink) {
      try {
        await fetch(`${SB_URL}/rest/v1/order_batches?id=eq.${encodeURIComponent(orderId)}`, {
          method: "PATCH",
          headers: {
            apikey: SB_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({
            mp_link: mpLink,
            mp_preference_id: data?.id || null,
            payment_method: "MERCADO_PAGO",
            // Persiste o total autoritativo para manter admin/webhook consistentes
            total_locked: Number(total.toFixed(2)),
            status: "PENDING_PAYMENT"
          }),
        });
        saved = true;
      } catch {
        // não bloqueia o retorno do link
      }
    }

    return new Response(JSON.stringify({
      mpLink,
      preferenceId: data?.id || null,
      saved
    }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}
