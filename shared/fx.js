// ──────────────────────────────────────────────────────────────
// Helpers puros de câmbio (USD→BRL). A orquestração (fetch + cache no
// Supabase) fica em functions/api/_fx-helper.js; aqui só lógica testável.
// ──────────────────────────────────────────────────────────────

// Extrai a cotação da resposta da AwesomeAPI (/last/USD-BRL).
// Usa "ask" por padrão (custo de compra do dólar — conservador p/ venda),
// caindo para "bid" se necessário.
export function parseAwesomeApiRate(json, field = 'ask') {
  const o = json && (json.USDBRL || json.usdbrl || json['USD-BRL']);
  if (!o) return null;
  for (const key of [field, 'ask', 'bid', 'high']) {
    const v = Number(o[key]);
    if (Number.isFinite(v) && v > 0) return v;
  }
  return null;
}

// True se a cotação está velha (ou inválida) para o limite de horas dado.
export function isStale(fetchedAt, maxAgeHours = 12) {
  const t = new Date(fetchedAt).getTime();
  if (!Number.isFinite(t)) return true;
  return (Date.now() - t) > maxAgeHours * 3600 * 1000;
}
