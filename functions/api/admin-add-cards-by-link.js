import { verifyAdmin } from "./_admin-auth.js";
import { corsHeaders } from "./_cors.js";
import { slugify, STORAGE_BASE } from "../../shared/cardImport.js";

const MAX_ITEMS = 25;
const MAX_BYTES = 8 * 1024 * 1024; // 8MB
const CONCURRENCY = 4;
const EXT_BY_MIME = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

async function shortHash(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 10);
}

function extFromUrl(url) {
  try {
    const path = new URL(url).pathname.toLowerCase();
    const m = path.match(/\.(jpe?g|png|webp|gif)$/);
    if (m) return m[0] === ".jpeg" ? ".jpg" : m[0];
  } catch {}
  return null;
}

// Baixa a imagem do link informado (ex: link do Google Imagens já resolvido para a URL real).
async function fetchImage(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; MagicPortalBot/1.0)", Accept: "image/*" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar imagem`);
  const contentType = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!contentType.startsWith("image/")) throw new Error(`Conteúdo não é imagem (${contentType || "desconhecido"})`);
  const buf = await res.arrayBuffer();
  if (buf.byteLength === 0) throw new Error("Imagem vazia");
  if (buf.byteLength > MAX_BYTES) throw new Error("Imagem excede 8MB");
  const ext = EXT_BY_MIME[contentType] || extFromUrl(url) || ".jpg";
  return { buf, contentType: EXT_BY_MIME[contentType] ? contentType : "image/jpeg", ext };
}

async function uploadToStorage(SB_URL, SB_SERVICE_ROLE_KEY, filename, buf, contentType) {
  const res = await fetch(`${SB_URL}/storage/v1/object/cards/${encodeURIComponent(filename)}`, {
    method: "POST",
    headers: {
      apikey: SB_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}`,
      "Content-Type": contentType,
      "x-upsert": "true",
    },
    body: buf,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Falha no upload do storage: ${res.status} ${t.slice(0, 160)}`);
  }
}

export async function onRequest(context) {
  const CORS = corsHeaders(context, "POST, OPTIONS");
  if (context.request.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

  if (context.request.method !== "POST") return json({ ok: false, error: "Método não permitido" }, 405);

  const { SB_URL, SB_SERVICE_ROLE_KEY } = context.env;
  if (!SB_URL || !SB_SERVICE_ROLE_KEY) {
    return json({ ok: false, error: "SB_URL/SB_SERVICE_ROLE_KEY não configurado" }, 500);
  }

  const auth = await verifyAdmin(context, SB_URL, SB_SERVICE_ROLE_KEY);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const body = await context.request.json().catch(() => ({}));
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) return json({ ok: false, error: "Nenhuma carta informada" }, 400);
  if (items.length > MAX_ITEMS) return json({ ok: false, error: `Máximo de ${MAX_ITEMS} cartas por vez` }, 400);

  const headers = {
    apikey: SB_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SB_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };

  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      const { name, url } = items[i] || {};
      try {
        if (!name || !url) throw new Error("Nome ou link ausente");
        const { buf, contentType, ext } = await fetchImage(url);
        const hash = await shortHash(url);
        const filename = `${slugify(name)}-${hash}${ext}`;
        await uploadToStorage(SB_URL, SB_SERVICE_ROLE_KEY, filename, buf, contentType);

        const card = {
          name,
          type: "Normal",
          tcg: "Magic",
          is_active: true,
          image_url: STORAGE_BASE + filename,
          import_ref: filename,
        };
        const r = await fetch(`${SB_URL}/rest/v1/cards?on_conflict=import_ref`, {
          method: "POST",
          headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify([card]),
        });
        if (!r.ok) {
          const t = await r.text().catch(() => "");
          throw new Error(`Falha ao salvar no banco: ${r.status} ${t.slice(0, 160)}`);
        }
        results[i] = { name, url, ok: true, image_url: card.image_url };
      } catch (e) {
        results[i] = { name, url, ok: false, error: String(e?.message || e) };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));

  const added = results.filter((r) => r.ok).length;
  const failed = results.length - added;
  return json({ ok: true, added, failed, results });
}
