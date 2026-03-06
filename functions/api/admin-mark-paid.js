export async function onRequest(context) {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (context.request.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { SB_URL, SB_SERVICE_ROLE_KEY } = context.env;
    if (!SB_URL || !SB_SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ ok:false, error: "SB_URL/SB_SERVICE_ROLE_KEY não configurado" }), {
        status: 500, headers: { ...CORS, "Content-Type":"application/json" }
      });
    }

    const body = await context.request.json().catch(() => ({}));
    const batchId = String(body.batchId || "").trim();
    if (!batchId) {
      return new Response(JSON.stringify({ ok:false, error:"batchId ausente" }), {
        status: 400, headers: { ...CORS, "Content-Type":"application/json" }
      });
    }

    const headers = {
      apikey: SB_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    };

    await fetch(`${SB_URL}/rest/v1/order_batches?id=eq.${encodeURIComponent(batchId)}`, {
      method:"PATCH",
      headers,
      body: JSON.stringify({ status:"PAID", confirmed_at: new Date().toISOString() })
    });

    return new Response(JSON.stringify({ ok:true }), { status:200, headers:{ ...CORS, "Content-Type":"application/json" }});
  } catch (e) {
    return new Response(JSON.stringify({ ok:false, error:String(e?.message||e) }), { status:500, headers:{ "Content-Type":"application/json" }});
  }
}
