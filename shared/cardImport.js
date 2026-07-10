// ──────────────────────────────────────────────────────────────
// Importação de catálogo de cartas a partir do CSV do fornecedor.
// Compartilhado entre o painel admin (preview) e o endpoint
// /api/admin-import-cards (importação autoritativa no servidor).
// ──────────────────────────────────────────────────────────────

export const STORAGE_BASE =
  'https://kjyqnlpiohoewmqmsuxp.supabase.co/storage/v1/object/public/cards/';

const HTML_ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
  '&#039;': "'", '&#39;': "'", '&apos;': "'", '&nbsp;': ' ',
};

// Decodifica entidades HTML nomeadas e numéricas (ex: &#8217; → ’, &#215; → ×).
export function decodeHtmlEntities(input) {
  let s = String(input == null ? '' : input);
  s = s.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => safeFromCodePoint(parseInt(hex, 16)));
  s = s.replace(/&#(\d+);/g, (_, dec) => safeFromCodePoint(parseInt(dec, 10)));
  s = s.replace(/&[a-zA-Z]+;|&#0?39;/g, (m) => (m in HTML_ENTITIES ? HTML_ENTITIES[m] : m));
  return s;
}

function safeFromCodePoint(code) {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try { return String.fromCodePoint(code); } catch { return ''; }
}

// Parser de CSV que respeita aspas, vírgulas internas, "" escapado e quebras de linha em campos.
export function parseCsv(text) {
  const rows = [];
  let field = '';
  let record = [];
  let inQuotes = false;
  const src = String(text == null ? '' : text).replace(/^﻿/, ''); // remove BOM
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      record.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      record.push(field); field = '';
      if (record.length > 1 || record[0] !== '') rows.push(record);
      record = [];
    } else field += c;
  }
  if (field !== '' || record.length > 0) {
    record.push(field);
    if (record.length > 1 || record[0] !== '') rows.push(record);
  }
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const obj = {};
    header.forEach((h, idx) => { obj[h] = r[idx] != null ? r[idx] : ''; });
    return obj;
  });
}

// "Foil Cards (...)" → Foil | "Holo Cards(...)" → Holo | "Regular Cards" → Normal | resto → Normal
export function categoryToType(category) {
  const c = String(category == null ? '' : category).toLowerCase();
  if (c.includes('foil')) return 'Foil';
  if (c.includes('holo')) return 'Holo';
  return 'Normal';
}

// Remove sufixos de marketing e decodifica entidades, mantendo o nome de exibição limpo.
export function cleanName(name) {
  let n = decodeHtmlEntities(name);
  n = n.replace(/\s*MTG\s*Proxy\s*Cards?\s*$/i, '');
  n = n.replace(/\s*MTG\s*Cards?\s*$/i, '');
  return n.trim();
}

// Extrai o nome do arquivo de um caminho (lida com barras de Windows e Unix).
export function basename(pathStr) {
  const p = String(pathStr == null ? '' : pathStr).replace(/\\/g, '/');
  const parts = p.split('/');
  return parts[parts.length - 1] || '';
}

// "$64.99" → 64.99 ; "" → null
export function parseMoney(value) {
  const s = String(value == null ? '' : value).replace(/[$\s,]/g, '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

// Transforma uma linha bruta do CSV em um registro pronto para a tabela `cards`.
// Retorna null quando a linha não tem dados suficientes (nome ou imagem ausentes).
export function rowToCard(row, { storageBase = STORAGE_BASE } = {}) {
  const name = cleanName(row.name);
  const file = basename(row.image_file);
  if (!name || !file) return null;
  return {
    name,
    type: categoryToType(row.category),
    tcg: 'Magic',
    is_active: true,
    image_url: storageBase + file,
    cost_usd: parseMoney(row.price),
    cost_original_usd: parseMoney(row.original_price),
    import_ref: file,
  };
}

// CSV (texto) → { cards, skipped, total }
export function buildCardsFromCsv(text, options = {}) {
  const rows = parseCsv(text);
  const cards = [];
  let skipped = 0;
  const seen = new Set();
  for (const row of rows) {
    const card = rowToCard(row, options);
    if (!card) { skipped++; continue; }
    if (seen.has(card.import_ref)) { skipped++; continue; } // protege o upsert de conflitos internos
    seen.add(card.import_ref);
    cards.push(card);
  }
  return { cards, skipped, total: rows.length };
}

// ──────────────────────────────────────────────────────────────
// Adição de cartas por link de imagem (ex: Google Imagens).
// Compartilhado entre o painel admin (preview) e o endpoint
// /api/admin-add-cards-by-link (download + upload no servidor).
// ──────────────────────────────────────────────────────────────

// Link de resultado do Google Imagens (…/imgres?imgurl=https%3A%2F%2F…) → URL real da imagem.
// Se já for uma URL direta (ex: "copiar endereço da imagem"), retorna como está.
export function extractImageUrl(link) {
  const s = String(link == null ? '' : link).trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    if (/(^|\.)google\.[a-z.]+$/i.test(u.hostname) && u.pathname.includes('/imgres')) {
      const imgurl = u.searchParams.get('imgurl');
      if (imgurl) return imgurl;
    }
    return s;
  } catch {
    return s;
  }
}

// "Aragorn, King of Gondor" → "aragorn-king-of-gondor"
export function slugify(input) {
  const s = String(input == null ? '' : input)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s.slice(0, 80) || 'carta';
}

// Lista colada pelo admin (uma carta por linha: "Nome da carta | link da imagem").
// Linhas vazias e iniciadas com "#" são ignoradas. Separa itens válidos de
// inválidos para exibir um preview antes de enviar ao servidor.
export function parseCardLinkList(text) {
  const lines = String(text == null ? '' : text).split(/\r\n|\r|\n/);
  const items = [];
  const invalid = [];
  let total = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    total++;
    const idx = line.indexOf('|');
    if (idx === -1) { invalid.push({ raw: line, error: 'Formato esperado: Nome da carta | link da imagem' }); continue; }
    const name = cleanName(line.slice(0, idx).trim());
    const url = extractImageUrl(line.slice(idx + 1).trim());
    if (!name || !url) { invalid.push({ raw: line, error: 'Nome ou link ausente' }); continue; }
    items.push({ name, url });
  }
  return { items, invalid, total };
}
