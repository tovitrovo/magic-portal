export const onRequestPost: PagesFunction = async (context) => {
  try {
    const body = await context.request.json<any>();

    const accessToken = context.env.MP_ACCESS_TOKEN as string | undefined;
    if (!accessToken) {
      return json({ error: "MP_ACCESS_TOKEN não configurado no Cloudflare" }, 500);
    }

    const items = Array.isArray(body?.items) ? body.items : [];
    if (!items.length) return json({ error: "items vazio" }, 400);

    const preference = {
      items: items.map((it: any) => ({
        title: String(it.title || "Item"),
        quantity: Number(it.quantity || 1),
        unit_price: Number(it.unit_price || 0),
        currency_id: "BRL",
      })),
      payer: body?.email ? { email: String(body.email) } : undefined,
      // Ajuste essas URLs quando quiser páginas de retorno:
      back_urls: {
        success: context.request.headers.get("origin") + "/?pay=success",
        pending: context.request.headers.get("origin") + "/?pay=pending",
        failure: context.request.headers.get("origin") + "/?pay=failure",
      },
      auto_return: "approved",
      shipments: body?.shipping?.cost ? {
        cost: Number(body.shipping.cost),
        mode: "not_specified"
      } : undefined,
    };

    const resp = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(preference),
    });

    const data = await resp.json<any>();
    if (!resp.ok) {
      return json({ error: data?.message || "Erro Mercado Pago", details: data }, 400);
    }

    return json({ id: data.id, init_point: data.init_point, sandbox_init_point: data.sandbox_init_point }, 200);
  } catch (e: any) {
    return json({ error: e?.message || "Erro inesperado" }, 500);
  }
};

// ✅ Pra você conseguir "clicar e testar" no browser.
// Cloudflare Pages Functions: se só existir onRequestPost, um GET dá 404.
export const onRequestGet: PagesFunction = async () => {
  return json(
    {
      ok: true,
      message: "MP endpoint está online. Use POST para criar preferência.",
      howToTest: "Abra /api/health (GET). O checkout usa POST via site.",
    },
    200
  );
};

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}
