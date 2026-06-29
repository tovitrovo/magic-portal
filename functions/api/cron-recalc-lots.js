import { recalcLotPrices } from "./_lot-helper.js";

// Endpoint do agendador diário (GitHub Actions). Protegido por segredo
// compartilhado (CRON_SECRET), independente de login admin — assim o cron
// roda sem ninguém acessar o site. Força a busca ao vivo do dólar base.
//
//   POST /api/cron-recalc-lots
//   header: x-cron-secret: <CRON_SECRET>   (ou Authorization: Bearer <CRON_SECRET>)

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function providedSecret(request) {
  const h = request.headers;
  const x = h.get("x-cron-secret");
  if (x) return x.trim();
  const auth = h.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : "";
}

export async function onRequest(context) {
  if (context.request.method !== "POST") return json({ ok: false, error: "Método não permitido" }, 405);

  const { SB_URL, SB_SERVICE_ROLE_KEY, CRON_SECRET } = context.env;
  if (!SB_URL || !SB_SERVICE_ROLE_KEY) return json({ ok: false, error: "Config do servidor incompleta" }, 500);
  if (!CRON_SECRET) return json({ ok: false, error: "CRON_SECRET não configurado" }, 500);

  if (providedSecret(context.request) !== String(CRON_SECRET)) {
    return json({ ok: false, error: "Não autorizado" }, 401);
  }

  try {
    const result = await recalcLotPrices(SB_URL, SB_SERVICE_ROLE_KEY, { force: true });
    return json(result, result.ok ? 200 : 502);
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
}
