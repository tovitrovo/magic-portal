import { decrementPoolOnCancel } from './_pool-helper.js';
import { verifyUser } from './_admin-auth.js';

export async function onRequest(context) {
  const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  if (context.request.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { SB_URL, SB_SERVICE_ROLE_KEY } = context.env;
    if (!SB_URL || !SB_SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ ok:false, error:"SB_URL/SB_SERVICE_ROLE_KEY não configurado" }), {
        status: 500, headers: { ...CORS, "Content-Type":"application/json" }
      });
    }

    const auth = await verifyUser(context, SB_URL, SB_SERVICE_ROLE_KEY);
    if (!auth.ok) return new Response(JSON.stringify({ ok:false, error: auth.error }), {
      status: auth.status, headers: { ...CORS, "Content-Type":"application/json" }
    });
    const userId = auth.userId;

    const body = await context.request.json().catch(() => ({}));
    const batchId = String(body.batchId || body.id || "").trim();
    const orderId = String(body.orderId || body.order_id || "").trim();
    if (!batchId && !orderId) {
      return new Response(JSON.stringify({ ok:false, error:"batchId/orderId ausente" }), {
        status: 400, headers: { ...CORS, "Content-Type":"application/json" }
      });
    }

    const headers = {
      apikey: SB_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    };
    const readHeaders = { apikey: SB_SERVICE_ROLE_KEY, Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}` };

    // SEGURANÇA: verifica posse e bloqueia cancelamento de pedidos pagos.
    const ownsOrder = async (oid) => {
      const r = await fetch(`${SB_URL}/rest/v1/orders?id=eq.${encodeURIComponent(oid)}&select=user_id&limit=1`, { headers: readHeaders });
      const arr = await r.json().catch(() => []);
      return Array.isArray(arr) && arr.length ? arr[0].user_id === userId : false;
    };

    if (batchId) {
      const r = await fetch(`${SB_URL}/rest/v1/order_batches?id=eq.${encodeURIComponent(batchId)}&select=order_id,status&limit=1`, { headers: readHeaders });
      const arr = await r.json().catch(() => []);
      const b = Array.isArray(arr) && arr.length ? arr[0] : null;
      if (!b) return new Response(JSON.stringify({ ok:false, error:"Pedido não encontrado" }), { status:404, headers:{...CORS,"Content-Type":"application/json"}});
      if (b.status === "PAID" || b.status === "PAID_CONFIRMED") {
        return new Response(JSON.stringify({ ok:false, error:"Pedido pago não pode ser cancelado aqui" }), { status:409, headers:{...CORS,"Content-Type":"application/json"}});
      }
      if (!(await ownsOrder(b.order_id))) {
        return new Response(JSON.stringify({ ok:false, error:"Acesso negado" }), { status:403, headers:{...CORS,"Content-Type":"application/json"}});
      }
    } else if (orderId) {
      if (!(await ownsOrder(orderId))) {
        return new Response(JSON.stringify({ ok:false, error:"Acesso negado" }), { status:403, headers:{...CORS,"Content-Type":"application/json"}});
      }
    }

    const del = async (table, filter) => {
      await fetch(`${SB_URL}/rest/v1/${table}?${filter}`, { method:"DELETE", headers });
    };

    if (batchId) {
      // Decrementa pool se batch estava PAID antes de deletar
      try { await decrementPoolOnCancel(SB_URL, SB_SERVICE_ROLE_KEY, batchId); } catch {}
      try { await del("order_items", `batch_id=eq.${encodeURIComponent(batchId)}`); } catch {}
      try { await del("order_batches", `id=eq.${encodeURIComponent(batchId)}`); } catch {}
    }
    else if (orderId) {
      // Decrementa pool para todos os batches PAID desta order antes de deletar
      try {
        const bRes = await fetch(`${SB_URL}/rest/v1/order_batches?order_id=eq.${encodeURIComponent(orderId)}&select=id,status`, { headers: { apikey: SB_SERVICE_ROLE_KEY, Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}` } });
        const batches = await bRes.json().catch(() => []);
        if (Array.isArray(batches)) {
          for (const b of batches) {
            if (b.status === 'PAID' || b.status === 'PAID_CONFIRMED') {
              await decrementPoolOnCancel(SB_URL, SB_SERVICE_ROLE_KEY, b.id);
            }
          }
        }
      } catch {}
      try { await del("order_batches", `order_id=eq.${encodeURIComponent(orderId)}`); } catch {}
      try { await del("orders", `id=eq.${encodeURIComponent(orderId)}`); } catch {}
    }

    return new Response(JSON.stringify({ ok:true }), { status:200, headers:{...CORS,"Content-Type":"application/json"}});
  } catch (e) {
    return new Response(JSON.stringify({ ok:false, error:String(e?.message||e) }), { status:500, headers:{"Content-Type":"application/json"}});
  }
}
