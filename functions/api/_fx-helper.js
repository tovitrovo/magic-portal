import { parseAwesomeApiRate, parsePtaxRate, ptaxUrl, isStale } from "../../shared/fx.js";

const AWESOME_API = "https://economia.awesomeapi.com.br/last/USD-BRL";

/**
 * Cotação USD→BRL do dia, com cache em public.fx_cache e fallback.
 * Estratégia: cache fresco → usa cache; senão busca ao vivo (PTAX do Banco
 * Central; AwesomeAPI de reserva) e atualiza o cache; se as duas falharem →
 * usa cache velho; se não houver → fallback fixo.
 *
 * Retorna { rate, source: 'cache'|'live'|'stale'|'fallback', provider?, fetched_at }.
 * 'stale' e 'fallback' significam que a cotação NÃO está atualizando: o
 * resumo diário avisa o admin (ver checkFxHealth em _automation.js).
 */
export async function getUsdBrlRate(SB_URL, SB_KEY, opts = {}) {
  const maxAgeHours = opts.maxAgeHours ?? 12;
  const fallback = Number(opts.fallback) > 0 ? Number(opts.fallback) : 5.5;
  const headers = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };

  // 1. Cache atual
  let cached = null;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/fx_cache?pair=eq.USD-BRL&select=rate,fetched_at`, { headers });
    const a = await r.json().catch(() => []);
    if (Array.isArray(a) && a[0]) cached = a[0];
  } catch { /* ignora */ }

  if (cached && !isStale(cached.fetched_at, maxAgeHours)) {
    return { rate: Number(cached.rate), source: "cache", fetched_at: cached.fetched_at };
  }

  // 2. Busca ao vivo: PTAX primeiro, AwesomeAPI de reserva.
  const live = await fetchLiveRate();
  if (live) {
    const fetched_at = new Date().toISOString();
    try {
      await fetch(`${SB_URL}/rest/v1/fx_cache?on_conflict=pair`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ pair: "USD-BRL", rate: live.rate, fetched_at }),
      });
    } catch { /* cache é otimização; a cotação vale mesmo assim */ }
    return { rate: live.rate, source: "live", provider: live.provider, fetched_at };
  }

  // 3. Cache velho, senão fallback
  if (cached) return { rate: Number(cached.rate), source: "stale", fetched_at: cached.fetched_at };
  return { rate: fallback, source: "fallback", fetched_at: null };
}

/** Cotação ao vivo, sem cache. { rate, provider } ou null se as duas fontes falharem. */
export async function fetchLiveRate(fetchImpl = fetch) {
  try {
    const r = await fetchImpl(ptaxUrl(), { headers: { Accept: "application/json" } });
    if (r.ok) {
      const p = parsePtaxRate(await r.json());
      if (p) return { rate: p.rate, provider: "bcb-ptax", quotedAt: p.quotedAt };
    }
  } catch { /* tenta a reserva */ }
  try {
    const r = await fetchImpl(AWESOME_API, { headers: { Accept: "application/json" } });
    if (r.ok) {
      const rate = parseAwesomeApiRate(await r.json());
      if (rate) return { rate, provider: "awesomeapi" };
    }
  } catch { /* sem cotação ao vivo */ }
  return null;
}
