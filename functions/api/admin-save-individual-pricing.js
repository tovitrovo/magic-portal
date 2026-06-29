import { verifyAdmin } from "./_admin-auth.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

// POST /api/admin-save-individual-pricing  { pricing:{...}, tiers:[{min_qty,max_qty,usd_per_card}] }
export async function onRequest(context) {
  if (context.request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (context.request.method !== "POST") return json({ ok: false, error: "Método não permitido" }, 405);

  const { SB_URL, SB_SERVICE_ROLE_KEY } = context.env;
  if (!SB_URL || !SB_SERVICE_ROLE_KEY) return json({ ok: false, error: "Config do servidor incompleta" }, 500);

  const auth = await verifyAdmin(context, SB_URL, SB_SERVICE_ROLE_KEY);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const body = await context.request.json().catch(() => ({}));
  const headers = { apikey: SB_SERVICE_ROLE_KEY, Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" };

  try {
    // ── Config (singleton) ──
    if (body.pricing && typeof body.pricing === "object") {
      const p = body.pricing;
      const fields = {};
      for (const k of ["multiplier", "normal_floor_brl", "holo_floor_brl", "foil_floor_brl", "min_cards", "fx_fallback_rate"]) {
        if (p[k] != null && Number.isFinite(Number(p[k]))) fields[k] = Number(p[k]);
      }
      if (Object.keys(fields).length) {
        fields.updated_at = new Date().toISOString();
        const r = await fetch(`${SB_URL}/rest/v1/individual_pricing?is_active=eq.true`, {
          method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify(fields),
        });
        if (!r.ok) return json({ ok: false, error: `Falha ao salvar config: ${r.status} ${(await r.text()).slice(0, 160)}` }, 502);
      }
    }

    // ── Faixas ──
    if (Array.isArray(body.tiers)) {
      const tiers = body.tiers
        .map(t => ({ min_qty: Math.floor(Number(t.min_qty)), max_qty: t.max_qty == null || t.max_qty === "" ? null : Math.floor(Number(t.max_qty)), usd_per_card: Number(t.usd_per_card) }))
        .filter(t => Number.isFinite(t.min_qty) && Number.isFinite(t.usd_per_card) && t.usd_per_card > 0);

      if (tiers.length) {
        const up = await fetch(`${SB_URL}/rest/v1/individual_tiers?on_conflict=min_qty`, {
          method: "POST", headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(tiers),
        });
        if (!up.ok) return json({ ok: false, error: `Falha ao salvar faixas: ${up.status} ${(await up.text()).slice(0, 160)}` }, 502);

        // Remove faixas que não estão mais na lista
        const keep = tiers.map(t => t.min_qty).join(",");
        await fetch(`${SB_URL}/rest/v1/individual_tiers?min_qty=not.in.(${keep})`, {
          method: "DELETE", headers: { ...headers, Prefer: "return=minimal" },
        }).catch(() => {});
      }
    }

    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
}
