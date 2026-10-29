import { verifyAdmin } from "./_admin-auth.js";
import { corsHeaders } from "./_cors.js";
import { sheetIdFromUrl } from "../../shared/supplierSheet.js";

// POST /api/admin-catalog-sync
//   { action: "get" }                       → link salvo + status da última sincronização
//   { action: "save", sheet_url, sheet_tab } → troca a planilha
// A sincronização em si roda na Edge Function sync-supplier-sheet (pg_cron
// diário); o botão "Sincronizar agora" do console chama a função direto.
export async function onRequest(context) {
  const CORS = corsHeaders(context, "POST, OPTIONS");
  if (context.request.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

  if (context.request.method !== "POST") return json({ ok: false, error: "Método não permitido" }, 405);

  const { SB_URL, SB_SERVICE_ROLE_KEY } = context.env;
  if (!SB_URL || !SB_SERVICE_ROLE_KEY) return json({ ok: false, error: "SB_URL/SB_SERVICE_ROLE_KEY não configurado" }, 500);

  const auth = await verifyAdmin(context, SB_URL, SB_SERVICE_ROLE_KEY);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const headers = { apikey: SB_SERVICE_ROLE_KEY, Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" };
  const body = await context.request.json().catch(() => ({}));

  if (body.action === "save") {
    const sheetUrl = String(body.sheet_url || "").trim();
    const sheetTab = String(body.sheet_tab || "").trim() || "SINGLES";
    if (!sheetIdFromUrl(sheetUrl)) return json({ ok: false, error: "Link inválido: cole o link do Google Sheets (docs.google.com/spreadsheets/d/...)" }, 400);
    const r = await fetch(`${SB_URL}/rest/v1/catalog_sync?id=eq.1`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ sheet_url: sheetUrl, sheet_tab: sheetTab, updated_at: new Date().toISOString() }),
    });
    if (!r.ok) return json({ ok: false, error: `Falha ao salvar: ${r.status} ${(await r.text()).slice(0, 160)}` }, 502);
  }

  // cron_secret fica de fora: só o pg_cron e a Edge Function precisam dele.
  const r = await fetch(`${SB_URL}/rest/v1/catalog_sync?id=eq.1&select=sheet_url,sheet_tab,running_since,last_run_at,last_result`, { headers });
  if (!r.ok) return json({ ok: false, error: `Falha ao ler config: ${r.status}` }, 502);
  const [config] = await r.json();
  return json({ ok: true, config: config || null });
}
