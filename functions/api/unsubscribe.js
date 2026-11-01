/**
 * GET/POST /api/unsubscribe?t=<email_unsub_token> — descadastro dos e-mails.
 *
 * GET vem do link no rodapé; POST vem do botão "cancelar inscrição" do
 * Gmail/Yahoo (List-Unsubscribe-Post). Os dois só ligam `email_opt_out`.
 */
const page = (title, text) => new Response(
  `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>` +
  `<body style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:60px auto;padding:0 16px;color:#222"><h1 style="font-size:20px">${title}</h1><p>${text}</p></body></html>`,
  { headers: { "Content-Type": "text/html; charset=utf-8" } },
);

export async function onRequest(context) {
  const { SB_URL, SB_SERVICE_ROLE_KEY: KEY } = context.env;
  const token = new URL(context.request.url).searchParams.get("t") || "";
  if (!/^[0-9a-f-]{36}$/i.test(token)) return page("Link inválido", "Este link de descadastro não é válido.");
  if (!SB_URL || !KEY) return page("Erro", "Tente de novo mais tarde.");

  const res = await fetch(`${SB_URL}/rest/v1/profiles?email_unsub_token=eq.${encodeURIComponent(token)}`, {
    method: "PATCH",
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ email_opt_out: true }),
  }).catch(() => null);
  const rows = res?.ok ? await res.json().catch(() => []) : [];
  if (!rows.length) return page("Link inválido", "Não encontramos este cadastro.");
  return page("Pronto, descadastrado", "Você não vai mais receber e-mails de lembrete e avisos do Magic Portal.");
}
