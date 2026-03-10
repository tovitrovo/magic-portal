import { verifyAdmin } from "./_admin-auth.js";

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
      return new Response(JSON.stringify({ ok: false, error: "SB_URL/SB_SERVICE_ROLE_KEY não configurado" }), {
        status: 500, headers: { ...CORS, "Content-Type": "application/json" }
      });
    }

    const auth = await verifyAdmin(context, SB_URL, SB_SERVICE_ROLE_KEY);
    if (!auth.ok) {
      return new Response(JSON.stringify({ ok: false, error: auth.error }), {
        status: auth.status, headers: { ...CORS, "Content-Type": "application/json" }
      });
    }

    const body = await context.request.json().catch(() => ({}));
    const { action } = body;

    const headers = {
      apikey: SB_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    };

    // ─── LIST: listar bonus_grants de uma campanha ───
    if (action === "list") {
      const { campaignId } = body;
      if (!campaignId) {
        return new Response(JSON.stringify({ ok: false, error: "campaignId obrigatório" }), {
          status: 400, headers: { ...CORS, "Content-Type": "application/json" }
        });
      }
      const select = "id,user_id,campaign_id,bonus_qty,status,created_at,profiles(name,email)";
      const url = `${SB_URL}/rest/v1/bonus_grants?campaign_id=eq.${encodeURIComponent(campaignId)}&select=${encodeURIComponent(select)}&order=created_at.desc`;
      const r = await fetch(url, { headers });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        return new Response(JSON.stringify({ ok: false, error: `Falha ao listar bônus: ${r.status} ${t.slice(0, 200)}` }), {
          status: 502, headers: { ...CORS, "Content-Type": "application/json" }
        });
      }
      const grants = await r.json();
      return new Response(JSON.stringify({ ok: true, grants }), {
        status: 200, headers: { ...CORS, "Content-Type": "application/json" }
      });
    }

    // ─── GRANT: conceder bônus a um usuário ──────────
    if (action === "grant") {
      const { userId, campaignId, bonusQty } = body;
      if (!userId || !campaignId || !bonusQty || bonusQty < 1) {
        return new Response(JSON.stringify({ ok: false, error: "userId, campaignId e bonusQty (>0) obrigatórios" }), {
          status: 400, headers: { ...CORS, "Content-Type": "application/json" }
        });
      }
      const url = `${SB_URL}/rest/v1/bonus_grants`;
      const r = await fetch(url, {
        method: "POST",
        headers: { ...headers, Prefer: "return=representation" },
        body: JSON.stringify({ user_id: userId, campaign_id: campaignId, bonus_qty: bonusQty, status: "AVAILABLE" }),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        return new Response(JSON.stringify({ ok: false, error: `Falha ao conceder bônus: ${r.status} ${t.slice(0, 200)}` }), {
          status: 502, headers: { ...CORS, "Content-Type": "application/json" }
        });
      }
      const created = await r.json();
      return new Response(JSON.stringify({ ok: true, grant: Array.isArray(created) ? created[0] : created }), {
        status: 201, headers: { ...CORS, "Content-Type": "application/json" }
      });
    }

    // ─── REVOKE: revogar/expirar um bônus ────────────
    if (action === "revoke") {
      const { grantId } = body;
      if (!grantId) {
        return new Response(JSON.stringify({ ok: false, error: "grantId obrigatório" }), {
          status: 400, headers: { ...CORS, "Content-Type": "application/json" }
        });
      }
      const url = `${SB_URL}/rest/v1/bonus_grants?id=eq.${encodeURIComponent(grantId)}`;
      const r = await fetch(url, {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify({ status: "EXPIRED" }),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        return new Response(JSON.stringify({ ok: false, error: `Falha ao revogar bônus: ${r.status} ${t.slice(0, 200)}` }), {
          status: 502, headers: { ...CORS, "Content-Type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { ...CORS, "Content-Type": "application/json" }
      });
    }

    return new Response(JSON.stringify({ ok: false, error: "action inválida (use: list, grant, revoke)" }), {
      status: 400, headers: { ...CORS, "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: "Erro interno no endpoint de bônus: " + String(e?.message || e) }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" }
    });
  }
}
