
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

    const body = await context.request.json().catch(() => ({}));
    const tiers = body.tiers;
    const campaignId = body.campaign_id;
    const deletedIds = body.deletedIds || [];
    if (!Array.isArray(tiers)) {
      return new Response(JSON.stringify({ ok: false, error: "Lista de tiers inválida" }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" }
      });
    }

    const headers = {
      apikey: SB_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    };

    // Resolve campaign_id from request body or from the tier payloads
    const campId = campaignId || tiers.find(t => t.campaign_id)?.campaign_id;

    // Validate and collect IDs of existing tiers to keep (UUID format only)
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const keepIds = tiers.map(t => t.id).filter(id => id && uuidRe.test(id));

    // Delete tiers that are no longer in the payload for this campaign
    if (campId) {
      if (keepIds.length === 0) {
        // No existing tiers to preserve — delete ALL tiers for this campaign
        await fetch(`${SB_URL}/rest/v1/tiers?campaign_id=eq.${encodeURIComponent(campId)}`, {
          method: "DELETE", headers,
        });
      } else {
        // Keep specified tiers, delete everything else for this campaign
        const keepFilter = keepIds.map(id => encodeURIComponent(id)).join(',');
        await fetch(`${SB_URL}/rest/v1/tiers?campaign_id=eq.${encodeURIComponent(campId)}&id=not.in.(${keepFilter})`, {
          method: "DELETE", headers,
        });
      }
    } else {
      // Fallback: delete by explicit IDs from client (legacy behavior)
      for (const id of deletedIds) {
        if (!id) continue;
        await fetch(`${SB_URL}/rest/v1/tiers?id=eq.${encodeURIComponent(id)}`, {
          method: "DELETE", headers,
        });
      }
    }

    // Update existing and create new tiers
    const getHeaders = { apikey: SB_SERVICE_ROLE_KEY, Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}` };
    const upsertHeaders = { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" };

    for (const tier of tiers) {
      const { id, usd_per_card, label, min_qty, max_qty, quest_text, rank } = tier;
      if (id && uuidRe.test(id)) {
        // Update existing
        const r = await fetch(`${SB_URL}/rest/v1/tiers?id=eq.${encodeURIComponent(id)}`, {
          method: "PATCH", headers,
          body: JSON.stringify({ usd_per_card, label, min_qty, max_qty, quest_text, rank }),
        });
        if (!r.ok) {
          const t = await r.text().catch(() => "");
          return new Response(JSON.stringify({ ok: false, error: `Falha ao salvar tier ${id}: ${r.status} ${t.slice(0, 200)}` }), {
            status: 502, headers: { ...CORS, "Content-Type": "application/json" }
          });
        }
      } else if (campId) {
        // Create new tier — try UPSERT with correct (campaign_id, min_qty, max_qty) constraint first
        const tierData = { campaign_id: campId, usd_per_card, label, min_qty, max_qty, quest_text, rank };
        let r = await fetch(
          `${SB_URL}/rest/v1/tiers?on_conflict=campaign_id,min_qty,max_qty`,
          { method: "POST", headers: upsertHeaders, body: JSON.stringify(tierData) }
        );

        if (!r.ok) {
          // Correct constraint may not exist (old schema has UNIQUE(min_qty, max_qty) only).
          // Fallback: find conflicting tier by min_qty/max_qty and PATCH it.
          const maxQtyFilter = max_qty === null || max_qty === undefined
            ? 'max_qty=is.null' : `max_qty=eq.${encodeURIComponent(max_qty)}`;
          const lookupRes = await fetch(
            `${SB_URL}/rest/v1/tiers?min_qty=eq.${encodeURIComponent(min_qty)}&${maxQtyFilter}&select=id&limit=1`,
            { headers: getHeaders }
          );
          const existing = await lookupRes.json().catch(() => []);

          if (existing.length > 0) {
            r = await fetch(`${SB_URL}/rest/v1/tiers?id=eq.${encodeURIComponent(existing[0].id)}`, {
              method: "PATCH", headers,
              body: JSON.stringify(tierData),
            });
          } else {
            // No conflicting tier found — try plain INSERT as last resort
            r = await fetch(`${SB_URL}/rest/v1/tiers`, {
              method: "POST", headers,
              body: JSON.stringify(tierData),
            });
          }

          if (!r.ok) {
            const t = await r.text().catch(() => "");
            return new Response(JSON.stringify({ ok: false, error: `Falha ao criar tier: ${r.status} ${t.slice(0, 200)}` }), {
              status: 502, headers: { ...CORS, "Content-Type": "application/json" }
            });
          }
        }
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { ...CORS, "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" }
    });
  }
}
