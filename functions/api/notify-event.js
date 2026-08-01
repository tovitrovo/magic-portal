import { corsHeaders } from "./_cors.js";
import { verifyUser } from "./_admin-auth.js";
import { notifyAdmins, loadActorLabel } from "./_notify.js";

/**
 * POST /api/notify-event
 * body: { type: 'LOGIN' | 'SIGNUP' }
 *
 * Registra acesso de cliente no site e avisa os admins. O usuário é sempre
 * identificado pelo token (nunca pelo corpo da requisição), então não dá para
 * forjar login de terceiros.
 *
 * Anti-ruído: um mesmo usuário só gera um evento LOGIN a cada 30 minutos —
 * abrir o PWA várias vezes no dia não vira uma enxurrada de notificações.
 */
const LOGIN_DEDUPE_MINUTES = 30;

export async function onRequest(context) {
  const CORS = corsHeaders(context, "POST, OPTIONS");
  const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
  if (context.request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (context.request.method !== "POST") return json({ ok: false, error: "Método não permitido" }, 405);

  const { SB_URL, SB_SERVICE_ROLE_KEY } = context.env;
  if (!SB_URL || !SB_SERVICE_ROLE_KEY) return json({ ok: false, error: "Config do servidor incompleta" }, 500);

  const auth = await verifyUser(context, SB_URL, SB_SERVICE_ROLE_KEY);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const body = await context.request.json().catch(() => ({}));
  const type = String(body.type || "LOGIN").toUpperCase();
  if (type !== "LOGIN" && type !== "SIGNUP") return json({ ok: false, error: "Tipo inválido" }, 400);

  const headers = { apikey: SB_SERVICE_ROLE_KEY, Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}` };

  // Admin logando no próprio painel não vira notificação.
  try {
    const profRes = await fetch(
      `${SB_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(auth.userId)}&select=is_admin`,
      { headers }
    );
    const rows = await profRes.json().catch(() => []);
    if (Array.isArray(rows) && rows[0]?.is_admin) return json({ ok: true, skipped: "admin" });
  } catch {
    // segue o fluxo: melhor notificar de mais do que perder o evento
  }

  if (type === "LOGIN") {
    const since = new Date(Date.now() - LOGIN_DEDUPE_MINUTES * 60 * 1000).toISOString();
    try {
      const url = `${SB_URL}/rest/v1/app_notifications?type=eq.LOGIN&actor_user_id=eq.${encodeURIComponent(auth.userId)}&created_at=gte.${encodeURIComponent(since)}&select=id&limit=1`;
      const recent = await fetch(url, { headers }).then((r) => (r.ok ? r.json() : [])).catch(() => []);
      if (Array.isArray(recent) && recent.length > 0) return json({ ok: true, skipped: "duplicado" });
    } catch {
      // sem dedupe: segue e notifica
    }
  }

  const label = (await loadActorLabel(context.env, auth.userId)) || "Cliente";
  const result = await notifyAdmins(context.env, {
    type,
    title: type === "SIGNUP" ? "Nova conta criada" : "Login no site",
    body: type === "SIGNUP" ? `${label} criou uma conta` : `${label} entrou no portal`,
    data: { userId: auth.userId, name: label },
    actorUserId: auth.userId,
    url: "/?admin=notifications",
  });

  return json({ ok: true, ...result });
}
