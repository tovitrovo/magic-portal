import { corsHeaders } from "./_cors.js";
import { verifyUser } from "./_admin-auth.js";
import { pushToSubscriptions } from "./_notify.js";
import { readVapidConfig } from "./_webpush.js";

/**
 * POST /api/push-subscribe
 *
 * body:
 *   { action:'subscribe', subscription:{endpoint,keys:{p256dh,auth}}, prefs?:{newOrders,logins}, deviceLabel? }
 *   { action:'update',    endpoint, prefs:{newOrders,logins} }
 *   { action:'unsubscribe', endpoint }
 *   { action:'status',    endpoint }
 *   { action:'test',      endpoint }   — envia um push de teste para o aparelho
 *
 * Sempre exige usuário autenticado; a subscription é gravada no nome dele.
 */
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
  const action = String(body.action || "subscribe");
  const headers = { apikey: SB_SERVICE_ROLE_KEY, Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}`, "Content-Type": "application/json" };

  const findByEndpoint = async (endpoint) => {
    const url = `${SB_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}&user_id=eq.${auth.userId}&select=id,endpoint,p256dh,auth,notify_new_orders,notify_logins,device_label,created_at,last_success_at`;
    const rows = await fetch(url, { headers }).then((r) => (r.ok ? r.json() : [])).catch(() => []);
    return Array.isArray(rows) ? rows[0] || null : null;
  };

  try {
    if (action === "subscribe") {
      const sub = body.subscription || {};
      const endpoint = String(sub.endpoint || "").trim();
      const p256dh = String(sub.keys?.p256dh || "").trim();
      const authKey = String(sub.keys?.auth || "").trim();
      if (!endpoint || !p256dh || !authKey) return json({ ok: false, error: "Subscription inválida" }, 400);

      const prefs = body.prefs || {};
      const row = {
        user_id: auth.userId,
        endpoint,
        p256dh,
        auth: authKey,
        user_agent: (context.request.headers.get("User-Agent") || "").slice(0, 300),
        device_label: String(body.deviceLabel || "").slice(0, 80) || null,
        notify_new_orders: prefs.newOrders !== false,
        notify_logins: prefs.logins !== false,
        updated_at: new Date().toISOString(),
      };

      // `endpoint` é UNIQUE — on_conflict garante idempotência quando o
      // navegador reenvia a mesma subscription (reinstalação do PWA, etc).
      const res = await fetch(`${SB_URL}/rest/v1/push_subscriptions?on_conflict=endpoint`, {
        method: "POST",
        headers: { ...headers, Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(row),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return json({ ok: false, error: `Falha ao salvar dispositivo: ${res.status} ${text.slice(0, 200)}` }, 502);
      }
      const saved = (await res.json().catch(() => []))[0] || null;
      return json({ ok: true, subscription: saved, prefs: { newOrders: row.notify_new_orders, logins: row.notify_logins } });
    }

    if (action === "update") {
      const endpoint = String(body.endpoint || "").trim();
      if (!endpoint) return json({ ok: false, error: "endpoint ausente" }, 400);
      const prefs = body.prefs || {};
      const patch = { updated_at: new Date().toISOString() };
      if (typeof prefs.newOrders === "boolean") patch.notify_new_orders = prefs.newOrders;
      if (typeof prefs.logins === "boolean") patch.notify_logins = prefs.logins;

      const res = await fetch(
        `${SB_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}&user_id=eq.${auth.userId}`,
        { method: "PATCH", headers: { ...headers, Prefer: "return=representation" }, body: JSON.stringify(patch) }
      );
      if (!res.ok) return json({ ok: false, error: `Falha ao atualizar preferências: ${res.status}` }, 502);
      const saved = (await res.json().catch(() => []))[0] || null;
      return json({ ok: true, subscription: saved });
    }

    if (action === "unsubscribe") {
      const endpoint = String(body.endpoint || "").trim();
      if (!endpoint) return json({ ok: false, error: "endpoint ausente" }, 400);
      await fetch(
        `${SB_URL}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}&user_id=eq.${auth.userId}`,
        { method: "DELETE", headers: { ...headers, Prefer: "return=minimal" } }
      );
      return json({ ok: true });
    }

    if (action === "status") {
      const endpoint = String(body.endpoint || "").trim();
      if (!endpoint) return json({ ok: true, subscription: null });
      return json({ ok: true, subscription: await findByEndpoint(endpoint) });
    }

    if (action === "test") {
      if (!readVapidConfig(context.env)) return json({ ok: false, error: "VAPID não configurado no servidor" }, 400);
      const endpoint = String(body.endpoint || "").trim();
      const sub = endpoint ? await findByEndpoint(endpoint) : null;
      if (!sub) return json({ ok: false, error: "Dispositivo não inscrito" }, 404);
      const result = await pushToSubscriptions(context.env, [sub], {
        type: "TEST",
        title: "Notificações ativas ✅",
        body: "É assim que você vai receber pedidos novos e logins.",
        url: "/?admin=notifications",
      });
      if (result.sent === 0) return json({ ok: false, error: "Não foi possível entregar o push de teste" }, 502);
      return json({ ok: true, ...result });
    }

    return json({ ok: false, error: "Ação desconhecida" }, 400);
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
}
