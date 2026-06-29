import { parseRatesBrl, parseAwesomeApiMid, isStale } from "../../shared/fx.js";

// Dólar BASE (spot / mid-market, ~o valor que o Google mostra). É a entrada
// correta para o preço de lote, porque o spread já está embutido no
// lot_cost_factor (PayPal). Cacheado em fx_cache sob a chave 'USD-BRL-BASE',
// separado do dólar comercial ('USD-BRL') usado no pedido individual.

const SOURCES = [
  // open.er-api.com: mid-market, sem chave, { rates: { BRL } }
  { url: "https://open.er-api.com/v6/latest/USD", parse: parseRatesBrl },
  // exchangerate.host: fallback, mesmo formato
  { url: "https://api.exchangerate.host/latest?base=USD&symbols=BRL", parse: parseRatesBrl },
  // AwesomeAPI (mid = média bid/ask): último recurso ao vivo
  { url: "https://economia.awesomeapi.com.br/last/USD-BRL", parse: parseAwesomeApiMid },
];

const PAIR = "USD-BRL-BASE";

export async function getBaseUsdBrlRate(SB_URL, SB_KEY, opts = {}) {
  const maxAgeHours = opts.maxAgeHours ?? 20; // recálculo é diário
  const fallback = Number(opts.fallback) > 0 ? Number(opts.fallback) : 5.5;
  const force = opts.force === true; // cron força a busca ao vivo
  const headers = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

  // 1. Cache atual
  let cached = null;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/fx_cache?pair=eq.${PAIR}&select=rate,fetched_at`, { headers });
    const a = await r.json().catch(() => []);
    if (Array.isArray(a) && a[0]) cached = a[0];
  } catch { /* ignora */ }

  if (!force && cached && !isStale(cached.fetched_at, maxAgeHours)) {
    return { rate: Number(cached.rate), source: "cache", fetched_at: cached.fetched_at };
  }

  // 2. Busca ao vivo (tenta as fontes em ordem)
  for (const src of SOURCES) {
    try {
      const r = await fetch(src.url, { headers: { Accept: "application/json" } });
      if (!r.ok) continue;
      const rate = src.parse(await r.json());
      if (rate) {
        const fetched_at = new Date().toISOString();
        await fetch(`${SB_URL}/rest/v1/fx_cache?on_conflict=pair`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify({ pair: PAIR, rate, fetched_at }),
        });
        return { rate, source: "live", fetched_at, provider: src.url };
      }
    } catch { /* tenta a próxima fonte */ }
  }

  // 3. Cache velho, senão fallback
  if (cached) return { rate: Number(cached.rate), source: "stale", fetched_at: cached.fetched_at };
  return { rate: fallback, source: "fallback", fetched_at: null };
}
