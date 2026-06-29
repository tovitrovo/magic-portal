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

// Dólar BASE (spot / mid-market, ~o que o Google mostra) a partir de APIs que
// retornam { rates: { BRL: x } } — ex.: open.er-api.com, exchangerate.host.
export function parseRatesBrl(json) {
  const v = Number(json && json.rates && json.rates.BRL);
  return Number.isFinite(v) && v > 0 ? v : null;
}

// Mid da AwesomeAPI = média de bid/ask (fallback p/ o dólar base).
export function parseAwesomeApiMid(json) {
  const bid = parseAwesomeApiRate(json, 'bid');
  const ask = parseAwesomeApiRate(json, 'ask');
  if (Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > 0) return (bid + ask) / 2;
  return bid || ask || null;
}

// True se a cotação está velha (ou inválida) para o limite de horas dado.
export function isStale(fetchedAt, maxAgeHours = 12) {
  const t = new Date(fetchedAt).getTime();
  if (!Number.isFinite(t)) return true;
  return (Date.now() - t) > maxAgeHours * 3600 * 1000;
}
