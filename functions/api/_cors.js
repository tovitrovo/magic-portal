/**
 * Cabeçalhos CORS configuráveis.
 *
 * Por padrão devolve "*" (comportamento original, não quebra nada). Se a
 * variável de ambiente ALLOWED_ORIGINS estiver definida (lista separada por
 * vírgulas), apenas as origens listadas são refletidas no Access-Control-
 * Allow-Origin; origens fora da lista não recebem o cabeçalho (o navegador
 * bloqueia a leitura cross-origin da resposta).
 *
 * App e /api são servidos na mesma origem (Cloudflare Pages), então o app
 * continua funcionando mesmo com a lista restrita.
 */
export function corsHeaders(context, methods = "POST, OPTIONS") {
  const base = {
    "Access-Control-Allow-Headers": "content-type, authorization",
    "Access-Control-Allow-Methods": methods,
    "Vary": "Origin",
  };

  const allowed = String(context?.env?.ALLOWED_ORIGINS || "").trim();
  if (!allowed) {
    return { ...base, "Access-Control-Allow-Origin": "*" };
  }

  const list = allowed.split(",").map((s) => s.trim()).filter(Boolean);
  const origin = context?.request?.headers?.get("Origin") || "";
  if (origin && list.includes(origin)) {
    return { ...base, "Access-Control-Allow-Origin": origin };
  }
  // Origem não permitida: não envia ACAO (bloqueia leitura cross-origin).
  return base;
}
