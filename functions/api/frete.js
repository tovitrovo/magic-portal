import { quoteShipping } from "./_frete-helper.js";

export async function onRequest(context) {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (context.request.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    const body = await context.request.json().catch(() => ({}));
    const result = await quoteShipping(context.env, body.cepDestino, body.quantidade);

    if (result.error) {
      return new Response(JSON.stringify({ opcoes: [], error: result.error }), {
        status: result.status || 500,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ opcoes: result.opcoes }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ opcoes: [], error: String(e?.message || e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
