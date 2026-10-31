/**
 * Envio de e-mail pelo Resend (https://resend.com).
 *
 * Variáveis do Cloudflare Pages:
 *   RESEND_API_KEY — chave da API
 *   EMAIL_FROM     — remetente, ex.: "Magic Portal <contato@seudominio.com.br>".
 *                    Sem domínio verificado no Resend, use
 *                    "Magic Portal <onboarding@resend.dev>": nesse modo o Resend
 *                    só entrega para o e-mail da própria conta (bom para testar).
 *
 * Nunca lança: devolve `{ ok, id?, error? }`.
 */
const API = "https://api.resend.com";
const DEFAULT_FROM = "Magic Portal <onboarding@resend.dev>";
/** Limite do endpoint /emails/batch. */
export const EMAIL_BATCH_SIZE = 100;

export function emailConfigured(env) {
  return !!env?.RESEND_API_KEY;
}

function payload(env, { to, subject, html, text, unsubUrl }) {
  const body = { from: env.EMAIL_FROM || DEFAULT_FROM, to: [to], subject, html, text };
  if (env.EMAIL_REPLY_TO) body.reply_to = env.EMAIL_REPLY_TO;
  // Descadastro em um clique (Gmail/Yahoo exigem para envio em massa).
  if (unsubUrl) body.headers = { "List-Unsubscribe": `<${unsubUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
  return body;
}

async function call(env, path, body) {
  if (!emailConfigured(env)) return { ok: false, error: "RESEND_API_KEY não configurada" };
  try {
    const res = await fetch(`${API}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: `Resend ${res.status}: ${String(data?.message || data?.error || "").slice(0, 200)}` };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: String(e?.message || e).slice(0, 200) };
  }
}

/** Um e-mail. */
export async function sendEmail(env, message) {
  const r = await call(env, "/emails", payload(env, message));
  return r.ok ? { ok: true, id: r.data?.id || null } : r;
}

/** Vários e-mails, em lotes de 100. Devolve `{ sent, failed, firstError }`. */
export async function sendEmailBatch(env, messages) {
  const result = { sent: 0, failed: 0, firstError: null };
  for (let i = 0; i < messages.length; i += EMAIL_BATCH_SIZE) {
    const chunk = messages.slice(i, i + EMAIL_BATCH_SIZE);
    const r = await call(env, "/emails/batch", chunk.map((m) => payload(env, m)));
    if (r.ok) result.sent += chunk.length;
    else {
      result.failed += chunk.length;
      result.firstError = result.firstError || r.error;
    }
  }
  return result;
}

/** Link de descadastro de um perfil. */
export function unsubscribeUrl(siteUrl, token) {
  return siteUrl && token ? `${siteUrl}/api/unsubscribe?t=${encodeURIComponent(token)}` : null;
}
