import { corsHeaders } from "./_cors.js";
import { verifyAdmin } from "./_admin-auth.js";

/**
 * POST /api/admin-notifications
 * body:
 *   { action:'list', limit?, onlyUnread? }  — feed de eventos + contagem não lida
 *   { action:'read', ids:[...] }            — marca eventos como lidos
 *   { action:'readAll' }                    — marca tudo como lido
 *   { action:'clear' }                      — apaga eventos já lidos
 */
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
  const action = String(body.action || "list");
  const headers = { apikey: SB_SERVICE_ROLE_KEY, Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" };

  try {
    if (action === "list") {
      const limit = Math.min(Math.max(Number(body.limit) || 60, 1), 200);
      const unreadFilter = body.onlyUnread ? "&read_at=is.null" : "";
      const listUrl = `${SB_URL}/rest/v1/app_notifications?select=id,type,title,body,data,actor_user_id,read_at,created_at${unreadFilter}&order=created_at.desc&limit=${limit}`;
      const listRes = await fetch(listUrl, { headers });
      if (!listRes.ok) {
        const text = await listRes.text().catch(() => "");
        return json({ ok: false, error: `Erro do banco: ${listRes.status} ${text.slice(0, 200)}` }, 502);
      }
      const notifications = await listRes.json().catch(() => []);

      // `count=exact` + limit=1 devolve o total no header Content-Range.
      const countRes = await fetch(`${SB_URL}/rest/v1/app_notifications?select=id&read_at=is.null&limit=1`, {
        headers: { ...headers, Prefer: "count=exact" },
      });
      const range = countRes.headers.get("content-range") || "";
      const unread = Number(range.split("/")[1]) || 0;

      return json({ ok: true, notifications: Array.isArray(notifications) ? notifications : [], unread });
    }

    if (action === "read") {
      const ids = (Array.isArray(body.ids) ? body.ids : []).map(String).filter(Boolean);
      if (ids.length === 0) return json({ ok: true, updated: 0 });
      const inList = ids.map((id) => `"${id}"`).join(",");
      const res = await fetch(`${SB_URL}/rest/v1/app_notifications?id=in.(${inList})&read_at=is.null`, {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify({ read_at: new Date().toISOString() }),
      });
      if (!res.ok) return json({ ok: false, error: `Falha ao marcar como lido: ${res.status}` }, 502);
      return json({ ok: true, updated: ids.length });
    }

    if (action === "readAll") {
      const res = await fetch(`${SB_URL}/rest/v1/app_notifications?read_at=is.null`, {
        method: "PATCH",
        headers: { ...headers, Prefer: "return=minimal" },
        body: JSON.stringify({ read_at: new Date().toISOString() }),
      });
      if (!res.ok) return json({ ok: false, error: `Falha ao marcar como lido: ${res.status}` }, 502);
      return json({ ok: true });
    }

    if (action === "clear") {
      const res = await fetch(`${SB_URL}/rest/v1/app_notifications?read_at=not.is.null`, {
        method: "DELETE",
        headers: { ...headers, Prefer: "return=minimal" },
      });
      if (!res.ok) return json({ ok: false, error: `Falha ao limpar: ${res.status}` }, 502);
      return json({ ok: true });
    }

    return json({ ok: false, error: "Ação desconhecida" }, 400);
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
}
