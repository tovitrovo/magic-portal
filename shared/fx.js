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

// ── Banco Central (PTAX) ─────────────────────────────────────────────────
// Fonte principal desde nov/2026: a AwesomeAPI passou a recusar consultas sem
// chave (HTTP 429, "QuotaExceeded") e o cache ficou parado em 1º/out sem
// ninguém perceber. A PTAX é oficial, gratuita e sem cota. Ela sai em dias
// úteis por volta das 13h; fim de semana e feriado repetem a última.

const pad2 = (n) => String(n).padStart(2, '0');
const bcbDate = (d) => `'${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}-${d.getFullYear()}'`;

/** URL da PTAX dos últimos `days` dias (pega a mais recente da janela). */
export function ptaxUrl(now = new Date(), days = 10) {
  const from = new Date(now.getTime() - days * 86400000);
  return 'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/'
    + 'CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)'
    + `?@dataInicial=${bcbDate(from)}&@dataFinalCotacao=${bcbDate(now)}`
    + '&$format=json&$select=cotacaoCompra,cotacaoVenda,dataHoraCotacao';
}

/**
 * Cotação de venda mais recente da resposta da PTAX.
 * Devolve { rate, quotedAt } ou null.
 */
export function parsePtaxRate(json) {
  const rows = Array.isArray(json?.value) ? json.value : [];
  let best = null;
  for (const r of rows) {
    const rate = Number(r?.cotacaoVenda);
    if (!Number.isFinite(rate) || rate <= 0) continue;
    const at = String(r?.dataHoraCotacao || '');
    if (!best || at > best.quotedAt) best = { rate, quotedAt: at };
  }
  return best;
}

// Depois de quanto tempo sem conseguir atualizar a cotação o admin é avisado.
// 48h: cobre um dia útil inteiro de falha, sem alarme falso no fim de semana
// (o cache é renovado mesmo quando a PTAX repete a de sexta).
export const FX_ALERT_HOURS = 48;

// ── Dólar que você paga de fato ──────────────────────────────────────────
// O PREÇO usa o dólar oficial. O CUSTO (painel de lucro) usa o dólar do
// Inter: o oficial mais o spread da conversão e o IOF. Calibrado em
// 02/11/2026 com o app do Inter ("Comprar Dólar"): cotação R$ 5,440 com
// spread de 0,99% (comercial ≈ R$ 5,387), IOF de 3,5% e Valor Efetivo Total
// de R$ 5,69 → 5,69 ÷ 5,387 = +5,6% sobre o dólar oficial.
export const INTER_FX_MARKUP = 0.056;
export const costFx = (officialRate, markup = INTER_FX_MARKUP) => Number(officialRate || 0) * (1 + markup);
