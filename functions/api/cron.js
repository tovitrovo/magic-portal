import { sendDailyDigest, syncTracking } from "./_automation.js";

/**
 * POST /api/cron — chamado pelo pg_cron do Supabase (ver
 * supabase/migrations/admin-automation.sql). O Cloudflare Pages não tem
 * agendador próprio; o banco já tem, e é ele que bate aqui.
 *
 * header: x-cron-secret = automation_config.cron_secret
 * body:   { job: 'tracking' | 'digest' }
 */
function safeEqual(a, b) {
  const x = String(a || "");
  const y = String(b || "");
  if (!x || x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

export async function onRequest(context) {
  const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
  if (context.request.method !== "POST") return json({ ok: false, error: "Método não permitido" }, 405);

  const { SB_URL, SB_SERVICE_ROLE_KEY } = context.env;
  if (!SB_URL || !SB_SERVICE_ROLE_KEY) return json({ ok: false, error: "Config do servidor incompleta" }, 500);

  const headers = { apikey: SB_SERVICE_ROLE_KEY, Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}` };
  const rows = await fetch(`${SB_URL}/rest/v1/automation_config?id=eq.1&select=cron_secret`, { headers })
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => []);
  const secret = Array.isArray(rows) ? rows[0]?.cron_secret : null;
  if (!safeEqual(context.request.headers.get("x-cron-secret"), secret)) return json({ ok: false, error: "Não autorizado" }, 401);

  const body = await context.request.json().catch(() => ({}));
  const job = String(body.job || "");
  if (job === "tracking") return json({ ok: true, job, result: await syncTracking(context.env) });
  if (job === "digest") return json({ ok: true, job, result: await sendDailyDigest(context.env) });
  return json({ ok: false, error: "Job desconhecido" }, 400);
}
