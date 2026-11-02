import { decrementPoolOnCancel } from './_pool-helper.js';
import { verifyAdmin } from './_admin-auth.js';
import { refundBatch } from './_mp-refund.js';

export async function onRequest(context) {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (context.request.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { SB_URL, SB_SERVICE_ROLE_KEY, MP_ACCESS_TOKEN } = context.env;
    if (!SB_URL || !SB_SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ ok:false, error: "SB_URL/SB_SERVICE_ROLE_KEY não configurado" }), {
        status: 500, headers: { ...CORS, "Content-Type":"application/json" }
      });
    }

    const auth = await verifyAdmin(context, SB_URL, SB_SERVICE_ROLE_KEY);
    if (!auth.ok) return new Response(JSON.stringify({ ok:false, error: auth.error }), {
      status: auth.status, headers: { ...CORS, "Content-Type":"application/json" }
    });

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

    // Reembolso (opcional): devolve no Mercado Pago ANTES de cancelar. Se o
    // MP recusar, o lote fica como está e o erro volta para o admin.
    let refund = null;
    if (body.refund === true) {
      const br = await fetch(`${SB_URL}/rest/v1/order_batches?id=eq.${encodeURIComponent(batchId)}&select=id,status,payment_status,mp_payment_id,total_locked`, { headers });
      const [batch] = await br.json().catch(() => []);
      if (!batch) {
        return new Response(JSON.stringify({ ok:false, error:"Lote não encontrado" }), { status: 404, headers: { ...CORS, "Content-Type":"application/json" } });
      }
      refund = await refundBatch(batch, MP_ACCESS_TOKEN);
      if (!refund.ok) {
        return new Response(JSON.stringify({ ok:false, error: refund.error, refundFailed: true }), { status: 502, headers: { ...CORS, "Content-Type":"application/json" } });
      }
    }

    // Decrementa pool ANTES de marcar como CANCELLED (para detectar transição de PAID)
    await decrementPoolOnCancel(SB_URL, SB_SERVICE_ROLE_KEY, batchId);

    const r = await fetch(`${SB_URL}/rest/v1/order_batches?id=eq.${encodeURIComponent(batchId)}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(refund ? { status: "REFUNDED", payment_status: "refunded" } : { status: "CANCELLED" })
    });

    if (!r.ok) {
      const t = await r.text().catch(() => "");
      // O dinheiro já voltou: o erro precisa dizer isso, senão o admin tenta de novo achando que nada aconteceu.
      const prefix = refund ? "Reembolso feito no Mercado Pago, mas o pedido não foi marcado como reembolsado. " : "";
      return new Response(JSON.stringify({ ok:false, error:`${prefix}Supabase PATCH falhou: ${r.status} ${t.slice(0,200)}` }), {
        status: 502, headers: { ...CORS, "Content-Type":"application/json" }
      });
    }

    return new Response(JSON.stringify({ ok:true, refund }), {
      status: 200, headers: { ...CORS, "Content-Type":"application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok:false, error:String(e?.message||e) }), {
      status: 500, headers: { ...CORS, "Content-Type":"application/json" }
    });
  }
}
