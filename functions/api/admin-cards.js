import { verifyAdmin } from "./_admin-auth.js";
import { corsHeaders } from "./_cors.js";

// POST /api/admin-cards — edição do catálogo pelo console (só admin).
//
//   { action:'search', q, status:'all'|'active'|'inactive', offset }
//       → { cards:[{id,name,type,image_url,is_active,created_at}], total }
//   { action:'update', id, patch:{ name?, type?, image_url?, is_active? } }
//       → { card }
//
// Só esses quatro campos são editáveis aqui. Custo, referência de importação
// e tcg continuam sendo da planilha/CSV — editar à mão quebraria o upsert.
const PAGE = 30;
const EDITABLE = ["name", "type", "image_url", "is_active"];

export function sanitizeCardPatch(patch) {
  const out = {};
  const p = patch && typeof patch === "object" ? patch : {};
  for (const key of EDITABLE) {
    if (!(key in p)) continue;
    const v = p[key];
    if (key === "is_active") { out.is_active = v === true; continue; }
    if (key === "image_url") {
      const s = String(v ?? "").trim();
      if (s && !/^https:\/\//i.test(s)) return { error: "A imagem precisa ser um link https://" };
      out.image_url = s || null;
      continue;
    }
    const s = String(v ?? "").trim();
    if (!s) return { error: key === "name" ? "O nome não pode ficar vazio" : "O tipo não pode ficar vazio" };
    if (s.length > (key === "name" ? 200 : 40)) return { error: "Texto longo demais" };
    out[key] = s;
  }
  if (!Object.keys(out).length) return { error: "Nada para salvar" };
  return { patch: out };
}

export async function onRequest(context) {
  const CORS = corsHeaders(context, "POST, OPTIONS");
  const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
  if (context.request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (context.request.method !== "POST") return json({ ok: false, error: "Método não permitido" }, 405);

  const { SB_URL, SB_SERVICE_ROLE_KEY } = context.env;
  if (!SB_URL || !SB_SERVICE_ROLE_KEY) return json({ ok: false, error: "Config do servidor incompleta" }, 500);

  const auth = await verifyAdmin(context, SB_URL, SB_SERVICE_ROLE_KEY);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const body = await context.request.json().catch(() => ({}));
  const headers = { apikey: SB_SERVICE_ROLE_KEY, Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}` };

  try {
    if (body.action === "search") {
      const filters = ["tcg=eq.Magic"];
      if (body.status === "active") filters.push("is_active=eq.true");
      if (body.status === "inactive") filters.push("is_active=eq.false");
      const q = String(body.q || "").trim().replace(/[*,()]/g, " ").slice(0, 80);
      if (q) filters.push(`name=ilike.*${encodeURIComponent(q)}*`);
      const offset = Math.max(0, Math.floor(Number(body.offset) || 0));
      const res = await fetch(`${SB_URL}/rest/v1/cards?${filters.join("&")}&select=id,name,type,image_url,is_active,created_at&order=name.asc&limit=${PAGE}&offset=${offset}`, {
        headers: { ...headers, Prefer: "count=exact" },
      });
      if (!res.ok) return json({ ok: false, error: `Erro do banco: ${res.status}` }, 502);
      const cards = await res.json().catch(() => []);
      const range = res.headers.get("content-range") || "";
      const total = Number(range.split("/")[1]) || cards.length;
      return json({ ok: true, cards, total, pageSize: PAGE });
    }

    if (body.action === "update") {
      const id = String(body.id || "");
      if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ ok: false, error: "Carta inválida" }, 400);
      const { patch, error } = sanitizeCardPatch(body.patch);
      if (error) return json({ ok: false, error }, 400);
      const res = await fetch(`${SB_URL}/rest/v1/cards?id=eq.${id}`, {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json", Prefer: "return=representation" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) return json({ ok: false, error: `Erro ao salvar: ${res.status} ${(await res.text().catch(() => "")).slice(0, 160)}` }, 502);
      const rows = await res.json().catch(() => []);
      if (!rows.length) return json({ ok: false, error: "Carta não encontrada" }, 404);
      return json({ ok: true, card: rows[0] });
    }

    return json({ ok: false, error: "Ação desconhecida" }, 400);
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
}
