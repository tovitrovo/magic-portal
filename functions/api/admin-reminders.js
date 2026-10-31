import { corsHeaders } from "./_cors.js";
import { verifyAdmin } from "./_admin-auth.js";
import { broadcastRecipientCount, loadReminderQueue, sendBroadcast, sendSingleReminder } from "./_automation.js";
import { emailConfigured } from "./_email.js";

/**
 * POST /api/admin-reminders — lembretes e aviso em massa do console.
 *
 * body:
 *   { action:'list' }                       → { carts, payments, recipients, emailConfigured }
 *   { action:'email', kind:'cart'|'payment', id } → manda o lembrete agora
 *   { action:'broadcast', subject, message } → e-mail para todos os clientes
 *
 * O token de descadastro nunca sai daqui: o console não precisa dele.
 */
const strip = ({ unsubToken, ...rest }) => rest;

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

  try {
    if (action === "list") {
      const [queue, recipients] = await Promise.all([loadReminderQueue(context.env), broadcastRecipientCount(context.env)]);
      return json({
        ok: true,
        carts: queue.carts.map(strip),
        payments: queue.payments.map(strip),
        recipients,
        emailConfigured: emailConfigured(context.env),
      });
    }

    if (action === "email") {
      const kind = body.kind === "cart" ? "cart" : body.kind === "payment" ? "payment" : null;
      if (!kind || !body.id) return json({ ok: false, error: "Lembrete inválido" }, 400);
      const r = await sendSingleReminder(context.env, { kind, id: String(body.id) });
      return json(r, r.ok ? 200 : 400);
    }

    if (action === "broadcast") {
      if (!emailConfigured(context.env)) return json({ ok: false, error: "Configure RESEND_API_KEY no Cloudflare Pages" }, 400);
      const subject = String(body.subject || "").trim().slice(0, 200);
      const message = String(body.message || "").trim().slice(0, 5000);
      if (!subject || !message) return json({ ok: false, error: "Assunto e mensagem são obrigatórios" }, 400);
      return json({ ok: true, result: await sendBroadcast(context.env, { subject, message }) });
    }

    return json({ ok: false, error: "Ação desconhecida" }, 400);
  } catch (e) {
    const msg = String(e?.message || e);
    const hint = /email_opt_out|cart_reminded_at|payment_reminded_at|created_at/.test(msg) ? " — rode supabase/migrations/email-reminders.sql" : "";
    return json({ ok: false, error: msg + hint }, 500);
  }
}
