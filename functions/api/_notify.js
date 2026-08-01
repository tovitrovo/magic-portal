/**
 * Central de notificações do painel admin.
 *
 * Grava o evento em `app_notifications` e dispara Web Push para todos os
 * dispositivos de admins inscritos (`push_subscriptions`).
 *
 * Nunca lança: notificar é efeito colateral, não pode derrubar checkout,
 * webhook ou login. Erros vão para o log.
 */
import { readVapidConfig, sendPush } from "./_webpush.js";

/** Eventos que respeitam a preferência "novos pedidos" do dispositivo. */
const ORDER_EVENTS = new Set(["NEW_ORDER", "ORDER_PAID", "BONUS_ORDER"]);
/** Eventos que respeitam a preferência "logins" do dispositivo. */
const ACCESS_EVENTS = new Set(["LOGIN", "SIGNUP"]);

function sbHeaders(key, extra = {}) {
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra };
}

/** Salva o evento no histórico. Retorna a linha criada (ou null). */
async function insertNotification(SB_URL, SB_KEY, event) {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/app_notifications`, {
      method: "POST",
      headers: sbHeaders(SB_KEY, { "Content-Type": "application/json", Prefer: "return=representation" }),
      body: JSON.stringify({
        type: event.type,
        title: event.title,
        body: event.body || null,
        data: event.data || {},
        actor_user_id: event.actorUserId || null,
      }),
    });
    if (!res.ok) {
      console.error("notify: falha ao gravar notificação:", res.status, (await res.text().catch(() => "")).slice(0, 200));
      return null;
    }
    const rows = await res.json().catch(() => []);
    return Array.isArray(rows) ? rows[0] || null : null;
  } catch (e) {
    console.error("notify: erro ao gravar notificação:", e);
    return null;
  }
}

/** Lista as subscriptions de admins que querem receber este tipo de evento. */
async function loadTargetSubscriptions(SB_URL, SB_KEY, type) {
  const admins = await fetch(`${SB_URL}/rest/v1/profiles?is_admin=eq.true&select=id`, { headers: sbHeaders(SB_KEY) })
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => []);
  const ids = (Array.isArray(admins) ? admins : []).map((a) => a.id).filter(Boolean);
  if (ids.length === 0) return [];

  const inList = ids.map((id) => `"${id}"`).join(",");
  let filter = "";
  if (ORDER_EVENTS.has(type)) filter = "&notify_new_orders=eq.true";
  else if (ACCESS_EVENTS.has(type)) filter = "&notify_logins=eq.true";

  const url = `${SB_URL}/rest/v1/push_subscriptions?user_id=in.(${inList})${filter}&select=id,endpoint,p256dh,auth`;
  const subs = await fetch(url, { headers: sbHeaders(SB_KEY) })
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => []);
  return Array.isArray(subs) ? subs : [];
}

async function dropSubscription(SB_URL, SB_KEY, id) {
  await fetch(`${SB_URL}/rest/v1/push_subscriptions?id=eq.${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: sbHeaders(SB_KEY, { Prefer: "return=minimal" }),
  }).catch(() => {});
}

async function markSubscriptionSuccess(SB_URL, SB_KEY, id) {
  await fetch(`${SB_URL}/rest/v1/push_subscriptions?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: sbHeaders(SB_KEY, { "Content-Type": "application/json", Prefer: "return=minimal" }),
    body: JSON.stringify({ last_success_at: new Date().toISOString(), failure_count: 0 }),
  }).catch(() => {});
}

/**
 * Dispara push para uma lista de subscriptions já carregadas.
 * Endpoints expirados (404/410) são removidos do banco.
 */
export async function pushToSubscriptions(env, subscriptions, payload) {
  const vapid = readVapidConfig(env);
  if (!vapid) return { sent: 0, failed: 0, skipped: subscriptions.length, reason: "VAPID não configurado" };

  const { SB_URL, SB_SERVICE_ROLE_KEY } = env;
  let sent = 0;
  let failed = 0;

  await Promise.all(
    subscriptions.map(async (sub) => {
      const result = await sendPush(sub, payload, vapid);
      if (result.ok) {
        sent++;
        if (sub.id) await markSubscriptionSuccess(SB_URL, SB_SERVICE_ROLE_KEY, sub.id);
        return;
      }
      failed++;
      console.error("notify: push falhou", sub.endpoint?.slice(0, 60), result.error);
      if (result.gone && sub.id) await dropSubscription(SB_URL, SB_SERVICE_ROLE_KEY, sub.id);
    })
  );

  return { sent, failed, skipped: 0 };
}

/**
 * Registra um evento e notifica os admins.
 *
 * @param {object} env  context.env das Pages Functions
 * @param {{type:string,title:string,body?:string,data?:object,actorUserId?:string,url?:string}} event
 */
export async function notifyAdmins(env, event) {
  const { SB_URL, SB_SERVICE_ROLE_KEY } = env || {};
  if (!SB_URL || !SB_SERVICE_ROLE_KEY) return { ok: false, error: "Supabase não configurado" };

  try {
    const record = await insertNotification(SB_URL, SB_SERVICE_ROLE_KEY, event);
    const subs = await loadTargetSubscriptions(SB_URL, SB_SERVICE_ROLE_KEY, event.type);
    const result = await pushToSubscriptions(env, subs, {
      type: event.type,
      title: event.title,
      body: event.body || "",
      url: event.url || "/?admin=notifications",
      notificationId: record?.id || null,
      data: event.data || {},
      createdAt: record?.created_at || new Date().toISOString(),
    });
    return { ok: true, notificationId: record?.id || null, ...result };
  } catch (e) {
    console.error("notify: erro inesperado:", e);
    return { ok: false, error: String(e?.message || e) };
  }
}

/** Busca nome/email do cliente para enriquecer a mensagem. */
export async function loadActorLabel(env, userId) {
  const { SB_URL, SB_SERVICE_ROLE_KEY } = env || {};
  if (!SB_URL || !SB_SERVICE_ROLE_KEY || !userId) return "";
  try {
    const res = await fetch(
      `${SB_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=name,email,whatsapp`,
      { headers: sbHeaders(SB_SERVICE_ROLE_KEY) }
    );
    const rows = await res.json().catch(() => []);
    const profile = Array.isArray(rows) ? rows[0] : null;
    return profile?.name || profile?.email || "";
  } catch {
    return "";
  }
}

export const BRL = (value) =>
  `R$ ${Number(value || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Notificação de pedido (novo / pago / bônus) a partir do id do lote.
 * Lê os dados reais do banco — nada vem do cliente.
 *
 * @param {object} env
 * @param {string} batchId
 * @param {'NEW_ORDER'|'ORDER_PAID'|'BONUS_ORDER'} type
 */
export async function notifyOrderEvent(env, batchId, type) {
  const { SB_URL, SB_SERVICE_ROLE_KEY } = env || {};
  if (!SB_URL || !SB_SERVICE_ROLE_KEY || !batchId) return { ok: false, error: "Parâmetros insuficientes" };

  try {
    // Idempotência: mp-create/webhook podem repetir para o mesmo lote
    // ("Pagar agora" no perfil, reenvio do Mercado Pago). Um lote gera no
    // máximo um evento de cada tipo.
    const dupUrl = `${SB_URL}/rest/v1/app_notifications?type=eq.${type}&data->>batchId=eq.${encodeURIComponent(batchId)}&select=id&limit=1`;
    const existing = await fetch(dupUrl, { headers: sbHeaders(SB_SERVICE_ROLE_KEY) })
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []);
    if (Array.isArray(existing) && existing.length > 0) return { ok: true, skipped: "duplicado" };

    const select =
      "id,qty_in_batch,total_locked,subtotal_locked,shipping_locked,payment_method,status," +
      "orders(id,kind,user_id,campaign_id,campaigns(name),profiles(name,email,whatsapp))";
    const res = await fetch(
      `${SB_URL}/rest/v1/order_batches?id=eq.${encodeURIComponent(batchId)}&select=${encodeURIComponent(select)}`,
      { headers: sbHeaders(SB_SERVICE_ROLE_KEY) }
    );
    const rows = await res.json().catch(() => []);
    const batch = Array.isArray(rows) ? rows[0] : null;
    if (!batch) return { ok: false, error: "Lote não encontrado" };

    const order = batch.orders || {};
    const client = order.profiles?.name || order.profiles?.email || "Cliente";
    const channel = String(order.kind || "").toUpperCase() === "INDIVIDUAL" ? "Individual" : "Coletiva";
    const campaignName = order.campaigns?.name || "";
    const shortId = String(batch.id).slice(0, 8).toUpperCase();
    const qty = Number(batch.qty_in_batch || 0);
    const total = Number(batch.total_locked || 0);

    const titles = {
      NEW_ORDER: `🛒 Pedido novo · ${channel}`,
      ORDER_PAID: `💰 Pagamento confirmado · ${channel}`,
      BONUS_ORDER: `🎁 Pedido bônus · ${channel}`,
    };
    const valuePart = type === "BONUS_ORDER" ? "grátis (bônus)" : BRL(total);
    const contextPart = channel === "Coletiva" && campaignName ? ` · ${campaignName}` : "";

    return await notifyAdmins(env, {
      type,
      title: titles[type] || "Pedido atualizado",
      body: `${client} · ${qty} carta(s) · ${valuePart} · #${shortId}${contextPart}`,
      data: {
        batchId: batch.id,
        orderId: order.id || null,
        shortId,
        channel: order.kind || "CAMPAIGN",
        campaignId: order.campaign_id || null,
        campaignName,
        clientName: client,
        qty,
        total,
      },
      actorUserId: order.user_id || null,
      url: "/?admin=orders",
    });
  } catch (e) {
    console.error("notify: erro ao montar evento de pedido:", e);
    return { ok: false, error: String(e?.message || e) };
  }
}
