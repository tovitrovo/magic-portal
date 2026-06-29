import { parseAwesomeApiRate, isStale } from "../../shared/fx.js";

const AWESOME_API = "https://economia.awesomeapi.com.br/last/USD-BRL";

/**
 * Cotação USD→BRL do dia, com cache em public.fx_cache e fallback.
 * Estratégia: cache fresco → usa cache; senão busca ao vivo e atualiza o
 * cache; se a API falhar → usa cache velho; se não houver → fallback fixo.
 *
 * Retorna { rate, source: 'cache'|'live'|'stale'|'fallback', fetched_at }.
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

  // 2. Busca ao vivo
  try {
    const r = await fetch(AWESOME_API, { headers: { Accept: "application/json" } });
    if (r.ok) {
      const rate = parseAwesomeApiRate(await r.json());
      if (rate) {
        const fetched_at = new Date().toISOString();
        await fetch(`${SB_URL}/rest/v1/fx_cache?on_conflict=pair`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify({ pair: "USD-BRL", rate, fetched_at }),
        });
        return { rate, source: "live", fetched_at };
      }
    }
  } catch { /* cai para fallback abaixo */ }

  // 3. Cache velho, senão fallback
  if (cached) return { rate: Number(cached.rate), source: "stale", fetched_at: cached.fetched_at };
  return { rate: fallback, source: "fallback", fetched_at: null };
}
