/**
 * Rotinas automáticas do console admin — rodam sozinhas pelo pg_cron
 * (ver supabase/migrations/admin-automation.sql → /api/cron) e sob demanda
 * pelo botão "Rodar agora" do console (/api/admin-automation).
 *
 *   syncTracking  — consulta no MandaBem cada remessa com etiqueta ainda não
 *                   entregue, grava status/rastreio, marca "Entregue" sozinho
 *                   e avisa o admin quando a remessa muda de fase.
 *   sendDailyDigest — um push por dia com vendas e a fila de trabalho, e
 *                   alerta se a sincronização da planilha falhou.
 *
 * Nada aqui lança: o resultado volta como objeto e fica gravado em
 * `automation_config` para o console mostrar a última execução.
 */
import { getMandaBemTrackingDetails, queryShipment } from "./_mandabem.js";
import { BRL, notifyAdminsOnce } from "./_notify.js";
import { shipmentPhase, trackingEventFor, SHIPMENT_PHASES } from "../../shared/mandabemStatus.js";
import { isPaid } from "../../shared/orderStatus.js";
import { isShippingAdjustment } from "../../shared/shippingAddressChange.js";

/**
 * Remessas consultadas por execução. As Pages Functions têm teto de
 * subrequests; com o cron de hora em hora e as mais antigas primeiro, todas
 * acabam consultadas várias vezes por dia.
 */
export const TRACKING_PER_RUN = 12;
/** Etiqueta gerada e não postada há mais que isso entra como "parada" no resumo. */
const STALLED_DAYS = 4;
const TERMINAL = "CANCELLED,FAILED,REFUNDED,CHARGEDBACK";
const PAID_STATUSES = "PAID,PAID_CONFIRMED,CONFIRMED,APPROVED";

const enc = encodeURIComponent;

function sb(env) {
  const { SB_URL, SB_SERVICE_ROLE_KEY: KEY } = env || {};
  const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
  return async function rest(path, init = {}) {
    const res = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
    if (!res.ok) throw new Error(`${init.method || "GET"} ${path.split("?")[0]}: ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
    return res.status === 204 ? null : res.json().catch(() => null);
  };
}

/** Data civil em Brasília (AAAA-MM-DD) — chave do resumo diário. */
export function brDate(date = new Date()) {
  return new Date(date.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

async function saveRun(env, fields) {
  try {
    await sb(env)("automation_config?id=eq.1", {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ ...fields, updated_at: new Date().toISOString() }),
    });
  } catch (e) {
    console.error("automation: falha ao gravar execução:", e);
  }
}

/** Agrupa lotes por envio do MandaBem: uma consulta por caixa, não por lote. */
export function groupByShipment(batches) {
  const groups = new Map();
  for (const b of batches || []) {
    const envioId = String(b.mandabem_envio_id || "");
    if (!envioId) continue;
    if (!groups.has(envioId)) groups.set(envioId, { envioId, batches: [] });
    groups.get(envioId).batches.push(b);
  }
  // Mais antigas primeiro: quem não foi consultado há mais tempo vai antes.
  const stamp = (g) => Math.min(...g.batches.map((b) => (b.mandabem_updated_at ? new Date(b.mandabem_updated_at).getTime() : 0)));
  return [...groups.values()].sort((a, b) => stamp(a) - stamp(b));
}

const EVENT_COPY = {
  SHIPMENT_POSTED: { title: "📦 Pedido postado", url: "/?admin=shipping" },
  SHIPMENT_DELIVERED: { title: "✅ Pedido entregue", url: "/?admin=shipping" },
  SHIPMENT_PROBLEM: { title: "⚠️ Problema na entrega", url: "/?admin=shipping" },
};

export async function syncTracking(env, { limit = TRACKING_PER_RUN } = {}) {
  const rest = sb(env);
  const startedAt = new Date().toISOString();
  const result = { checked: 0, updated: 0, delivered: 0, problems: 0, errors: 0, pending: 0, firstError: null };
  try {
    const select = "id,status,fulfillment_status,shipping_group_id,mandabem_envio_id,mandabem_status,mandabem_rastreamento,mandabem_etiqueta,mandabem_updated_at,orders(user_id,profiles(name))";
    const rows = await rest(
      `order_batches?mandabem_envio_id=not.is.null&status=not.in.(${TERMINAL})` +
      `&or=(fulfillment_status.is.null,fulfillment_status.neq.DELIVERED)&select=${enc(select)}&limit=500`
    );
    const groups = groupByShipment(rows);
    result.pending = groups.length;

    for (const group of groups.slice(0, limit)) {
      result.checked++;
      const root = group.batches[0];
      const ids = group.batches.map((b) => b.id);
      const prevStatus = root.mandabem_status || "";
      const prevCode = root.mandabem_rastreamento || root.mandabem_etiqueta || "";
      try {
        const info = await queryShipment(env, group.envioId, root.shipping_group_id || root.id);
        const tracking = getMandaBemTrackingDetails(info.data || {}, prevStatus, info.payload);
        const status = tracking.status || prevStatus;
        const code = tracking.code || prevCode || null;
        const phase = shipmentPhase(status);

        const patch = { mandabem_updated_at: new Date().toISOString(), mandabem_status: status || null, mandabem_rastreamento: code, mandabem_etiqueta: code };
        if (phase === SHIPMENT_PHASES.DELIVERED) patch.fulfillment_status = "DELIVERED";
        await rest(`order_batches?id=in.(${ids.map(enc).join(",")})`, {
          method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch),
        });
        if (status !== prevStatus || code !== prevCode) result.updated++;
        if (phase === SHIPMENT_PHASES.DELIVERED) result.delivered++;
        if (phase === SHIPMENT_PHASES.PROBLEM) result.problems++;

        const type = trackingEventFor(prevStatus, status);
        if (type) {
          const client = root.orders?.profiles?.name || "Cliente";
          const shortId = String(root.shipping_group_id || root.id).slice(0, 8).toUpperCase();
          await notifyAdminsOnce(env, `track:${group.envioId}:${status.toLowerCase()}`, {
            type,
            title: EVENT_COPY[type].title,
            body: `${client} · ${status}${code ? ` · ${code}` : ""} · #${shortId}`,
            data: { shortId, envioId: group.envioId, trackingCode: code, status, clientName: client },
            actorUserId: root.orders?.user_id || null,
            url: EVENT_COPY[type].url,
          });
        }
      } catch (e) {
        result.errors++;
        result.firstError = result.firstError || String(e?.message || e).slice(0, 240);
        console.error(`tracking: envio ${group.envioId} falhou:`, e);
      }
    }

    // Tudo falhou (credencial, MandaBem fora do ar): um alerta por dia basta.
    if (result.checked > 0 && result.errors === result.checked) {
      await notifyAdminsOnce(env, `sys:tracking:${brDate()}`, {
        type: "SYSTEM_ERROR",
        title: "🛑 Rastreio automático falhou",
        body: `Nenhuma remessa pôde ser consultada no MandaBem: ${result.firstError}`,
        data: { job: "tracking" },
        url: "/?admin=automation",
      });
    }
  } catch (e) {
    result.fatal = String(e?.message || e).slice(0, 240);
    console.error("tracking: erro geral:", e);
  }
  await saveRun(env, { tracking_last_run_at: startedAt, tracking_last_result: result });
  return result;
}

/** Números do resumo diário. Separado do envio para ser testável. */
export function summarizeQueue(paidOpenBatches, now = Date.now()) {
  const q = { toBuy: 0, inbound: 0, toShip: 0, shipped: 0, problems: 0, stalled: 0 };
  for (const b of paidOpenBatches || []) {
    if (isShippingAdjustment(b)) continue;
    const f = String(b.fulfillment_status || "").toUpperCase();
    if (!f || f === "AWAITING_SUPPLIER_ORDER") q.toBuy++;
    else if (f === "ORDERED_FROM_SUPPLIER" || f === "SHIPPED_TO_BR" || f === "ARRIVED_BR") q.inbound++;
    else if (f === "PREPARING") q.toShip++;
    else if (f === "LABEL_GENERATED") {
      q.shipped++;
      const phase = shipmentPhase(b.mandabem_status);
      if (phase === SHIPMENT_PHASES.PROBLEM) q.problems++;
      const generated = b.mandabem_generated_at ? new Date(b.mandabem_generated_at).getTime() : now;
      if ((phase === SHIPMENT_PHASES.PENDING || phase === SHIPMENT_PHASES.UNKNOWN) && now - generated > STALLED_DAYS * 86400000) q.stalled++;
    }
  }
  return q;
}

/** Texto do push do resumo diário. */
export function formatDigest({ paidCount, paidTotal, awaiting }, q) {
  const parts = [];
  parts.push(paidCount > 0 ? `Ontem: ${paidCount} pago(s) · ${BRL(paidTotal)}` : "Ontem: nenhum pagamento");
  const queue = [
    q.toBuy && `${q.toBuy} p/ comprar`,
    q.toShip && `${q.toShip} p/ etiquetar`,
    q.inbound && `${q.inbound} vindo do fornecedor`,
    q.shipped && `${q.shipped} em trânsito`,
    awaiting && `${awaiting} aguardando pgto`,
  ].filter(Boolean);
  parts.push(queue.length ? `Fila: ${queue.join(" · ")}` : "Fila vazia ✨");
  const alerts = [q.problems && `${q.problems} com problema na entrega`, q.stalled && `${q.stalled} etiqueta(s) sem postagem há +${STALLED_DAYS} dias`].filter(Boolean);
  if (alerts.length) parts.push(`⚠️ ${alerts.join(" · ")}`);
  return parts.join("\n");
}

export async function sendDailyDigest(env, { force = false } = {}) {
  const rest = sb(env);
  const startedAt = new Date().toISOString();
  const result = {};
  try {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const week = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const [paidRecent, unpaid, paidOpen, sheet] = await Promise.all([
      rest(`order_batches?confirmed_at=gte.${enc(since)}&select=status,payment_status,total_locked,qty_in_batch,shipping_locked,shipping_already_paid`),
      rest(`order_batches?status=in.(DRAFT,AWAITING_PAYMENT,PENDING_PAYMENT)&created_at=gte.${enc(week)}&qty_in_batch=gt.0&select=id`),
      rest(`order_batches?status=in.(${PAID_STATUSES})&or=(fulfillment_status.is.null,fulfillment_status.neq.DELIVERED)&select=fulfillment_status,mandabem_status,mandabem_generated_at,qty_in_batch,shipping_locked,shipping_already_paid`),
      rest("catalog_sync?id=eq.1&select=last_run_at,last_result").catch(() => []),
    ]);
    const paid = (paidRecent || []).filter(isPaid);
    const totals = {
      paidCount: paid.filter((b) => !isShippingAdjustment(b)).length,
      paidTotal: paid.reduce((s, b) => s + Number(b.total_locked || 0), 0),
      awaiting: (unpaid || []).length,
    };
    const queue = summarizeQueue(paidOpen);
    Object.assign(result, totals, queue);

    const day = brDate();
    const sent = await notifyAdminsOnce(env, force ? `digest:${day}:${Date.now()}` : `digest:${day}`, {
      type: "DAILY_DIGEST",
      title: "☀️ Resumo do dia",
      body: formatDigest(totals, queue),
      data: { day, ...totals, ...queue },
      url: "/?admin=overview",
    });
    result.skipped = sent?.skipped || null;

    // Saúde da sincronização da planilha (Edge Function sync-supplier-sheet).
    const last = Array.isArray(sheet) ? sheet[0] : null;
    const lr = last?.last_result || {};
    if (last?.last_run_at && (lr.fatal || Number(lr.failed || 0) > 0)) {
      await notifyAdminsOnce(env, `sys:sheet:${last.last_run_at}`, {
        type: "SYSTEM_ERROR",
        title: "🛑 Sincronização da planilha com erro",
        body: lr.fatal ? String(lr.fatal).slice(0, 200) : `${lr.failed} carta(s) não puderam ser importadas`,
        data: { job: "sheet-sync", lastRunAt: last.last_run_at },
        url: "/?admin=catalog",
      });
    }
  } catch (e) {
    result.fatal = String(e?.message || e).slice(0, 240);
    console.error("digest: erro geral:", e);
  }
  await saveRun(env, { digest_last_run_at: startedAt, digest_last_result: result });
  return result;
}
