import { corsHeaders } from "./_cors.js";
import { verifyAdmin } from "./_admin-auth.js";
import { sendDailyDigest, syncTracking } from "./_automation.js";

/**
 * POST /api/admin-automation — painel das rotinas automáticas.
 *
 * body:
 *   { action:'get' }                       → status da última execução de cada rotina
 *   { action:'register', siteUrl }         → grava a URL do site que o pg_cron chama
 *   { action:'run', job:'tracking'|'digest' } → roda agora, fora do horário
 *
 * O console chama `register` sozinho ao abrir, com window.location.origin:
 * assim o cron aponta para o domínio real sem ninguém configurar nada.
 */
export function normalizeSiteUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:") return null;
    if (/^(localhost|127\.|0\.0\.0\.0)/.test(url.hostname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export async function onRequest(context) {
  const CORS = corsHeaders(context, "POST, OPTIONS");
  const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
  if (context.request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (context.request.method !== "POST") return json({ ok: false, error: "Método não permitido" }, 405);

  const { SB_URL, SB_SERVICE_ROLE_KEY } = context.env;
  if (!SB_URL || !SB_SERVICE_ROLE_KEY) return json({ ok: false, error: "Config do servidor incompleta" }, 500);
  const auth = await verifyAdmin(context, SB_URL, SB_SERVICE_ROLE_KEY);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const body = await context.request.json().catch(() => ({}));
  const action = String(body.action || "get");
  const headers = { apikey: SB_SERVICE_ROLE_KEY, Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" };
  // cron_secret fica de fora: só o pg_cron e /api/cron precisam dele.
  const fields = "site_url,tracking_last_run_at,tracking_last_result,digest_last_run_at,digest_last_result,updated_at";

  const load = async () => {
    const res = await fetch(`${SB_URL}/rest/v1/automation_config?id=eq.1&select=${fields}`, { headers });
    if (!res.ok) throw new Error(`automation_config: ${res.status} — rode supabase/migrations/admin-automation.sql`);
    return (await res.json().catch(() => []))[0] || null;
  };

  try {
    if (action === "get") return json({ ok: true, config: await load() });

    if (action === "register") {
      const siteUrl = normalizeSiteUrl(body.siteUrl);
      if (!siteUrl) return json({ ok: false, error: "URL do site inválida (precisa ser https)" }, 400);
      const res = await fetch(`${SB_URL}/rest/v1/automation_config?id=eq.1`, {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify({ site_url: siteUrl, updated_at: new Date().toISOString() }),
      });
      if (!res.ok) return json({ ok: false, error: `Falha ao salvar: ${res.status}` }, 502);
      return json({ ok: true, config: await load() });
    }

    if (action === "run") {
      const job = String(body.job || "");
      if (job === "tracking") return json({ ok: true, result: await syncTracking(context.env), config: await load() });
      if (job === "digest") return json({ ok: true, result: await sendDailyDigest(context.env, { force: true }), config: await load() });
      return json({ ok: false, error: "Job desconhecido" }, 400);
    }

    return json({ ok: false, error: "Ação desconhecida" }, 400);
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
}
