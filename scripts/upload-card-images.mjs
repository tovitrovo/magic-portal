#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────
// Sobe as imagens das cartas para o bucket público `cards` do Supabase.
// Os arquivos devem ter o mesmo nome que aparece na coluna image_file
// do CSV (ex: tom-bombadil-hoc-38-mtg-proxy-cards.jpg), pois os
// image_url gravados no banco apontam para cards/<nome-do-arquivo>.
//
// Requisitos: Node 18+ (usa fetch nativo). Sem dependências.
//
// Uso (Windows PowerShell):
//   $env:SB_SERVICE_ROLE_KEY="sua-service-role-key"
//   node scripts/upload-card-images.mjs "C:\caminho\para\output\images"
//
// Uso (macOS/Linux):
//   SB_SERVICE_ROLE_KEY=sua-service-role-key \
//     node scripts/upload-card-images.mjs ./output/images
//
// A service-role key fica em: Supabase → Project Settings → API → service_role.
// NUNCA commite essa chave; passe sempre por variável de ambiente.
// ──────────────────────────────────────────────────────────────

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';

const SB_URL = process.env.SB_URL || 'https://kjyqnlpiohoewmqmsuxp.supabase.co';
const KEY = process.env.SB_SERVICE_ROLE_KEY;
const BUCKET = process.env.SB_BUCKET || 'cards';
const DIR = process.argv[2];
const CONCURRENCY = Number(process.env.CONCURRENCY || 8);

const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif',
};

function die(msg) { console.error('❌ ' + msg); process.exit(1); }

if (!KEY) die('Defina a variável de ambiente SB_SERVICE_ROLE_KEY.');
if (!DIR) die('Informe a pasta das imagens. Ex: node scripts/upload-card-images.mjs ./output/images');

async function listFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await listFiles(full));
    else if (MIME[extname(entry.name).toLowerCase()]) out.push(full);
  }
  return out;
}

async function uploadOne(file, attempt = 1) {
  const name = basename(file);
  const ct = MIME[extname(name).toLowerCase()] || 'application/octet-stream';
  const body = await readFile(file);
  const res = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': ct,
      'x-upsert': 'true', // sobrescreve se já existir
    },
    body,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    if (attempt < 4 && (res.status >= 500 || res.status === 429)) {
      await new Promise(r => setTimeout(r, attempt * 1000));
      return uploadOne(file, attempt + 1);
    }
    throw new Error(`${name}: ${res.status} ${t.slice(0, 160)}`);
  }
}

(async () => {
  try { if (!(await stat(DIR)).isDirectory()) die(`Não é uma pasta: ${DIR}`); }
  catch { die(`Pasta não encontrada: ${DIR}`); }

  const files = await listFiles(DIR);
  if (files.length === 0) die(`Nenhuma imagem (.jpg/.jpeg/.png/.webp/.gif) em ${DIR}`);
  console.log(`📦 ${files.length} imagens → bucket "${BUCKET}" em ${SB_URL}\n`);

  let done = 0, failed = 0;
  const errors = [];
  let idx = 0;

  async function worker() {
    while (idx < files.length) {
      const file = files[idx++];
      try { await uploadOne(file); }
      catch (e) { failed++; errors.push(String(e.message || e)); }
      done++;
      if (done % 100 === 0 || done === files.length) {
        process.stdout.write(`\r  ${done}/${files.length} enviadas (${failed} falhas)`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, worker));
  console.log('\n');
  if (errors.length) {
    console.log(`⚠️  ${errors.length} falhas (primeiras 10):`);
    errors.slice(0, 10).forEach(e => console.log('   - ' + e));
    process.exit(1);
  }
  console.log('✅ Upload concluído. As cartas já devem exibir as imagens.');
})();
