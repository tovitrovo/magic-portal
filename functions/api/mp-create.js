export async function onRequest(context) {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (context.request.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { MP_ACCESS_TOKEN } = context.env;
    if (!MP_ACCESS_TOKEN) {
      return new Response(JSON.stringify({ error: "MP_ACCESS_TOKEN não configurado" }), {
        status: 500, headers: { ...CORS, "Content-Type": "application/json" }
      });
    }

    const body = await context.request.json().catch(() => ({}));
    const orderId = String(body.orderId || "").trim();
    const total = Number(body.total || 0);
    const descricao = String(body.descricao || "Pedido");

    if (!orderId || !Number.isFinite(total) || total <= 0) {
      return new Response(JSON.stringify({ error: "Parâmetros inválidos" }), {
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

    // Retorna tudo, mas normalmente o portal usa data.init_point
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
}
