import { incrementPoolOnPaid } from './_pool-helper.js';
import { grantTierBonusToAll } from './_tier-bonus-helper.js';

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

    // Incrementa pool ANTES de marcar como PAID (para detectar a transição)
    await incrementPoolOnPaid(SB_URL, SB_SERVICE_ROLE_KEY, batchId);

    const r = await fetch(`${SB_URL}/rest/v1/order_batches?id=eq.${encodeURIComponent(batchId)}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ status:"PAID", confirmed_at: new Date().toISOString() })
    });

    if (!r.ok) {
      const t = await r.text().catch(()=> "");
      return new Response(JSON.stringify({ ok:false, error:`Supabase PATCH falhou: ${r.status} ${t.slice(0,200)}` }), {
        status: 502, headers: { ...CORS, "Content-Type":"application/json" }
      });
    }

    
    // Recalcula bônus de tier-change para todos os usuários da campanha
    try {
      const sbH = { apikey: SB_SERVICE_ROLE_KEY, Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}` };
      const bRes = await fetch(`${SB_URL}/rest/v1/order_batches?id=eq.${encodeURIComponent(batchId)}&select=order_id`, { headers: sbH });
      const bArr = await bRes.json().catch(() => []);
      const orderId2 = Array.isArray(bArr) && bArr.length ? bArr[0].order_id : null;
      if (orderId2) {
        const oRes = await fetch(`${SB_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId2)}&select=campaign_id`, { headers: sbH });
        const oArr = await oRes.json().catch(() => []);
        const campaignId = Array.isArray(oArr) && oArr.length ? oArr[0].campaign_id : null;
        if (campaignId) await grantTierBonusToAll(SB_URL, SB_SERVICE_ROLE_KEY, campaignId);
      }
    } catch (e) { console.error('admin-mark-paid: tier bonus error:', e); }

    return new Response(JSON.stringify({ ok:true }), {
      status: 200, headers: { ...CORS, "Content-Type":"application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok:false, error:String(e?.message||e) }), {
      status: 500, headers: { "Content-Type":"application/json" }
    });
  }
}
