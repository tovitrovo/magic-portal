// ──────────────────────────────────────────────────────────────
// Sincronização com a planilha do fornecedor (Google Sheets, aba SINGLES).
//
// Só lógica pura: ler o XML do .xlsx exportado, achar as colunas
// "New Updated Cards", limpar o nome e reconhecer a variante. Quem baixa a
// planilha, resolve o Google Photos e grava no banco é a Edge Function
// supabase/functions/sync-supplier-sheet. Sem dependência de Node ou Deno,
// para rodar lá, nos testes e no front (lista de variantes).
// ──────────────────────────────────────────────────────────────

// Acabamentos especiais. Ficam numa coluna própria (cards.variant) e saem do
// nome. A ordem importa: "raised golden foil" precisa casar antes de
// "golden foil". "sliver" é erro de digitação recorrente na planilha.
const VARIANT_RULES = [
  ['Raised Golden Foil', /raised\s*gold(?:en)?\s*foil/],
  ['Raised Silver Foil', /raised\s*s(?:il|li)ver\s*foil/],
  ['Surge Foil', /surge\s*foil/],
  ['Golden Foil', /golden\s*foil/],
  ['Silver Foil', /silver\s*foil/],
  ['Galaxy Foil', /galaxy\s*foil/],
  ['Etched Foil', /etched\s*foil/],
  ['Neon Ink Foil', /neon\s*ink\s*foil/],
  ['Fracture Foil', /fracture\s*foil/],
  ['Dragonscale Foil', /dragon\s*scale\s*foil/],
  ['Chocobo Track Foil', /chocobo\s*track\s*foil/],
].map(([label, re]) => ({
  label,
  // Casa a expressão solta ou entre parênteses: "(raised golden foil)EN".
  re: new RegExp(`\\(\\s*${re.source}\\s*\\)|\\b${re.source}\\b`, 'i'),
}));

export const VARIANTS = VARIANT_RULES.map((v) => v.label);

export function detectVariant(name) {
  const s = String(name == null ? '' : name);
  const rule = VARIANT_RULES.find((v) => v.re.test(s));
  return rule ? rule.label : null;
}

// Nome exibido: o texto da planilha, sem a variante e sem "foil"/"holo" no
// fim. A coluna já diz se a carta é Foil ou Holo. Só o FIM é cortado porque
// "Foil (PCY)" é o nome de uma carta de verdade; "none foil" também fica,
// porque descreve a carta, não o acabamento.
export function cleanCardName(raw) {
  let n = String(raw == null ? '' : raw).replace(/ /g, ' ');
  const rule = VARIANT_RULES.find((v) => v.re.test(n));
  if (rule) n = n.replace(rule.re, ' ');
  n = n.replace(/\s+/g, ' ').trim();
  for (;;) {
    const m = n.match(/^(.*\S)\s*\b(foil|holo)$/i);
    if (!m || /\bnon[e-]?\s*$/i.test(m[1])) break;
    n = m[1].trim();
  }
  return n.replace(/\s+/g, ' ').trim() || String(raw).trim();
}

// Chave para reconhecer no banco uma carta importada antes desta automação,
// quando ainda não existia cards.source_url. Os nomes antigos variam muito
// ("Scalding TarnSPG#112foil", "... MTG Proxy Cards"), então só sobram
// letras e números. Usar com o texto CRU da planilha, não o nome limpo.
export function cardMatchKey(name) {
  return String(name == null ? '' : name)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/mtg\s*proxy(\s*cards?)?|foil|holo/g, '')
    .replace(/[^a-z0-9]/g, '');
}

// "REGULAR CARDS" → Normal | "HOLO CARDS" → Holo | "FOIL CARDS" → Foil
export function sectionToType(label) {
  const s = String(label || '').toLowerCase();
  if (s.includes('foil')) return 'Foil';
  if (s.includes('holo')) return 'Holo';
  if (s.includes('regular') || s.includes('normal')) return 'Normal';
  return null;
}

// ─── Leitura do .xlsx (XML já descompactado) ────────────────────

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXml(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(code); } catch { return m; }
    }
    return XML_ENTITIES[e.toLowerCase()] ?? m;
  });
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return m ? decodeXml(m[1]) : null;
}

function textRuns(xml) {
  let out = '';
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += m[1];
  return decodeXml(out);
}

export function parseSharedStrings(xml) {
  if (!xml) return [];
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textRuns(m[1]));
}

// Relationships: Id → Target.
export function parseRels(xml) {
  const rels = {};
  for (const m of String(xml || '').matchAll(/<Relationship\b[^>]*>/g)) {
    const id = attr(m[0], 'Id');
    if (id) rels[id] = attr(m[0], 'Target');
  }
  return rels;
}

// Caminho do XML de uma aba pelo nome, a partir de workbook.xml e de
// xl/_rels/workbook.xml.rels. Devolve null se a aba não existir.
export function findSheetPath(workbookXml, workbookRelsXml, sheetName) {
  const rels = parseRels(workbookRelsXml);
  const wanted = String(sheetName).trim().toLowerCase();
  for (const m of String(workbookXml).matchAll(/<sheet\b[^>]*>/g)) {
    if ((attr(m[0], 'name') || '').trim().toLowerCase() !== wanted) continue;
    const target = rels[attr(m[0], 'r:id')];
    if (!target) return null;
    return target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  }
  return null;
}

export function splitRef(ref) {
  const m = String(ref).match(/^([A-Z]+)(\d+)$/);
  return m ? { col: m[1], row: Number(m[2]) } : null;
}

// Células com valor de texto e hiperlinks de uma aba.
// Retorna Map "B5" → { col, row, text, link }.
export function parseSheetCells(sheetXml, sharedStrings, sheetRelsXml) {
  const rels = parseRels(sheetRelsXml);
  const cells = new Map();
  for (const m of String(sheetXml).matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const head = m[1];
    const ref = attr(head, 'r');
    const pos = ref && splitRef(ref);
    if (!pos) continue;
    const body = m[2] || '';
    const t = attr(head, 't');
    let text = '';
    if (t === 's') {
      const v = body.match(/<v>([\s\S]*?)<\/v>/);
      text = v ? sharedStrings[Number(v[1])] ?? '' : '';
    } else if (t === 'inlineStr') {
      text = textRuns(body);
    } else {
      const v = body.match(/<v>([\s\S]*?)<\/v>/);
      text = v ? decodeXml(v[1]) : '';
    }
    cells.set(ref, { ...pos, text: text.trim(), link: null });
  }
  for (const m of String(sheetXml).matchAll(/<hyperlink\b[^>]*>/g)) {
    const ref = attr(m[0], 'ref');
    const target = rels[attr(m[0], 'r:id')];
    if (!ref || !target) continue;
    // Um hyperlink pode cobrir um intervalo ("B5:B6"); vale a primeira célula.
    const first = ref.split(':')[0];
    const cell = cells.get(first) || { ...splitRef(first), text: '' };
    cells.set(first, { ...cell, link: target });
  }
  return cells;
}

const NEW_HEADER = /new\s+updated\s+cards/i;
const BLOCK_HEADER = /new\s+updates?/i;

// As colunas de cartas novas ("New Updated Cards") da aba, com o tipo de cada
// uma vindo do título da seção acima ("REGULAR CARDS", "HOLO CARDS", ...).
// Retorna [{ type, row, block, raw, name, variant, link }] na ordem da
// planilha. Linhas sem link são ignoradas; cabeçalhos de lote ("10.26 NEW
// Updates") viram o campo block das linhas abaixo.
export function extractNewCards(cells) {
  const byCol = new Map();
  for (const c of cells.values()) {
    if (!byCol.has(c.col)) byCol.set(c.col, []);
    byCol.get(c.col).push(c);
  }
  const columns = [];
  for (const c of cells.values()) {
    if (!NEW_HEADER.test(c.text)) continue;
    // O título da seção fica na linha de cima, na própria coluna ou numa
    // célula mesclada à esquerda (A2 "REGULAR CARDS" cobre A e B).
    let type = null;
    for (let back = 0; back < 3 && !type; back++) {
      const col = shiftCol(c.col, -back);
      if (!col) break;
      for (let r = c.row - 1; r >= Math.max(1, c.row - 3) && !type; r--) {
        type = sectionToType(cells.get(`${col}${r}`)?.text);
      }
    }
    if (type) columns.push({ col: c.col, headerRow: c.row, type });
  }

  const out = [];
  for (const { col, headerRow, type } of columns) {
    const rows = (byCol.get(col) || []).filter((c) => c.row > headerRow).sort((a, b) => a.row - b.row);
    let block = null;
    for (const c of rows) {
      if (BLOCK_HEADER.test(c.text) && !c.link) { block = c.text.split(/\s+/)[0]; continue; }
      if (!c.link || !c.text) continue;
      out.push({
        type, row: c.row, block, raw: c.text, link: c.link,
        name: cleanCardName(c.text), variant: detectVariant(c.text),
      });
    }
  }
  return out.sort((a, b) => a.row - b.row || a.type.localeCompare(b.type));
}

function shiftCol(col, delta) {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  n += delta;
  if (n < 1) return null;
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

// ─── Google Sheets / Google Photos ──────────────────────────────

export function sheetIdFromUrl(url) {
  const m = String(url || '').match(/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/);
  return m ? m[1] : null;
}

export function sheetExportUrl(url) {
  const id = sheetIdFromUrl(url);
  return id ? `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx` : null;
}

export function isGooglePhotosLink(url) {
  try { return /^(photos\.app\.goo\.gl|photos\.google\.com)$/i.test(new URL(url).hostname); }
  catch { return false; }
}

// Cada link da planilha é um álbum compartilhado com uma foto só. A página
// pública embute a URL da foto (lh3.googleusercontent.com/pw/...); sem API
// oficial, é isso ou nada. Se o Google mudar o HTML, cai aqui.
export function extractPhotoUrl(html, size = 'w1600-h1600') {
  const m = String(html || '').match(/https:\/\/lh3\.googleusercontent\.com\/pw\/[A-Za-z0-9_-]+/);
  return m ? `${m[0]}=${size}` : null;
}
