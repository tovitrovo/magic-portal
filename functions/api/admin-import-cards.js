import { verifyAdmin } from "./_admin-auth.js";
import { buildCardsFromCsv } from "../../shared/cardImport.js";
import { recalcLotPrices } from "./_lot-helper.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const CHUNK = 500;

export async function onRequest(context) {
  if (context.request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (context.request.method !== "POST") return json({ ok: false, error: "Método não permitido" }, 405);

  const { SB_URL, SB_SERVICE_ROLE_KEY } = context.env;
  if (!SB_URL || !SB_SERVICE_ROLE_KEY) {
    return json({ ok: false, error: "SB_URL/SB_SERVICE_ROLE_KEY não configurado" }, 500);
  }

  const auth = await verifyAdmin(context, SB_URL, SB_SERVICE_ROLE_KEY);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const body = await context.request.json().catch(() => ({}));
  const csv = typeof body.csv === "string" ? body.csv : "";
  const deactivatePrevious = body.deactivatePrevious === true;
  if (!csv.trim()) return json({ ok: false, error: "CSV vazio ou ausente" }, 400);

  let cards, skipped, total;
  try {
    ({ cards, skipped, total } = buildCardsFromCsv(csv));
  } catch (e) {
    return json({ ok: false, error: `Falha ao processar o CSV: ${String(e?.message || e)}` }, 400);
  }
  if (cards.length === 0) return json({ ok: false, error: "Nenhuma carta válida no CSV" }, 400);

  const headers = {
    apikey: SB_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };

  // Opcional: desativa o catálogo Magic anterior. Os registros importados são
  // reativados logo abaixo via upsert (merge-duplicates por import_ref).
  let deactivated = 0;
  if (deactivatePrevious) {
    const r = await fetch(`${SB_URL}/rest/v1/cards?tcg=eq.Magic&is_active=eq.true`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=representation" },
      body: JSON.stringify({ is_active: false }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      return json({ ok: false, error: `Falha ao desativar catálogo anterior: ${r.status} ${t.slice(0, 200)}` }, 502);
    }
    const rows = await r.json().catch(() => []);
    deactivated = Array.isArray(rows) ? rows.length : 0;
  }

  // Upsert em lotes por import_ref (re-uploads atualizam preço/imagem em vez de duplicar).
  let upserted = 0;
  for (let i = 0; i < cards.length; i += CHUNK) {
    const chunk = cards.slice(i, i + CHUNK);
    const r = await fetch(`${SB_URL}/rest/v1/cards?on_conflict=import_ref`, {
      method: "POST",
      headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(chunk),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      return json({
        ok: false,
        error: `Falha no upsert (lote ${i / CHUNK + 1}): ${r.status} ${t.slice(0, 300)}`,
        upserted,
        deactivated,
      }, 502);
    }
    upserted += chunk.length;
  }

  // Reprecifica os lotes: re-uploads podem mudar o cost_original_usd.
  let lots = null;
  try { lots = await recalcLotPrices(SB_URL, SB_SERVICE_ROLE_KEY); } catch { /* não bloqueia o import */ }

  return json({ ok: true, total, upserted, skipped, deactivated, lots });
}
