// ──────────────────────────────────────────────────────────────
// Sincroniza o catálogo com a planilha do fornecedor (aba SINGLES).
//
// 1. Baixa a planilha (link salvo em catalog_sync.sheet_url) como .xlsx —
//    o CSV perde os hiperlinks, e é neles que estão as fotos.
// 2. Lê as colunas "New Updated Cards"; a coluna decide o tipo.
// 3. Para cada link do Google Photos ainda não visto (cards.source_url):
//    se a carta já existe no banco com outro nome, só grava o link nela;
//    senão baixa a foto, sobe no bucket `cards` e cria a carta, já ativa.
//
// Chamadas: pg_cron 1x/dia (cabeçalho x-sync-secret) ou o botão do console
// admin (token do admin). Responde 202 na hora e roda em segundo plano; se
// sobrar carta quando o tempo acaba, chama a si mesma para continuar.
// ──────────────────────────────────────────────────────────────

import {
  extractNewCards, findSheetPath, parseSharedStrings, parseSheetCells,
  sheetExportUrl, extractPhotoUrl, isGooglePhotosLink, cardMatchKey, detectVariant,
} from '../../../shared/supplierSheet.js';
import { slugify } from '../../../shared/cardImport.js';
import { readZip } from '../../../shared/xlsxZip.js';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

const SB_URL = Deno.env.get('SUPABASE_URL')!;
const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SELF_URL = `${SB_URL}/functions/v1/sync-supplier-sheet`;
const STORAGE_PUBLIC = `${SB_URL}/storage/v1/object/public/cards/`;
const TCG = 'Magic';

const TIME_BUDGET_MS = 100_000;   // abaixo do limite de 150s da Edge Function
const LOCK_TTL_MS = 5 * 60_000;   // trava esquecida (função morta) expira
const CONCURRENCY = 5;
const MAX_CHAIN = 20;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-sync-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

async function rest(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`${init.method || 'GET'} ${path.split('?')[0]}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.status === 204 ? null : r.json().catch(() => null);
}

// ─── Autorização ────────────────────────────────────────────────

async function isAdminToken(token: string) {
  if (!token || token === KEY) return false;
  const me = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: KEY, Authorization: `Bearer ${token}` } });
  if (!me.ok) return false;
  const { id } = await me.json();
  if (!id) return false;
  const rows = await rest(`profiles?id=eq.${id}&is_admin=eq.true&select=id`);
  return Array.isArray(rows) && rows.length > 0;
}

// ─── Trava: uma sincronização por vez ───────────────────────────

async function acquireLock() {
  const now = new Date();
  const stale = new Date(now.getTime() - LOCK_TTL_MS).toISOString();
  const rows = await rest(
    `catalog_sync?id=eq.1&or=(running_since.is.null,running_since.lt.${encodeURIComponent(stale)})`,
    { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ running_since: now.toISOString() }) },
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function finish(result: Record<string, unknown>) {
  await rest('catalog_sync?id=eq.1', {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ running_since: null, last_run_at: new Date().toISOString(), last_result: result }),
  });
}

async function loadSheetRows(sheetUrl: string, tab: string) {
  const url = sheetExportUrl(sheetUrl);
  if (!url) throw new Error('Link da planilha inválido (esperado docs.google.com/spreadsheets/d/...)');
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  const ct = r.headers.get('content-type') || '';
  if (!r.ok || ct.includes('text/html')) {
    throw new Error(`Não consegui baixar a planilha (HTTP ${r.status}). Ela precisa estar como "qualquer pessoa com o link pode ver".`);
  }
  const buf = new Uint8Array(await r.arrayBuffer());
  const meta = await readZip(buf, (n) => n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || n === 'xl/sharedStrings.xml');
  const sheetPath = findSheetPath(meta['xl/workbook.xml'], meta['xl/_rels/workbook.xml.rels'], tab);
  if (!sheetPath) throw new Error(`Aba "${tab}" não encontrada na planilha`);
  const relsPath = sheetPath.replace(/([^/]+)$/, '_rels/$1.rels');
  const files = await readZip(buf, (n) => n === sheetPath || n === relsPath);
  const cells = parseSheetCells(files[sheetPath], parseSharedStrings(meta['xl/sharedStrings.xml']), files[relsPath]);
  return extractNewCards(cells);
}

// ─── Banco ──────────────────────────────────────────────────────

type CardRow = { id: string; name: string; type: string; is_active: boolean; source_url: string | null; variant: string | null };

async function loadCatalog(): Promise<CardRow[]> {
  const all: CardRow[] = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await rest(`cards?tcg=eq.${TCG}&select=id,name,type,is_active,source_url,variant&order=id&limit=1000&offset=${offset}`);
    all.push(...page);
    if (page.length < 1000) return all;
  }
}

// Cartas antigas com a variante só no nome ("... Surge foil") ganham a coluna.
async function backfillVariants(catalog: CardRow[]) {
  const groups = new Map<string, string[]>();
  for (const c of catalog) {
    if (c.variant) continue;
    const v = detectVariant(c.name);
    if (!v) continue;
    c.variant = v;
    if (!groups.has(v)) groups.set(v, []);
    groups.get(v)!.push(c.id);
  }
  let n = 0;
  for (const [variant, ids] of groups) {
    for (let i = 0; i < ids.length; i += 150) {
      const chunk = ids.slice(i, i + 150);
      await rest(`cards?id=in.(${chunk.join(',')})`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ variant }) });
      n += chunk.length;
    }
  }
  return n;
}

// ─── Foto ───────────────────────────────────────────────────────

async function shortHash(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 10);
}

async function fetchPhoto(link: string) {
  if (!isGooglePhotosLink(link)) throw new Error('Link não é do Google Photos');
  const page = await fetch(link, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' } });
  if (!page.ok) throw new Error(`Google Photos respondeu HTTP ${page.status}`);
  const photoUrl = extractPhotoUrl(await page.text());
  if (!photoUrl) throw new Error('Foto não encontrada no álbum (link privado ou formato mudou)');
  const img = await fetch(photoUrl, { headers: { 'User-Agent': UA, Accept: 'image/*' } });
  const ct = (img.headers.get('content-type') || '').split(';')[0].trim();
  if (!img.ok || !ct.startsWith('image/')) throw new Error(`Download da foto falhou (HTTP ${img.status}, ${ct || 'sem tipo'})`);
  const buf = new Uint8Array(await img.arrayBuffer());
  if (buf.byteLength === 0 || buf.byteLength > MAX_IMAGE_BYTES) throw new Error(`Foto com tamanho inválido (${buf.byteLength} bytes)`);
  const ext = ct === 'image/png' ? '.png' : ct === 'image/webp' ? '.webp' : '.jpg';
  return { buf, contentType: ext === '.jpg' ? 'image/jpeg' : ct, ext };
}

async function addCard(row: { name: string; type: string; variant: string | null; link: string }) {
  const { buf, contentType, ext } = await fetchPhoto(row.link);
  const filename = `${slugify(row.name)}-${await shortHash(row.link)}${ext}`;
  const up = await fetch(`${SB_URL}/storage/v1/object/cards/${encodeURIComponent(filename)}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': contentType, 'x-upsert': 'true' },
    body: buf,
  });
  if (!up.ok) throw new Error(`Upload da foto falhou: ${up.status} ${(await up.text()).slice(0, 160)}`);
  await rest('cards', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      name: row.name, type: row.type, variant: row.variant, tcg: TCG, is_active: true,
      image_url: STORAGE_PUBLIC + filename, import_ref: filename, source_url: row.link,
    }),
  });
}

// ─── Sincronização ──────────────────────────────────────────────

type Totals = { added: number; linked: number; failed: number; variants_backfilled: number; errors: { name: string; type: string; error: string }[] };

async function sync(cfg: { sheet_url: string; sheet_tab: string; cron_secret: string }, chain: number, acc: Totals | null) {
  const startedAt = Date.now();
  const totals: Totals = acc || { added: 0, linked: 0, failed: 0, variants_backfilled: 0, errors: [] };
  let remaining = 0;
  let summary: Record<string, unknown> = {};
  try {
    const rows = await loadSheetRows(cfg.sheet_url, cfg.sheet_tab || 'SINGLES');
    const catalog = await loadCatalog();
    if (chain === 0) totals.variants_backfilled = await backfillVariants(catalog);

    const bySource = new Set(catalog.filter((c) => c.source_url).map((c) => c.source_url));
    const byKey = new Map<string, CardRow[]>();
    for (const c of catalog) {
      if (c.source_url) continue;
      const k = `${c.type}|${cardMatchKey(c.name)}`;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k)!.push(c);
    }

    const seen = new Set<string>();
    const pending: typeof rows = [];
    let already = 0;
    for (const row of rows) {
      if (seen.has(row.link)) continue;
      seen.add(row.link);
      if (bySource.has(row.link)) { already++; continue; }
      // Carta importada antes da automação: liga o link a ela em vez de duplicar.
      const candidates = byKey.get(`${row.type}|${cardMatchKey(row.raw)}`) || [];
      const match = candidates.find((c) => c.is_active) || candidates[0];
      if (match) {
        candidates.splice(candidates.indexOf(match), 1);
        await rest(`cards?id=eq.${match.id}`, {
          method: 'PATCH', headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ source_url: row.link, is_active: true, variant: match.variant || row.variant }),
        });
        totals.linked++;
        continue;
      }
      pending.push(row);
    }

    let cursor = 0;
    const worker = async () => {
      while (cursor < pending.length && Date.now() - startedAt < TIME_BUDGET_MS) {
        const row = pending[cursor++];
        try { await addCard(row); totals.added++; }
        catch (e) {
          totals.failed++;
          if (totals.errors.length < 40) totals.errors.push({ name: row.raw, type: row.type, error: String((e as Error)?.message || e) });
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    remaining = pending.length - cursor;
    summary = { sheet_rows: rows.length, unique_links: seen.size, already };
  } catch (e) {
    summary = { fatal: String((e as Error)?.message || e) };
  }

  const result = { ...summary, ...totals, remaining, chain, finished_at: new Date().toISOString() };
  await finish(result);

  if (remaining > 0 && chain < MAX_CHAIN) {
    await fetch(SELF_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-sync-secret': cfg.cron_secret },
      body: JSON.stringify({ chain: chain + 1, acc: totals }),
    }).catch(() => {});
  }
  return result;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'Método não permitido' }, 405);

  const [cfg] = (await rest('catalog_sync?id=eq.1&select=sheet_url,sheet_tab,cron_secret')) || [];
  if (!cfg) return json({ ok: false, error: 'catalog_sync não configurado' }, 500);

  const secret = req.headers.get('x-sync-secret');
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const authorized = (secret && secret === cfg.cron_secret) || await isAdminToken(token);
  if (!authorized) return json({ ok: false, error: 'Não autorizado' }, 401);
  if (!cfg.sheet_url) return json({ ok: false, error: 'Nenhuma planilha configurada' }, 400);

  const body = await req.json().catch(() => ({}));
  const chain = Number.isInteger(body.chain) ? body.chain : 0;
  if (!(await acquireLock())) return json({ ok: false, error: 'Já existe uma sincronização rodando' }, 409);

  EdgeRuntime.waitUntil(sync(cfg, chain, chain > 0 ? body.acc : null).catch(async (e) => {
    await finish({ fatal: String(e?.message || e), chain }).catch(() => {});
  }));
  return json({ ok: true, started: true }, 202);
});
